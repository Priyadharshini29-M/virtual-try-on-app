"""Port of UploadController.php's uploadTemp(). Public — no auth, matching
`router.php`'s `POST /upload-temp` (no ApiKeyAuth applied).
"""

from __future__ import annotations

import json
import time
import uuid

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.constants import UPLOAD_MAX_BYTES
from app.services import image_service, storage_service
from app.utils.urls import base_path, base_url

router = APIRouter()


@router.post("/upload-temp")
async def upload_temp(request: Request, photo: UploadFile = File(...)) -> JSONResponse:
    data = await photo.read()

    mime = image_service.detect_mime_type(data)
    if not mime.startswith("image/"):
        return JSONResponse({"error": "Only image files are allowed"}, status_code=400)

    if len(data) > UPLOAD_MAX_BYTES:
        mb = UPLOAD_MAX_BYTES / 1024 / 1024
        return JSONResponse({"error": f"File exceeds {mb:g}MB limit"}, status_code=400)

    settings = get_settings()
    file_uuid = str(uuid.uuid4())
    filename = f"{file_uuid}.jpg"

    jpeg_bytes = image_service.reencode_as_jpeg(data)
    (storage_service.temp_dir() / filename).write_bytes(jpeg_bytes)

    now = int(time.time())
    meta = {"uuid": file_uuid, "expires_at": now + settings.upload_ttl_seconds, "created_at": now}
    (storage_service.temp_meta_dir() / f"{file_uuid}.json").write_text(json.dumps(meta))

    temp_url = f"{base_url(request)}{base_path(request)}/temp/{filename}"
    return JSONResponse({"tempUrl": temp_url})
