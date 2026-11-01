export const SUPPORTED_LOCALES = ["en", "hi", "es", "fr", "de", "ar"];
export const DEFAULT_LOCALE = "en";
export const RTL_LOCALES = new Set(["ar"]);

export const NAMESPACES = [
  "common",
  "settings",
  "products",
  "studio",
  "analytics",
  "onboarding",
  "plans",
  "complete-look",
  "size-chart",
  "errors",
];

// Namespaces loaded synchronously by root.jsx. Others lazy-load per route.
export const CRITICAL_NAMESPACES = ["common", "errors"];

export const LOCALE_LABELS = {
  en: "English",
  hi: "हिन्दी",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ar: "العربية",
};

// Country-to-locale map used as the final fallback (step 5 of the detection
// chain). Only countries where we have good coverage are listed; unmapped
// countries fall through to DEFAULT_LOCALE.
export const COUNTRY_LOCALE = {
  IN: "hi",
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es",
  FR: "fr", BE: "fr", CH: "fr", LU: "fr", MC: "fr",
  DE: "de", AT: "de",
  SA: "ar", AE: "ar", EG: "ar", MA: "ar", DZ: "ar", TN: "ar",
  JO: "ar", KW: "ar", QA: "ar", BH: "ar", OM: "ar", IQ: "ar",
};

export function normalize(tag) {
  if (!tag) return DEFAULT_LOCALE;
  const base = String(tag).toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(base) ? base : DEFAULT_LOCALE;
}

export function isRtl(locale) {
  return RTL_LOCALES.has(locale);
}

export function dirFor(locale) {
  return isRtl(locale) ? "rtl" : "ltr";
}
