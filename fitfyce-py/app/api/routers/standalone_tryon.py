"""Port of fitfyce-php/standalone-tryon.php — the public, unauthenticated
endpoint the Tilda-site widget (tilda-tryon-widget.html) calls directly.

Mounted at the exact same path (`/standalone-tryon.php`) so the already-
deployed Tilda widget script (hardcoded to
`https://tryonapp.digifyce.com/standalone-tryon.php`) keeps working
unmodified — this endpoint has no DB usage, no auth, CORS-open by design.

Fashn.ai is canonical (matches the PHP file's current active engine, per
the migration plan's resolved decision). Kolors/fal.ai is NOT ported here
yet — it's dormant in PHP too (disabled, zero fal.ai balance) and can be
added alongside Fashn in a later pass without changing this contract.
"""

from __future__ import annotations

import base64
import time
import uuid

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.integrations.fashn_client import FashnClient
from app.services import image_service, storage_service
from app.utils.urls import base_path, base_url

router = APIRouter()

_STATUS_MAP = {429: 503, 408: 504}


@router.post("/standalone-tryon.php")
async def standalone_tryon(
    request: Request,
    model_image: UploadFile = File(...),
    garment_image: UploadFile = File(...),
    category: str = Form(default="auto"),
) -> JSONResponse:
    settings = get_settings()
    if not settings.fashn_api_key:
        return JSONResponse(
            {"error": "Server not configured: set FASHN_API_KEY in .env or as an environment variable"},
            status_code=500,
        )

    if category not in ("auto", "tops", "bottoms", "one-pieces"):
        category = "auto"

    model_bytes = await model_image.read()
    garment_bytes = await garment_image.read()

    model_mime = image_service.detect_mime_type(model_bytes)
    if not model_mime.startswith("image/"):
        return JSONResponse({"error": "model_image could not be read as an image"}, status_code=400)

    garment_mime = image_service.detect_mime_type(garment_bytes)
    if not garment_mime.startswith("image/"):
        return JSONResponse({"error": "garment_image could not be read as an image"}, status_code=400)

    model_uri = f"data:{model_mime};base64,{base64.b64encode(model_bytes).decode()}"
    garment_uri = f"data:{garment_mime};base64,{base64.b64encode(garment_bytes).decode()}"

    client = FashnClient(settings.fashn_api_key, settings.fashn_api_mode)
    result = await client.try_on(model_uri, garment_uri, category)

    if result.status_code != 200 or result.image_bytes is None:
        return JSONResponse(
            {
                "error": result.error_details or "Try-on generation failed",
                "status_code": result.status_code,
            },
            status_code=_STATUS_MAP.get(result.status_code, 400),
        )

    filename = f"tryon_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.jpg"
    (storage_service.results_dir() / filename).write_bytes(result.image_bytes)

    result_url = f"{base_url(request)}{base_path(request)}/results/{filename}"
    return JSONResponse(
        {
            "result_image": f"data:image/jpeg;base64,{base64.b64encode(result.image_bytes).decode()}",
            "result_url": result_url,
        }
    )
