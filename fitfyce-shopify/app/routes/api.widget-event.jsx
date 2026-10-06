/**
 * Public storefront endpoint — fire-and-forget engagement tracking for
 * moments that happen before a tryon_sessions row exists (widget opened,
 * camera permission granted). Called by tryon-widget.js via the Shopify app
 * proxy. No auth required — same trust model as api.widget-settings.jsx's
 * GET (shop domain only), and it never returns an error the widget would
 * need to react to.
 */
import { PHP_API_URL } from "../lib/env.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

export async function loader() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: true }, { headers: CORS }); // malformed ping — swallow
  }

  const phpBase = PHP_API_URL.replace(/\/$/, "");
  if (!phpBase || !body?.shop || !body?.event) {
    return Response.json({ ok: true }, { headers: CORS });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    await fetch(`${phpBase}/api/widget-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop: body.shop, event: body.event }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    clearTimeout(timer);
    // Fire-and-forget — always ok to the client either way.
  }

  return Response.json({ ok: true }, { headers: CORS });
}
