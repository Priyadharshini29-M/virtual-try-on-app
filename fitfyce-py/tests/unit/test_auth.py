import base64
import hashlib
import hmac
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

import app.api.deps as deps_module
from app.api.deps import get_shop_domain, require_api_key, resolve_merchant_by_shop
from app.core.config import get_settings


# ── require_api_key ─────────────────────────────────────────────────────


async def test_empty_key_raises_401(db_session):
    with pytest.raises(HTTPException) as exc:
        await require_api_key(x_api_key="", db=db_session)
    assert exc.value.status_code == 401


async def test_master_key_returns_synthetic_identity_without_db_lookup(db_session):
    settings = get_settings()
    identity = await require_api_key(x_api_key=settings.master_api_key, db=db_session)
    assert identity.is_master is True
    assert identity.id == 0
    assert identity.plan == "master"
    assert identity.merchant is None


async def test_valid_merchant_key_returns_identity(db_session, test_merchant):
    identity = await require_api_key(x_api_key=test_merchant.api_key, db=db_session)
    assert identity.is_master is False
    assert identity.merchant is not None
    assert identity.id == test_merchant.id
    assert identity.plan == test_merchant.plan


async def test_unknown_key_raises_401(db_session):
    with pytest.raises(HTTPException) as exc:
        await require_api_key(x_api_key="tf_does_not_exist", db=db_session)
    assert exc.value.status_code == 401


async def test_inactive_merchant_raises_401(db_session, test_merchant):
    test_merchant.is_active = False
    db_session.add(test_merchant)
    await db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await require_api_key(x_api_key=test_merchant.api_key, db=db_session)
    assert exc.value.status_code == 401


# ── get_shop_domain ──────────────────────────────────────────────────────


async def test_get_shop_domain_prefers_query_param():
    result = await get_shop_domain(shop="a.myshopify.com", x_shop_domain="b.myshopify.com")
    assert result == "a.myshopify.com"


async def test_get_shop_domain_falls_back_to_header():
    result = await get_shop_domain(shop=None, x_shop_domain="b.myshopify.com")
    assert result == "b.myshopify.com"


async def test_get_shop_domain_normalizes_protocol_and_trailing_slash():
    result = await get_shop_domain(shop="HTTPS://A.MyShopify.com/", x_shop_domain=None)
    assert result == "a.myshopify.com"


async def test_get_shop_domain_none_when_neither_provided():
    result = await get_shop_domain(shop=None, x_shop_domain=None)
    assert result is None


# ── resolve_merchant_by_shop ─────────────────────────────────────────────


async def test_resolve_merchant_no_domain_returns_none(db_session):
    result = await resolve_merchant_by_shop(shop_domain=None, db=db_session)
    assert result is None


async def test_resolve_merchant_exact_match(db_session, test_merchant):
    result = await resolve_merchant_by_shop(shop_domain=test_merchant.shopify_domain, db=db_session)
    assert result is not None
    assert result.id == test_merchant.id


async def test_resolve_merchant_unknown_domain_returns_none(db_session):
    result = await resolve_merchant_by_shop(shop_domain="totally-unknown-shop.myshopify.com", db=db_session)
    assert result is None


async def test_resolve_merchant_inactive_returns_none(db_session, test_merchant):
    test_merchant.is_active = False
    db_session.add(test_merchant)
    await db_session.commit()

    result = await resolve_merchant_by_shop(shop_domain=test_merchant.shopify_domain, db=db_session)
    assert result is None


# ── verify_shopify_hmac (exercised via a throwaway app, since it needs a
#    real Request with an actual byte stream to verify against) ──────────


def _hmac_test_app(secret: str) -> FastAPI:
    app = FastAPI()

    @app.post("/webhook-test")
    async def handler(raw: bytes = Depends(deps_module.verify_shopify_hmac)):
        return {"ok": True, "len": len(raw)}

    return app


def test_hmac_valid_signature_passes(monkeypatch):
    monkeypatch.setattr(
        deps_module, "get_settings", lambda: SimpleNamespace(shopify_api_secret="test-secret")
    )
    client = TestClient(_hmac_test_app("test-secret"))
    body = b'{"shopify_domain":"test.myshopify.com"}'
    sig = base64.b64encode(hmac.new(b"test-secret", body, hashlib.sha256).digest()).decode()

    resp = client.post("/webhook-test", content=body, headers={"X-Shopify-Hmac-Sha256": sig})
    assert resp.status_code == 200
    assert resp.json()["len"] == len(body)


def test_hmac_tampered_body_rejected(monkeypatch):
    monkeypatch.setattr(
        deps_module, "get_settings", lambda: SimpleNamespace(shopify_api_secret="test-secret")
    )
    client = TestClient(_hmac_test_app("test-secret"))
    original = b'{"shopify_domain":"test.myshopify.com"}'
    sig = base64.b64encode(hmac.new(b"test-secret", original, hashlib.sha256).digest()).decode()

    tampered = b'{"shopify_domain":"evil.myshopify.com"}'
    resp = client.post("/webhook-test", content=tampered, headers={"X-Shopify-Hmac-Sha256": sig})
    assert resp.status_code == 401


def test_hmac_wrong_secret_rejected(monkeypatch):
    monkeypatch.setattr(
        deps_module, "get_settings", lambda: SimpleNamespace(shopify_api_secret="the-real-secret")
    )
    client = TestClient(_hmac_test_app("the-real-secret"))
    body = b'{"shopify_domain":"test.myshopify.com"}'
    sig = base64.b64encode(hmac.new(b"wrong-secret", body, hashlib.sha256).digest()).decode()

    resp = client.post("/webhook-test", content=body, headers={"X-Shopify-Hmac-Sha256": sig})
    assert resp.status_code == 401


def test_hmac_missing_signature_rejected(monkeypatch):
    monkeypatch.setattr(
        deps_module, "get_settings", lambda: SimpleNamespace(shopify_api_secret="test-secret")
    )
    client = TestClient(_hmac_test_app("test-secret"))
    resp = client.post("/webhook-test", content=b"{}")
    assert resp.status_code == 401
