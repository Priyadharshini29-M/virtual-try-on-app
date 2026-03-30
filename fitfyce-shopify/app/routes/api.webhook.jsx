import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook handler for:
 *   - orders/paid   → record conversion in PHP
 *   - app/uninstalled → deactivate merchant in PHP
 */
export const loader = () => new Response("Not Found", { status: 404 });

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await request.text();

  // ── Verify HMAC ────────────────────────────────────────────────
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const shopifySecret = process.env.SHOPIFY_API_SECRET ?? "";

  if (!verifyWebhookHmac(rawBody, hmacHeader, shopifySecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shop  = request.headers.get("x-shopify-shop-domain") ?? "";

  const phpBase   = (process.env.PHP_API_URL ?? "").replace(/\/$/, "");
  const phpSecret = process.env.PHP_API_SECRET ?? "";

  if (topic === "orders/paid") {
    const lineItems = (payload.line_items ?? []).map((item) => ({
      product_id: item.product_id,
      variant_id: item.variant_id,
      title: item.title,
      quantity: item.quantity,
      price: item.price,
    }));

    await phpFetch(phpBase, phpSecret, "/conversion", {
      shopify_order_id:  payload.id,
      shopify_order_gid: `gid://shopify/Order/${payload.id}`,
      order_value_inr:   parseFloat(payload.total_price ?? "0"),
      merchant_domain:   shop,
      line_items:        lineItems,
    }).catch(console.error);
  }

  if (topic === "app/uninstalled") {
    // Mark merchant inactive via a custom endpoint we can add later,
    // or call findByDomain + update via the PHP API
    await phpFetch(phpBase, phpSecret, "/merchant/deactivate", {
      shopify_domain: shop,
    }).catch(() => {
      // Endpoint may not exist yet — log but don't fail the webhook
      console.warn("Could not deactivate merchant for shop:", shop);
    });
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
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
