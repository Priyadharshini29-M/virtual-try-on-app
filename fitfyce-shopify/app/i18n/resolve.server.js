import {
  COUNTRY_LOCALE,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  normalize,
} from "./config.js";
import { readLocaleCookie } from "./cookie.server.js";
import prisma from "../db.server.js";

/**
 * 6-step locale detection (plan §2):
 *   1. ff_locale cookie
 *   2. prisma Session.locale (merchant row)
 *   3. shop.primaryLocale (passed in by caller)
 *   4. Accept-Language header
 *   5. CF-IPCountry header -> country-to-locale map
 *   6. DEFAULT_LOCALE
 *
 * The caller passes `admin` + `shopDomain` when available (post-auth loaders);
 * early loaders may not have them yet, which is fine — the chain still works.
 */
export async function resolveLocale(request, { shopDomain, admin } = {}) {
  // 1. Cookie
  const cookieLocale = await readLocaleCookie(request);
  if (cookieLocale) {
    const n = normalize(cookieLocale);
    if (n) return n;
  }

  // 2. Prisma Session.locale (what Shopify stored at install)
  if (shopDomain) {
    try {
      const session = await prisma.session.findFirst({
        where: { shop: shopDomain },
        select: { locale: true },
      });
      if (session?.locale) {
        const n = normalize(session.locale);
        if (n) return n;
      }
    } catch {
      // Session table missing or locale column null — fall through
    }
  }

  // 3. Shopify shop locale (admin.graphql)
  if (admin) {
    try {
      const res = await admin.graphql(`{ shop { primaryLocale } }`);
      const payload = await res.json();
      const primary = payload?.data?.shop?.primaryLocale;
      if (primary) {
        const n = normalize(primary);
        if (n) return n;
      }
    } catch {
      // Admin API not reachable yet (e.g. mid-install) — fall through
    }
  }

  // 4. Accept-Language
  const acceptLang = request.headers.get("accept-language");
  if (acceptLang) {
    const picked = pickFromAcceptLanguage(acceptLang);
    if (picked) return picked;
  }

  // 5a. CF-IPCountry (fast path when Cloudflare is in front)
  const cfCountry = request.headers.get("cf-ipcountry");
  if (cfCountry) {
    const mapped = COUNTRY_LOCALE[cfCountry.toUpperCase()];
    if (mapped && SUPPORTED_LOCALES.includes(mapped)) return mapped;
  }

  // 5b. External IP lookup fallback (ip-api.com). Cached forever on the
  // Session row so this call fires at most once per shop. Failures and
  // unsupported countries fall through to the default silently.
  const cc = await lookupCountry(request, shopDomain);
  if (cc) {
    const mapped = COUNTRY_LOCALE[cc];
    if (mapped && SUPPORTED_LOCALES.includes(mapped)) return mapped;
  }

  // 6. Default
  return DEFAULT_LOCALE;
}

async function lookupCountry(request, shopDomain) {
  // Cached country for this shop?
  if (shopDomain) {
    try {
      const session = await prisma.session.findFirst({
        where: { shop: shopDomain },
        select: { localeDetectedCountry: true },
      });
      const cached = session?.localeDetectedCountry;
      if (typeof cached === "string" && cached.length === 2) {
        return cached.toUpperCase();
      }
    } catch {
      // Column may not exist in the Prisma schema yet — fall through.
    }
  }

  const ip = clientIpFromRequest(request);
  if (!ip) return null;

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2000);
    // ipwho.is: free, no auth, HTTPS, 10k/mo. ip-api.com's free tier is
    // HTTP-only (403 over HTTPS) and would trip mixed-content in the admin.
    const res = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code`,
      { signal: ctrl.signal, headers: { accept: "application/json" } },
    );
    clearTimeout(to);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    const cc = typeof data.country_code === "string" ? data.country_code.toUpperCase() : null;
    if (!cc || cc.length !== 2) return null;

    // Cache it on the Session so we never look this IP up again.
    if (shopDomain) {
      try {
        await prisma.session.updateMany({
          where: { shop: shopDomain },
          data: { localeDetectedCountry: cc },
        });
      } catch {
        // Column may not exist yet — ignore, locale resolution still works.
      }
    }
    return cc;
  } catch {
    return null;
  }
}

function clientIpFromRequest(request) {
  const headers = [
    "cf-connecting-ip",
    "x-forwarded-for",
    "x-real-ip",
    "fly-client-ip",
  ];
  for (const h of headers) {
    const v = request.headers.get(h);
    if (!v) continue;
    const first = v.split(",")[0].trim();
    if (first) return first;
  }
  return null;
}

/** Lightweight q-weighted parser, so we avoid pulling in accept-language-parser. */
function pickFromAcceptLanguage(header) {
  const parts = header.split(",");
  const ranked = [];
  for (const part of parts) {
    const [rawTag, ...paramSegs] = part.split(";").map((s) => s.trim());
    if (!rawTag || rawTag === "*") continue;
    let q = 1.0;
    for (const seg of paramSegs) {
      if (seg.startsWith("q=")) {
        const n = parseFloat(seg.slice(2));
        if (!Number.isNaN(n)) q = n;
      }
    }
    ranked.push({ tag: rawTag, q });
  }
  ranked.sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return null;
}
