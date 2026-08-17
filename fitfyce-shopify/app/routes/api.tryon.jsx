import { createHmac } from "node:crypto";
import https from "node:https";
import { SHOPIFY_API_SECRET, PHP_API_URL, PHP_API_SECRET } from "../lib/env.server";

// PHP backend has a missing intermediate CA that Node.js can't verify.
// We bypass SSL only for these server-to-server calls to the PHP backend.
const phpHttpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Server-side try-on proxy.
 * Authenticated via Shopify app proxy — never exposes PHP_API_URL to client.
 */
export const loader = () => new Response("Not Found", { status: 404 });

export const action = async ({ request }) => {
  try {
    return await handleTryOn(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api.tryon] unhandled exception:", msg, err?.stack);
    return Response.json({ error: `Server error: ${msg}` }, { status: 500 });
  }
};

async function handleTryOn(request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Shopify app proxy authenticates via query-string HMAC
  // We verify it here using the Shopify API secret
  const url = new URL(request.url);
  const shopifySecret = SHOPIFY_API_SECRET;
  if (!verifyShopifyProxySignature(url.searchParams, shopifySecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Accept both naming conventions: widget sends shopify_variant_id / shopify_product_id
  const clothing_image   = body.clothing_image;
  const avatar_image     = body.avatar_image;
  const clothing_prompt  = body.clothing_prompt   ?? null;
  const avatar_sex       = body.avatar_sex        ?? null;
  const seed             = body.seed              ?? -1;
  const variant_id       = body.shopify_variant_id ?? body.variant_id       ?? null;
  const product_id       = body.shopify_product_id ?? body.product_id       ?? null;
  const client_session   = body.session_id        ?? null;
  const device_type      = body.device_type       ?? null;

  if (!clothing_image || !avatar_image) {
    return Response.json(
      { error: "clothing_image and avatar_image are required" },
      { status: 400 }
    );
  }

  const phpBase   = (PHP_API_URL).replace(/\/$/, "");
  const phpSecret = PHP_API_SECRET;
  // Shopify app proxy always appends ?shop=mystore.myshopify.com
  const shopDomain = url.searchParams.get("shop") ?? null;

  console.log("[api.tryon] incoming request", {
    shop: shopDomain,
    variant_id,
    product_id,
    clothing_image: clothing_image?.substring(0, 80),
    has_avatar: Boolean(avatar_image),
  });

  // Guard: PHP backend not configured
  if (!phpBase) {
    console.error("[api.tryon] PHP_API_URL is not set");
    return Response.json({ error: "Try-on service is not configured. Please contact support." }, { status: 503 });
  }

  // ── Check plan limit (temporarily disabled) ──────────────────
  // const limitRes = await fetchPhp(phpBase, phpSecret, "GET", "/plan/limit", null, shopDomain, 10_000);
  // if (!limitRes.ok) {
  //   return Response.json({ error: limitRes.error || "Plan check failed" }, { status: 503 });
  // }
  // if (!limitRes.data?.is_unlimited && limitRes.data?.remaining <= 0) {
  //   return Response.json(
  //     {
  //       error: "Monthly try-on limit reached. Please upgrade your plan.",
  //       upgrade_url: "https://apps.shopify.com/tryfit",
  //     },
  //     { status: 429 }
  //   );
  // }

  // ── Session ──────────────────────────────────────────────────────
  // The widget already creates a session via /api/session/create before
  // calling here and sends its session_id in the body — reuse it instead of
  // making PHP create a second one. Saves a full round-trip off the critical
  // path before the (slow) try-on call even starts.
  const sessionId = client_session ?? null;

  // ── Call PHP try-on endpoint ──────────────────────────────────
  // Path must be /tryon — sending "" (root) returns 404 from the PHP router.
  // Timeout 90 s: RapidAPI / Fashn.ai inference can take 60–90 s.
  const tryOnPayload = {
    clothing_image,
    avatar_image,
    shopify_variant_id: variant_id  ?? null,
    shopify_product_id: product_id  ?? null,
    session_id:         sessionId,
    ...(clothing_prompt ? { clothing_prompt } : {}),
    ...(avatar_sex      ? { avatar_sex }      : {}),
    seed,
  };

  console.log("[api.tryon] calling PHP /tryon", { shop: shopDomain, session_id: sessionId, clothing_image: clothing_image?.substring(0, 80) });
  const tryOnRes = await fetchPhp(phpBase, phpSecret, "POST", "/tryon", tryOnPayload, shopDomain, 90_000);
  console.log("[api.tryon] /tryon response", { ok: tryOnRes.ok, has_result: Boolean(tryOnRes.data?.result_image), error: tryOnRes.error, httpStatus: tryOnRes.httpStatus });

  if (!tryOnRes.ok || !tryOnRes.data?.result_image) {
    let errMsg;
    if (tryOnRes.timedOut) {
      errMsg = "This is taking longer than expected. Please try again.";
    } else if (tryOnRes.error && tryOnRes.error.length < 300) {
      // Surface the actual PHP error so the user/admin can act on it
      errMsg = tryOnRes.error;
    } else {
      errMsg = "Try-on failed. Please try again.";
    }

    console.error("[api.tryon] try-on failed:", {
      timedOut:   tryOnRes.timedOut,
      error:      tryOnRes.error,
      httpStatus: tryOnRes.httpStatus,
      clothing_image: clothing_image?.substring(0, 80),
    });

    // Fire-and-forget — don't block the error response
    if (sessionId) {
      fetchPhp(phpBase, phpSecret, "POST", "/session/update", {
        session_id: sessionId,
        status: "failed",
        error_message: errMsg,
      }, shopDomain, 5_000).catch(() => {});
    }

    const status = tryOnRes.timedOut ? 504 : (tryOnRes.httpStatus || 500);
    return Response.json({ error: errMsg, session_id: sessionId }, { status });
  }

  const resultImage = tryOnRes.data.result_image;
  const resultSeed  = tryOnRes.data.seed;

  // Fire-and-forget — don't block the result response
  if (sessionId) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);

    fetchPhp(phpBase, phpSecret, "POST", "/session/update", {
      session_id: sessionId,
      status: "completed",
      result_image_url: resultImage,
      result_seed: resultSeed,
      result_expires_at: expiresAt,
    }, shopDomain, 5_000).catch(() => {});
  }

  return Response.json({ result_image: resultImage, seed: resultSeed, session_id: sessionId });
};

// ── Helpers ─────────────────────────────────────────────────────

function fetchPhp(base, apiKey, method, path, body, shopDomain, timeoutMs) {
  // Build URL with ?shop= on all requests
  let urlStr = path ? `${base}${path}` : base;
  if (shopDomain && !urlStr.includes("shop=")) {
    const sep = urlStr.includes("?") ? "&" : "?";
    urlStr = `${urlStr}${sep}shop=${encodeURIComponent(shopDomain)}`;
  }

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-Api-Key": apiKey,
  };
  if (shopDomain) headers["X-Shop-Domain"] = shopDomain;

  const bodyStr = body !== null && method !== "GET" ? JSON.stringify(body) : null;
  if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();

  const parsed = new URL(urlStr);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      req.destroy();
      resolve({ ok: false, timedOut: true, error: "Request timed out", data: null });
    }, timeoutMs);

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        headers,
        agent: phpHttpsAgent,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          clearTimeout(timer);
          let data = {};
          try { data = JSON.parse(raw); } catch { data = {}; }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            resolve({ ok: false, error: data.error || `HTTP ${res.statusCode}`, httpStatus: res.statusCode, data: null });
          } else {
            resolve({ ok: true, data });
          }
        });
      }
    );

    req.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, timedOut: false, error: err.message ?? "Network error", data: null });
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Verify Shopify app proxy HMAC signature.
 * https://shopify.dev/docs/apps/online-store/app-proxies#verify-proxy-requests
 */
function verifyShopifyProxySignature(searchParams, secret) {
  if (!secret) return true; // dev mode without secret

  const sig = searchParams.get("signature");
  if (!sig) return false;

  const pairs = [];
  for (const [k, v] of searchParams.entries()) {
    if (k !== "signature") {
      pairs.push(`${k}=${v}`);
    }
  }
  pairs.sort();
  const message = pairs.join("");

  try {
    const expected = createHmac("sha256", secret).update(message).digest("hex");
    // Constant-time comparison
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}
