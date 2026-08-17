import { createHmac } from "node:crypto";
import https from "node:https";
import { SHOPIFY_API_SECRET, PHP_API_URL, PHP_API_SECRET } from "../lib/env.server";

const phpHttpsAgent = new https.Agent({ rejectUnauthorized: false });

export const loader = () => new Response("Not Found", { status: 404 });

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(request.url);
  if (!verifyShopifyProxySignature(url.searchParams, SHOPIFY_API_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const phpBase = PHP_API_URL.replace(/\/$/, "");
  if (!phpBase) {
    return Response.json({ error: "Service not configured" }, { status: 503 });
  }

  // Shopify app proxy always appends ?shop=mystore.myshopify.com
  const shopDomain = url.searchParams.get("shop") ?? null;

  const sessionUrl = shopDomain
    ? `${phpBase}/session/create?shop=${encodeURIComponent(shopDomain)}`
    : `${phpBase}/session/create`;

  const reqBody = JSON.stringify({
    product_id: body.product_id ?? null,
    variant_id: body.variant_id ?? null,
    device_type: body.device_type ?? null,
  });

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-Api-Key": PHP_API_SECRET,
    "Content-Length": Buffer.byteLength(reqBody).toString(),
  };
  if (shopDomain) headers["X-Shop-Domain"] = shopDomain;

  const parsed = new URL(sessionUrl);

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => { req.destroy(); resolve({ status: 504, data: { error: "Request timed out" } }); }, 10_000);

    const req = https.request(
      { hostname: parsed.hostname, port: parsed.port || 443, path: parsed.pathname + parsed.search, method: "POST", headers, agent: phpHttpsAgent },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          clearTimeout(timer);
          let data = {};
          try { data = JSON.parse(raw); } catch { data = {}; }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on("error", (err) => { clearTimeout(timer); resolve({ status: 500, data: { error: err.message } }); });
    req.write(reqBody);
    req.end();
  });

  return Response.json(result.data, { status: result.status >= 200 && result.status < 300 ? 200 : result.status });
};

function verifyShopifyProxySignature(searchParams, secret) {
  if (!secret) return true;
  const sig = searchParams.get("signature");
  if (!sig) return false;

  const pairs = [];
  for (const [k, v] of searchParams.entries()) {
    if (k !== "signature") pairs.push(`${k}=${v}`);
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
