import { PHP_API_URL, PHP_API_SECRET } from "../lib/env.server";

/**
 * Server-side action tracking proxy.
 * PHP_API_URL is never exposed to the client.
 */
export const loader = () => new Response("Not Found", { status: 404 });

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body;
  try {
    const text = await request.text();
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { session_id, action } = body;

  if (!session_id || !action) {
    return Response.json({ error: "session_id and action are required" }, { status: 400 });
  }

  const phpBase   = (PHP_API_URL).replace(/\/$/, "");
  const phpSecret = PHP_API_SECRET;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    const res = await fetch(`${phpBase}/session/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": phpSecret,
      },
      body: JSON.stringify({ session_id, action }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      return Response.json({ ok: false }, { status: res.status });
    }

    return Response.json({ ok: true });
  } catch {
    clearTimeout(timer);
    // Fire-and-forget tracking — always return ok to client
    return Response.json({ ok: true });
  }
};
