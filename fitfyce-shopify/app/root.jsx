import "@shopify/polaris/build/esm/styles.css";
import "./tailwind.css";
import "./design-tokens.css";
import "./vto-design.css";
// Studio pages' styles, moved out of in-JSX <style>{CSS}</style> blocks into
// static imports — a React-rendered <style> tag is subject to hydration
// timing and can intermittently fail to (re)attach if hydration ever falls
// back to client-only rendering; a root-level static import never can.
// (Must live outside app/routes/ — this app uses file-based routing, and any
// file placed there, including a .css one, is treated as a competing route
// module and collides with the real route of the same base name.)
import "./app.studio.create.css";
import "./app.studio._index.css";
// Brix-TryOn admin shell + UI kit — last so it wins over legacy styles.
import "./fitsnap-ui.css";
import "./fitsnap-onboarding.css";
import "./fitsnap-dashboard.css";
import "./fitsnap-models.css";
import "./styles/rtl.css";

import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";
import { I18nProvider } from "./components/I18nProvider.jsx";
import { resolveLocale } from "./i18n/resolve.server.js";
import { loadBundles } from "./i18n/bundles.server.js";
import { CRITICAL_NAMESPACES, dirFor } from "./i18n/config.js";
import { serializeLocaleCookie } from "./i18n/cookie.server.js";

export async function loader({ request }) {
  // Root loader runs before Shopify auth on some routes (login, auth callback),
  // so we resolve the locale with whatever's in the request alone. Downstream
  // loaders inside app.* can re-resolve with { admin, shopDomain } if they want
  // step 2/3 of the detection chain to run.
  const locale = await resolveLocale(request);
  const bundles = await loadBundles(locale, CRITICAL_NAMESPACES);
  const dir = dirFor(locale);
  const cookie = await serializeLocaleCookie(locale);

  return Response.json(
    { locale, dir, bundles },
    { headers: { "Set-Cookie": cookie } }
  );
}

export default function App() {
  const { locale, dir, bundles } = useLoaderData();
  return (
    <html lang={locale} dir={dir}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        {locale === "hi" && (
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600&display=swap"
          />
        )}
        {locale === "ar" && (
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600&display=swap"
          />
        )}
        <Meta />
        <Links />
      </head>
      <body>
        <I18nProvider locale={locale} dir={dir} bundles={bundles}>
          <Outlet />
        </I18nProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
