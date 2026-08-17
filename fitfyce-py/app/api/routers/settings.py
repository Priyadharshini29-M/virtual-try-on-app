"""Port of SettingsController.php.

`toResponse()` in the PHP source is field-for-field identical to
`WidgetController::flatConfig()` except it adds a `merchant_id` key — reuse
`flat_widget_config()` rather than duplicating ~45 lines of coalesce logic.

Unlike `PATCH /widget/settings`, `POST /settings` does NOT run field
validation/clamping (`sanitizeFields()`) — its docblock explicitly calls it
a "full-replace save," merging whatever the client sends directly. Keep
that distinction; don't reuse `sanitize_widget_fields()` here.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Identity, require_api_key
from app.core.logging import get_logger
from app.db.session import get_db
from app.services.settings_service import flat_widget_config, get_or_create_settings_row, patch_widget_config

router = APIRouter()
logger = get_logger(__name__)


def _to_response(widget_config: dict, merchant_id: int) -> dict:
    return {"merchant_id": merchant_id, **flat_widget_config(widget_config)}


@router.get("/settings")
async def get_settings_route(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    try:
        if identity.merchant is None:
            return JSONResponse({"error": "Failed to load settings: merchant not identified"}, status_code=500)
        row = await get_or_create_settings_row(db, identity.merchant)
        return JSONResponse(_to_response(row.widget_config or {}, identity.id))
    except Exception as exc:  # noqa: BLE001
        logger.error("[Settings] GET error: %s", exc)
        return JSONResponse({"error": f"Failed to load settings: {exc}"}, status_code=500)


@router.post("/settings")
async def save_settings(
    request: Request,
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    try:
        mid = identity.id
        raw = await request.body()
        logger.info("[Settings] POST /settings | merchant=%s | body_len=%d", mid, len(raw))

        if not raw.strip():
            return JSONResponse({"error": "Empty request body"}, status_code=400)

        import json
        try:
            body = json.loads(raw)
        except ValueError:
            return JSONResponse({"error": "Invalid JSON body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

        if identity.merchant is None:
            logger.error("[Settings] Error: Merchant not identified (master key used)")
            return JSONResponse({"error": "Cannot save settings: merchant not identified"}, status_code=400)

        # Flatten legacy nested 'css' object so widget_config uses flat keys.
        if "css" in body:
            css = body.pop("css")
            if isinstance(css, dict):
                body.update(css)

        # Keep button_text in sync with widget_title so both read paths work.
        if str(body.get("widget_title", "")).strip():
            body["button_text"] = body["widget_title"]

        body.pop("shopify_domain", None)
        body.pop("shop_id", None)

        row = await patch_widget_config(db, identity.merchant, body)

        logger.info("[Settings] Saved OK for merchant %s", mid)
        return JSONResponse({"ok": True, **_to_response(row.widget_config or {}, mid)})
    except Exception as exc:  # noqa: BLE001
        logger.error("[Settings] ERROR (%s): %s", type(exc).__name__, exc)
        return JSONResponse({"error": f"Save failed: {exc}"}, status_code=500)
