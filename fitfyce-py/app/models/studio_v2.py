import uuid
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.studio import studio_status_enum

asset_source_type_enum = ENUM(
    "saved_model", "generation", "infographic", name="asset_source_type_enum"
)


class SavedModel(Base):
    __tablename__ = "saved_models"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_id: Mapped[int] = mapped_column(
        ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False, index=True)


class Generation(Base):
    """Port of `generations` (StudioV2). Adds a real FK on `saved_model_id`
    (unenforced in the original PHP runtime-created table) now that this
    goes through Alembic — see GarmentStudioSession docstring for the same
    reasoning.
    """

    __tablename__ = "generations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_id: Mapped[int] = mapped_column(
        ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    shopify_variant_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    product_image_url: Mapped[str] = mapped_column(Text, nullable=False)
    saved_model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("saved_models.id", ondelete="SET NULL"), nullable=True
    )
    model_image_url: Mapped[str] = mapped_column(Text, nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(studio_status_enum, nullable=False, default="pending", index=True)
    fashn_prediction_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Tracks whether the post-completion infographic batch has been kicked
    # off yet — set True as soon as it's enqueued (right after Fashn submit,
    # per the plan's "eager background kickoff" approach), so a retried
    # status check never double-enqueues the batch.
    infographic_batch_started: Mapped[bool] = mapped_column(default=False, nullable=False)
    api_request_at: Mapped[datetime | None] = mapped_column(nullable=True)
    api_response_at: Mapped[datetime | None] = mapped_column(nullable=True)
    api_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Infographic(Base):
    __tablename__ = "infographics"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    generation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("generations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    merchant_id: Mapped[int] = mapped_column(
        ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    style_key: Mapped[str] = mapped_column(String(30), nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(studio_status_enum, nullable=False, default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class Asset(Base):
    """Port of `assets` — a unified media index across saved models,
    generations, and infographics. `source_id` is intentionally NOT a real
    FK (no clean Postgres pattern for a polymorphic reference without
    single-table-inheritance overkill); referential integrity for it is
    enforced at the service layer (validate the referenced row exists at
    write time) instead of the DB layer. This is a deliberate, documented
    exception to "enforce real FKs everywhere else in this migration."
    """

    __tablename__ = "assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_id: Mapped[int] = mapped_column(
        ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str] = mapped_column(asset_source_type_enum, nullable=False, index=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False, index=True)
