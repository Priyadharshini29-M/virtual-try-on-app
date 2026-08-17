import { PHP_API_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_URL } from "../lib/env.server";

/**
 * Server-side only upload proxy.
 * Tries Cloudflare R2 first; falls back to PHP temp upload.
 * PHP_API_URL is never exposed to the client.
 */
export const loader = () => new Response("Not Found", { status: 404 });

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const photo = formData.get("photo");
  if (!photo || typeof photo === "string") {
    return Response.json({ error: "No photo provided" }, { status: 400 });
  }

  // Validate: image/* only, max 5 MB
  if (!photo.type.startsWith("image/")) {
    return Response.json({ error: "Only image files are allowed" }, { status: 400 });
  }
  if (photo.size > 5 * 1024 * 1024) {
    return Response.json({ error: "File exceeds 5MB limit" }, { status: 400 });
  }

  const uuid = crypto.randomUUID();

  // ── R2 upload ──────────────────────────────────────────────────
  const r2AccountId = R2_ACCOUNT_ID;
  const r2AccessKey = R2_ACCESS_KEY;
  const r2SecretKey = R2_SECRET_KEY;
  const r2Bucket    = R2_BUCKET;
  const r2PublicUrl = R2_PUBLIC_URL;

  if (r2AccountId && r2AccessKey && r2SecretKey && r2PublicUrl) {
    try {
      const key = `uploads/${uuid}.jpg`;
      const arrayBuf = await photo.arrayBuffer();

      // Cloudflare R2 S3-compatible endpoint
      const r2Endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;

      // Build AWS v4 signature headers using Web Crypto
      const signedHeaders = await buildR2Headers(
        r2AccessKey,
        r2SecretKey,
        r2AccountId,
        r2Bucket,
        key,
        arrayBuf,
        photo.type
      );

      const r2Res = await fetch(`${r2Endpoint}/${r2Bucket}/${key}`, {
        method: "PUT",
        headers: signedHeaders,
        body: arrayBuf,
      });

      if (r2Res.ok) {
        return Response.json({ tempUrl: `${r2PublicUrl}/${key}` });
      }
    } catch (err) {
      console.error("R2 upload failed, falling back to PHP:", err);
    }
  }

  // ── PHP fallback ───────────────────────────────────────────────
  const phpApiUrl = PHP_API_URL;
  if (!phpApiUrl) {
    return Response.json({ error: "Upload service unavailable" }, { status: 500 });
  }

  try {
    // Convert File to ArrayBuffer first — avoids Node.js fetch serialization issues
    // with File objects obtained from an incoming request's formData()
    const arrayBuf = await photo.arrayBuffer();
    const fd = new FormData();
    fd.append(
      "photo",
      new Blob([arrayBuf], { type: photo.type || "image/jpeg" }),
      "photo.jpg"
    );

    const phpRes = await fetch(`${phpApiUrl.replace(/\/$/, "")}/upload-temp`, {
      method: "POST",
      body: fd,
    });

    const data = await phpRes.json().catch(() => ({}));
    if (!phpRes.ok || !data.tempUrl) {
      console.error("PHP upload-temp failed:", phpRes.status, data);
      return Response.json(
        { error: data.error || `Upload failed (HTTP ${phpRes.status})` },
        { status: 500 }
      );
    }
    return Response.json({ tempUrl: data.tempUrl });
  } catch (err) {
    console.error("PHP upload failed:", err);
    return Response.json({ error: `Upload failed: ${err.message || err}` }, { status: 500 });
  }
};

/**
 * Minimal AWS Signature v4 helper for Cloudflare R2 PUT.
 * Uses Web Crypto — no external dependencies.
 */
async function buildR2Headers(accessKey, secretKey, accountId, bucket, key, body, contentType) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const host = `${accountId}.r2.cloudflarestorage.com`;

  const payloadHash = await sha256Hex(body);

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaderNames = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${bucket}/${key}`,
    "",
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");

  const signingKey = await deriveSigningKey(secretKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaderNames}, Signature=${signature}`;

  return {
    "Content-Type": contentType,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: authorization,
  };
}

async function sha256Hex(data) {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(key, message) {
  const msgBuf = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const sig = await crypto.subtle.sign("HMAC", key, msgBuf);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function deriveSigningKey(secret, date, region, service) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode("AWS4" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );

  async function hmacKey(key, msg) {
    const buf = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
    return crypto.subtle.importKey("raw", buf, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }

  const dateKey    = await hmacKey(baseKey, date);
  const regionKey  = await hmacKey(dateKey, region);
  const serviceKey = await hmacKey(regionKey, service);
  return hmacKey(serviceKey, "aws4_request");
}
