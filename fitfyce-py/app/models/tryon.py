import uuid
from datetime import date as date_type
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Date, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base

session_status_enum = ENUM("pending", "processing", "completed", "failed", name="session_status_enum")
device_type_enum = ENUM("mobile", "tablet", "desktop", name="device_type_enum")


class TryOnSession(Base):
    """`product_id` is nullable with ON DELETE SET NULL — the original dump
    DDL said NOT NULL, but a later deployed ALTER (`migrate.php`) relaxed it
    explicitly to "allow sessions without synced products." Going with the
    later, actually-deployed state.
    """

    __tablename__ = "tryon_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_id: Mapped[int] = mapped_column(
        ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shopify_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shopify_store_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    variant_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # Shopify variant id, no local FK
    status: Mapped[str] = mapped_column(session_status_enum, nullable=False, default="pending", index=True)
    result_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_seed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_expires_at: Mapped[datetime | None] = mapped_column(nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    api_request_at: Mapped[datetime | None] = mapped_column(nullable=True)
    api_response_at: Mapped[datetime | None] = mapped_column(nullable=True)
    api_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action_add_to_cart: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    action_buy_now: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    action_save_image: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    action_share_wa: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    device_type: Mapped[str | None] = mapped_column(device_type_enum, nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )


class TryOnConversion(Base):
    __tablename__ = "tryon_conversions"
    __table_args__ = (
        UniqueConstraint("shopify_order_id", "tryon_session_id", name="uq_order_session"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tryon_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tryon_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    merchant_id: Mapped[int] = mapped_column(
        ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shopify_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shopify_store_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    shopify_order_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    shopify_order_gid: Mapped[str | None] = mapped_column(String(100), nullable=True)
    order_value_inr: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    attributed_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class AnalyticsDaily(Base):
    __tablename__ = "analytics_daily"
    __table_args__ = (UniqueConstraint("merchant_id", "date", name="uq_merchant_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    merchant_id: Mapped[int] = mapped_column(ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False)
    shopify_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shopify_store_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    tryon_initiated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tryon_completed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tryon_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    add_to_cart_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    buy_now_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    save_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    share_wa_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    order_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revenue_inr: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    avg_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    computed_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AnalyticsWebhookEvent(Base):
    """Idempotency/dedup table for Shopify order webhooks (ConversionController)."""

    __tablename__ = "analytics_webhook_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    webhook_event_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    merchant_id: Mapped[int] = mapped_column(ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    processed_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False, index=True)
