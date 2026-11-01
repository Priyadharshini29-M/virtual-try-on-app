/**
 * Tiny translator — no runtime deps. Mirrors the i18next `t(key, params)` API
 * closely enough that the plan's §7 maintenance workflow (DeepL fills locale
 * JSONs, `t("ns.key", { name })` reads them) still applies if you later swap
 * this layer for i18next itself.
 *
 * Bundles are a `{ namespace: { ...nestedKeys } }` map produced by
 * bundles.server.js and passed through the root loader.
 */
export function translate(bundles, namespace, key, params = {}) {
  const bundle = bundles?.[namespace];
  const raw = lookup(bundle, key);
  if (typeof raw !== "string") return `${namespace}.${key}`;
  return interpolate(raw, params);
}

function lookup(obj, dottedKey) {
  if (!obj) return undefined;
  const parts = dottedKey.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] == null ? `{${name}}` : String(params[name])
  );
}
