"""Async httpx port of src/TryOnDiffusionClient.php (RapidAPI Try-On-Diffusion)."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

import httpx


@dataclass
class TryOnDiffusionResult:
    status_code: int
    image_bytes: bytes | None
    error_details: str | None
    seed: int | None = None


class TryOnDiffusionClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        host = urlparse(self.base_url).hostname or ""
        self.rapidapi_host = host if host.endswith(".rapidapi.com") else None

    async def try_on_file(
        self,
        clothing_image_bytes: bytes,
        avatar_image_bytes: bytes,
        clothing_prompt: str | None = None,
        avatar_prompt: str | None = None,
        avatar_sex: str | None = None,
        background_image_bytes: bytes | None = None,
        background_prompt: str | None = None,
        seed: int = -1,
    ) -> TryOnDiffusionResult:
        url = f"{self.base_url}/try-on-file"

        data = {"seed": str(seed)}
        if clothing_prompt:
            data["clothing_prompt"] = clothing_prompt
        if avatar_prompt:
            data["avatar_prompt"] = avatar_prompt
        if avatar_sex:
            data["avatar_sex"] = avatar_sex
        if background_prompt:
            data["background_prompt"] = background_prompt

        files = {
            "clothing_image": ("clothing.jpg", clothing_image_bytes, "image/jpeg"),
            "avatar_image": ("avatar.jpg", avatar_image_bytes, "image/jpeg"),
        }
        if background_image_bytes:
            files["background_image"] = ("background.jpg", background_image_bytes, "image/jpeg")

        if self.rapidapi_host:
            headers = {"X-RapidAPI-Key": self.api_key, "X-RapidAPI-Host": self.rapidapi_host}
        else:
            headers = {"X-API-Key": self.api_key}

        try:
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post(url, data=data, files=files, headers=headers)
        except httpx.HTTPError as exc:
            return TryOnDiffusionResult(status_code=0, image_bytes=None, error_details=str(exc))

        seed_header = resp.headers.get("x-seed")
        seed_value = int(seed_header) if seed_header and seed_header.lstrip("-").isdigit() else None

        if resp.status_code == 200:
            return TryOnDiffusionResult(status_code=200, image_bytes=resp.content, error_details=None, seed=seed_value)

        try:
            decoded = resp.json()
            error_details = str(decoded["detail"]) if isinstance(decoded, dict) and "detail" in decoded else resp.text[:500]
        except ValueError:
            error_details = resp.text[:500] if resp.text else None

        return TryOnDiffusionResult(status_code=resp.status_code, image_bytes=None, error_details=error_details, seed=seed_value)
