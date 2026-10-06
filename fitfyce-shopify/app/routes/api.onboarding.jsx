/**
 * api.onboarding.jsx — saves the first-run onboarding wizard's answers.
 *
 * Called after every wizard step. Writes to two places:
 *   1. Shop metafield fitfyce.onboarding (JSON) — the source of truth for
 *      whether to show the wizard and how far the merchant has gotten;
 *      always available, no backend migration needed.
 *   2. PHP /merchant/onboarding — central collection of every store's answers
 *      (best effort: a backend failure never blocks the merchant).
 */
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";

const ALLOWED_KEYS = [
  "step", "completed", "skipped", "goals", "heard_from", "store_type",
  "catalog_size", "product_scope", "products_enabled", "embed_confirmed", "block_confirmed",
  "contact_name", "contact_email", "contact_phone", "selected_plan",
];

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const data = Object.fromEntries(ALLOWED_KEYS.filter((k) => k in body).map((k) => [k, body[k]]));
  data.updated_at = new Date().toISOString();

  if (data.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.contact_email))) {
    return Response.json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });
  }

  // 1. Shop metafield
  let metafieldOk = false;
  try {
    const shopRes = await admin.graphql(`#graphql
      query { shop { id metafield(namespace: "fitfyce", key: "onboarding") { value } } }
    `);
    const shopJson = await shopRes.json();
    const shopId = shopJson?.data?.shop?.id;
    let previous = {};
    try { previous = JSON.parse(shopJson?.data?.shop?.metafield?.value ?? "{}") || {}; } catch { previous = {}; }
    const merged = { ...previous, ...data };
    if (previous.completed) merged.completed = true; // completion is sticky

    const setRes = await admin.graphql(
      `#graphql
      mutation SaveOnboarding($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { message } }
      }`,
      {
        variables: {
          metafields: [{ namespace: "fitfyce", key: "onboarding", type: "json", value: JSON.stringify(merged), ownerId: shopId }],
        },
      },
    );
    const setJson = await setRes.json();
    metafieldOk = (setJson?.data?.metafieldsSet?.userErrors ?? []).length === 0;
  } catch (err) {
    console.error("[api.onboarding] metafield save failed:", err?.message ?? err);
  }

  // 2. PHP backend (best effort — reported back so it can be checked)
  let backend = { ok: false, error: null };
  try {
    const apiKey = await ensureMerchant(session);
    const res = await phpApiClient(apiKey, PHP_API_URL, session.shop).saveOnboarding(data);
    backend = { ok: !!res.ok, status: res.status ?? null, error: res.ok ? null : (res.error ?? "PHP save failed") };
    if (!res.ok) console.error("[api.onboarding] PHP save failed:", res.status, res.error);
  } catch (err) {
    backend = { ok: false, error: err?.message ?? String(err) };
    console.error("[api.onboarding] PHP save error:", err?.message ?? err);
  }

  if (!metafieldOk) {
    return Response.json({ ok: false, error: "We couldn't save your progress. Please try again.", backend }, { status: 500 });
  }
  return Response.json({ ok: true, completed: !!data.completed, skipped: !!data.skipped, metafield: true, backend });
};
