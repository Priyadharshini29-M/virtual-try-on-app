"""Port of WidgetController.php's `flatConfig()`/`formatConfig()`.

IMPORTANT: PHP's `??` (null-coalescing) only falls back on missing/null —
NOT on falsy-but-meaningful values like `0` or `""` (e.g. `button_width: 0`
is a valid explicit "auto width" setting, not "unset"). `_coalesce`/
`_coalesce_chain` below replicate that exactly; do not simplify to `or`.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import BUTTON_ICONS, COLLECTION_POSITIONS, ICON_SHAPES
from app.core.constants import WIDGET_DEFAULTS as D
from app.models.merchant import Merchant, MerchantSettings

_MISSING = object()
_HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


async def get_or_create_settings_row(db: AsyncSession, merchant: Merchant) -> MerchantSettings:
    """Port of `WidgetSettingsRepo::getButtonConfig()`'s lazy-default-insert
    behavior — reads the merchant's settings row, creating one seeded with
    WIDGET_DEFAULTS (plus `widget_title` mirrored from `button_text`, same
    as PHP's `insertDefaults()`) if none exists yet.
    """
    result = await db.execute(select(MerchantSettings).where(MerchantSettings.merchant_id == merchant.id))
    row = result.scalar_one_or_none()

    if row is None:
        defaults = {**D, "widget_title": D["button_text"]}
        row = MerchantSettings(
            merchant_id=merchant.id,
            shopify_domain=merchant.shopify_domain,
            shopify_store_id=merchant.shopify_store_id,
            widget_config=defaults,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)

    return row


def _coalesce(cfg: dict, key: str, default: Any) -> Any:
    val = cfg.get(key, _MISSING)
    return default if val is None or val is _MISSING else val


def _coalesce_chain(cfg: dict, keys: list[str], default: Any) -> Any:
    for key in keys:
        val = cfg.get(key, _MISSING)
        if val is not None and val is not _MISSING:
            return val
    return default


def flat_widget_config(raw: dict) -> dict:
    """Port of `WidgetController::flatConfig()` — the shape the storefront
    widget JS (`tryon-widget.js`) reads via `GET /api/widget-settings`.
    Merges legacy nested `css` storage first, flat keys (newer saves)
    override it, then WIDGET_DEFAULTS fills any remaining gaps.
    """
    css = raw.get("css") or {}
    cfg = {**css, **raw}

    return {
        "widget_title": cfg.get("widget_title") or cfg.get("button_text") or D["button_text"],
        "widget_subtitle": _coalesce(cfg, "widget_subtitle", D["widget_subtitle"]),
        "button_color": _coalesce(cfg, "button_color", D["button_color"]),
        "button_text_color": _coalesce(cfg, "button_text_color", D["button_text_color"]),
        "button_border_radius": int(_coalesce(cfg, "button_border_radius", D["button_border_radius"])),
        "hover_bg_color": _coalesce(cfg, "hover_bg_color", D["hover_bg_color"]),
        "button_width": int(_coalesce(cfg, "button_width", D["button_width"])),
        "button_height": int(_coalesce(cfg, "button_height", D["button_height"])),
        "button_padding_top": int(_coalesce(cfg, "button_padding_top", D["button_padding_top"])),
        "button_padding_right": int(_coalesce(cfg, "button_padding_right", D["button_padding_right"])),
        "button_padding_bottom": int(_coalesce(cfg, "button_padding_bottom", D["button_padding_bottom"])),
        "button_padding_left": int(_coalesce(cfg, "button_padding_left", D["button_padding_left"])),
        "button_margin_top": int(_coalesce(cfg, "button_margin_top", D["button_margin_top"])),
        "button_margin_right": int(_coalesce(cfg, "button_margin_right", D["button_margin_right"])),
        "button_margin_bottom": int(_coalesce(cfg, "button_margin_bottom", D["button_margin_bottom"])),
        "button_margin_left": int(_coalesce(cfg, "button_margin_left", D["button_margin_left"])),
        "title_font_size": int(_coalesce(cfg, "title_font_size", D["title_font_size"])),
        "subtitle_font_size": int(_coalesce(cfg, "subtitle_font_size", D["subtitle_font_size"])),
        "title_font_weight": _coalesce(cfg, "title_font_weight", D["title_font_weight"]),
        "title_font_family": _coalesce(cfg, "title_font_family", D["title_font_family"]),
        "subtitle_font_family": _coalesce(cfg, "subtitle_font_family", D["subtitle_font_family"]),
        "desktop_title_font_size": int(
            _coalesce_chain(cfg, ["desktop_title_font_size", "title_font_size"], D["title_font_size"])
        ),
        "mobile_title_font_size": int(_coalesce(cfg, "mobile_title_font_size", 14)),
        "desktop_padding_top": int(
            _coalesce_chain(cfg, ["desktop_padding_top", "button_padding_top"], D["button_padding_top"])
        ),
        "desktop_padding_right": int(
            _coalesce_chain(cfg, ["desktop_padding_right", "button_padding_right"], D["button_padding_right"])
        ),
        "desktop_padding_bottom": int(
            _coalesce_chain(
                cfg, ["desktop_padding_bottom", "button_padding_bottom"], D["button_padding_bottom"]
            )
        ),
        "desktop_padding_left": int(
            _coalesce_chain(cfg, ["desktop_padding_left", "button_padding_left"], D["button_padding_left"])
        ),
        "mobile_padding_top": int(_coalesce(cfg, "mobile_padding_top", 8)),
        "mobile_padding_right": int(_coalesce(cfg, "mobile_padding_right", 16)),
        "mobile_padding_bottom": int(_coalesce(cfg, "mobile_padding_bottom", 8)),
        "mobile_padding_left": int(_coalesce(cfg, "mobile_padding_left", 16)),
        "desktop_widget_width": int(_coalesce_chain(cfg, ["desktop_widget_width", "button_width"], 0)),
        "desktop_widget_width_unit": _coalesce(cfg, "desktop_widget_width_unit", "px"),
        "desktop_widget_height": int(_coalesce_chain(cfg, ["desktop_widget_height", "button_height"], 0)),
        "desktop_widget_height_unit": _coalesce(cfg, "desktop_widget_height_unit", "px"),
        "mobile_widget_width": int(_coalesce(cfg, "mobile_widget_width", 100)),
        "mobile_widget_width_unit": _coalesce(cfg, "mobile_widget_width_unit", "%"),
        "mobile_widget_height": int(_coalesce(cfg, "mobile_widget_height", 0)),
        "mobile_widget_height_unit": _coalesce(cfg, "mobile_widget_height_unit", "auto"),
        "widget_language": _coalesce(cfg, "widget_language", D["widget_language"]),
        "button_icon": _coalesce(cfg, "button_icon", D["button_icon"]),
        "icon_color": _coalesce(cfg, "icon_color", D["icon_color"]),
        "main_icon_bg_color": _coalesce(cfg, "main_icon_bg_color", D["main_icon_bg_color"]),
        "coll_icon_bg_color": _coalesce(cfg, "coll_icon_bg_color", D["coll_icon_bg_color"]),
        "icon_size": int(_coalesce(cfg, "icon_size", D["icon_size"])),
        "icon_radius": int(_coalesce(cfg, "icon_radius", D["icon_radius"])),
        "icon_shape": _coalesce(cfg, "icon_shape", D["icon_shape"]),
        "icon_opacity": int(_coalesce(cfg, "icon_opacity", D["icon_opacity"])),
        "show_on_collection": bool(_coalesce(cfg, "show_on_collection", D["show_on_collection"])),
        "collection_position": _coalesce(cfg, "collection_position", D["collection_position"]),
        "show_watermark": bool(_coalesce(cfg, "show_watermark", D["show_watermark"])),
        "share_whatsapp_enabled": bool(_coalesce(cfg, "share_whatsapp_enabled", D["share_whatsapp_enabled"])),
        "save_image_enabled": bool(_coalesce(cfg, "save_image_enabled", D["save_image_enabled"])),
        "privacy_notice_shown": bool(_coalesce(cfg, "privacy_notice_shown", D["privacy_notice_shown"])),
    }


def format_config(row: dict) -> dict:
    """Port of `WidgetController::formatConfig()` — used by the authenticated
    `GET/PATCH /widget/settings` routes (narrower field set than flatConfig,
    no per-device variants).
    """
    return {
        "button_text": _coalesce(row, "button_text", D["button_text"]),
        "widget_subtitle": _coalesce(row, "widget_subtitle", D["widget_subtitle"]),
        "button_color": _coalesce(row, "button_color", D["button_color"]),
        "button_text_color": _coalesce(row, "button_text_color", D["button_text_color"]),
        "button_border_radius": int(_coalesce(row, "button_border_radius", D["button_border_radius"])),
        "hover_bg_color": _coalesce(row, "hover_bg_color", D["hover_bg_color"]),
        "button_width": int(_coalesce(row, "button_width", D["button_width"])),
        "button_height": int(_coalesce(row, "button_height", D["button_height"])),
        "button_padding_top": int(_coalesce(row, "button_padding_top", D["button_padding_top"])),
        "button_padding_right": int(_coalesce(row, "button_padding_right", D["button_padding_right"])),
        "button_padding_bottom": int(_coalesce(row, "button_padding_bottom", D["button_padding_bottom"])),
        "button_padding_left": int(_coalesce(row, "button_padding_left", D["button_padding_left"])),
        "button_margin_top": int(_coalesce(row, "button_margin_top", D["button_margin_top"])),
        "button_margin_right": int(_coalesce(row, "button_margin_right", D["button_margin_right"])),
        "button_margin_bottom": int(_coalesce(row, "button_margin_bottom", D["button_margin_bottom"])),
        "button_margin_left": int(_coalesce(row, "button_margin_left", D["button_margin_left"])),
        "title_font_size": int(_coalesce(row, "title_font_size", D["title_font_size"])),
        "subtitle_font_size": int(_coalesce(row, "subtitle_font_size", D["subtitle_font_size"])),
        "title_font_weight": _coalesce(row, "title_font_weight", D["title_font_weight"]),
        "title_font_family": _coalesce(row, "title_font_family", D["title_font_family"]),
        "subtitle_font_family": _coalesce(row, "subtitle_font_family", D["subtitle_font_family"]),
        "widget_language": _coalesce(row, "widget_language", D["widget_language"]),
        "button_icon": _coalesce(row, "button_icon", D["button_icon"]),
        "icon_color": _coalesce(row, "icon_color", D["icon_color"]),
        "main_icon_bg_color": _coalesce(row, "main_icon_bg_color", D["main_icon_bg_color"]),
        "coll_icon_bg_color": _coalesce(row, "coll_icon_bg_color", D["coll_icon_bg_color"]),
        "icon_size": int(_coalesce(row, "icon_size", D["icon_size"])),
        "icon_radius": int(_coalesce(row, "icon_radius", D["icon_radius"])),
        "icon_shape": _coalesce(row, "icon_shape", D["icon_shape"]),
        "icon_opacity": int(_coalesce(row, "icon_opacity", D["icon_opacity"])),
        "show_on_collection": bool(_coalesce(row, "show_on_collection", D["show_on_collection"])),
        "collection_position": _coalesce(row, "collection_position", D["collection_position"]),
        "show_watermark": bool(_coalesce(row, "show_watermark", D["show_watermark"])),
        "share_whatsapp_enabled": bool(_coalesce(row, "share_whatsapp_enabled", D["share_whatsapp_enabled"])),
        "save_image_enabled": bool(_coalesce(row, "save_image_enabled", D["save_image_enabled"])),
        "privacy_notice_shown": bool(_coalesce(row, "privacy_notice_shown", D["privacy_notice_shown"])),
    }


def _hex(v: str) -> str | None:
    v = v.strip()
    return v if _HEX_RE.match(v) else None


def _color(v: str) -> str | None:
    v = v.strip()
    if v == "transparent":
        return "transparent"
    return v if _HEX_RE.match(v) else None


def sanitize_widget_fields(body: dict) -> dict:
    """Port of `WidgetController::sanitizeFields()` — validates/clamps a
    PATCH body into a safe subset of fields to merge into widget_config.
    Unknown/invalid fields are silently dropped (matches PHP)."""
    out: dict[str, Any] = {}

    if "button_text" in body:
        v = str(body["button_text"]).strip()
        if v:
            out["button_text"] = v[:100]
    if "widget_subtitle" in body:
        out["widget_subtitle"] = str(body["widget_subtitle"]).strip()[:200]

    for f in ["button_color", "button_text_color", "hover_bg_color", "icon_color"]:
        if f in body:
            v = _hex(str(body[f]))
            if v is not None:
                out[f] = v
    for f in ["main_icon_bg_color", "coll_icon_bg_color"]:
        if f in body:
            v = _color(str(body[f]))
            if v is not None:
                out[f] = v

    clamped_ranges = {
        "button_border_radius": (0, 100), "button_width": (0, 800), "button_height": (0, 200),
        "button_padding_top": (0, 200), "button_padding_right": (0, 200),
        "button_padding_bottom": (0, 200), "button_padding_left": (0, 200),
        "button_margin_top": (0, 200), "button_margin_right": (0, 200),
        "button_margin_bottom": (0, 200), "button_margin_left": (0, 200),
        "title_font_size": (8, 72), "subtitle_font_size": (8, 48),
        "icon_size": (8, 48), "icon_radius": (0, 32), "icon_opacity": (0, 100),
    }
    for f, (lo, hi) in clamped_ranges.items():
        if f in body:
            out[f] = max(lo, min(hi, int(body[f])))

    for f in ["title_font_weight", "title_font_family", "subtitle_font_family"]:
        if f in body and str(body[f]).strip():
            out[f] = str(body[f]).strip()[:100]

    if "widget_language" in body and str(body["widget_language"]).strip():
        out["widget_language"] = str(body["widget_language"]).strip()[:10]

    if body.get("button_icon") in BUTTON_ICONS:
        out["button_icon"] = body["button_icon"]
    if body.get("icon_shape") in ICON_SHAPES:
        out["icon_shape"] = body["icon_shape"]
    if body.get("collection_position") in COLLECTION_POSITIONS:
        out["collection_position"] = body["collection_position"]

    for f in ["show_on_collection", "show_watermark", "share_whatsapp_enabled", "save_image_enabled", "privacy_notice_shown"]:
        if f in body:
            out[f] = bool(body[f])

    return out


async def patch_widget_config(db: AsyncSession, merchant: Merchant, fields: dict) -> MerchantSettings:
    """Port of `WidgetSettingsRepo::patchButtonConfig()` — merges `fields`
    into the existing widget_config (partial update)."""
    row = await get_or_create_settings_row(db, merchant)
    merged = {**(row.widget_config or {}), **fields}
    row.widget_config = merged
    await db.commit()
    await db.refresh(row)
    return row
