import { Select } from "@shopify/polaris";
import { useFetcher } from "react-router";
import { useEffect } from "react";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "../i18n/config.js";
import { useT } from "../i18n/useT.js";

/**
 * Polaris Select for the merchant-facing language switcher.
 * Posts to /api/locale, which writes the cookie + the Prisma Session.locale
 * + mirrors to the PHP API. We force a full reload after the fetcher resolves
 * so SSR picks the new bundle up (hydrating in place would leave server-side
 * strings stale until the next navigation).
 */
export function LanguageSelector({ current }) {
  const fetcher = useFetcher();
  const { t } = useT("common");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      window.location.reload();
    }
  }, [fetcher.state, fetcher.data]);

  const onChange = (value) => {
    const formData = new FormData();
    formData.append("locale", value);
    fetcher.submit(formData, { method: "post", action: "/api/locale" });
  };

  return (
    <Select
      label={t("language.label")}
      labelHidden
      value={current}
      disabled={fetcher.state !== "idle"}
      options={SUPPORTED_LOCALES.map((l) => ({
        label: LOCALE_LABELS[l] ?? l,
        value: l,
      }))}
      onChange={onChange}
    />
  );
}
