"""Port of StudioV2Controller.php's business logic + its 4 repo classes
(GenerationRepo, SavedModelRepo, InfographicGenRepo, AssetRepo).

Single-flow AI Studio pipeline: merchant uploads a product image, selects a
saved model (or uploads a new one), enters a required creative-direction
prompt, FASHN.ai generates the dressed model, and on completion this chains
an OpenAI marketing-infographic batch (see openai_client.MARKETING_STYLE_KEYS)
using the FASHN result as the visual reference.
"""

from __future__ import annotations

import re
import secrets
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.integrations.openai_client import MARKETING_STYLE_KEYS, OpenAIClient
from app.models.studio_v2 import Asset, Generation, Infographic, SavedModel
from app.services import image_service, storage_service
from app.utils.urls import base_path, base_url

logger = get_logger(__name__)

_FULL_RE = re.compile(
    r"\b(saree|sari|lehenga|jumpsuit|dungaree|romper|dress|gown|overall|abaya|pantsuit|playsuit|"
    r"salwar\s*kameez|anarkali)\b"
)
_BOTTOM_RE = re.compile(
    r"\b(pant|pants|jeans|trouser|trousers|shorts|skirt|legging|leggings|palaz|palazzo|dhoti|lungi|"
    r"salwar|churidar)\b"
)


# ── Garment-type / category resolution (mirrors garment_studio_service) ──

def resolve_category(garment_type: str, prompt: str) -> str:
    fashn_category = {"bottom": "bottoms", "full": "one-pieces", "top": "tops"}.get(garment_type)
    return fashn_category or infer_category(prompt)


def infer_category(prompt: str) -> str:
    p = prompt.lower()
    if _FULL_RE.search(p):
        return "one-pieces"
    if _BOTTOM_RE.search(p):
        return "bottoms"
    return "tops"


# ── Local-file resolution (for deletion — persisted URLs are always our own) ──

_LOCAL_PATH_PATTERNS: list[tuple[re.Pattern, Any]] = [
    (re.compile(r"^/temp/([^/]+)$"), lambda m: storage_service.temp_dir() / m.group(1).split("?")[0]),
    (re.compile(r"^/library/([^/]+)$"), lambda m: storage_service.library_dir() / m.group(1).split("?")[0]),
    (re.compile(r"^/generations/([^/]+)$"), lambda m: storage_service.generations_dir() / m.group(1).split("?")[0]),
    (re.compile(r"^/results/([^/]+)$"), lambda m: storage_service.results_dir() / m.group(1).split("?")[0]),
    (re.compile(r"^/models/([^/]+)/([^/]+)$"), lambda m: storage_service.models_dir() / m.group(1) / m.group(2).split("?")[0]),
]


def resolve_local_path(url: str) -> Path | None:
    path = urlparse(url).path
    for pattern, resolver in _LOCAL_PATH_PATTERNS:
        m = pattern.match(path)
        if m:
            candidate = resolver(m)
            return candidate if candidate.is_file() else None
    return None


def unlink_local_asset(url: str) -> None:
    path = resolve_local_path(url)
    if path is not None:
        path.unlink(missing_ok=True)


# ── Image download/persistence helpers ────────────────────────────────────

async def persist_permanent_image(request: Request, image_url: str, dest_dir: Path, prefix: str) -> tuple[str, Path] | None:
    """Downloads `image_url` and saves it permanently (as JPEG) under
    `dest_dir`. Returns (public_url, local_path) or None on failure."""
    image_bytes = await image_service.fetch_image_bytes(image_url)
    if image_bytes is None:
        return None
    filename = f"{prefix}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(4)}.jpg"
    dest_path = dest_dir / filename
    dest_path.write_bytes(image_service.reencode_as_jpeg(image_bytes))
    url = f"{base_url(request)}{base_path(request)}/{dest_dir.name}/{filename}"
    return url, dest_path


def make_and_save_thumbnail(request: Request, source_path: Path, dest_dir: Path, prefix: str) -> str | None:
    thumb_filename = f"thumb_{prefix}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(3)}.jpg"
    thumb_path = dest_dir / thumb_filename
    if not image_service.make_thumbnail(source_path, thumb_path, 320):
        return None
    return f"{base_url(request)}{base_path(request)}/{dest_dir.name}/{thumb_filename}"


# ── Saved Models ───────────────────────────────────────────────────────────

async def create_saved_model(db: AsyncSession, merchant_id: int, image_url: str) -> SavedModel:
    model = SavedModel(merchant_id=merchant_id, image_url=image_url)
    db.add(model)
    await db.commit()
    await db.refresh(model)
    return model


async def list_saved_models(db: AsyncSession, merchant_id: int) -> list[SavedModel]:
    result = await db.execute(
        select(SavedModel).where(SavedModel.merchant_id == merchant_id).order_by(SavedModel.created_at.desc())
    )
    return list(result.scalars().all())


async def find_saved_model(db: AsyncSession, model_id: str) -> SavedModel | None:
    try:
        uuid.UUID(model_id)
    except ValueError:
        return None
    return (await db.execute(select(SavedModel).where(SavedModel.id == model_id))).scalar_one_or_none()


async def delete_saved_model(db: AsyncSession, model_id: str, merchant_id: int) -> None:
    model = (
        await db.execute(select(SavedModel).where(SavedModel.id == model_id, SavedModel.merchant_id == merchant_id))
    ).scalar_one_or_none()
    if model is not None:
        await db.delete(model)
        await db.commit()


def saved_model_to_dict(row: SavedModel) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "merchant_id": row.merchant_id,
        "image_url": row.image_url,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


# ── Generations ─────────────────────────────────────────────────────────────

async def create_generation(db: AsyncSession, data: dict[str, Any]) -> Generation:
    gen = Generation(
        merchant_id=data["merchant_id"],
        product_id=data.get("product_id"),
        shopify_variant_id=data.get("shopify_variant_id"),
        product_image_url=data["product_image_url"],
        saved_model_id=data.get("saved_model_id"),
        model_image_url=data["model_image_url"],
        prompt=data["prompt"],
        status="pending",
    )
    db.add(gen)
    await db.commit()
    await db.refresh(gen)
    return gen


async def update_generation_status(db: AsyncSession, generation_id: str, status: str, **extra: Any) -> None:
    row = (await db.execute(select(Generation).where(Generation.id == generation_id))).scalar_one_or_none()
    if row is None:
        return
    row.status = status
    for col in ("result_image_url", "error_message", "api_request_at", "api_response_at",
                "fashn_prediction_id", "api_latency_ms", "infographic_batch_started"):
        if col in extra:
            setattr(row, col, extra[col])
    await db.commit()


async def find_generation(db: AsyncSession, generation_id: str) -> Generation | None:
    try:
        uuid.UUID(generation_id)
    except ValueError:
        return None
    return (await db.execute(select(Generation).where(Generation.id == generation_id))).scalar_one_or_none()


async def list_generations(db: AsyncSession, merchant_id: int, limit: int = 20, offset: int = 0) -> list[Generation]:
    result = await db.execute(
        select(Generation)
        .where(Generation.merchant_id == merchant_id)
        .order_by(Generation.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


async def delete_generation(db: AsyncSession, generation_id: str, merchant_id: int) -> None:
    row = (
        await db.execute(select(Generation).where(Generation.id == generation_id, Generation.merchant_id == merchant_id))
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()


def generation_to_dict(row: Generation, infographics: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    d = {
        "id": str(row.id),
        "merchant_id": row.merchant_id,
        "product_id": row.product_id,
        "shopify_variant_id": row.shopify_variant_id,
        "product_image_url": row.product_image_url,
        "saved_model_id": str(row.saved_model_id) if row.saved_model_id else None,
        "model_image_url": row.model_image_url,
        "prompt": row.prompt,
        "status": row.status,
        "fashn_prediction_id": row.fashn_prediction_id,
        "result_image_url": row.result_image_url,
        "error_message": row.error_message,
        "api_request_at": row.api_request_at.isoformat() if row.api_request_at else None,
        "api_response_at": row.api_response_at.isoformat() if row.api_response_at else None,
        "api_latency_ms": row.api_latency_ms,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
    if infographics is not None:
        d["infographics"] = infographics
    return d


# ── Infographics (5-style marketing batch) ──────────────────────────────────

async def create_infographic_batch(db: AsyncSession, generation_id: str, merchant_id: int, style_keys: list[str]) -> dict[str, str]:
    ids: dict[str, str] = {}
    for style_key in style_keys:
        row = Infographic(generation_id=generation_id, merchant_id=merchant_id, style_key=style_key, status="pending")
        db.add(row)
        await db.flush()
        ids[style_key] = str(row.id)
    await db.commit()
    return ids


async def mark_infographic_completed(db: AsyncSession, infographic_id: str, image_url: str) -> None:
    row = (await db.execute(select(Infographic).where(Infographic.id == infographic_id))).scalar_one_or_none()
    if row is None:
        return
    row.status = "completed"
    row.image_url = image_url
    await db.commit()


async def mark_infographic_failed(db: AsyncSession, infographic_id: str, error_message: str) -> None:
    row = (await db.execute(select(Infographic).where(Infographic.id == infographic_id))).scalar_one_or_none()
    if row is None:
        return
    row.status = "failed"
    row.error_message = error_message
    await db.commit()


async def list_infographics_by_generation(db: AsyncSession, generation_id: str) -> list[Infographic]:
    result = await db.execute(
        select(Infographic).where(Infographic.generation_id == generation_id).order_by(Infographic.created_at.asc())
    )
    return list(result.scalars().all())


async def delete_infographics_by_generation(db: AsyncSession, generation_id: str) -> list[Infographic]:
    rows = await list_infographics_by_generation(db, generation_id)
    for row in rows:
        await db.delete(row)
    await db.commit()
    return rows


def infographic_to_dict(row: Infographic) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "generation_id": str(row.generation_id),
        "merchant_id": row.merchant_id,
        "style_key": row.style_key,
        "image_url": row.image_url,
        "status": row.status,
        "error_message": row.error_message,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


# ── Asset Library ────────────────────────────────────────────────────────────

async def record_asset(db: AsyncSession, merchant_id: int, url: str, thumbnail_url: str | None, source_type: str, source_id: str | None) -> Asset:
    asset = Asset(merchant_id=merchant_id, url=url, thumbnail_url=thumbnail_url, source_type=source_type, source_id=source_id)
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset


async def list_assets(db: AsyncSession, merchant_id: int, limit: int = 100, offset: int = 0) -> list[Asset]:
    result = await db.execute(
        select(Asset).where(Asset.merchant_id == merchant_id).order_by(Asset.created_at.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all())


async def delete_assets_by_source(db: AsyncSession, source_type: str, source_id: str) -> None:
    rows = (await db.execute(select(Asset).where(Asset.source_type == source_type, Asset.source_id == source_id))).scalars().all()
    for row in rows:
        await db.delete(row)
    await db.commit()


def asset_to_dict(row: Asset) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "merchant_id": row.merchant_id,
        "url": row.url,
        "thumbnail_url": row.thumbnail_url,
        "source_type": row.source_type,
        "source_id": str(row.source_id) if row.source_id else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


# ── OpenAI infographic batch orchestration ──────────────────────────────────

async def run_infographic_batch(
    request: Request, db: AsyncSession, generation_id: str, merchant_id: int, reference_image_bytes: bytes, prompt: str,
) -> list[dict[str, Any]]:
    """Runs the 5-style OpenAI marketing-infographic batch against a local
    reference JPEG, saving each result as a 1080x1080 PNG under
    generations/, recording infographics + assets rows, and returning the
    final infographics list for this generation."""
    row_ids = await create_infographic_batch(db, generation_id, merchant_id, MARKETING_STYLE_KEYS)

    settings = get_settings()
    if not settings.openai_api_key:
        for row_id in row_ids.values():
            await mark_infographic_failed(db, row_id, "OpenAI service is not configured. Add OPENAI_API_KEY to .env.")
        return [infographic_to_dict(r) for r in await list_infographics_by_generation(db, generation_id)]

    openai = OpenAIClient(settings.openai_api_key)
    results = await openai.generate_marketing_infographics(reference_image_bytes, "reference.jpg", "", prompt)

    completed_styles: set[str] = set()
    generations_dir = storage_service.generations_dir()

    for r in results:
        style_key = r["style_key"]
        completed_styles.add(style_key)

        png_bytes = image_service.pad_to_square(r["image_bytes"], 1080)
        filename = f"infographic_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(3)}_{style_key}.png"
        out_path = generations_dir / filename
        out_path.write_bytes(png_bytes)

        url = f"{base_url(request)}{base_path(request)}/generations/{filename}"
        await mark_infographic_completed(db, row_ids[style_key], url)

        thumb_url = make_and_save_thumbnail(request, out_path, generations_dir, "infographic")
        await record_asset(db, merchant_id, url, thumb_url, "infographic", row_ids[style_key])

    for style_key in MARKETING_STYLE_KEYS:
        if style_key not in completed_styles:
            await mark_infographic_failed(db, row_ids[style_key], "Creative generation failed for this style")

    return [infographic_to_dict(r) for r in await list_infographics_by_generation(db, generation_id)]
