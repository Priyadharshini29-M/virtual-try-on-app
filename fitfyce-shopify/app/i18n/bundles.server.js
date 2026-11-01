import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./config.js";

const LOCALES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../locales"
);

const cache = new Map(); // key: `${locale}:${ns}` -> parsed JSON

async function readNamespace(locale, ns) {
  const key = `${locale}:${ns}`;
  if (cache.has(key)) return cache.get(key);
  const file = path.join(LOCALES_DIR, locale, `${ns}.json`);
  try {
    const text = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(text);
    cache.set(key, parsed);
    return parsed;
  } catch {
    cache.set(key, {});
    return {};
  }
}

/**
 * Load the given namespaces for a locale, with the English fallback merged
 * underneath so a missing key in e.g. `hi/common.json` shows the English
 * string rather than the raw key.
 */
export async function loadBundles(locale, namespaces) {
  if (!SUPPORTED_LOCALES.includes(locale)) locale = DEFAULT_LOCALE;
  const out = {};
  for (const ns of namespaces) {
    const en = locale === DEFAULT_LOCALE ? {} : await readNamespace(DEFAULT_LOCALE, ns);
    const loc = await readNamespace(locale, ns);
    out[ns] = deepMerge(en, loc);
  }
  return out;
}

function deepMerge(base, override) {
  if (typeof base !== "object" || base === null) return override;
  if (typeof override !== "object" || override === null) return override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] =
      v && typeof v === "object" && !Array.isArray(v)
        ? deepMerge(base?.[k], v)
        : v;
  }
  return out;
}
