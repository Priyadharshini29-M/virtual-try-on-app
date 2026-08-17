#!/usr/bin/env python
"""One-time MySQL -> Postgres ETL for the FitFyce PHP -> Python migration.

Re-runnable: every write is an idempotent upsert (INSERT ... ON CONFLICT),
so this can be run repeatedly against a staging Postgres while validating,
and safely re-run in production without creating duplicates.

Source connection (MySQL, the live fitfyce-php database) is read from
MYSQL_HOST / MYSQL_DB / MYSQL_USER / MYSQL_PASSWORD env vars, or copied
directly from fitfyce-php/.env via --php-env-path (reuses that file's
DB_HOST/DB_NAME/DB_USER/DB_PASS keys verbatim, since that's the connection
info an operator running this already has).

Destination connection (Postgres) is read from this project's own
Settings.database_url_sync (fitfyce-py/.env), same as Alembic uses.

Usage:
    python scripts/migrate_data.py --php-env-path ../fitfyce-php/.env
    python scripts/migrate_data.py                      # uses MYSQL_* env vars
    python scripts/migrate_data.py --dry-run             # connect + report only, no writes

Order (respects FK dependencies in the target schema):
    1. plan_limits   (seeded reference data, NOT migrated from MySQL — see PLAN_LIMIT_SEED)
    2. merchants     (plan remapped: free/starter/growth/scale -> basic/pro/premium)
    3. merchant_settings
    4. products
    5. variant_image_mappings
    6. tryon_sessions
    7. tryon_conversions
    8. analytics_daily

`collections` / `product_collection_map` (new normalized tables that don't
exist in the legacy MySQL schema, which denormalizes collection_id/title/
handle directly onto `products`) are deliberately NOT populated here — the
running app repopulates them itself via ProductRepo's collection-upsert
path the first time each merchant's catalog is synced from Shopify, so
there is nothing to migrate for them.

Every source table is inserted with its original integer/UUID primary key
preserved, so all cross-table foreign keys carry over unchanged with zero
ID remapping. Postgres SERIAL sequences are reset to MAX(id)+1 for every
table that used one, at the end of the run, so future inserts don't collide.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras
import pymysql
import pymysql.cursors

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings  # noqa: E402

# free -> basic, starter -> pro, growth -> pro, scale -> premium — the
# resolved 4-tier-legacy-data -> 3-tier-intended-model mapping from the
# migration plan.
PLAN_REMAP = {"free": "basic", "starter": "pro", "growth": "pro", "scale": "premium"}

# Reference data, not per-merchant instance data — plan_limits describes the
# NEW 3-tier product, so it's seeded fresh rather than migrated. Values
# chosen by combining whichever of the two legacy tiers now map to the same
# new tier (pro = max(starter, growth), since both collapse into it):
# basic mirrors old 'free', pro mirrors old 'growth' (the more generous of
# starter/growth), premium mirrors old 'scale'.
PLAN_LIMIT_SEED = [
    # plan,      monthly_tryon_limit, max_products, analytics, custom_api, branding_removable, share, price_inr_monthly
    ("basic", 50, 1, False, False, False, True, 0),
    ("pro", 3000, 0, True, False, True, True, 2499),
    ("premium", 0, 0, True, True, True, True, 5999),
]


def parse_php_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def get_mysql_conn(args: argparse.Namespace):
    if args.php_env_path:
        php_env = parse_php_env(Path(args.php_env_path))
        host, db, user, password = php_env["DB_HOST"], php_env["DB_NAME"], php_env["DB_USER"], php_env["DB_PASS"]
    else:
        import os

        host = os.environ.get("MYSQL_HOST", "localhost")
        db = os.environ["MYSQL_DB"]
        user = os.environ["MYSQL_USER"]
        password = os.environ.get("MYSQL_PASSWORD", "")

    return pymysql.connect(
        host=host, database=db, user=user, password=password,
        charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor, connect_timeout=10,
    )


def get_pg_conn():
    settings = get_settings()
    # database_url_sync is postgresql+psycopg2://... ; psycopg2.connect wants
    # a plain postgresql:// DSN.
    dsn = settings.database_url_sync.replace("postgresql+psycopg2://", "postgresql://", 1)
    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    return conn


def seed_plan_limits(pg) -> int:
    with pg.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO plan_limits
                (plan, monthly_tryon_limit, max_products, analytics_enabled,
                 custom_api_enabled, branding_removable, share_enabled, price_inr_monthly)
            VALUES %s
            ON CONFLICT (plan) DO UPDATE SET
                monthly_tryon_limit = EXCLUDED.monthly_tryon_limit,
                max_products = EXCLUDED.max_products,
                analytics_enabled = EXCLUDED.analytics_enabled,
                custom_api_enabled = EXCLUDED.custom_api_enabled,
                branding_removable = EXCLUDED.branding_removable,
                share_enabled = EXCLUDED.share_enabled,
                price_inr_monthly = EXCLUDED.price_inr_monthly
            """,
            PLAN_LIMIT_SEED,
        )
    pg.commit()
    return len(PLAN_LIMIT_SEED)


def migrate_merchants(mysql, pg) -> tuple[int, dict[str, int]]:
    with mysql.cursor() as cur:
        cur.execute("SELECT * FROM merchants")
        rows = cur.fetchall()

    unmapped_plans: dict[str, int] = {}
    n = 0
    with pg.cursor() as cur:
        for r in rows:
            source_plan = (r.get("plan") or "").strip().lower()
            plan = PLAN_REMAP.get(source_plan)
            if plan is None:
                unmapped_plans[source_plan] = unmapped_plans.get(source_plan, 0) + 1
                plan = "basic"  # safe fallback — never silently grant a higher tier than intended

            cur.execute(
                """
                INSERT INTO merchants
                    (id, shopify_domain, shopify_store_id, access_token, plan, api_key, api_secret,
                     tryon_count_month, billing_cycle_start, is_active, shopify_plan,
                     installed_theme_name, installed_theme_id, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    shopify_domain = EXCLUDED.shopify_domain,
                    shopify_store_id = EXCLUDED.shopify_store_id,
                    access_token = EXCLUDED.access_token,
                    plan = EXCLUDED.plan,
                    api_key = EXCLUDED.api_key,
                    api_secret = EXCLUDED.api_secret,
                    tryon_count_month = EXCLUDED.tryon_count_month,
                    billing_cycle_start = EXCLUDED.billing_cycle_start,
                    is_active = EXCLUDED.is_active,
                    shopify_plan = EXCLUDED.shopify_plan,
                    installed_theme_name = EXCLUDED.installed_theme_name,
                    installed_theme_id = EXCLUDED.installed_theme_id,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    r["id"], r["shopify_domain"], r["shopify_store_id"], r["access_token"], plan,
                    r["api_key"], r["api_secret"], r.get("tryon_count_month", 0), r.get("billing_cycle_start"),
                    bool(r.get("is_active", 1)), r.get("shopify_plan"), r.get("installed_theme_name"),
                    r.get("installed_theme_id"), r["created_at"], r["updated_at"],
                ),
            )
            n += 1
    pg.commit()
    return n, unmapped_plans


def migrate_merchant_settings(mysql, pg) -> int:
    with mysql.cursor() as cur:
        cur.execute("SELECT * FROM merchant_settings")
        rows = cur.fetchall()

    n = 0
    with pg.cursor() as cur:
        for r in rows:
            widget_config = _parse_json(r.get("widget_config"))
            products_json = _parse_json(r.get("products_json"))
            enabled_products = _parse_json(r.get("enabled_products"))

            cur.execute(
                """
                INSERT INTO merchant_settings
                    (id, merchant_id, shopify_domain, shopify_store_id, widget_config, products_json, enabled_products)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (merchant_id) DO UPDATE SET
                    shopify_domain = EXCLUDED.shopify_domain,
                    shopify_store_id = EXCLUDED.shopify_store_id,
                    widget_config = EXCLUDED.widget_config,
                    products_json = EXCLUDED.products_json,
                    enabled_products = EXCLUDED.enabled_products
                """,
                (
                    r["id"], r["merchant_id"], r.get("shopify_domain"), r.get("shopify_store_id"),
                    psycopg2.extras.Json(widget_config) if widget_config is not None else None,
                    psycopg2.extras.Json(products_json) if products_json is not None else None,
                    psycopg2.extras.Json(enabled_products) if enabled_products is not None else None,
                ),
            )
            n += 1
    pg.commit()
    return n


def migrate_products(mysql, pg) -> int:
    with mysql.cursor() as cur:
        cur.execute("SELECT * FROM products")
        rows = cur.fetchall()

    n = 0
    with pg.cursor() as cur:
        for r in rows:
            cur.execute(
                """
                INSERT INTO products
                    (id, merchant_id, shopify_domain, shopify_store_id, shopify_product_id, shopify_product_gid,
                     title, handle, is_tryon_enabled, collection_id, collection_title, collection_handle,
                     created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    handle = EXCLUDED.handle,
                    is_tryon_enabled = EXCLUDED.is_tryon_enabled,
                    collection_id = EXCLUDED.collection_id,
                    collection_title = EXCLUDED.collection_title,
                    collection_handle = EXCLUDED.collection_handle,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    r["id"], r["merchant_id"], r.get("shopify_domain"), r.get("shopify_store_id"),
                    r["shopify_product_id"], r["shopify_product_gid"], r.get("title"), r.get("handle"),
                    bool(r.get("is_tryon_enabled", 1)), r.get("collection_id"), r.get("collection_title"),
                    r.get("collection_handle"), r["created_at"], r["updated_at"],
                ),
            )
            n += 1
    pg.commit()
    return n


def migrate_variant_image_mappings(mysql, pg) -> int:
    with mysql.cursor() as cur:
        cur.execute("SELECT * FROM variant_image_mappings")
        rows = cur.fetchall()

    n = 0
    with pg.cursor() as cur:
        for r in rows:
            cur.execute(
                """
                INSERT INTO variant_image_mappings
                    (id, merchant_id, product_id, shopify_variant_id, shopify_variant_gid, variant_title,
                     tryon_image_url, image_type, garment_type, avatar_sex, clothing_prompt, is_approved,
                     created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    variant_title = EXCLUDED.variant_title,
                    tryon_image_url = EXCLUDED.tryon_image_url,
                    image_type = EXCLUDED.image_type,
                    garment_type = EXCLUDED.garment_type,
                    avatar_sex = EXCLUDED.avatar_sex,
                    clothing_prompt = EXCLUDED.clothing_prompt,
                    is_approved = EXCLUDED.is_approved,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    r["id"], r["merchant_id"], r["product_id"], r["shopify_variant_id"], r["shopify_variant_gid"],
                    r.get("variant_title"), r["tryon_image_url"], r.get("image_type", "flat_lay"),
                    # `garment_type` doesn't exist on the legacy MySQL table (added later,
                    # runtime-ALTERed in some deployments) — default to 'top' when absent.
                    r.get("garment_type", "top"), r.get("avatar_sex"), r.get("clothing_prompt"),
                    bool(r.get("is_approved", 1)), r["created_at"], r["updated_at"],
                ),
            )
            n += 1
    pg.commit()
    return n


def migrate_tryon_sessions(mysql, pg) -> int:
    with mysql.cursor() as cur:
        cur.execute("SELECT * FROM tryon_sessions")
        rows = cur.fetchall()

    n = 0
    with pg.cursor() as cur:
        for r in rows:
            cur.execute(
                """
                INSERT INTO tryon_sessions
                    (id, merchant_id, shopify_domain, shopify_store_id, product_id, variant_id, status,
                     result_image_url, result_seed, result_expires_at, error_message, api_request_at,
                     api_response_at, api_latency_ms, action_add_to_cart, action_buy_now, action_save_image,
                     action_share_wa, device_type, country_code, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    result_image_url = EXCLUDED.result_image_url,
                    result_seed = EXCLUDED.result_seed,
                    result_expires_at = EXCLUDED.result_expires_at,
                    error_message = EXCLUDED.error_message,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    r["id"], r["merchant_id"], r.get("shopify_domain"), r.get("shopify_store_id"),
                    # `products.id` may legitimately be absent (product deleted after the
                    # session was created) — the target column is nullable ON DELETE SET NULL.
                    r.get("product_id") or None, r.get("variant_id"), r.get("status", "pending"),
                    r.get("result_image_url"), r.get("result_seed"), r.get("result_expires_at"),
                    r.get("error_message"), r.get("api_request_at"), r.get("api_response_at"),
                    r.get("api_latency_ms"), bool(r.get("action_add_to_cart", 0)), bool(r.get("action_buy_now", 0)),
                    bool(r.get("action_save_image", 0)), bool(r.get("action_share_wa", 0)), r.get("device_type"),
                    r.get("country_code"), r["created_at"], r["updated_at"],
                ),
            )
            n += 1
    pg.commit()
    return n


def migrate_tryon_conversions(mysql, pg) -> int:
    with mysql.cursor() as cur:
        cur.execute("SELECT * FROM tryon_conversions")
        rows = cur.fetchall()

    n = 0
    with pg.cursor() as cur:
        for r in rows:
            cur.execute(
                """
                INSERT INTO tryon_conversions
                    (id, tryon_session_id, merchant_id, shopify_domain, shopify_store_id, shopify_order_id,
                     shopify_order_gid, order_value_inr, attributed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    r["id"], r["tryon_session_id"], r["merchant_id"], r.get("shopify_domain"),
                    r.get("shopify_store_id"), r["shopify_order_id"], r.get("shopify_order_gid"),
                    r.get("order_value_inr"), r["attributed_at"],
                ),
            )
            n += 1
    pg.commit()
    return n


def migrate_analytics_daily(mysql, pg) -> int:
    with mysql.cursor() as cur:
        cur.execute("SELECT * FROM analytics_daily")
        rows = cur.fetchall()

    n = 0
    with pg.cursor() as cur:
        for r in rows:
            cur.execute(
                """
                INSERT INTO analytics_daily
                    (id, merchant_id, shopify_domain, shopify_store_id, date, tryon_initiated, tryon_completed,
                     tryon_failed, add_to_cart_count, buy_now_count, save_count, share_wa_count, order_count,
                     revenue_inr, avg_latency_ms, computed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (merchant_id, date) DO UPDATE SET
                    tryon_initiated = EXCLUDED.tryon_initiated,
                    tryon_completed = EXCLUDED.tryon_completed,
                    tryon_failed = EXCLUDED.tryon_failed,
                    add_to_cart_count = EXCLUDED.add_to_cart_count,
                    buy_now_count = EXCLUDED.buy_now_count,
                    save_count = EXCLUDED.save_count,
                    share_wa_count = EXCLUDED.share_wa_count,
                    order_count = EXCLUDED.order_count,
                    revenue_inr = EXCLUDED.revenue_inr,
                    avg_latency_ms = EXCLUDED.avg_latency_ms,
                    computed_at = EXCLUDED.computed_at
                """,
                (
                    r["id"], r["merchant_id"], r.get("shopify_domain"), r.get("shopify_store_id"), r["date"],
                    r.get("tryon_initiated", 0), r.get("tryon_completed", 0), r.get("tryon_failed", 0),
                    r.get("add_to_cart_count", 0), r.get("buy_now_count", 0), r.get("save_count", 0),
                    r.get("share_wa_count", 0), r.get("order_count", 0), r.get("revenue_inr", 0),
                    r.get("avg_latency_ms"), r["computed_at"],
                ),
            )
            n += 1
    pg.commit()
    return n


def reset_sequences(pg) -> None:
    """Explicit IDs were inserted for every SERIAL-PK table above, so their
    sequences need bumping past MAX(id) or the next app-level INSERT will
    collide with a migrated row."""
    tables_with_serial_pk = [
        "merchants", "merchant_settings", "products", "variant_image_mappings",
        "tryon_conversions", "analytics_daily",
    ]
    with pg.cursor() as cur:
        for table in tables_with_serial_pk:
            cur.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table}), 1), (SELECT MAX(id) IS NOT NULL FROM {table}))"
            )
    pg.commit()


def verify_row_counts(mysql, pg) -> None:
    tables = [
        "merchants", "merchant_settings", "products", "variant_image_mappings",
        "tryon_sessions", "tryon_conversions", "analytics_daily",
    ]
    print("\n=== Row count parity check ===")
    for table in tables:
        with mysql.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS c FROM {table}")
            src = cur.fetchone()["c"]
        with pg.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            dst = cur.fetchone()[0]
        flag = "OK" if src == dst else "MISMATCH"
        print(f"  {table:28s} mysql={src:6d}  postgres={dst:6d}  [{flag}]")


def _parse_json(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--php-env-path", help="Path to fitfyce-php/.env to read MySQL creds from")
    parser.add_argument("--dry-run", action="store_true", help="Connect and report row counts only, no writes")
    args = parser.parse_args()

    print("Connecting to source (MySQL) and destination (Postgres)...")
    mysql = get_mysql_conn(args)
    pg = get_pg_conn()

    try:
        if args.dry_run:
            verify_row_counts(mysql, pg)
            return

        print("Seeding plan_limits (basic/pro/premium reference data)...")
        n = seed_plan_limits(pg)
        print(f"  {n} plan tier(s) seeded.")

        print("Migrating merchants (plan remap: free/starter/growth/scale -> basic/pro/premium)...")
        n, unmapped = migrate_merchants(mysql, pg)
        print(f"  {n} merchant(s) migrated.")
        if unmapped:
            print(f"  WARNING: unrecognized plan value(s) encountered, defaulted to 'basic': {unmapped}")

        print("Migrating merchant_settings...")
        print(f"  {migrate_merchant_settings(mysql, pg)} row(s) migrated.")

        print("Migrating products...")
        print(f"  {migrate_products(mysql, pg)} row(s) migrated.")

        print("Migrating variant_image_mappings...")
        print(f"  {migrate_variant_image_mappings(mysql, pg)} row(s) migrated.")

        print("Migrating tryon_sessions...")
        print(f"  {migrate_tryon_sessions(mysql, pg)} row(s) migrated.")

        print("Migrating tryon_conversions...")
        print(f"  {migrate_tryon_conversions(mysql, pg)} row(s) migrated.")

        print("Migrating analytics_daily...")
        print(f"  {migrate_analytics_daily(mysql, pg)} row(s) migrated.")

        print("Resetting Postgres SERIAL sequences past migrated max IDs...")
        reset_sequences(pg)

        verify_row_counts(mysql, pg)
        print("\nMigration complete.")
    finally:
        mysql.close()
        pg.close()


if __name__ == "__main__":
    main()
