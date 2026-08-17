/**
 * Public storefront endpoint — returns saved widget settings for a shop.
 * Called by tryon-widget.js on every product page load.
 * No auth required: settings are already visible on the storefront.
 *
 * POST action — called by the admin settings page Save button.
 * Auth-guarded via Shopify session.
 */
import { authenticate } from "../shopify.server";
import { ensureMerchant } from "../lib/merchant.server";
import phpApiClient from "../lib/php-api.server";
import { PHP_API_URL } from "../lib/env.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

// ── GET: storefront read (no auth needed) ─────────────────────────────────────
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return Response.json({}, { headers: CORS });
  }

  const phpBase = PHP_API_URL.replace(/\/$/, "");
  if (!phpBase) {
    return Response.json({}, { headers: CORS });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    // Call the public widget-settings endpoint directly — it scopes by shop domain,
    // returns the correctly-formatted flat config, and includes enabled_product_ids
    // and enabled_product_handles so the widget can filter products by this shop.
    const res = await fetch(
      `${phpBase}/api/widget-settings?shop=${encodeURIComponent(shop)}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);

    const data = res.ok ? await res.json().catch(() => ({})) : {};
    return Response.json(data ?? {}, { headers: CORS });
  } catch {
    clearTimeout(timer);
    return Response.json({}, { headers: CORS });
  }
}

// ── POST: admin save (Shopify session auth) ───────────────────────────────────
export async function action({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const apiKey = await ensureMerchant(session);
    const body = await request.json();

    console.log("[SAVE] shop:", session.shop, "| apiKey:", apiKey?.slice(0, 8), "| PHP_API_URL:", PHP_API_URL);

    const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
    const res = await api.saveSettings(body);

    console.log("[SAVE] PHP ok:", res.ok, "| status:", res.status, "| error:", res.error);

    if (!res.ok) {
      console.error("[SAVE] PHP rejected save:", res.status, res.error);
      // Return 200 so React Router does not trigger the error boundary;
      // the settings page reads ok/error from the JSON body.
      return Response.json({ ok: false, error: res.error ?? "Save failed. Please try again." });
    }

    return Response.json({ ok: true, data: res.data ?? null, _t: Date.now() });
  } catch (err) {
    console.error("[SAVE] Unhandled error:", err);
    return Response.json({ ok: false, error: err?.message ?? "Unexpected server error. Please try again." });
  }
}
