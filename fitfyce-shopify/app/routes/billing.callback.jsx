import { redirect } from "react-router";
import phpApiClient from "../lib/php-api.server";
import { getMerchantApiKey } from "../lib/merchant.server";
import { PHP_API_URL, SHOPIFY_API_KEY } from "../lib/env.server";
import { unauthenticated } from "../shopify.server";
import { uiPlanToPhp } from "../lib/plans";

// Maps URL slug → Shopify subscription name (for verification)
const PLAN_KEY_MAP = {
  growth: "FitSnap Growth",
  pro:    "FitSnap Pro",
};

export async function loader({ request }) {
  const url      = new URL(request.url);
  const shop     = url.searchParams.get("shop");
  const planName = url.searchParams.get("plan");
  const chargeId = url.searchParams.get("charge_id");

  console.log("[billing-callback] shop:", shop, "plan:", planName, "chargeId:", chargeId);

  if (!shop) return redirect("/auth/login");

  const declineUrl = SHOPIFY_API_KEY
    ? `https://${shop}/admin/apps/${SHOPIFY_API_KEY}/app/plans?billing_declined=1`
    : `https://${shop}/admin`;

  const successUrl = SHOPIFY_API_KEY
    ? `https://${shop}/admin/apps/${SHOPIFY_API_KEY}/app/plans?plan_upgraded=1`
    : `https://${shop}/admin`;

  // No charge_id means the merchant declined billing on Shopify's confirmation page
  if (!chargeId || !planName || !PLAN_KEY_MAP[planName]) {
    return redirect(declineUrl);
  }

  // Verify the subscription is ACTIVE on Shopify before activating in our system.
  // Prevents fraudulent plan upgrades via crafted callback URLs.
  try {
    const { admin } = await unauthenticated.admin(shop);

    const gqlRes = await admin.graphql(
      `#graphql
      query VerifySubscription($id: ID!) {
        node(id: $id) {
          ... on AppSubscription {
            id
            status
            name
          }
        }
      }`,
      { variables: { id: `gid://shopify/AppSubscription/${chargeId}` } }
    );

    const gqlData      = await gqlRes.json();
    const subscription = gqlData?.data?.node;
    console.log("[billing-callback] Shopify subscription:", JSON.stringify(subscription));

    if (subscription?.status !== "ACTIVE") {
      console.warn("[billing-callback] subscription not ACTIVE, status:", subscription?.status);
      return redirect(declineUrl);
    }
  } catch (verifyErr) {
    console.error("[billing-callback] Shopify verification failed:", verifyErr?.message ?? verifyErr);
    return redirect(declineUrl);
  }

  // Subscription confirmed ACTIVE — translate UI plan slug to PHP plan name and update backend.
  // UI "growth" → PHP "pro", UI "pro" → PHP "premium"
  const phpPlan = uiPlanToPhp(planName);
  try {
    const apiKey = await getMerchantApiKey(shop);
    const result = await phpApiClient(apiKey, PHP_API_URL, shop).updatePlan(phpPlan);
    console.log("[billing-callback] PHP plan updated to:", phpPlan, "result:", JSON.stringify(result));
  } catch (phpErr) {
    console.error("[billing-callback] PHP plan update error:", phpErr?.message ?? phpErr);
  }

  return redirect(successUrl);
}

export default function BillingCallback() {
  return null;
}
