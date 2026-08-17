/**
 * api.studio.jsx — server-side proxy for the Garment Studio module.
 *
 * Handles:
 *   POST ?_action=generate         → PHP /studio/generate (120 s timeout)
 *   POST ?_action=save-gallery     → Shopify Admin GraphQL + PHP /studio/save-gallery
 *   POST ?_action=set-model-image  → PHP /studio/set-model-image (merchant uploads model photo)
 *   POST ?_action=delete-model-image → PHP DELETE /studio/model-image
 *   GET  ?_action=models           → PHP /studio/models
 *   GET  ?_action=sessions         → PHP /studio/sessions
 */

import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  const url = new URL(request.url);
  const action = url.searchParams.get("_action") ?? "";

  if (action === "models") {
    const res = await api.studioGetModels();
    return Response.json(res.ok ? res.data : { error: res.error }, {
      status: res.ok ? 200 : 500,
    });
  }

  if (action === "sessions") {
    const limit  = url.searchParams.get("limit")  ?? "20";
    const offset = url.searchParams.get("offset") ?? "0";
    const res    = await api.studioListSessions({ limit, offset });
    return Response.json(res.ok ? res.data : { error: res.error }, {
      status: res.ok ? 200 : 500,
    });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api    = phpApiClient(apiKey, PHP_API_URL, session.shop);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const actionType = body._action ?? "";

  // ── Generate try-on image ──────────────────────────────────────────────────
  if (actionType === "generate") {
    const {
      front_image_url,
      back_image_url,
      detail_image_1_url,
      detail_image_2_url,
      detail_image_3_url,
      model_key,
      garment_type,
      clothing_prompt,
      product_id,
      shopify_variant_id,
    } = body;

    if (!front_image_url) {
      return Response.json({ error: "front_image_url is required" }, { status: 400 });
    }
    if (!model_key) {
      return Response.json({ error: "model_key is required" }, { status: 400 });
    }

    const res = await api.studioGenerate({
      front_image_url,
      back_image_url,
      detail_image_1_url: detail_image_1_url || null,
      detail_image_2_url: detail_image_2_url || null,
      detail_image_3_url: detail_image_3_url || null,
      model_key,
      garment_type:    garment_type    || null,
      clothing_prompt: clothing_prompt || null,
      product_id:      product_id      || null,
      shopify_variant_id: shopify_variant_id || null,
    });

    return Response.json(
      res.ok ? res.data : { error: res.error },
      { status: res.ok ? 200 : (res.status >= 400 ? res.status : 500) }
    );
  }

  // ── Save result to Shopify product gallery ─────────────────────────────────
  if (actionType === "save-gallery") {
    const { session_id, result_image_url, shopify_product_gid } = body;

    if (!session_id || !result_image_url) {
      return Response.json(
        { error: "session_id and result_image_url are required" },
        { status: 400 }
      );
    }

    let shopifyMediaId = null;

    // If a product GID is provided, attach the image via Admin GraphQL
    if (shopify_product_gid) {
      try {
        const mediaRes = await admin.graphql(
          `#graphql
          mutation studioCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              media {
                ... on MediaImage {
                  id
                  image { url }
                }
              }
              mediaUserErrors { field message }
            }
          }`,
          {
            variables: {
              productId: shopify_product_gid,
              media: [{
                mediaContentType: "IMAGE",
                originalSource:   result_image_url,
                alt: "Studio try-on result",
              }],
            },
          }
        );
        const data = await mediaRes.json();
        const mediaList = data?.data?.productCreateMedia?.media ?? [];
        shopifyMediaId  = mediaList[0]?.id ?? null;
      } catch (err) {
        console.error("[api.studio] productCreateMedia error:", err?.message ?? err);
      }
    }

    // Mark saved in PHP DB regardless of Shopify outcome
    await api.studioSaveGallery(session_id);

    return Response.json({ ok: true, shopify_media_id: shopifyMediaId });
  }

  // ── Upload/replace a model image (merchant-managed) ──────────────────────
  if (actionType === "set-model-image") {
    const { model_key, image_url } = body;
    if (!model_key || !image_url) {
      return Response.json(
        { error: "model_key and image_url are required" },
        { status: 400 }
      );
    }
    const res = await api.studioSetModelImage(model_key, image_url);
    return Response.json(
      res.ok ? res.data : { error: res.error },
      { status: res.ok ? 200 : 500 }
    );
  }

  // ── Remove a model image ───────────────────────────────────────────────────
  if (actionType === "delete-model-image") {
    const { model_key } = body;
    if (!model_key) {
      return Response.json({ error: "model_key is required" }, { status: 400 });
    }
    const res = await api.studioDeleteModelImage(model_key);
    return Response.json(
      res.ok ? res.data : { error: res.error },
      { status: res.ok ? 200 : 500 }
    );
  }

  return Response.json({ error: "Unknown _action" }, { status: 400 });
};
