from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ENUM, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base

webhook_direction_enum = ENUM("incoming", "outgoing", name="webhook_direction_enum")


class WebhookLog(Base):
    """Port of `webhook_logs`. Not wired into any live route today (not
    referenced from router.php's controller list, and it's unclear whether
    `WebhookLogRepo` is used anywhere reachable) — schema carried forward
    for completeness, writes not yet wired up. `payload`/`headers` are
    JSONB (PHP had this split between a migration declaring native JSON and
    the deployed `migrate.php` downgrading to LONGTEXT — JSONB resolves
    that cleanly in Postgres's favor).
    """

    __tablename__ = "webhook_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    merchant_id: Mapped[int] = mapped_column(
        ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    direction: Mapped[str] = mapped_column(webhook_direction_enum, nullable=False, default="incoming")
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    headers: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )
