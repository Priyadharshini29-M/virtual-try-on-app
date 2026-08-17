"""Import every model module so `Base.metadata` is fully populated before
Alembic's `--autogenerate` (or any `Base.metadata.create_all`) runs.
"""

from app.db.base import Base
from app.models.catalog import Collection, Product, ProductCollectionMap, VariantImageMapping
from app.models.merchant import Merchant, MerchantSettings, PlanLimit
from app.models.studio import GarmentStudioSession
from app.models.studio_v2 import Asset, Generation, Infographic, SavedModel
from app.models.tryon import AnalyticsDaily, AnalyticsWebhookEvent, TryOnConversion, TryOnSession
from app.models.webhook import WebhookLog

__all__ = [
    "Base",
    "Merchant",
    "MerchantSettings",
    "PlanLimit",
    "Collection",
    "Product",
    "ProductCollectionMap",
    "VariantImageMapping",
    "TryOnSession",
    "TryOnConversion",
    "AnalyticsDaily",
    "AnalyticsWebhookEvent",
    "WebhookLog",
    "GarmentStudioSession",
    "SavedModel",
    "Generation",
    "Infographic",
    "Asset",
]
