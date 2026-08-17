"""Pillow port of fitfyce-php/src/ImageUtils.php, plus a shared async
image-fetch helper (port of the "base64 data URI or https:// URL" input
pattern repeated across TryOnController/GarmentStudioController/
InfographicController)."""

from __future__ import annotations

import base64
import io
from pathlib import Path

import httpx
from PIL import Image, UnidentifiedImageError

_FORMAT_TO_MIME = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "GIF": "image/gif",
    "WEBP": "image/webp",
    "BMP": "image/bmp",
}


def detect_mime_type(data: bytes) -> str:
    """Port of `ImageUtils::detectMimeType()`. Returns
    'application/octet-stream' for undecodable data (matches finfo's
    behavior of not throwing — callers check for an `image/*` prefix)."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            fmt = (img.format or "").upper()
            return _FORMAT_TO_MIME.get(fmt, "application/octet-stream")
    except (UnidentifiedImageError, OSError):
        return "application/octet-stream"


def reencode_as_jpeg(data: bytes, quality: int = 90) -> bytes:
    """Port of the GD re-encode `UploadController::uploadTemp()` performs
    (`imagecreatefromstring` + `imagejpeg`). Falls back to the original
    bytes if Pillow can't decode it — matches PHP's `move_uploaded_file`
    fallback when `imagecreatefromstring` fails.
    """
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality)
            return buf.getvalue()
    except (UnidentifiedImageError, OSError):
        return data


def ensure_minimum_size(path: Path, min_w: int, min_h: int) -> Path:
    """Port of `ImageUtils::ensureMinimumSize()` — upscale (preserving
    aspect ratio) so both dimensions reach at least min_w x min_h. Returns
    the original path unchanged if already large enough or undecodable.
    Writes a new file alongside the original (caller owns cleanup) rather
    than PHP's by-ref $tempFiles accumulator.
    """
    try:
        with Image.open(path) as img:
            w, h = img.size
            if w >= min_w and h >= min_h:
                return path

            scale = max(min_w / max(w, 1), min_h / max(h, 1))
            new_w, new_h = int((w * scale) + 0.999999), int((h * scale) + 0.999999)

            resized = img.convert("RGB") if img.mode not in ("RGB", "L") else img
            resized = resized.resize((new_w, new_h), Image.LANCZOS)

            out_path = path.with_name(f"{path.stem}_resized.jpg")
            resized.save(out_path, format="JPEG", quality=95)
            return out_path
    except (UnidentifiedImageError, OSError):
        return path


def ensure_minimum_size_bytes(data: bytes, min_w: int, min_h: int) -> bytes:
    """Bytes-based sibling of `ensure_minimum_size()` — Garment Studio's
    pipeline works on in-memory bytes throughout rather than temp-file
    paths (PHP's `&$tempFiles`-accumulator pattern doesn't translate;
    Pillow can just hold everything in `BytesIO`)."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            w, h = img.size
            if w >= min_w and h >= min_h:
                return data

            scale = max(min_w / max(w, 1), min_h / max(h, 1))
            new_w, new_h = int((w * scale) + 0.999999), int((h * scale) + 0.999999)

            resized = img.convert("RGB") if img.mode not in ("RGB", "L") else img
            resized = resized.resize((new_w, new_h), Image.LANCZOS)

            buf = io.BytesIO()
            resized.save(buf, format="JPEG", quality=95)
            return buf.getvalue()
    except (UnidentifiedImageError, OSError):
        return data


def pad_to_square(data: bytes, size: int = 1080) -> bytes:
    """Port of `ImageUtils::padToSquare()` — contain-scale + center onto a
    white size x size canvas, re-encoded as PNG. Used to normalize
    gpt-image-1's native output to a requested square commercial size."""
    try:
        with Image.open(io.BytesIO(data)) as src:
            src_rgb = src.convert("RGB") if src.mode not in ("RGB", "L", "RGBA") else src
            src_w, src_h = src_rgb.size

            canvas = Image.new("RGB", (size, size), (255, 255, 255))
            scale = min(size / max(src_w, 1), size / max(src_h, 1))
            new_w, new_h = round(src_w * scale), round(src_h * scale)
            resized = src_rgb.resize((new_w, new_h), Image.LANCZOS)

            off_x = (size - new_w) // 2
            off_y = (size - new_h) // 2
            canvas.paste(resized, (off_x, off_y))

            buf = io.BytesIO()
            canvas.save(buf, format="PNG")
            return buf.getvalue()
    except (UnidentifiedImageError, OSError):
        return data


def make_thumbnail(source_path: Path, dest_path: Path, max_dim: int = 320) -> bool:
    """Port of `ImageUtils::makeThumbnail()` — scale-down-only (never
    upscales), JPEG quality 80."""
    try:
        with Image.open(source_path) as img:
            w, h = img.size
            scale = min(max_dim / max(w, 1), max_dim / max(h, 1), 1.0)
            new_w, new_h = max(1, round(w * scale)), max(1, round(h * scale))

            resized = img.convert("RGB") if img.mode not in ("RGB", "L") else img
            resized = resized.resize((new_w, new_h), Image.LANCZOS)

            dest_path.parent.mkdir(parents=True, exist_ok=True)
            resized.save(dest_path, format="JPEG", quality=80)
            return True
    except (UnidentifiedImageError, OSError):
        return False


def file_to_base64_uri(path: Path) -> str:
    """Port of `ImageUtils::fileToBase64Uri()`."""
    data = path.read_bytes()
    mime = detect_mime_type(data)
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def bytes_to_base64_uri(data: bytes) -> str:
    mime = detect_mime_type(data)
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


async def fetch_image_bytes(value: str) -> bytes | None:
    """Port of the "base64 data URI or https:// URL" input resolution
    pattern (`TryOnController::inputToTempFile()`,
    `GarmentStudioController::inputToTempFile()`,
    `InfographicController::downloadImage()`). Local-file shortcut
    resolution is skipped — every input is fetched over HTTP, including our
    own /temp/ and /results/ static routes; a minor perf simplification,
    not a correctness change.
    """
    if value.startswith("data:image"):
        comma = value.find(",")
        if comma == -1:
            return None
        try:
            return base64.b64decode(value[comma + 1:])
        except Exception:  # noqa: BLE001
            return None

    url = value
    if url.startswith("//"):
        url = "https:" + url
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "FitFyce/1.0"})
        return resp.content if resp.status_code == 200 else None
    except httpx.HTTPError:
        return None
