import { createHmac } from "node:crypto";

/**
 * Server-side try-on proxy.
 * Authenticated via Shopify app proxy — never exposes PHP_API_URL to client.
 */
export const loader = () => new Response("Not Found", { status: 404 });

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Shopify app proxy authenticates via query-string HMAC
  // We verify it here using the Shopify API secret
  const url = new URL(request.url);
  const shopifySecret = process.env.SHOPIFY_API_SECRET ?? "";
  if (!verifyShopifyProxySignature(url.searchParams, shopifySecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    clothing_image,
    avatar_image,
    clothing_prompt,
    avatar_sex,
    seed,
    product_id,
    variant_id,
    device_type,
  } = body;

  if (!clothing_image || !avatar_image) {
    return Response.json(
      { error: "clothing_image and avatar_image are required" },
      { status: 400 }
    );
  }

  const phpBase   = (process.env.PHP_API_URL ?? "").replace(/\/$/, "");
  const phpSecret = process.env.PHP_API_SECRET ?? "";

  // ── Check plan limit ──────────────────────────────────────────
  const limitRes = await fetchPhp(phpBase, phpSecret, "GET", "/plan/limit", null, 10_000);
  if (!limitRes.ok) {
    return Response.json({ error: limitRes.error ?? "Plan check failed" }, { status: 503 });
  }
  if (!limitRes.data?.is_unlimited && limitRes.data?.remaining <= 0) {
    return Response.json(
      {
        error: "Monthly try-on limit reached. Please upgrade your plan.",
        upgrade_url: "https://apps.shopify.com/tryfit",
      },
      { status: 429 }
    );
  }

  // ── Create session ────────────────────────────────────────────
  const sessRes = await fetchPhp(phpBase, phpSecret, "POST", "/session/create", {
    product_id,
    variant_id: variant_id ?? null,
    device_type: device_type ?? null,
  }, 10_000);

  const sessionId = sessRes.ok ? sessRes.data?.session_id : null;

  // ── Call PHP try-on endpoint (original api.php logic) ─────────
  const tryOnPayload = {
    clothing_image,
    avatar_image,
    ...(clothing_prompt ? { clothing_prompt } : {}),
    ...(avatar_sex      ? { avatar_sex }      : {}),
    seed: seed ?? -1,
  };

  const tryOnRes = await fetchPhp(phpBase, phpSecret, "POST", "", tryOnPayload, 35_000);

  if (!tryOnRes.ok || !tryOnRes.data?.result_image) {
    // Update session as failed
    if (sessionId) {
      await fetchPhp(phpBase, phpSecret, "POST", "/session/update", {
        session_id: sessionId,
        status: "failed",
        error_message: tryOnRes.error ?? "Try-on failed",
      }, 5_000).catch(() => {});
    }

    const status = tryOnRes.timedOut ? 504 : 500;
    return Response.json(
      {
        error: tryOnRes.timedOut
          ? "Try-on timed out. Please try again."
          : tryOnRes.error ?? "Try-on failed",
        session_id: sessionId,
      },
      { status }
    );
  }

  const resultImage = tryOnRes.data.result_image;
  const resultSeed  = tryOnRes.data.seed;

  // Update session as completed
  if (sessionId) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);

    await fetchPhp(phpBase, phpSecret, "POST", "/session/update", {
      session_id: sessionId,
      status: "completed",
      result_image_url: resultImage,
      result_seed: resultSeed,
      result_expires_at: expiresAt,
    }, 5_000).catch(() => {});
  }

  return Response.json({ result_image: resultImage, seed: resultSeed, session_id: sessionId });
};

// ── Helpers ─────────────────────────────────────────────────────

async function fetchPhp(base, apiKey, method, path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // path="" means the root api.php endpoint
  const url = path ? `${base}${path}` : base;

  try {
    const init = {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      signal: controller.signal,
    };

    if (body !== null && method !== "GET") {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}`, data: null };
    }
    return { ok: true, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      timedOut: isAbort,
      error: isAbort ? "Request timed out" : (err?.message ?? "Network error"),
      data: null,
    };
  } finally {
    clearTimeout(timer);
  }
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
