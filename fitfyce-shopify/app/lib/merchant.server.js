import https from "node:https";
import { PHP_API_URL, PHP_API_SECRET } from "./env.server.js";

const phpAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Per-merchant PHP API key resolution.
 * Each shop has its own api_key in the merchants table.
 * Named .server.js — never sent to the browser.
 */

/**
 * Fetch the merchant row from PHP by Shopify domain.
 * Returns { api_key, plan, id, ... } or null.
 */
export function getMerchantByDomain(shopDomain) {
  const base = (PHP_API_URL).replace(/\/$/, "");
  if (!base) return Promise.resolve(null);

  const url = `${base}/merchant/by-domain?domain=${encodeURIComponent(shopDomain)}`;
  return phpGet(url);
}

/**
 * Get the PHP api_key for the current shop session.
 * Falls back to PHP_API_SECRET (dev/single-tenant mode).
 */
export async function getMerchantApiKey(shopDomain) {
  // Dev shortcut: if PHP_API_SECRET is set and no URL, use it directly
  if (!PHP_API_URL) {
    return PHP_API_SECRET;
  }

  const merchant = await getMerchantByDomain(shopDomain);
  if (merchant?.api_key) return merchant.api_key;

  // Fallback to env var (single-tenant dev)
  return PHP_API_SECRET;
}

/**
 * Ensure the merchant exists in the PHP backend.
 * If not found, auto-registers them using the Shopify session.
 * Returns the merchant's api_key.
 */
export async function ensureMerchant(session) {
  const base = (PHP_API_URL).replace(/\/$/, "");
  if (!base) return PHP_API_SECRET;

  // Check if already registered
  const existing = await getMerchantByDomain(session.shop);
  if (existing?.api_key) return existing.api_key;

  // Not found — register now
  try {
    const data = await phpPost(`${base}/merchant/register`, {
      shopify_domain:   session.shop,
      shopify_store_id: session.shop,
      access_token:     session.accessToken ?? "",
    });
    if (data?.api_key) return data.api_key;
  } catch (err) {
    console.error("[ensureMerchant] register failed:", err);
  }

  return PHP_API_SECRET;
}

// ── Helpers ─────────────────────────────────────────────────────

function phpGet(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const timer = setTimeout(() => { req.destroy(); resolve(null); }, 8_000);
    const req = https.request(
      { hostname: parsed.hostname, port: parsed.port || 443, path: parsed.pathname + parsed.search, method: "GET", headers: { "Accept": "application/json", "X-Api-Key": PHP_API_SECRET }, agent: phpAgent },
      (res) => {
        let raw = ""; res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => { clearTimeout(timer); if (res.statusCode < 200 || res.statusCode >= 300) { resolve(null); return; } try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
      }
    );
    req.on("error", () => { clearTimeout(timer); resolve(null); });
    req.end();
  });
}

function phpPost(url, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed = new URL(url);
    const timer = setTimeout(() => { req.destroy(); reject(new Error("timeout")); }, 8_000);
    const req = https.request(
      { hostname: parsed.hostname, port: parsed.port || 443, path: parsed.pathname + parsed.search, method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Api-Key": PHP_API_SECRET, "Content-Length": Buffer.byteLength(bodyStr) }, agent: phpAgent },
      (res) => {
        let raw = ""; res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => { clearTimeout(timer); try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
      }
    );
    req.on("error", (err) => { clearTimeout(timer); reject(err); });
    req.write(bodyStr); req.end();
  });
}
