from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.routers import (
    analytics,
    conversion,
    garment_studio,
    gdpr,
    infographic,
    merchant,
    plans,
    products,
    session,
    settings,
    shop,
    shopify_sync,
    standalone_tryon,
    studio_v2,
    tryon,
    upload,
    widget,
)
from app.core.logging import configure_logging
from app.middleware.cors import CORS_KWARGS, CORSMiddleware
from app.services.storage_service import generations_dir, library_dir, models_dir, results_dir, temp_dir

configure_logging()

app = FastAPI(title="FitFyce API (Python)", version="0.1.0")

app.add_middleware(CORSMiddleware, **CORS_KWARGS)

# Static serving for temp/ and results/ — matches PHP's baseUrl()+basePath()
# + '/temp/'|'/results/' URL construction (files served directly by the web
# server in production; StaticFiles replicates that for local/dev use).
app.mount("/temp", StaticFiles(directory=str(temp_dir())), name="temp")
app.mount("/results", StaticFiles(directory=str(results_dir())), name="results")
app.mount("/models", StaticFiles(directory=str(models_dir())), name="models")
app.mount("/library", StaticFiles(directory=str(library_dir())), name="library")
app.mount("/generations", StaticFiles(directory=str(generations_dir())), name="generations")

# Phase 1 — public/stateless routes.
app.include_router(widget.router)
app.include_router(upload.router)
app.include_router(standalone_tryon.router)

# Phase 2 — read-mostly authenticated dashboard routes.
app.include_router(analytics.router)
app.include_router(plans.router)
app.include_router(shop.router)
app.include_router(products.router)

# Phase 3 — merchant lifecycle + low-frequency writes.
app.include_router(merchant.router)
app.include_router(settings.router)
app.include_router(shopify_sync.router)
app.include_router(gdpr.router)

# Phase 4 — core revenue path.
app.include_router(session.router)
app.include_router(tryon.router)
app.include_router(conversion.router)

# Phase 5b — Garment Studio (/studio/*).
app.include_router(garment_studio.router)

# Phase 5c — Infographic (/infographic/*).
app.include_router(infographic.router)

# Phase 5d — Studio v2 (/studio-v2/*).
app.include_router(studio_v2.router)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True}
