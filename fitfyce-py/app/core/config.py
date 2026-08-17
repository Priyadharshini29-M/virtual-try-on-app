from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://fitfyce:fitfyce@localhost:5432/fitfyce"
    database_url_sync: str = "postgresql+psycopg2://fitfyce:fitfyce@localhost:5432/fitfyce"

    # Auth
    master_api_key: str = ""
    shopify_api_secret: str = ""

    # Try-on engines
    fashn_api_key: str = ""
    fashn_api_mode: str = "quality"
    fal_api_key: str = ""
    vton_api_url: str = ""
    vton_api_key: str = ""

    # OpenAI
    openai_api_key: str = ""

    # Redis / arq
    redis_url: str = "redis://localhost:6379/0"

    # Object storage
    r2_account_id: str = ""
    r2_access_key: str = ""
    r2_secret_key: str = ""
    r2_bucket: str = ""
    r2_public_url: str = ""

    # Public URL used to build absolute links (results/, temp/, models/)
    public_base_url: str = "http://localhost:8000"

    # Local-disk storage root for temp/ and results/ (Phase 1). The approved
    # plan calls for R2/S3 object storage once multi-instance deployment is
    # needed; this stays behind app/services/storage_service.py so swapping
    # the backend later doesn't touch callers.
    storage_dir: str = "./storage"

    # TTLs — single source of truth (PHP had two independent, drifted copies of this)
    upload_ttl_seconds: int = 600
    results_ttl_hours: int = 24

    # Plans
    plans: tuple[str, ...] = ("basic", "pro", "premium")


@lru_cache
def get_settings() -> Settings:
    return Settings()
