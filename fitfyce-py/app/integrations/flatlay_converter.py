"""Async httpx port of src/FlatLayConverter.php.

Converts a flat-lay garment image into a worn-reference image via FLUX
Kontext Pro (fal.ai). Cached 7 days by md5(garment_url + hint) so each
unique product image is only processed once.
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)

FAL_URL = "https://fal.run/fal-ai/flux-kontext-pro"
CACHE_TTL_SECONDS = 86400 * 7
API_TIMEOUT = 120

_PROMPTS = {
    "saree": (
        "Transform this flat-lay saree into a photorealistic image of an Indian woman "
        "wearing the saree in traditional nivi drape style. Show the full outfit: "
        "fitted blouse matching the border color, white petticoat visible at the hem, "
        "neat accordion pleats tucked at the front waist, pallu draped over the left "
        "shoulder revealing the zari border and motifs. "
        "Preserve the exact fabric color, all zari embroidery, border design, and "
        "textile patterns. Standing front-facing, neutral cream background, "
        "professional studio lighting, full body head to feet, photorealistic "
        "fashion photography quality."
    ),
    "lehenga": (
        "Transform this flat-lay lehenga into a photorealistic image of an Indian "
        "woman wearing the complete lehenga choli set. Show fitted blouse (choli), "
        "full flared skirt with natural folds and embroidery, dupatta draped over "
        "one shoulder. Preserve exact colors, embroidery patterns, and fabric "
        "texture. Standing front-facing, neutral background, studio lighting, "
        "full body, photorealistic fashion photography."
    ),
    "default": (
        "Transform this flat-lay garment into a photorealistic image of a person "
        "wearing it naturally. Show the complete garment worn with correct fit, "
        "natural fabric drape and folds, full body front-facing view. "
        "Preserve exact colors, patterns, and fabric texture. "
        "Neutral background, studio lighting, photorealistic fashion photography."
    ),
}


class FlatLayConverter:
    def __init__(self, api_key: str, cache_dir: Path):
        self.api_key = api_key
        self.cache_dir = cache_dir

    async def get_worn_reference(self, clothing_url: str, garment_hint: str) -> bytes | None:
        """Returns worn-reference JPEG bytes, or None on failure. Serves
        from the on-disk cache when fresh."""
        cache_key = hashlib.md5(f"{clothing_url}{garment_hint}".encode()).hexdigest()
        cache_path = self.cache_dir / f"wornref_{cache_key}.jpg"

        if cache_path.is_file() and (time.time() - cache_path.stat().st_mtime) < CACHE_TTL_SECONDS:
            logger.info("FlatLayConverter: cache hit key=%s", cache_key)
            return cache_path.read_bytes()

        prompt = _PROMPTS.get(garment_hint, _PROMPTS["default"])
        result_url = await self._call_fal(clothing_url, prompt)
        if result_url is None:
            logger.warning("FlatLayConverter: fal.ai call failed url=%s", clothing_url)
            return None

        image_bytes = await self._download(result_url)
        if image_bytes is None:
            logger.warning("FlatLayConverter: failed to download result url=%s", result_url)
            return None

        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(image_bytes)

        logger.info("FlatLayConverter: generated worn reference garment=%s cache=%s", garment_hint, cache_key)
        return image_bytes

    async def _call_fal(self, image_url: str, prompt: str) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
                resp = await client.post(
                    FAL_URL,
                    json={"image_url": image_url, "prompt": prompt, "num_inference_steps": 28, "guidance_scale": 3.5},
                    headers={"Authorization": f"Key {self.api_key}", "Content-Type": "application/json"},
                )
        except httpx.HTTPError as exc:
            logger.warning("FlatLayConverter: FAL request error %s", exc)
            return None

        if resp.status_code != 200:
            logger.warning("FlatLayConverter: FAL HTTP error status=%s body=%s", resp.status_code, resp.text[:300])
            return None

        try:
            decoded = resp.json()
        except ValueError:
            return None

        images = decoded.get("images") or []
        url = images[0].get("url") if images else None
        return url if isinstance(url, str) and url else None

    async def _download(self, url: str) -> bytes | None:
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "FitFyce/1.0"})
            return resp.content if resp.status_code == 200 else None
        except httpx.HTTPError:
            return None
