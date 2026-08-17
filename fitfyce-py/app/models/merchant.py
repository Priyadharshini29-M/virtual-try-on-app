import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class Merchant(Base):
    """Port of `merchants`. `plan` stays a plain string (validated at the
    Pydantic layer against Settings.plans) rather than a native Postgres
    ENUM — the live MySQL data was still on legacy 4-tier values
    (free/starter/growth/scale) despite the code assuming a 3-tier
    (basic/pro/premium) rebrand that was never actually applied; keeping
    this a data column, not a schema-level enum, means the ETL remap is a
    one-time UPDATE, not a migration, and any future tier change stays that
    way too.
    """

    __tablename__ = "merchants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shopify_domain: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    shopify_store_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    plan: Mapped[str] = mapped_column(String(20), nullable=False, default="basic")
    api_key: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    api_secret: Mapped[str] = mapped_column(String(64), nullable=False)
    tryon_count_month: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    billing_cycle_start: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    shopify_plan: Mapped[str | None] = mapped_column(String(100), nullable=True)
    installed_theme_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    installed_theme_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )

    settings: Mapped["MerchantSettings"] = relationship(
        back_populates="merchant", uselist=False, cascade="all, delete-orphan"
    )


class MerchantSettings(Base):
    """Port of `merchant_settings`.

    IMPORTANT: old PHP migration files (001/008) defined ~38 flat columns
    (button_color, padding, fonts, icon settings, ...) that `schema.md`
    documents as canonical — but the actual production dump AND the actual
    runtime code (`WidgetSettingsRepo.php`) never used them at all. Every
    widget/button setting lives as a key inside `widget_config` JSON. This
    model intentionally matches the real runtime contract, not the
    aspirational migration-file schema. Do not "restore" the flat columns.
    """

    __tablename__ = "merchant_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    merchant_id: Mapped[int] = mapped_column(
        ForeignKey("merchants.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    shopify_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shopify_store_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    widget_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    products_json: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    enabled_products: Mapped[list | None] = mapped_column(
        JSONB, nullable=True
    )  # NULL = "never synced" vs [] = "synced, zero enabled" — code depends on this distinction
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )

    merchant: Mapped["Merchant"] = relationship(back_populates="settings")


class PlanLimit(Base):
    """Port of `plan_limits`. `plan` is the PK and, like `Merchant.plan`,
    deliberately a plain string rather than tied to the same value set via a
    native enum — see `Merchant.plan` docstring.
    """

    __tablename__ = "plan_limits"

    plan: Mapped[str] = mapped_column(String(20), primary_key=True)
    monthly_tryon_limit: Mapped[int] = mapped_column(Integer, nullable=False)  # 0 = unlimited
    max_products: Mapped[int] = mapped_column(Integer, nullable=False)  # 0 = unlimited
    analytics_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    custom_api_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    branding_removable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    share_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    price_inr_monthly: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
