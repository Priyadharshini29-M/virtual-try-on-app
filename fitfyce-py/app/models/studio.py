import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base

studio_status_enum = ENUM(
    "pending", "processing", "completed", "failed", name="generation_status_enum"
)
studio_gender_enum = ENUM("female", "male", name="studio_gender_enum")


class GarmentStudioSession(Base):
    """Port of `garment_studio_sessions` — was a `CREATE TABLE IF NOT EXISTS`
    embedded directly in PHP (`GarmentStudioRepo.php`), no migration file,
    no FKs enforced at all. Now Alembic-managed with real FKs added (a
    strictness increase MySQL never had — only ever catches genuine bugs).
    """

    __tablename__ = "garment_studio_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_id: Mapped[int] = mapped_column(
        ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    shopify_variant_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    front_image_url: Mapped[str] = mapped_column(Text, nullable=False)
    back_image_url: Mapped[str] = mapped_column(Text, nullable=False)
    detail_image_1_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail_image_2_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail_image_3_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    gender: Mapped[str] = mapped_column(studio_gender_enum, nullable=False, default="female")
    model_key: Mapped[str] = mapped_column(String(50), nullable=False)
    fashn_prediction_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    garment_type: Mapped[str] = mapped_column(String(20), nullable=False, default="top")
    clothing_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(studio_status_enum, nullable=False, default="pending", index=True)
    result_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    saved_to_gallery: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    api_request_at: Mapped[datetime | None] = mapped_column(nullable=True)
    api_response_at: Mapped[datetime | None] = mapped_column(nullable=True)
    api_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )
