import { I18nContext } from "../i18n/useT.js";

export function I18nProvider({ locale, dir, bundles, children }) {
  return (
    <I18nContext.Provider value={{ locale, dir, bundles }}>
      {children}
    </I18nContext.Provider>
  );
}
