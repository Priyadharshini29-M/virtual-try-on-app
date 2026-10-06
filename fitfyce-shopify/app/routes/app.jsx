import { Outlet, useLoaderData, useRouteError, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import { SHOPIFY_API_KEY, PHP_API_URL } from "../lib/env.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { phpPlanToUi } from "../lib/plans";
import { computeChecklist, isWidgetCustomized } from "../lib/gamification";
import AppShell from "../components/AppShell";

// Store-wide growth signals for the shell (level pill, credits pill) and the
// dashboard. Every call is allowSettled — a slow or failing backend must never
// block the app from rendering, it just shows the merchant as a new store.
const SHOP_ONBOARDING_QUERY = `#graphql
  query {
    shop {
      name
      email
      contactEmail
      metafield(namespace: "fitfyce", key: "onboarding") { value }
    }
  }
`;

async function loadOnboarding(admin) {
  try {
    const res = await admin.graphql(SHOP_ONBOARDING_QUERY);
    const shop = (await res.json())?.data?.shop;
    let saved = null;
    try { saved = shop?.metafield?.value ? JSON.parse(shop.metafield.value) : null; } catch { saved = null; }
    return {
      saved,
      shopName: shop?.name ?? "",
      shopEmail: shop?.contactEmail || shop?.email || "",
    };
  } catch (err) {
    console.error("[app.jsx] onboarding load failed:", err?.message ?? err);
    return { saved: null, shopName: "", shopEmail: "" };
  }
}

async function loadGrowth(session) {
  try {
    const apiKey = await ensureMerchant(session);
    const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
    const today = new Date().toISOString().split("T")[0];
    const [planRes, productsRes, settingsRes, assetsRes, analyticsRes] =
      await Promise.allSettled([
        api.checkPlanLimit(),
        api.getProducts(),
        api.getSettings(),
        api.studioV2ListAssets(),
        api.getAnalytics({ from: "2020-01-01", to: today }),
      ]);
    const ok = (r) => (r.status === "fulfilled" && r.value.ok ? r.value.data : null);

    const plan = ok(planRes);
    const products = ok(productsRes);
    const productList = Array.isArray(products) ? products : (products?.products ?? []);
    const enabledProducts = productList.filter((p) => Number(p.is_tryon_enabled) === 1).length;
    const settings = ok(settingsRes);
    const assets = ok(assetsRes)?.assets ?? [];
    const summary = ok(analyticsRes)?.summary ?? {};

    const checklist = computeChecklist({
      enabledProducts,
      totalProducts: productList.length,
      widgetCustomized: isWidgetCustomized(settings),
      assets: assets.length,
      tryons: summary.tryon_initiated ?? 0,
      orders: summary.order_count ?? 0,
    });

    const limit = Number(plan?.limit) || 0;
    const used = Number(plan?.used) || 0;

    return {
      checklist,
      credits: { used, limit, left: Math.max(0, limit - used) },
      planName: phpPlanToUi(plan?.plan ?? "basic"),
      counts: {
        enabledProducts,
        totalProducts: productList.length,
        assets: assets.length,
        tryons: summary.tryon_initiated ?? 0,
        orders: summary.order_count ?? 0,
      },
    };
  } catch (err) {
    console.error("[app.jsx] growth load failed:", err?.message ?? err);
    return null;
  }
}

export const loader = async ({ request }) => {
  let session;
  let admin;
  try {
    ({ session, admin } = await authenticate.admin(request));
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
  const onboarding = await loadOnboarding(admin);
  const growth = await loadGrowth(session);
  return { apiKey: SHOPIFY_API_KEY, growth, onboarding, shop: session.shop };
};

// The shell's growth numbers only need refreshing after something changed
// (an action ran) — not on every tab switch.
export const shouldRevalidate = ({ formMethod, defaultShouldRevalidate }) =>
  formMethod ? defaultShouldRevalidate : false;

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <s-app-nav>
          <s-link href="/app/products">Products</s-link>
          <s-link href="/app/studio">AI Studio</s-link>
          <s-link href="/app/settings">Widget Settings</s-link>
          <s-link href="/app/analytics">Analytics</s-link>
          <s-link href="/app/plans">Plans</s-link>
        </s-app-nav>
        <AppShell>
          <Outlet />
        </AppShell>
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
