"""Port of shared/helpers.php's baseUrl()/basePath()."""

from __future__ import annotations

from fastapi import Request

from app.core.config import get_settings


def base_url(request: Request | None) -> str:
    """Derives scheme://host from the incoming request — respects
    X-Forwarded-Proto behind a reverse proxy, same as PHP's version.
    Falls back to the configured PUBLIC_BASE_URL when there's no real
    request context (e.g. a background worker task).
    """
    if request is None:
        return get_settings().public_base_url.rstrip("/")

    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("host") or request.url.netloc
    if not host:
        return get_settings().public_base_url.rstrip("/")
    return f"{proto}://{host}"


def base_path(request: Request | None) -> str:
    """PHP derives this from dirname(SCRIPT_NAME) for apps not mounted at
    domain root. FastAPI's equivalent is the ASGI `root_path`."""
    if request is None:
        return ""
    return request.scope.get("root_path", "") or ""
