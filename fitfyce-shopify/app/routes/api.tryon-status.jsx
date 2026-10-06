import { createHmac } from "node:crypto";
import https from "node:https";
import { SHOPIFY_API_SECRET, PHP_API_URL, PHP_API_SECRET } from "../lib/env.server";

// PHP backend has a missing intermediate CA that Node.js can't verify.
// We bypass SSL only for these server-to-server calls to the PHP backend.
const phpHttpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Server-side poll proxy for the async try-on flow. Deliberately fast and
 * stateless (just forwards to PHP's GET /tryon-status) — this is what lets
 * the widget poll from the browser without any single request ever risking
 * Shopify App Proxy's own ~60s timeout, no matter how long the underlying
 * RunPod generation actually takes. See api.tryon.jsx for the submit half.
 */
export const action = () => new Response("Method Not Allowed", { status: 405 });

export const loader = async ({ request }) => {
  try {
    return await handleStatus(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api.tryon-status] unhandled exception:", msg, err?.stack);
    return Response.json({ error: `Server error: ${msg}` }, { status: 500 });
  }
};

async function handleStatus(request) {
  const url = new URL(request.url);

  // Shopify app proxy authenticates via query-string HMAC
  if (!verifyShopifyProxySignature(url.searchParams, SHOPIFY_API_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phpBase = PHP_API_URL.replace(/\/$/, "");
  if (!phpBase) {
    return Response.json({ error: "Try-on service is not configured. Please contact support." }, { status: 503 });
  }

  const jobId     = url.searchParams.get("job_id") || "";
  const shopDomain = url.searchParams.get("shop") || "";
  const sessionId = url.searchParams.get("session_id") || "";
  const seed      = url.searchParams.get("seed") || "";

  if (!jobId) {
    return Response.json({ error: "job_id is required" }, { status: 400 });
  }

  const qs = new URLSearchParams({ job_id: jobId, shop: shopDomain, seed });
  if (sessionId) qs.set("session_id", sessionId);

  const statusRes = await fetchPhp(phpBase, PHP_API_SECRET, `/tryon-status?${qs.toString()}`, shopDomain, 15_000);

  if (statusRes.timedOut) {
    // A single status check taking >15s is unusual (it's meant to be a quick,
    // single RunPod check, not a wait) — treat as still-processing so the
    // widget just polls again rather than surfacing an error.
    return Response.json({ status: "processing" });
  }

  if (!statusRes.ok) {
    return Response.json(
      { status: statusRes.data?.status || "failed", error: statusRes.error || "Something went wrong. Please try again." },
      { status: statusRes.httpStatus || 500 },
    );
  }

  return Response.json(statusRes.data);
}

function fetchPhp(base, apiKey, path, shopDomain, timeoutMs) {
  const urlStr = `${base}${path}`;
  const headers = { "Accept": "application/json", "X-Api-Key": apiKey };
  if (shopDomain) headers["X-Shop-Domain"] = shopDomain;

  const parsed = new URL(urlStr);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      req.destroy();
      resolve({ ok: false, timedOut: true, error: "Request timed out", data: null });
    }, timeoutMs);

    const req = https.request(
      { hostname: parsed.hostname, port: parsed.port || 443, path: parsed.pathname + parsed.search, method: "GET", headers, agent: phpHttpsAgent },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          clearTimeout(timer);
          let data = {};
          try { data = JSON.parse(raw); } catch { data = {}; }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            resolve({ ok: false, error: data.error || `HTTP ${res.statusCode}`, httpStatus: res.statusCode, data });
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
    req.end();
  });
}

function verifyShopifyProxySignature(searchParams, secret) {
  if (!secret) return true;

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
