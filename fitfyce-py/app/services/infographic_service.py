"""Port of InfographicController.php's business logic — OpenAI only, no
Fashn involved anywhere in this flow:
  Step 1 — gpt-4o-mini extracts 3-4 short key-point phrases from the description
  Step 2 — gpt-image-1 composes the final infographic image from the source
           photo (a Fashn-generated model image or a merchant-uploaded image)
           plus the key points
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import Request

from app.integrations.openai_client import OpenAIClient
from app.services import image_service, storage_service
from app.utils.urls import base_path, base_url

VALID_STYLES = {"fashion", "luxury", "modern", "minimal", "ecommerce", "catalog", "collage", "lifestyle", "radial"}
VALID_CATEGORIES = {"clothing", "food"}

# Maps a merchant-facing size choice to the literal dimensions gpt-image-1
# accepts. Unresolved (None), the caller falls back to the existing
# category-based default (square for food, portrait otherwise).
SIZE_MAP = {"square": "1024x1024", "portrait": "1024x1536", "landscape": "1536x1024"}


def resolve_style(raw: str) -> str:
    s = (raw or "").strip().lower()
    return s if s in VALID_STYLES else "modern"


def resolve_category(raw: str) -> str:
    c = (raw or "").strip().lower()
    return c if c in VALID_CATEGORIES else "clothing"


def resolve_size(raw: str) -> str | None:
    return SIZE_MAP.get((raw or "").strip().lower())


def to_results(result_url: str, style: str, variation: int) -> list[dict[str, Any]]:
    """The frontend renders a gallery of `{key, label, image}` entries —
    this always produces one image per (non-collage) request, so wrap it as
    a single-element list. `variation` is folded into `key` so repeated
    "Regenerate" calls produce unique React keys."""
    return [{
        "key": f"{style}-v{variation}",
        "label": f"Variation {variation}" if variation > 1 else style.capitalize(),
        "image": result_url,
    }]


def save_generated(request: Request, image_bytes: bytes) -> str:
    filename = f"infographic_{uuid.uuid4().hex}.png"
    (storage_service.results_dir() / filename).write_bytes(image_bytes)
    return f"{base_url(request)}{base_path(request)}/results/{filename}"


async def compose_and_save(
    request: Request,
    openai: OpenAIClient,
    image_url: str,
    key_points: list[str],
    style: str,
    description: str = "",
    custom_style_prompt: str = "",
    category: str = "clothing",
    variation: int = 1,
    size: str | None = None,
) -> str:
    """`image_url` is either the Fashn-generated model/result photo from one
    of the try-on workflows, or a photo the merchant uploaded directly —
    both are just a source image handed to OpenAI's image model. Fashn is
    never called from here."""
    source_bytes = await image_service.fetch_image_bytes(image_url)
    if source_bytes is None:
        raise RuntimeError("Could not load the product image. Check the URL and try again.")

    image_bytes = await openai.generate_infographic_image(
        source_bytes, "source.jpg", key_points, style, description, custom_style_prompt, category, variation, size,
    )
    return save_generated(request, image_bytes)


async def compose_and_save_collage(
    request: Request,
    openai: OpenAIClient,
    image_url: str,
    key_points: list[str],
    description: str,
    custom_style_prompt: str,
    size: str | None = None,
) -> list[dict[str, Any]]:
    """'collage' produces 4 separate standalone images (hero, two detail
    zooms, features) instead of one — saves each and returns 4 gallery
    entries instead of to_results()'s single-element list."""
    source_bytes = await image_service.fetch_image_bytes(image_url)
    if source_bytes is None:
        raise RuntimeError("Could not load the product image. Check the URL and try again.")

    panels = await openai.generate_collage_panels(source_bytes, "source.jpg", key_points, description, custom_style_prompt, size)

    labels = {"hero": "Hero Shot", "detail1": "Detail 1", "detail2": "Detail 2", "features": "Features"}
    results = []
    for key, img_bytes in panels.items():
        results.append({
            "key": f"collage-{key}-{uuid.uuid4().hex}",
            "label": labels.get(key, key.capitalize()),
            "image": save_generated(request, img_bytes),
        })
    return results
