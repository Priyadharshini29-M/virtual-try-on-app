import { Outlet, useLoaderData, useRouteError, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import { SHOPIFY_API_KEY } from "../lib/env.server";

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
  } catch (err) {
    // Let Shopify auth Responses (redirects/401s) pass through normally
    if (err instanceof Response) throw err;
    // Network/token-exchange error — redirect to login so merchant can re-auth
    console.error("[app.jsx loader] auth error:", err?.message ?? err);
    const url = new URL(request.url);
    const params = new URLSearchParams();
    const shop = url.searchParams.get("shop");
    const host = url.searchParams.get("host");
    if (shop) params.set("shop", shop);
    if (host) params.set("host", host);
    throw redirect(`/auth/login${params.size ? `?${params.toString()}` : ""}`);
  }
  return { apiKey: SHOPIFY_API_KEY };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <s-app-nav>
          <s-link href="/app/products">Products</s-link>
          <s-link href="/app/studio">Studio</s-link>
          <s-link href="/app/settings">Widget Settings</s-link>
          <s-link href="/app/analytics">Analytics</s-link>
          <s-link href="/app/plans">Plans</s-link>
        </s-app-nav>
        <Outlet />
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses,
// so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
