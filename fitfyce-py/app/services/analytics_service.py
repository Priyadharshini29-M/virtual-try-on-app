"""Port of db/AnalyticsRepo.php."""

from __future__ import annotations

from datetime import date as date_type

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tryon import AnalyticsDaily

_ALLOWED_INCREMENT_COLS = [
    "tryon_initiated", "tryon_completed", "tryon_failed",
    "add_to_cart_count", "buy_now_count", "save_count",
    "share_wa_count", "order_count", "revenue_inr",
]


async def upsert_daily(db: AsyncSession, merchant_id: int, date: date_type | str, increments: dict) -> None:
    """Port of `AnalyticsRepo::upsertDaily()` — atomic increments via
    INSERT ... ON CONFLICT DO UPDATE (Postgres upsert)."""
    set_clauses = [
        f"{col} = analytics_daily.{col} + :{col}"
        for col in _ALLOWED_INCREMENT_COLS
        if increments.get(col, 0) != 0
    ]
    if not set_clauses:
        return

    domain_row = (
        await db.execute(text("SELECT shopify_domain, shopify_store_id FROM merchants WHERE id = :mid"), {"mid": merchant_id})
    ).mappings().first()
    domain = domain_row["shopify_domain"] if domain_row else None
    store_id = domain_row["shopify_store_id"] if domain_row else None

    set_clauses.append("shopify_domain = COALESCE(analytics_daily.shopify_domain, EXCLUDED.shopify_domain)")
    set_clauses.append("shopify_store_id = COALESCE(analytics_daily.shopify_store_id, EXCLUDED.shopify_store_id)")

    cols = ["merchant_id", "date", "shopify_domain", "shopify_store_id", *_ALLOWED_INCREMENT_COLS]
    placeholders = ", ".join(
        [":merchant_id", ":date_", ":shopify_domain", ":shopify_store_id"]
        + [f":{c}" for c in _ALLOWED_INCREMENT_COLS]
    )

    sql = f"""
        INSERT INTO analytics_daily ({", ".join(cols)})
        VALUES ({placeholders})
        ON CONFLICT (merchant_id, date) DO UPDATE SET {", ".join(set_clauses)}
    """
    params = {
        "merchant_id": merchant_id,
        "date_": date,
        "shopify_domain": domain,
        "shopify_store_id": store_id,
        **{col: increments.get(col, 0) for col in _ALLOWED_INCREMENT_COLS},
    }
    await db.execute(text(sql), params)
    await db.commit()


async def get_range(db: AsyncSession, merchant_id: int, from_date: str, to_date: str) -> list[dict]:
    from_d = date_type.fromisoformat(from_date)
    to_d = date_type.fromisoformat(to_date)
    result = await db.execute(
        select(AnalyticsDaily)
        .where(AnalyticsDaily.merchant_id == merchant_id)
        .where(AnalyticsDaily.date.between(from_d, to_d))
        .order_by(AnalyticsDaily.date.asc())
    )
    rows = result.scalars().all()
    return [
        {
            "date": str(r.date),
            "tryon_initiated": r.tryon_initiated,
            "add_to_cart_count": r.add_to_cart_count,
            "order_count": r.order_count,
            "revenue_inr": float(r.revenue_inr),
            "save_count": r.save_count,
            "share_wa_count": r.share_wa_count,
        }
        for r in rows
    ]


async def get_top_products(db: AsyncSession, merchant_id: int, from_date: str, to_date: str, limit: int = 10) -> list[dict]:
    from_date = date_type.fromisoformat(from_date)
    to_date = date_type.fromisoformat(to_date)
    sql = text("""
        SELECT
            p.shopify_product_id AS id,
            COALESCE(MAX(p.title), MAX(p.collection_title), 'Product #' || p.shopify_product_id) AS title,
            COALESCE(MAX(p.image_url), MIN(vim.tryon_image_url), '') AS image,
            MAX(COALESCE(p.price, 0.00)) AS price,
            COUNT(DISTINCT ts.id) AS tryon_count,
            COALESCE(SUM(CASE WHEN ts.action_buy_now THEN 1 ELSE 0 END), 0) AS buy_count
        FROM tryon_sessions ts
        JOIN products p ON p.id = ts.product_id
        LEFT JOIN variant_image_mappings vim ON vim.product_id = p.id
        WHERE ts.merchant_id = :mid
          AND ts.created_at::date BETWEEN :from_date AND :to_date
        GROUP BY p.id, p.shopify_product_id
        ORDER BY tryon_count DESC, buy_count DESC
        LIMIT :limit
    """)
    rows = (await db.execute(sql, {"mid": merchant_id, "from_date": from_date, "to_date": to_date, "limit": limit})).mappings().all()
    return [
        {
            "id": int(r["id"]),
            "title": str(r["title"]),
            "image": str(r["image"]),
            "price": f"{float(r['price']):.2f}",
            "tryon_count": int(r["tryon_count"]),
            "buy_count": int(r["buy_count"]),
        }
        for r in rows
    ]


async def get_device_split(db: AsyncSession, merchant_id: int, from_date: str, to_date: str) -> dict:
    from_date = date_type.fromisoformat(from_date)
    to_date = date_type.fromisoformat(to_date)
    sql = text("""
        SELECT COALESCE(device_type::text, 'desktop') AS device_type, COUNT(*) AS cnt
        FROM tryon_sessions
        WHERE merchant_id = :mid AND created_at::date BETWEEN :from_date AND :to_date
        GROUP BY device_type
    """)
    rows = (await db.execute(sql, {"mid": merchant_id, "from_date": from_date, "to_date": to_date})).mappings().all()

    counts = {"mobile": 0, "desktop": 0, "tablet": 0}
    for r in rows:
        t = str(r["device_type"])
        if t in counts:
            counts[t] = int(r["cnt"])

    total = sum(counts.values())
    if total == 0:
        return {"mobile": 0, "desktop": 0, "tablet": 0}

    return {k: round((v / total) * 100) for k, v in counts.items()}


def trend_str(current: float, prev: float) -> str:
    if prev == 0.0:
        return "+100.0%" if current > 0 else "+0.0%"
    pct = ((current - prev) / abs(prev)) * 100
    sign = "+" if pct >= 0 else ""
    return f"{sign}{pct:.1f}%"


def build_charts(daily: list[dict]) -> dict:
    if not daily:
        return {"tryons": [0], "cart_rate": [0], "purch_rate": [0], "revenue": [0]}

    tryons, cart_rate, purch_rate, revenue = [], [], [], []
    for row in daily:
        initiated = int(row.get("tryon_initiated", 0))
        cart = int(row.get("add_to_cart_count", 0))
        orders = int(row.get("order_count", 0))
        rev = float(row.get("revenue_inr", 0))

        tryons.append(initiated)
        cart_rate.append(round((cart / initiated) * 100, 1) if initiated > 0 else 0.0)
        purch_rate.append(round((orders / initiated) * 100, 2) if initiated > 0 else 0.0)
        revenue.append(round(rev, 2))

    return {"tryons": tryons, "cart_rate": cart_rate, "purch_rate": purch_rate, "revenue": revenue}
