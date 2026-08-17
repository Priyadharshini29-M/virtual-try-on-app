import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.models.merchant import Merchant


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    """A dedicated engine created inside the (session-scoped) test event
    loop. The app's own module-level `engine` in app/db/session.py is built
    at import time — outside any event loop — so asyncpg connections from
    it can't be reused across the different loop each test/fixture may run
    in. Tests get their own engine instead of importing that singleton.
    """
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine):
    session_maker = async_sessionmaker(bind=test_engine, expire_on_commit=False, autoflush=False)
    async with session_maker() as session:
        yield session


@pytest_asyncio.fixture
async def test_merchant(db_session: AsyncSession):
    merchant = Merchant(
        shopify_domain="test-shop.myshopify.com",
        shopify_store_id="test-shop.myshopify.com",
        access_token="test-token",
        plan="basic",
        api_key="tf_test_key_12345",
        api_secret="test-secret",
        is_active=True,
    )
    db_session.add(merchant)
    await db_session.commit()
    await db_session.refresh(merchant)
    yield merchant
    await db_session.delete(merchant)
    await db_session.commit()
