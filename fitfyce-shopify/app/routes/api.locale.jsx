/**
 * api.locale.jsx — merchant-facing language-switcher endpoint.
 *
 * POST /api/locale  { locale: "hi" }
 *   1. Normalises the locale against SUPPORTED_LOCALES
 *   2. Writes it to the Prisma Session row (so it survives sign-out)
 *   3. Mirrors to PHP /api/settings/locale (so API responses switch too)
 *   4. Sets the ff_locale cookie
 *
 * The <LanguageSelector> reloads the page after this returns so the root
 * loader re-renders with the new bundle.
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";
import { normalize, SUPPORTED_LOCALES } from "../i18n/config";
import { serializeLocaleCookie } from "../i18n/cookie.server";

export const loader = () => new Response("Not Found", { status: 404 });

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);

  const form = await request.formData();
  const raw = String(form.get("locale") ?? "");
  const locale = normalize(raw);
  if (!locale || !SUPPORTED_LOCALES.includes(locale)) {
    return Response.json({ ok: false, error: "Unsupported locale" }, { status: 400 });
  }

  // 1. Prisma Session — mirrors the merchant.locale column; keeps the
  // selection even after the ff_locale cookie expires.
  try {
    await prisma.session.updateMany({
      where: { shop: session.shop },
      data: { locale },
    });
  } catch (err) {
    console.error("[api.locale] prisma update failed:", err?.message ?? err);
  }

  // 2. PHP side — so API error payloads switch locale right away.
  try {
    const apiKey = await ensureMerchant(session);
    const client = phpApiClient(apiKey, PHP_API_URL, session.shop, locale);
    // Reuses the generic request helper exposed via the client's method surface.
    // Fall through on failure — the Remix UI already changed.
    if (typeof client.saveLocale === "function") {
      await client.saveLocale(locale);
    }
  } catch (err) {
    console.error("[api.locale] PHP mirror failed:", err?.message ?? err);
  }

  const cookie = await serializeLocaleCookie(locale);
  return Response.json({ ok: true, locale }, { headers: { "Set-Cookie": cookie } });
};
