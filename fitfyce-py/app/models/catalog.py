from datetime import datetime

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ENUM, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base

image_type_enum = ENUM("flat_lay", "ghost_mannequin", "on_model", name="image_type_enum")
garment_type_enum = ENUM("top", "bottom", "full", name="garment_type_enum")
avatar_sex_enum = ENUM("male", "female", name="avatar_sex_enum")


class Collection(Base):
    __tablename__ = "collections"
    __table_args__ = (
        UniqueConstraint("merchant_id", "shopify_collection_id", name="uq_merchant_collection"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    merchant_id: Mapped[int] = mapped_column(ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False)
    shopify_collection_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    shopify_collection_gid: Mapped[str] = mapped_column(String(100), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    handle: Mapped[str] = mapped_column(Text, nullable=False)
    products_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Product(Base):
    """Port of `products`. `title`/`price` are nullable — the real
    `syncProduct()` write path never populates them despite older DDL
    claiming NOT NULL/a numeric default; modeling nullability honestly here
    avoids a class of insert failures the PHP code never actually hit only
    because MySQL's dump-vs-runtime schema had already drifted.
    `handle` is TEXT rather than a guessed VARCHAR width — two PHP sources
    disagreed (255 vs 500).
    """

    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("merchant_id", "shopify_product_id", name="uq_merchant_product"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    merchant_id: Mapped[int] = mapped_column(ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False)
    shopify_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shopify_store_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    shopify_product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    shopify_product_gid: Mapped[str] = mapped_column(String(100), nullable=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    handle: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_tryon_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    # Shopify's own collection id — distinct from Collection.id (our internal PK)
    collection_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    collection_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    collection_handle: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    collection_products: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    shopify_variants: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ProductCollectionMap(Base):
    __tablename__ = "product_collection_map"

    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), primary_key=True
    )
    collection_id: Mapped[int] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True
    )


class VariantImageMapping(Base):
    """`clothing_prompt` is TEXT — sources disagreed on width (200 vs 500)."""

    __tablename__ = "variant_image_mappings"
    __table_args__ = (
        UniqueConstraint("product_id", "shopify_variant_id", name="uq_variant"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    merchant_id: Mapped[int] = mapped_column(
        ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    shopify_variant_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    shopify_variant_gid: Mapped[str] = mapped_column(String(100), nullable=False)
    variant_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tryon_image_url: Mapped[str] = mapped_column(Text, nullable=False)
    image_type: Mapped[str] = mapped_column(image_type_enum, nullable=False, default="flat_lay")
    garment_type: Mapped[str] = mapped_column(garment_type_enum, nullable=False, default="top")
    avatar_sex: Mapped[str | None] = mapped_column(avatar_sex_enum, nullable=True)
    clothing_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )
