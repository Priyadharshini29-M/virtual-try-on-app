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

import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
