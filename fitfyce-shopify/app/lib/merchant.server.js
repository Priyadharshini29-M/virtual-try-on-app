/**
 * Per-merchant PHP API key resolution.
 * Each shop has its own api_key in the merchants table.
 * Named .server.js — never sent to the browser.
 */

/**
 * Fetch the merchant row from PHP by Shopify domain.
 * Returns { api_key, plan, id, ... } or null.
 */
export async function getMerchantByDomain(shopDomain) {
  const base = (process.env.PHP_API_URL ?? "").replace(/\/$/, "");
  if (!base) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);

    const res = await fetch(
      `${base}/merchant/by-domain?domain=${encodeURIComponent(shopDomain)}`,
      {
        headers: {
          // Use the master install key only for this internal lookup
          "X-Api-Key":      process.env.PHP_API_SECRET ?? "",
          "Content-Type":   "application/json",
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the PHP api_key for the current shop session.
 * Falls back to PHP_API_SECRET (dev/single-tenant mode).
 */
export async function getMerchantApiKey(shopDomain) {
  // Dev shortcut: if PHP_API_SECRET is set and no URL, use it directly
  if (!process.env.PHP_API_URL) {
    return process.env.PHP_API_SECRET ?? "";
  }

  const merchant = await getMerchantByDomain(shopDomain);
  if (merchant?.api_key) return merchant.api_key;

  // Fallback to env var (single-tenant dev)
  return process.env.PHP_API_SECRET ?? "";
}

/**
 * Ensure the merchant exists in the PHP backend.
 * If not found, auto-registers them using the Shopify session.
 * Returns the merchant's api_key.
 */
export async function ensureMerchant(session) {
  const base = (process.env.PHP_API_URL ?? "").replace(/\/$/, "");
  if (!base) return process.env.PHP_API_SECRET ?? "";

  // Check if already registered
  const existing = await getMerchantByDomain(session.shop);
  if (existing?.api_key) return existing.api_key;

  // Not found — register now
  try {
    const res = await fetch(`${base}/merchant/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": process.env.PHP_API_SECRET ?? "",
      },
      body: JSON.stringify({
        shopify_domain:   session.shop,
        shopify_store_id: session.shop,
        access_token:     session.accessToken ?? "",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.api_key) return data.api_key;
    }
  } catch (err) {
    console.error("[ensureMerchant] register failed:", err);
  }

  return process.env.PHP_API_SECRET ?? "";
}
