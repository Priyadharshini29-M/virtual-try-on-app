import { PHP_API_URL, R2_PUBLIC_URL } from "../lib/env.server";

/**
 * Server-side download proxy.
 *
 * The `download` attribute on an <a> is silently ignored by browsers for
 * cross-origin URLs — since the generated-image host (PHP_API_URL) is a
 * different origin than this app, linking straight to it just navigates to
 * the raw image instead of downloading it. Fetching it here (server-to-server,
 * no CORS involved) and re-serving it with Content-Disposition: attachment
 * forces a real download regardless of origin.
 *
 * Only proxies URLs on the configured backend hosts to avoid becoming an
 * open SSRF-style proxy for arbitrary URLs.
 */
export const loader = async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get("url");
  const filename = searchParams.get("filename") || "download";

  if (!imageUrl) {
    return new Response("Missing url", { status: 400 });
  }

  const allowedOrigins = [PHP_API_URL, R2_PUBLIC_URL]
    .filter(Boolean)
    .map((u) => { try { return new URL(u).origin; } catch { return null; } })
    .filter(Boolean);

  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  if (!allowedOrigins.includes(parsed.origin)) {
    return new Response("URL not allowed", { status: 403 });
  }

  let upstream;
  try {
    upstream = await fetch(imageUrl);
  } catch {
    return new Response("Failed to fetch image", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("Failed to fetch image", { status: 502 });
  }

  const contentType  = upstream.headers.get("content-type") || "application/octet-stream";
  const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, "_") || "download";

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Cache-Control": "no-store",
    },
  });
};
