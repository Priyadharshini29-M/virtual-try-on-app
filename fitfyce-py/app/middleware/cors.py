"""Port of fitfyce-php/middleware/CorsMiddleware.php.

PHP's version only listed `POST, GET, OPTIONS` in Access-Control-Allow-
Methods despite routing PUT/PATCH/DELETE routes too — an existing gap.
The Python port fixes it (Postgres/FastAPI migration explicitly resolves
this per the plan) by listing every verb actually used across the API.
"""

from fastapi.middleware.cors import CORSMiddleware

CORS_KWARGS = dict(
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Api-Key", "X-Shop-Domain"],
)

__all__ = ["CORSMiddleware", "CORS_KWARGS"]
