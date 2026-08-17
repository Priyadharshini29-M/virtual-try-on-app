import { createHmac, timingSafeEqual } from "node:crypto";
import { SHOPIFY_API_SECRET, PHP_API_URL, PHP_API_SECRET } from "../lib/env.server";
import { getMerchantApiKey } from "../lib/merchant.server";

/**
 * Webhook handler for:
 *   - orders/paid          → record conversion in PHP (revenue attribution)
 *   - app/uninstalled      → deactivate merchant in PHP
 *   - customers/data_request → GDPR: forward data export request to PHP
 *   - customers/redact     → GDPR: delete customer data in PHP
 *   - shop/redact          → GDPR: delete all shop data in PHP
 */
export const loader = () => new Response("Not Found", { status: 404 });

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await request.text();

  const hmacHeader = request.headers.get("x-shopify-hmac-sha256") ?? "";
  if (!verifyWebhookHmac(rawBody, hmacHeader, SHOPIFY_API_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const topic       = request.headers.get("x-shopify-topic") ?? "";
  const shop        = request.headers.get("x-shopify-shop-domain") ?? "";
  const webhookId   = request.headers.get("x-shopify-webhook-id") ?? "";

  const phpBase   = (PHP_API_URL).replace(/\/$/, "");
  const phpSecret = PHP_API_SECRET;

  if (topic === "orders/create" || topic === "orders/paid") {
    const lineItems = (payload.line_items ?? []).map((item) => ({
      product_id:  item.product_id,
      variant_id:  item.variant_id,
      title:       item.title,
      quantity:    item.quantity,
      price:       item.price,
      // Pass line item properties so PHP can look up the exact _fitfyce_session
      properties:  (item.properties ?? []).reduce((acc, p) => {
        acc[p.name] = p.value;
        return acc;
      }, {}),
    }));

    await phpFetch(phpBase, phpSecret, "/conversion", {
      shopify_order_id:  payload.id,
      shopify_order_gid: `gid://shopify/Order/${payload.id}`,
      order_value_inr:   parseFloat(payload.total_price ?? "0"),
      merchant_domain:   shop,
      line_items:        lineItems,
      webhook_event_id:  webhookId,
      event_type:        topic,
    }).catch(console.error);
  }

  if (topic === "app/uninstalled") {
    await phpFetch(phpBase, phpSecret, "/merchant/deactivate", {
      shopify_domain: shop,
    }).catch(() => {
      console.warn("Could not deactivate merchant for shop:", shop);
    });
  }

  // Fires on any subscription state change; downgrade to free when cancelled.
  if (topic === "app_subscriptions/update" && payload.status === "CANCELLED") {
    try {
      const merchantApiKey = await getMerchantApiKey(shop);
      if (merchantApiKey) {
        await phpFetch(phpBase, merchantApiKey, "/plan/update", { plan: "basic" });
        console.log("[webhook] subscription cancelled — downgraded to basic for:", shop);
      }
    } catch (err) {
      console.error("[webhook] app_subscriptions/update error for shop:", shop, err?.message ?? err);
    }
  }

  // ── GDPR mandatory webhooks ────────────────────────────────────────────────

  if (topic === "customers/data_request") {
    // Merchant is requesting export of a specific customer's data.
    // Forward to PHP so it can locate and report any stored session data.
    await phpFetch(phpBase, phpSecret, "/gdpr/customers/data_request", {
      shop_domain:   shop,
      customer:      payload.customer ?? null,
      orders_requested: payload.orders_requested ?? [],
    }).catch((err) => console.error("customers/data_request PHP call failed:", err));
  }

  if (topic === "customers/redact") {
    // Merchant is requesting deletion of a specific customer's data.
    await phpFetch(phpBase, phpSecret, "/gdpr/customers/redact", {
      shop_domain: shop,
      customer:    payload.customer ?? null,
      orders_to_redact: payload.orders_to_redact ?? [],
    }).catch((err) => console.error("customers/redact PHP call failed:", err));
  }

  if (topic === "shop/redact") {
    // 48+ hours after app uninstall — delete all remaining shop data.
    await phpFetch(phpBase, phpSecret, "/gdpr/shop/redact", {
      shop_domain: shop,
    }).catch((err) => console.error("shop/redact PHP call failed:", err));
  }

  return new Response("OK", { status: 200 });
};

function verifyWebhookHmac(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;
  try {
    const digest = createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");
    const digestBuf   = Buffer.from(digest);
    const expectedBuf = Buffer.from(hmacHeader);
    if (digestBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(digestBuf, expectedBuf);
  } catch {
    return false;
  }
}

async function phpFetch(base, apiKey, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key":    apiKey,
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
