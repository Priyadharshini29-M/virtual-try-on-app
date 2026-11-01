import { createContext, useContext, useMemo } from "react";
import { translate } from "./translate.js";
import { DEFAULT_LOCALE } from "./config.js";

export const I18nContext = createContext({
  locale: DEFAULT_LOCALE,
  dir: "ltr",
  bundles: {},
});

/**
 * useT("settings") returns { t, locale, dir }.
 * t("save_success") -> localised string
 * t("save_error", { reason: "foo" }) -> interpolated
 */
export function useT(namespace) {
  const ctx = useContext(I18nContext);
  return useMemo(
    () => ({
      t: (key, params) => translate(ctx.bundles, namespace, key, params),
      locale: ctx.locale,
      dir: ctx.dir,
    }),
    [ctx, namespace]
  );
}

export function useLocale() {
  return useContext(I18nContext);
}
