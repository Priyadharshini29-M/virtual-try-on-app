"""Helpers for making raw-SQL row mappings JSON-safe. The ORM-backed routes
serialize explicitly per-field; raw-SQL results (used for the multi-table
aggregate queries ported from PHP's raw PDO queries) need a generic pass
since asyncpg returns native `datetime`/`date`/`Decimal` objects that
Starlette's default JSON encoder can't handle.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any


def jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def row_to_dict(row: Any) -> dict:
    return {k: jsonable(v) for k, v in dict(row).items()}
