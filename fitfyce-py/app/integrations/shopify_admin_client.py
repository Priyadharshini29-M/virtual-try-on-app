"""Async httpx port of src/ShopifyApi.php."""

from __future__ import annotations

import re
from urllib.parse import urlencode

import httpx

API_VERSION = "2024-04"


class ShopifyAdminClient:
    def __init__(self, shop_domain: str, access_token: str):
        self.domain = shop_domain.rstrip("/")
        self.token = access_token

    async def fetch_all(self, endpoint: str, key: str, params: dict | None = None) -> list[dict]:
        results: list[dict] = []
        page_info: str | None = None

        while True:
            if page_info:
                query = urlencode({"limit": 250, "page_info": page_info})
            else:
                query = urlencode({"limit": 250, **(params or {})})

            url = f"https://{self.domain}/admin/api/{API_VERSION}/{endpoint}.json?{query}"
            resp = await self.get(url)

            if "errors" in resp:
                break

            batch = resp.get(key, [])
            results.extend(batch)
            page_info = resp.get("_next_page_info")
            if page_info is None:
                break

        return results

    async def get(self, url: str) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                url,
                headers={"X-Shopify-Access-Token": self.token, "Content-Type": "application/json"},
            )

        try:
            data = resp.json()
        except ValueError:
            data = {}

        link_header = resp.headers.get("link", "")
        match = re.search(r'<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"', link_header)
        if match:
            data["_next_page_info"] = match.group(1)

        return data
