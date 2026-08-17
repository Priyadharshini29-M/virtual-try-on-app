"""Port of SessionController.php.

`authenticate()` is a custom auth pattern distinct from the standard 3 —
tries `X-Api-Key` first (full ApiKeyAuth, including master-key bypass),
falls back to `?shop=` domain lookup (active merchants only) if no key was
sent. Implemented inline rather than as a shared dependency since it's the
only controller using exactly this fallback order.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Identity, require_api_key
from app.core.constants import ACTION_ANALYTICS_MAP, SESSION_ACTIONS
from app.core.logging import get_logger
from app.db.session import get_db
from app.models.merchant import Merchant
from app.services import analytics_service, product_service, session_service
from app.services.merchant_service import find_merchant_by_domain

router = APIRouter()
logger = get_logger(__name__)


async def _authenticate(request: Request, db: AsyncSession) -> Merchant | None:
    x_api_key = request.headers.get("X-Api-Key", "").strip()
    if x_api_key:
        try:
            identity: Identity = await require_api_key(x_api_key=x_api_key, db=db)
        except Exception:  # noqa: BLE001 — require_api_key raises HTTPException(401) on failure
            return None
        return identity.merchant  # None for master key — caller treats that as unauthenticated for this flow

    shop = request.query_params.get("shop", "").strip()
    if shop:
        merchant = await find_merchant_by_domain(db, shop)
        if merchant is not None and merchant.is_active:
            return merchant
    return None


@router.post("/session/create")
@router.post("/api/session/create")
async def create_session(
    request: Request,
    db: AsyncSession = Depends(get_db),
    body: dict = Body(...),
) -> JSONResponse:
    merchant = await _authenticate(request, db)
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    product_id = body.get("product_id")
    if product_id is None:
        return JSONResponse({"error": "product_id is required"}, status_code=400)
    product_id = int(product_id)
    variant_id = int(body["variant_id"]) if body.get("variant_id") is not None else None
    device_type = body.get("device_type")
    country_code = body.get("country_code")

    db_product = await product_service.find_by_shopify_id(db, merchant.id, product_id)
    session_uuid = None
    if db_product is not None:
        try:
            session_uuid = await session_service.create(db, merchant.id, db_product.id, variant_id, device_type, country_code)
        except Exception as exc:  # noqa: BLE001
            logger.error("session create failed: %s", exc)

    try:
        from datetime import date
        await analytics_service.upsert_daily(db, merchant.id, date.today(), {"tryon_initiated": 1})
    except Exception as exc:  # noqa: BLE001
        logger.error("analytics upsert failed: %s", exc)

    return JSONResponse({"session_id": str(session_uuid) if session_uuid else None})


@router.post("/session/track")
@router.post("/api/session/track")
async def track_session(
    request: Request,
    db: AsyncSession = Depends(get_db),
    body: dict = Body(...),
) -> JSONResponse:
    merchant = await _authenticate(request, db)
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    sess_id = str(body.get("session_id", "")).strip()
    action = str(body.get("action", "")).strip()

    if sess_id == "" or action not in SESSION_ACTIONS:
        return JSONResponse({"error": "Invalid session_id or action"}, status_code=400)

    session = await session_service.find_by_id(db, sess_id)
    if session is None or session.merchant_id != merchant.id:
        return JSONResponse({"error": "Session not found"}, status_code=404)

    await session_service.track_action(db, sess_id, action)

    try:
        from datetime import date
        await analytics_service.upsert_daily(db, merchant.id, date.today(), {ACTION_ANALYTICS_MAP[action]: 1})
    except Exception as exc:  # noqa: BLE001
        logger.error("analytics track failed: %s", exc)

    return JSONResponse({"ok": True})


@router.post("/session/update")
async def update_session(
    db: AsyncSession = Depends(get_db),
    body: dict = Body(...),
) -> JSONResponse:
    """New route — called by Remix's api.tryon.jsx fire-and-forget after a
    /tryon call completes, to persist the result onto the session row. This
    route doesn't exist anywhere in the current PHP backend (confirmed
    absent from both router.php and api.php) — a pre-existing gap, not a
    behavior change from this rewrite.
    """
    session_id = str(body.get("session_id", "")).strip()
    if session_id == "":
        return JSONResponse({"error": "session_id is required"}, status_code=400)

    session = await session_service.find_by_id(db, session_id)
    if session is None:
        return JSONResponse({"error": "Session not found"}, status_code=404)

    extra = {}
    for col in ["result_image_url", "result_seed", "result_expires_at", "error_message"]:
        if col in body:
            extra[col] = body[col]

    status = body.get("status", session.status)
    await session_service.update_status(db, session_id, status, **extra)

    return JSONResponse({"ok": True})
