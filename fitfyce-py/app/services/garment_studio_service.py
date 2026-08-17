"""Port of GarmentStudioController.php's business logic (generation
pipeline, model registry, garment-type inference, DB access) — merchant-
facing multi-image try-on generation.

Unlike PHP's temp-file + `&$tempFiles`-accumulator pattern, this pipeline
works on in-memory bytes throughout (Pillow via `BytesIO`); there's nothing
to clean up on the way out.
"""

from __future__ import annotations

import io
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.integrations.fashn_client import FashnClient
from app.integrations.flatlay_converter import FlatLayConverter
from app.models.studio import GarmentStudioSession
from app.services import image_service, storage_service

logger = get_logger(__name__)

# ── Model registry ───────────────────────────────────────────────────────
MODELS: dict[str, dict[str, str]] = {
    "female_child_5_8": {"label": "Female Child (5–8 yrs)", "gender": "female", "fashn_category_hint": "kid"},
    "female_child_9_12": {"label": "Female Child (9–12 yrs)", "gender": "female", "fashn_category_hint": "kid"},
    "female_teen_13_17": {"label": "Female Teen (13–17 yrs)", "gender": "female", "fashn_category_hint": "teen"},
    "female_young_adult": {"label": "Female Young Adult (18–25)", "gender": "female", "fashn_category_hint": "adult"},
    "female_adult": {"label": "Female Adult (26–35)", "gender": "female", "fashn_category_hint": "adult"},
    "female_mature_adult": {"label": "Female Mature (36–50)", "gender": "female", "fashn_category_hint": "adult"},
    "female_plus_size": {"label": "Female Plus Size", "gender": "female", "fashn_category_hint": "adult"},
    "male_child_5_8": {"label": "Male Child (5–8 yrs)", "gender": "male", "fashn_category_hint": "kid"},
    "male_child_9_12": {"label": "Male Child (9–12 yrs)", "gender": "male", "fashn_category_hint": "kid"},
    "male_teen_13_17": {"label": "Male Teen (13–17 yrs)", "gender": "male", "fashn_category_hint": "teen"},
    "male_young_adult": {"label": "Male Young Adult (18–25)", "gender": "male", "fashn_category_hint": "adult"},
    "male_adult": {"label": "Male Adult (26–35)", "gender": "male", "fashn_category_hint": "adult"},
    "male_mature_adult": {"label": "Male Mature (36–50)", "gender": "male", "fashn_category_hint": "adult"},
    "male_plus_size": {"label": "Male Plus Size", "gender": "male", "fashn_category_hint": "adult"},
}

_FULL_RE = re.compile(
    r"\b(saree|sari|lehenga|jumpsuit|dungaree|romper|dress|gown|overall|abaya|pantsuit|playsuit|"
    r"salwar\s*kameez|anarkali)\b"
)
_BOTTOM_RE = re.compile(
    r"\b(pant|pants|jeans|trouser|trousers|shorts|skirt|legging|leggings|palaz|palazzo|dhoti|lungi|"
    r"salwar|churidar)\b"
)
_SAREE_RE = re.compile(r"\b(saree|sari)\b")
_LEHENGA_RE = re.compile(r"\blehenga\b")


# ── Garment-type / flat-lay-hint resolution ─────────────────────────────

def resolve_garment_type(payload: dict) -> str:
    explicit = str(payload.get("garment_type") or "").strip().lower()
    if explicit in ("top", "bottom", "full"):
        return explicit
    return infer_from_prompt(str(payload.get("clothing_prompt") or "").strip())


def infer_from_prompt(prompt: str) -> str:
    if prompt == "":
        return "top"
    p = prompt.lower()
    if _FULL_RE.search(p):
        return "full"
    if _BOTTOM_RE.search(p):
        return "bottom"
    return "top"


def infer_flatlay_garment_hint(prompt: str) -> str:
    if prompt == "":
        return "default"
    p = prompt.lower()
    if _SAREE_RE.search(p):
        return "saree"
    if _LEHENGA_RE.search(p):
        return "lehenga"
    return "default"


# ── Model image resolution ───────────────────────────────────────────────

def resolve_model_image_path(model_key: str, gender: str) -> Path | None:
    path = storage_service.models_dir() / gender / f"{model_key}.jpg"
    return path if path.is_file() else None


# ── Prompt builders ───────────────────────────────────────────────────────

def build_drape_prompt(flatlay_hint: str) -> str:
    if flatlay_hint == "saree":
        return (
            "Drape as a traditional Indian saree in nivi style: fitted blouse "
            "matching the border color, pleats tucked at the front waist, pallu "
            "draped over the left shoulder showing the zari border and motifs. "
            "Preserve exact fabric color and embroidery."
        )
    if flatlay_hint == "lehenga":
        return (
            "Style as a complete lehenga choli set: fitted blouse, full flared "
            "embroidered skirt, dupatta draped over one shoulder. Preserve exact "
            "colors and embroidery."
        )
    return ""


def build_product_to_model_prompt(flatlay_hint: str) -> str:
    drape = build_drape_prompt(flatlay_hint)
    framing = (
        "Full-body shot from head to feet, standing naturally facing the camera, "
        "plain neutral studio background, professional fashion photography."
    )
    return (f"{drape} {framing}".strip()) if drape else framing


def user_friendly_error(status_code: int, raw_error: str) -> str:
    if status_code == 503:
        return raw_error
    if status_code == 429:
        return "Service temporarily unavailable. Please try again later."
    if status_code == 0:
        return "Request timed out. Please try again."
    if status_code in (401, 403):
        return "Try-on service configuration error. Please contact support."
    if "image_too_small" in raw_error:
        return "Garment image is too small. Please use a higher-resolution photo."
    if "File size exceeds" in raw_error:
        return "Image is too large. Please use a smaller photo."
    return "Generation failed. Please try again."


# ── Multi-view garment composite (Pillow port of createGarmentComposite) ──

def _paste_fit(canvas: Image.Image, src_bytes: bytes, dst_x: int, dst_y: int, dst_w: int, dst_h: int) -> None:
    if dst_w <= 0 or dst_h <= 0:
        return
    try:
        with io.BytesIO(src_bytes) as buf, Image.open(buf) as src:
            src = src.convert("RGB") if src.mode not in ("RGB", "L") else src
            src_w, src_h = src.size
            if src_w <= 0 or src_h <= 0:
                return
            scale = min(dst_w / src_w, dst_h / src_h)
            new_w, new_h = round(src_w * scale), round(src_h * scale)
            resized = src.resize((new_w, new_h), Image.LANCZOS)
            off_x = dst_x + (dst_w - new_w) // 2
            off_y = dst_y + (dst_h - new_h) // 2
            canvas.paste(resized, (off_x, off_y))
    except Exception:  # noqa: BLE001
        return


def create_garment_composite(front_bytes: bytes, back_bytes: bytes | None, detail_bytes_list: list[bytes]) -> bytes:
    """Stitches front (dominant, left 60%) + back + up to 3 detail images
    (right 40%) into one 1024x1024 reference sheet, so Fashn sees the whole
    garment in a single input. Falls back to the front image alone when
    there's nothing else to composite."""
    has_back = back_bytes is not None
    d_count = len(detail_bytes_list)
    has_details = d_count > 0

    if not has_back and not has_details:
        return front_bytes

    canvas_w = canvas_h = 1024
    canvas = Image.new("RGB", (canvas_w, canvas_h), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    div = (210, 210, 210)

    front_w = round(canvas_w * 0.60)
    _paste_fit(canvas, front_bytes, 0, 0, front_w, canvas_h)
    draw.text((6, 4), "FRONT", fill=div)
    draw.line([(front_w, 0), (front_w, canvas_h)], fill=div)

    right_x = front_w
    right_w = canvas_w - front_w

    if has_back and has_details:
        back_h = round(canvas_h * 0.55)
        detail_h = canvas_h - back_h

        _paste_fit(canvas, back_bytes, right_x, 0, right_w, back_h)
        draw.text((right_x + 4, 4), "BACK", fill=div)
        draw.line([(right_x, back_h), (canvas_w, back_h)], fill=div)

        cell_w = right_w // d_count
        for i, dp in enumerate(detail_bytes_list):
            cell_x = right_x + (i * cell_w)
            _paste_fit(canvas, dp, cell_x, back_h, cell_w, detail_h)
            draw.text((cell_x + 4, back_h + 3), f"DETAIL {i + 1}", fill=div)
            if i > 0:
                draw.line([(cell_x, back_h), (cell_x, canvas_h)], fill=div)
    elif has_back:
        _paste_fit(canvas, back_bytes, right_x, 0, right_w, canvas_h)
        draw.text((right_x + 4, 4), "BACK", fill=div)
    else:
        cell_h = canvas_h // d_count
        for i, dp in enumerate(detail_bytes_list):
            cell_y = i * cell_h
            _paste_fit(canvas, dp, right_x, cell_y, right_w, cell_h)
            draw.text((right_x + 4, cell_y + 3), f"DETAIL {i + 1}", fill=div)
            if i > 0:
                draw.line([(right_x, cell_y), (canvas_w, cell_y)], fill=div)

    buf = io.BytesIO()
    canvas.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


# ── Generation pipeline (port of prepareAndSubmit + resolveGarmentImagePath) ──

async def _resolve_garment_image_bytes(
    front_url: str,
    front_bytes: bytes,
    back_url: str,
    detail1: str | None,
    detail2: str | None,
    detail3: str | None,
    use_flatlay_conversion: bool,
    flatlay_hint: str,
    garment_photo_type: str,
) -> tuple[bytes, str]:
    if use_flatlay_conversion:
        settings = get_settings()
        converter = FlatLayConverter(settings.fal_api_key, storage_service.flatlay_cache_dir())
        worn_ref = await converter.get_worn_reference(front_url, flatlay_hint)
        if worn_ref is not None:
            return worn_ref, "model"
        logger.warning("FlatLayConverter failed, falling back to raw flat-lay image hint=%s", flatlay_hint)

    back_bytes = None
    if back_url:
        back_bytes = await image_service.fetch_image_bytes(back_url)

    detail_bytes_list: list[bytes] = []
    for url in (detail1, detail2, detail3):
        if not url:
            continue
        db = await image_service.fetch_image_bytes(url)
        if db is not None:
            detail_bytes_list.append(db)

    composite = create_garment_composite(front_bytes, back_bytes, detail_bytes_list)
    return composite, garment_photo_type


async def prepare_and_submit(
    *,
    front_url: str,
    back_url: str,
    detail1: str | None,
    detail2: str | None,
    detail3: str | None,
    model_image_path: Path,
    garment_type: str,
    garment_photo_type: str,
    use_flatlay_conversion: bool,
    flatlay_hint: str,
    fashn_model: str,
) -> dict[str, Any]:
    """Image prep + Fashn submission — does NOT wait for the result. Caller
    stores the returned prediction_id and polls via checkGenerationStatus."""
    front_bytes = await image_service.fetch_image_bytes(front_url)
    if front_bytes is None:
        return {"status_code": 400, "prediction_id": None, "error_details": "Failed to load front_image_url"}
    front_bytes = image_service.reencode_as_jpeg(front_bytes)
    front_bytes = image_service.ensure_minimum_size_bytes(front_bytes, 768, 1024)

    model_bytes = model_image_path.read_bytes()
    model_bytes = image_service.reencode_as_jpeg(model_bytes)
    model_bytes = image_service.ensure_minimum_size_bytes(model_bytes, 768, 1024)

    settings = get_settings()
    if not settings.fashn_api_key:
        return {
            "status_code": 503,
            "prediction_id": None,
            "error_details": "Try-on service is not configured. Add FASHN_API_KEY to .env.",
        }

    fashn_client = FashnClient(settings.fashn_api_key, mode="quality")

    if fashn_model == "product-to-model":
        inputs = {
            "product_image": image_service.bytes_to_base64_uri(front_bytes),
            "face_reference": image_service.bytes_to_base64_uri(model_bytes),
            "face_reference_mode": "match_reference",
            "image_prompt": image_service.bytes_to_base64_uri(model_bytes),
            "aspect_ratio": "3:4",
            "generation_mode": "quality",
            "output_format": "jpeg",
        }
        prompt = build_product_to_model_prompt(flatlay_hint)
        if prompt:
            inputs["prompt"] = prompt
        return await fashn_client.submit_model_run("product-to-model", inputs)

    garment_bytes, garment_photo_type = await _resolve_garment_image_bytes(
        front_url, front_bytes, back_url, detail1, detail2, detail3,
        use_flatlay_conversion, flatlay_hint, garment_photo_type,
    )

    if fashn_model == "tryon-max":
        prompt = build_drape_prompt(flatlay_hint)
        inputs = {
            "product_image": image_service.bytes_to_base64_uri(garment_bytes),
            "model_image": image_service.bytes_to_base64_uri(model_bytes),
            "generation_mode": "quality",
            "output_format": "jpeg",
        }
        if prompt:
            inputs["prompt"] = prompt
        return await fashn_client.submit_model_run("tryon-max", inputs)

    fashn_category = {"bottom": "bottoms", "full": "one-pieces"}.get(garment_type, "tops")
    return await fashn_client.submit_run(
        model_image=image_service.bytes_to_base64_uri(model_bytes),
        garment_image=image_service.bytes_to_base64_uri(garment_bytes),
        category=fashn_category,
        garment_photo_type=garment_photo_type,
        seed=-1,
    )


# ── DB access (port of GarmentStudioRepo.php) ─────────────────────────────

async def create_session(db: AsyncSession, data: dict[str, Any]) -> uuid.UUID:
    session = GarmentStudioSession(
        merchant_id=data["merchant_id"],
        product_id=data.get("product_id"),
        shopify_variant_id=data.get("shopify_variant_id"),
        front_image_url=data["front_image_url"],
        back_image_url=data["back_image_url"],
        detail_image_1_url=data.get("detail_image_1_url"),
        detail_image_2_url=data.get("detail_image_2_url"),
        detail_image_3_url=data.get("detail_image_3_url"),
        gender=data["gender"],
        model_key=data["model_key"],
        garment_type=data.get("garment_type", "top"),
        clothing_prompt=data.get("clothing_prompt"),
        status="pending",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session.id


async def update_status(db: AsyncSession, session_id: str, status: str, **extra: Any) -> None:
    row = (await db.execute(select(GarmentStudioSession).where(GarmentStudioSession.id == session_id))).scalar_one_or_none()
    if row is None:
        return
    row.status = status
    for col in ("result_image_url", "error_message", "api_request_at", "api_response_at",
                "fashn_prediction_id", "api_latency_ms"):
        if col in extra:
            setattr(row, col, extra[col])
    await db.commit()


async def mark_saved_to_gallery(db: AsyncSession, session_id: str) -> None:
    row = (await db.execute(select(GarmentStudioSession).where(GarmentStudioSession.id == session_id))).scalar_one_or_none()
    if row is None:
        return
    row.saved_to_gallery = True
    await db.commit()


async def find_by_id(db: AsyncSession, session_id: str) -> GarmentStudioSession | None:
    try:
        uuid.UUID(session_id)
    except ValueError:
        return None
    return (await db.execute(select(GarmentStudioSession).where(GarmentStudioSession.id == session_id))).scalar_one_or_none()


async def list_by_merchant(db: AsyncSession, merchant_id: int, limit: int = 20, offset: int = 0) -> list[GarmentStudioSession]:
    result = await db.execute(
        select(GarmentStudioSession)
        .where(GarmentStudioSession.merchant_id == merchant_id)
        .order_by(GarmentStudioSession.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


def session_to_dict(row: GarmentStudioSession) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "merchant_id": row.merchant_id,
        "product_id": row.product_id,
        "shopify_variant_id": row.shopify_variant_id,
        "front_image_url": row.front_image_url,
        "back_image_url": row.back_image_url,
        "detail_image_1_url": row.detail_image_1_url,
        "detail_image_2_url": row.detail_image_2_url,
        "detail_image_3_url": row.detail_image_3_url,
        "gender": row.gender,
        "model_key": row.model_key,
        "fashn_prediction_id": row.fashn_prediction_id,
        "garment_type": row.garment_type,
        "clothing_prompt": row.clothing_prompt,
        "status": row.status,
        "result_image_url": row.result_image_url,
        "error_message": row.error_message,
        "saved_to_gallery": row.saved_to_gallery,
        "api_request_at": row.api_request_at.isoformat() if row.api_request_at else None,
        "api_response_at": row.api_response_at.isoformat() if row.api_response_at else None,
        "api_latency_ms": row.api_latency_ms,
        "created_at": row.created_at.isoformat() if isinstance(row.created_at, datetime) else row.created_at,
        "updated_at": row.updated_at.isoformat() if isinstance(row.updated_at, datetime) else row.updated_at,
    }
