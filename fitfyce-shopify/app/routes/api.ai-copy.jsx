/**
 * api.ai-copy.jsx — server-side proxy for the widget-settings AI copy picker.
 *
 *   POST { field, current?, max?, tone?, instructions?, language? }
 *     → PHP /widget/ai-copy → { suggestions: string[] }
 */

import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.field) {
    return Response.json({ error: "field is required" }, { status: 400 });
  }

  const res = await api.generateFieldCopy({
    field: body.field,
    current: body.current ?? "",
    max: body.max ?? 60,
    tone: body.tone ?? "friendly",
    instructions: body.instructions ?? "",
    language: body.language ?? "English",
    store: session.shop.replace(/\.myshopify\.com$/, ""),
  });

  return Response.json(res.ok ? res.data : { error: res.error ?? "AI generation failed" }, {
    status: res.ok ? 200 : 502,
  });
};
