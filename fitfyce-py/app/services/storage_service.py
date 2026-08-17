"""Local-disk file storage for temp/ and results/ — Phase 1 implementation.

Kept behind this module (rather than called inline from routers) so the
planned swap to R2/S3 object storage for multi-instance deployment only
touches this file, not every caller.
"""

from __future__ import annotations

from pathlib import Path

from app.core.config import get_settings


def _storage_root() -> Path:
    root = Path(get_settings().storage_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


def temp_dir() -> Path:
    d = _storage_root() / "temp"
    d.mkdir(parents=True, exist_ok=True)
    return d


def temp_meta_dir() -> Path:
    d = temp_dir() / ".meta"
    d.mkdir(parents=True, exist_ok=True)
    return d


def results_dir() -> Path:
    d = _storage_root() / "results"
    d.mkdir(parents=True, exist_ok=True)
    return d


def models_dir() -> Path:
    """14-model registry for Garment Studio: models/{gender}/{model_key}.jpg"""
    d = _storage_root() / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def library_dir() -> Path:
    """Permanent storage for merchant-uploaded/saved model photos (StudioV2)."""
    d = _storage_root() / "library"
    d.mkdir(parents=True, exist_ok=True)
    return d


def generations_dir() -> Path:
    """Permanent storage for FASHN-generated images + OpenAI infographics (StudioV2)."""
    d = _storage_root() / "generations"
    d.mkdir(parents=True, exist_ok=True)
    return d


def flatlay_cache_dir() -> Path:
    d = _storage_root() / "temp" / "flatlay-cache"
    d.mkdir(parents=True, exist_ok=True)
    return d
