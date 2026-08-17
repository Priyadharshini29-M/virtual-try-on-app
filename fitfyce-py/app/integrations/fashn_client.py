"""Async httpx port of fitfyce-php/src/FashnClient.php.

Flow: POST /v1/run → receive prediction ID → poll /v1/status/{id} until
completed, then download the result image. Fashn handles human parsing,
clothing masking, and pose conditioning internally.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class FashnResult:
    status_code: int
    image_bytes: bytes | None
    error_details: str | None
    seed: int | None = None


class FashnClient:
    BASE_URL = "https://api.fashn.ai/v1"
    MODEL_NAME = "tryon-v1.6"
    POLL_MAX_ATTEMPTS = 30  # 30 x 2.5s = 75s max wait
    POLL_INTERVAL_SECONDS = 2.5

    def __init__(self, api_key: str, mode: str = "balanced"):
        self.api_key = api_key
        self.mode = mode if mode in ("performance", "balanced", "quality") else "balanced"

    async def try_on(
        self,
        model_image: str,
        garment_image: str,
        category: str,
        garment_photo_type: str | None = None,
        moderation_level: str | None = None,
        seed: int | None = None,
    ) -> FashnResult:
        submit = await self.submit_run(
            model_image, garment_image, category, garment_photo_type, moderation_level, seed
        )
        if submit["status_code"] != 200 or not submit.get("prediction_id"):
            return FashnResult(submit["status_code"], None, submit.get("error_details"))
        return await self._poll_for_result(str(submit["prediction_id"]))

    async def submit_run(
        self,
        model_image: str,
        garment_image: str,
        category: str,
        garment_photo_type: str | None = None,
        moderation_level: str | None = None,
        seed: int | None = None,
    ) -> dict:
        inputs: dict[str, Any] = {
            "model_image": model_image,
            "garment_image": garment_image,
            "category": category,
            "mode": self.mode,
            # Conservative moderation is the safe default for a commercial
            # e-commerce try-on tool.
            "moderation_level": moderation_level or "conservative",
        }
        if garment_photo_type:
            inputs["garment_photo_type"] = garment_photo_type
        if seed is not None and seed >= 0:
            inputs["seed"] = seed

        return await self._post_run(self.MODEL_NAME, inputs)

    async def submit_model_run(self, model_name: str, inputs: dict) -> dict:
        """Submit to a Fashn model other than tryon-v1.6 (e.g. 'tryon-max',
        'product-to-model') whose input shape differs from garment-transfer
        params — caller builds the model-specific `inputs` payload.
        """
        return await self._post_run(model_name, inputs)

    async def _post_run(self, model_name: str, inputs: dict) -> dict:
        body = {"model_name": model_name, "inputs": inputs}
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{self.BASE_URL}/run",
                    json=body,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                )
        except httpx.HTTPError as exc:
            return {"status_code": 0, "prediction_id": None, "error_details": str(exc)}

        decoded = _safe_json(resp)

        if resp.status_code < 200 or resp.status_code >= 300:
            return {
                "status_code": resp.status_code,
                "prediction_id": None,
                "error_details": self._extract_error(decoded, resp.text),
            }

        if not isinstance(decoded, dict) or not decoded.get("id"):
            return {"status_code": 500, "prediction_id": None, "error_details": "Unexpected response (no prediction ID)"}

        return {"status_code": 200, "prediction_id": str(decoded["id"]), "error_details": None}

    async def _poll_for_result(self, prediction_id: str) -> FashnResult:
        for attempt in range(self.POLL_MAX_ATTEMPTS):
            if attempt > 0:
                await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

            check = await self.check_status(prediction_id)
            if check["job_status"] == "processing":
                continue
            if check["job_status"] == "completed":
                return FashnResult(200, check["image_bytes"], None)
            return FashnResult(400, None, check["error_details"])

        return FashnResult(408, None, "Timed out waiting for result")

    async def check_status(self, prediction_id: str) -> dict:
        """Checks a prediction's status exactly once (no retry loop) — the
        building block for async polling from a caller's own short-lived
        requests, mirroring the PHP client's `checkStatus()`.
        """
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{self.BASE_URL}/status/{prediction_id}",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
        except httpx.HTTPError:
            return {"job_status": "error", "image_bytes": None, "error_details": "Status check failed"}

        if resp.status_code != 200:
            return {"job_status": "error", "image_bytes": None, "error_details": "Status check failed"}

        decoded = _safe_json(resp)
        if not isinstance(decoded, dict):
            return {"job_status": "error", "image_bytes": None, "error_details": "Invalid status response"}

        job_status = str(decoded.get("status", ""))

        if job_status == "completed":
            output = decoded.get("output") or []
            output_url = output[0] if output else None
            if not isinstance(output_url, str) or output_url == "":
                return {"job_status": "failed", "image_bytes": None, "error_details": "No output URL in response"}
            image_bytes = await self._download_image(output_url)
            if image_bytes is None:
                return {"job_status": "failed", "image_bytes": None, "error_details": "Failed to download result image"}
            return {"job_status": "completed", "image_bytes": image_bytes, "error_details": None}

        if job_status == "failed":
            return {"job_status": "failed", "image_bytes": None, "error_details": self._extract_error(decoded, resp.text)}

        # 'starting', 'in_queue', or 'processing'
        return {"job_status": "processing", "image_bytes": None, "error_details": None}

    async def _download_image(self, url: str) -> bytes | None:
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "FitFyce/1.0"})
            return resp.content if resp.status_code == 200 else None
        except httpx.HTTPError:
            return None

    @staticmethod
    def _extract_error(decoded: Any, raw_response: str) -> str:
        """Fashn returns errors in two shapes: immediate validation
        ({"error": "BadRequest", "message": "..."}) or a failed prediction
        ({"error": {"name": ..., "message": ...}}). Always prefer the
        human-readable message.
        """
        if isinstance(decoded, dict):
            error = decoded.get("error")
            if isinstance(error, dict):
                return str(error.get("message") or error.get("name") or "Try-on generation failed")
            if isinstance(decoded.get("message"), str):
                return decoded["message"]
            if isinstance(error, str):
                return error
            if "detail" in decoded:
                return str(decoded["detail"])
        return (raw_response or "")[:200] or "Try-on generation failed"


def _safe_json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except ValueError:
        return None
