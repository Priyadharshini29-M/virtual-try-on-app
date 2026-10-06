// Server-side: redirect lives in react-router (React Router v7 equivalent of @remix-run/node)
import { redirect } from "react-router";

// Client-side hooks and components (React Router v7 equivalent of @remix-run/react)
import {
  Form,
  useLoaderData,
  useNavigation,
  useActionData,
  useRouteError,
} from "react-router";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useCelebrate } from "../components/AppShell";
import { FsPage, FsCard, FsPill, FsIcon } from "../components/fs-ui";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL, NODE_ENV } from "../lib/env.server";
import { phpPlanToUi, uiPlanToPhp, PLAN_LABELS, PLAN_TRYONS } from "../lib/plans";

// ─── Billing constants ────────────────────────────────────────────────────────

const PLAN_KEY_MAP = {
  growth: "Brix-TryOn Growth",
  pro: "Brix-TryOn Pro",
};

// Numeric rank for upgrade vs downgrade label
const PLAN_RANK = { free: 0, growth: 1, pro: 2 };

// ─── Revalidation control ─────────────────────────────────────────────────────

// When the action returns a billingUrl the user is about to be redirected away
// from the page entirely. Revalidating the loader at that point is both wasted
// work and a source of auth errors (the revalidation GET can trigger a Shopify
// auth redirect that Shopify's admin interprets as "Application Error").
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }) {
  if (actionResult?.billingUrl) return false;
  return defaultShouldRevalidate;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  console.log("[loader] plans page start");

  let session;
  try {
    ({ session } = await authenticate.admin(request));
    console.log("[loader] authenticated shop:", session?.shop);
  } catch (authErr) {
    // Re-throw Shopify auth Responses (redirects, 401s) — do NOT swallow them
    if (authErr instanceof Response) throw authErr;
    console.error(
      "[loader] authentication error:",
      authErr?.message ?? authErr,
    );
    // Re-throw so the ErrorBoundary can display the message
    throw new Error(
      `Authentication failed: ${authErr?.message ?? "Unknown error"}`,
    );
  }

  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  const url = new URL(request.url);
  const billingDeclined = url.searchParams.get("billing_declined") === "1";
  const planUpgraded = url.searchParams.get("plan_upgraded") === "1";

  // ── Normal load ───────────────────────────────────────────────────────────
  let planRes;
  try {
    planRes = await api.checkPlanLimit();
  } catch (planErr) {
    console.error(
      "[loader] checkPlanLimit error:",
      planErr?.message ?? planErr,
    );
    planRes = { ok: false };
  }

  const planData = planRes.ok ? planRes.data : null;
  const rawPlan = planData?.plan ?? "basic";

  console.log("[loader] current plan:", rawPlan, "upgraded:", planUpgraded);

  return {
    currentPlan: phpPlanToUi(rawPlan),
    usedTryons: planData?.used ?? 0,
    limitTryons: planData?.limit ?? 10,
    billingDeclined,
    planUpgraded,
  };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }) {
  console.log("[action] plans action start");

  // ── Authenticate ──────────────────────────────────────────────────────────
  let admin, session, billing;
  try {
    ({ admin, session, billing } = await authenticate.admin(request));
    console.log("[action] authenticated shop:", session?.shop);
  } catch (authErr) {
    if (authErr instanceof Response) {
      // Only re-throw redirect Responses (3xx) so React Router can follow the
      // Shopify auth flow. Re-throwing 4xx/5xx error Responses causes Shopify's
      // admin to show "Application Error" instead of our route's ErrorBoundary.
      if (authErr.status >= 300 && authErr.status < 400) throw authErr;
      console.error(
        "[action] auth error response:",
        authErr.status,
        authErr.statusText,
      );
      return { error: "Session error. Please refresh the page and try again." };
    }
    console.error(
      "[action] authentication error:",
      authErr?.message ?? authErr,
    );
    return { error: `Authentication error: ${authErr?.message ?? "Unknown"}` };
  }

  // ── Read form data ────────────────────────────────────────────────────────
  let planName;
  try {
    const formData = await request.formData();
    planName = formData.get("plan");
    console.log("[action] selected plan:", planName);
  } catch (bodyErr) {
    console.error("[action] formData error:", bodyErr?.message ?? bodyErr);
    return { error: `Could not read form: ${bodyErr?.message ?? "Unknown"}` };
  }

  // ── Downgrade to free ─────────────────────────────────────────────────────
  if (planName === "free") {
    console.log("[action] downgrading to free plan");
    try {
      // SDK billing.check / billing.cancel are safe — they return data, never throw Responses
      const billingCheck = await billing.check({
        // Both names checked: merchants who subscribed before the Brix-TryOn
        // rename still have their subscription recorded under the old name.
        plans: ["Brix-TryOn Growth", "Brix-TryOn Pro", "FitSnap Growth", "FitSnap Pro"],
        isTest: NODE_ENV !== "production",
      });
      for (const sub of billingCheck.appSubscriptions ?? []) {
        console.log("[action] cancelling subscription:", sub.id);
        await billing.cancel({
          subscriptionId: sub.id,
          isTest: NODE_ENV !== "production",
          prorate: true,
        });
      }
    } catch (cancelErr) {
      if (
        cancelErr instanceof Response &&
        cancelErr.status >= 300 &&
        cancelErr.status < 400
      )
        throw cancelErr;
      console.error(
        "[action] subscription cancel error:",
        cancelErr?.message ?? cancelErr,
      );
      // Non-fatal — continue to update PHP backend
    }

    try {
      const freeApiKey = await ensureMerchant(session);
      await phpApiClient(freeApiKey, PHP_API_URL, session.shop).updatePlan(
        uiPlanToPhp("free"),
      );
      console.log("[action] PHP plan updated to free");
    } catch (phpErr) {
      console.error("[action] PHP update error:", phpErr?.message ?? phpErr);
    }

    return redirect("/app/plans");
  }

  // ── Upgrade / switch paid plan ────────────────────────────────────────────
  // We call the Shopify Billing API (appSubscriptionCreate) directly via admin.graphql()
  // instead of billing.request() because billing.request() throws a 401 Response for
  // XHR form submissions, which React Router intercepts as an action error before
  // App Bridge can redirect the user — causing "Application Error" in embedded context.
  const planKey = PLAN_KEY_MAP[planName];
  if (!planKey) {
    console.error("[action] invalid plan selected:", planName);
    return { error: "Invalid plan selected. Please try again." };
  }

  const { origin } = new URL(request.url);
  const returnUrl = `${origin}/billing/callback?plan=${planName}&shop=${session.shop}`;
  console.log(
    "[action] creating subscription for plan:",
    planKey,
    "returnUrl:",
  );

  try {
    const gqlRes = await admin.graphql(
      `#graphql
      mutation AppSubscriptionCreate(
        $name: String!
        $returnUrl: URL!
        $test: Boolean
        $trialDays: Int
        $lineItems: [AppSubscriptionLineItemInput!]!
      ) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          test: $test
          trialDays: $trialDays
          lineItems: $lineItems
        ) {
          appSubscription { id }
          confirmationUrl
          userErrors { field message }
        }
      }`,
      {
        variables: {
          name: planKey,
          returnUrl,
          test: NODE_ENV !== "production",
          trialDays: 3,
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: {
                    amount: planName === "growth" ? "19.00" : "49.00",
                    currencyCode: "USD",
                  },
                  interval: "EVERY_30_DAYS",
                },
              },
            },
          ],
        },
      },
    );

    const gqlData = await gqlRes.json();
    const confirmationUrl =
      gqlData?.data?.appSubscriptionCreate?.confirmationUrl;
    const userErrors = gqlData?.data?.appSubscriptionCreate?.userErrors ?? [];

    if (userErrors.length > 0) {
      console.error("[action] GraphQL userErrors:", JSON.stringify(userErrors));
      return {
        error: userErrors[0]?.message ?? "Could not create subscription.",
      };
    }

    if (!confirmationUrl) {
      console.error("[action] no confirmationUrl returned");
      return { error: "Could not create subscription. Please try again." };
    }

    console.log("[action] subscription created, returning billingUrl");
    // Return the URL as data — the component navigates via window.top.location.href
    // (Shopify grants allow-top-navigation to the embedded app iframe)
    return { billingUrl: confirmationUrl };
  } catch (billingErr) {
    console.error("[action] billing error:", billingErr?.message ?? billingErr);
    return {
      error: "Billing service error. Please try again or contact support.",
    };
  }
}

// ─── Static plan config ───────────────────────────────────────────────────────

const PLAN_CONFIG = [
  {
    key: "free",
    name: "Preview",
    badge: null,
    price: "Free",
    priceSub: "forever",
    extraRate: null,
    description: "Get started with AI virtual try-on at zero cost.",
    features: [
      "10 monthly AI try-ons included",
      "Mobile & desktop responsive widget",
      "Privacy consent screen",
      "Product page try-on support",
      "Standard AI processing",
      "Email support",
    ],
    buttonLabel: "Current Plan",
    buttonVariant: "outline",
    featured: false,
  },
  {
    key: "growth",
    name: "Growth",
    badge: { label: "MOST POPULAR", variant: "popular" },
    price: "$19",
    priceSub: "/ month",
    extraRate: "+$0.15 / extra try-on",
    description: "Scale your virtual try-on with powerful store tools.",
    features: [
      "100 monthly AI try-ons included",
      "Collection page mini try-on icons",
      "Variant image mapping system",
      "Product-level try-on enable/disable",
      "Advanced widget customization",
      "Typography & branding controls",
      "WhatsApp share support",
      "Analytics dashboard",
      "Customer email collection",
      "Add-to-cart tracking",
      "Conversion tracking",
      "Faster AI processing queue",
      "Standard support",
    ],
    buttonLabel: "Upgrade to Growth",
    buttonVariant: "green",
    featured: true,
  },
  {
    key: "pro",
    name: "Pro",
    badge: { label: "PREMIUM", variant: "premium" },
    price: "$49",
    priceSub: "/ month",
    extraRate: "+$0.08 / extra try-on",
    description: "Full power for high-volume stores and brands.",
    features: [
      "500 monthly AI try-ons included",
      "Advanced analytics dashboard",
      "Top-performing product insights",
      "Device-based analytics (mobile vs desktop)",
      "7-day trend reporting",
      "Multi-language widget support",
      "Premium widget customization",
      "Priority AI processing",
      "Faster try-on rendering",
      "Custom icon positioning",
      "Priority support",
      "Early access to new features",
      "Dedicated onboarding assistance",
    ],
    buttonLabel: "Upgrade to Pro",
    buttonVariant: "dark",
    featured: false,
  },
];

const FAQ_ITEMS = [
  {
    q: "Can I change my plan at any time?",
    a: "Yes. Upgrades take effect immediately with prorated billing. You can change your plan whenever you need.",
  },
  {
    q: "What happens when I exceed my monthly try-on limit?",
    a: "Additional try-ons are charged at your plan's per-try-on rate — $0.28 (Preview), $0.15 (Growth), or $0.08 (Pro). You are never blocked mid-session.",
  },
  {
    q: "Is there a free trial on paid plans?",
    a: "Yes — paid plans include a 3-day free trial so you can evaluate before being charged.",
  },
  {
    q: "Does the Preview plan require a credit card?",
    a: "No. The Preview plan is completely free with no payment method required.",
  },
];

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({ config, isCurrent, currentPlanKey, isSubmitting }) {
  const currentRank = PLAN_RANK[currentPlanKey] ?? 0;
  const thisRank = PLAN_RANK[config.key] ?? 0;
  const isDowngrade = thisRank < currentRank;
  const isUpgrade = thisRank > currentRank;

  let ctaLabel = config.buttonLabel;
  if (!isCurrent) {
    if (isDowngrade) ctaLabel = `Downgrade to ${config.name}`;
    else if (isUpgrade) ctaLabel = `Upgrade to ${config.name}`;
  }
  const variant = isDowngrade ? "ghost" : config.featured ? "primary" : "dark";
  const [shown, setShown] = useState(6);
  const moreCount = config.features.length - shown;

  return (
    <div className={`fs-card fs-plan${config.featured ? " is-featured" : ""}${isCurrent ? " is-current" : ""}`}>
      <div className="fs-plan-top">
        <span className="fs-plan-name">{config.name}</span>
        {isCurrent ? (
          <FsPill tone="success"><FsIcon name="check" size={12} strokeWidth={3} />Current plan</FsPill>
        ) : config.badge ? (
          <FsPill tone={config.featured ? "primary" : "dark"}>{config.badge.variant === "popular" ? "Most popular" : "Premium"}</FsPill>
        ) : null}
      </div>
      <div className="fs-plan-price">
        <span className="fs-tabular">{config.price}</span>
        {config.priceSub && <small>{config.priceSub}</small>}
      </div>
      <p className="fs-plan-desc">{config.description}</p>
      <div className="fs-plan-meta">
        <span><FsIcon name="bolt" size={14} />{PLAN_TRYONS[config.key]} try-ons / month</span>
        {config.extraRate && <span>{config.extraRate}</span>}
      </div>

      {isCurrent ? (
        <button type="button" className="fs-btn fs-btn--ghost" disabled style={{ width: "100%", height: 42 }}>Your current plan</button>
      ) : (
        <Form method="post" style={{ width: "100%" }}>
          <input type="hidden" name="plan" value={config.key} />
          <button type="submit" className={`fs-btn fs-btn--${variant}`} disabled={isSubmitting} style={{ width: "100%", height: 42 }}>
            {isSubmitting ? "Processing…" : ctaLabel}
          </button>
        </Form>
      )}
      {!isCurrent && isUpgrade && <p className="fs-plan-trial">3-day free trial · cancel anytime</p>}

      <ul className="fs-plan-features">
        {config.features.slice(0, shown).map((f) => (
          <li key={f}><span className="fs-plan-check"><FsIcon name="check" size={11} strokeWidth={3} /></span>{f}</li>
        ))}
      </ul>
      {moreCount > 0 && (
        <button type="button" className="fs-btn fs-btn--plain" style={{ alignSelf: "flex-start", height: 28 }} onClick={() => setShown(config.features.length)}>
          + {moreCount} more features
        </button>
      )}
    </div>
  );
}

PlanCard.propTypes = {
  config: PropTypes.object.isRequired,
  isCurrent: PropTypes.bool,
  currentPlanKey: PropTypes.string,
  isSubmitting: PropTypes.bool,
};

// ─── FAQ accordion ────────────────────────────────────────────────────────────

function FaqAccordion() {
  const [open, setOpen] = useState(null);

  return (
    <FsCard title="Frequently asked questions" style={{ gap: 0 }}>
      <div style={{ marginTop: 8 }}>
        {FAQ_ITEMS.map((item, i) => (
          <div key={item.q} className="fs-faq-item">
            <button type="button" className="fs-faq-q" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <span>{item.q}</span>
              <FsIcon name="chevronRight" size={16} style={{ transform: open === i ? "rotate(90deg)" : "none", transition: "transform .2s", color: "#9CA3AF" }} />
            </button>
            {open === i && <p className="fs-faq-a">{item.a}</p>}
          </div>
        ))}
      </div>
    </FsCard>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Plans() {
  const { currentPlan, billingDeclined, planUpgraded } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const celebrate = useCelebrate();
  const isSubmitting = navigation.state === "submitting";
  const currentLabel = PLAN_LABELS[currentPlan] ?? currentPlan;

  // Navigate top window to Shopify billing confirmation page.
  // Shopify grants allow-top-navigation to the embedded app iframe.
  useEffect(() => {
    if (!actionData?.billingUrl) return;
    try {
      window.top.location.href = actionData.billingUrl;
    } catch {
      // Cross-origin blocked — fallback link is shown below
    }
  }, [actionData?.billingUrl]);

  useEffect(() => {
    if (planUpgraded) celebrate({ title: `Welcome to ${currentLabel}`, body: "Your new features are active now." });
  }, [planUpgraded]); // eslint-disable-line react-hooks/exhaustive-deps

  // While redirecting to billing, show an interim screen with a manual fallback link
  if (actionData?.billingUrl) {
    return (
      <FsPage>
        <FsCard style={{ alignItems: "center", textAlign: "center", padding: "64px 24px" }}>
          <span className="fs-gate-icon"><FsIcon name="crown" size={24} /></span>
          <h2 className="fs-h2">Taking you to Shopify billing…</h2>
          <p className="fs-sub" style={{ marginTop: 0 }}>Approve the subscription there, and you&apos;ll come right back.</p>
          <a className="fs-btn fs-btn--primary" href={actionData.billingUrl} target="_top" rel="noreferrer">Continue to billing</a>
        </FsCard>
      </FsPage>
    );
  }

  return (
    <FsPage>
      {planUpgraded && (
        <div className="fs-banner fs-banner--success">
          <FsIcon name="check" size={18} strokeWidth={2.6} />
          <span>You&apos;re now on <strong>{currentLabel}</strong>. Your new features are active.</span>
        </div>
      )}
      {actionData?.error && (
        <div className="fs-banner fs-banner--critical" role="alert">
          <FsIcon name="info" size={18} />
          <span>{actionData.error}</span>
        </div>
      )}
      {billingDeclined && (
        <div className="fs-banner fs-banner--warning">
          <FsIcon name="info" size={18} />
          <span>The subscription wasn&apos;t approved. You can upgrade again whenever you&apos;re ready.</span>
        </div>
      )}

      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "8px 0 8px" }}>
        <FsPill tone="primary">Plans</FsPill>
        <h2 className="fs-h1">Pick the plan that fits your store</h2>
        <p className="fs-sub" style={{ margin: 0, maxWidth: 560 }}>Simple, transparent pricing that grows with you. You&apos;re on <strong style={{ color: "var(--fs-ink)" }}>{currentLabel}</strong>.</p>
      </div>

      <div className="fs-plan-grid">
        {PLAN_CONFIG.map((config) => (
          <PlanCard key={config.key} config={config} isCurrent={currentPlan === config.key} currentPlanKey={currentPlan} isSubmitting={isSubmitting} />
        ))}
      </div>

      <div style={{ maxWidth: 820, width: "100%", margin: "0 auto" }}>
        <FaqAccordion />
      </div>
    </FsPage>
  );
}

// ─── Error boundary ───────────────────────────────────────────────────────────

export function ErrorBoundary() {
  const error = useRouteError();

  const message =
    error?.message ??
    error?.data ??
    (typeof error === "string" ? error : null) ??
    "An unexpected error occurred.";

  const stack = typeof error?.stack === "string" ? error.stack : null;

  return (
    <FsPage>
      <FsCard title="We couldn't load your plans" subtitle="Refresh the page to try again. If it keeps happening, send the details below to support.">
        <pre className="fs-error-pre">{message}</pre>
        {stack && (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--fs-muted)" }}>Technical details</summary>
            <pre className="fs-error-pre" style={{ marginTop: 8 }}>{stack}</pre>
          </details>
        )}
      </FsCard>
    </FsPage>
  );
}
