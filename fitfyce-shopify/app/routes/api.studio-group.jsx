/**
 * api.studio-group.jsx — server proxy for the Duo & Group workflow.
 *
 * The try-on engine dresses one person per image, so each person is generated
 * as a normal single try-on first, then PHP combines the finished people into
 * one photo:
 *
 *   POST { _action: "generate", ...wizard fields } → PHP /studio/generate      (one person)
 *   POST { _action: "status", session_id }          → PHP /studio/generate-status
 *   POST { _action: "compose", member_session_ids, background, background_image_url, arrangement, size }
 *                                                   → PHP /studio/group/compose (returns a session_id to poll)
 *   POST { _action: "split", image_url, splits }     → PHP /studio/group/split  (one photo → one image per person)
 *   POST { _action: "stitch", image_url, splits, member_session_ids }
 *                                                   → PHP /studio/group/stitch (dressed people back into the photo)
 *
 * A resource route (not the studio page's action) so the frequent polling
 * doesn't re-run the studio page's loaders.
 */

import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";
import { buildGeneratePayload } from "../lib/studio-generate.server";

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

  if (body._action === "generate") {
    const payload = buildGeneratePayload(body);
    if (!payload.front_image_url) {
      return Response.json({ error: "Each person needs a product image." }, { status: 400 });
    }
    const res = await api.studioGenerate(payload);
    return Response.json(res.ok ? res.data : { error: res.error, session_id: res.data?.session_id }, { status: res.ok ? 200 : 500 });
  }

  if (body._action === "status") {
    const res = await api.studioGenerateStatus(body.session_id);
    return Response.json(res.ok ? res.data : { error: res.error }, { status: res.ok ? 200 : 500 });
  }

  if (body._action === "compose") {
    const ids = Array.isArray(body.member_session_ids) ? body.member_session_ids.filter(Boolean) : [];
    if (ids.length < 2) {
      return Response.json({ error: "At least two people are needed." }, { status: 400 });
    }
    const res = await api.studioGroupCompose({
      member_session_ids: ids,
      background: body.background || null,
      background_image_url: body.background === "custom" ? body.background_image_url || null : null,
      arrangement: body.arrangement || "side_by_side",
      size: body.size || "landscape",
    });
    return Response.json(res.ok ? res.data : { error: res.error }, { status: res.ok ? 200 : 500 });
  }

  if (body._action === "split") {
    const res = await api.studioGroupSplit({ image_url: body.image_url, splits: body.splits });
    return Response.json(res.ok ? res.data : { error: res.error }, { status: res.ok ? 200 : 500 });
  }

  if (body._action === "stitch") {
    const res = await api.studioGroupStitch({
      image_url: body.image_url,
      splits: body.splits,
      member_session_ids: body.member_session_ids,
    });
    return Response.json(res.ok ? res.data : { error: res.error }, { status: res.ok ? 200 : 500 });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
};
