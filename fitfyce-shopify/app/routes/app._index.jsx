import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Link, useLoaderData, useRouteLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL, SHOPIFY_API_KEY } from "../lib/env.server";
import { PLAN_LABELS } from "../lib/plans";
import { useCelebrate } from "../components/AppShell";
import OnboardingWizard from "../components/OnboardingWizard";
import {
  FsPage, FsCard, FsButton, FsPill, FsProgress, FsSparkline, FsEmpty, FsIcon,
} from "../components/fs-ui";

// ─── Server ──────────────────────────────────────────────────────────────────

const SHOP_QUERY = `#graphql
  query {
    shop {
      name
      currencyCode
      metafield(namespace: "fitfyce", key: "app_enabled") { value }
    }
  }
`;

const isoDay = (d) => d.toISOString().split("T")[0];

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 6);

  const [settingsRes, shopRes, weekRes] = await Promise.allSettled([
    api.getSettings(),
    admin.graphql(SHOP_QUERY),
    api.getAnalytics({ from: isoDay(weekAgo), to: isoDay(now) }),
  ]);

  const settings = settingsRes.status === "fulfilled" && settingsRes.value.ok ? settingsRes.value.data : null;

  let appEnabled = true;
  let shopName = null;
  let currencyCode = "USD";
  if (shopRes.status === "fulfilled") {
    const json = await shopRes.value.json().catch(() => null);
    const shop = json?.data?.shop;
    if (shop?.metafield?.value !== undefined && shop?.metafield?.value !== null) appEnabled = shop.metafield.value !== "false";
    shopName = shop?.name ?? null;
    currencyCode = shop?.currencyCode || "USD";
  }

  const week = weekRes.status === "fulfilled" && weekRes.value.ok ? weekRes.value.data : null;

  return {
    settings,
    appEnabled,
    shopName,
    currencyCode,
    week: { summary: week?.summary ?? {}, charts: week?.charts ?? {} },
    shop: session.shop,
    apiKey: SHOPIFY_API_KEY,
  };
}

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const body = await request.json();
  const res = await api.saveSettings(body);

  // Sync with Shopify Metafield
  try {
    const shopRes = await admin.graphql(`{ shop { id } }`);
    const shopData = await shopRes.json();
    const shopId = shopData.data?.shop?.id;

    if (shopId) {
      await admin.graphql(
        `#graphql
        mutation CreateMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id }
            userErrors { message }
          }
        }`,
        {
          variables: {
            metafields: [
              {
                namespace: "fitfyce",
                key: "app_enabled",
                type: "boolean",
                value: body.app_enabled ? "true" : "false",
                ownerId: shopId,
              },
            ],
          },
        },
      );
    }
  } catch (err) {
    console.error("Failed to sync metafield:", err);
  }

  return { ok: res.ok };
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Checklist({ checklist }) {
  const items = checklist?.checklist ?? [];
  const left = items.length - (checklist?.checklistDone ?? 0);
  return (
    <FsCard
      className="fs-span-8"
      title="Setup checklist"
      subtitle={left === 0 ? "All done — your try-on experience is fully set up" : `${checklist.checklistDone} of ${items.length} complete · ${left} step${left === 1 ? "" : "s"} left`}
      action={<span className="fs-tabular" style={{ fontSize: 17, fontWeight: 700 }}>{checklist?.checklistPct ?? 0}%</span>}
    >
      <FsProgress value={checklist?.checklistPct ?? 0} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((c) => (
          <div key={c.key} className={`fs-check-row ${c.done ? "is-done" : "is-todo"}`}>
            <span className="fs-check-mark">{c.done && <FsIcon name="check" size={15} strokeWidth={3} />}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fs-check-title">{c.title}</div>
              <div className="fs-check-desc">{c.done ? c.doneText : c.todoText}</div>
            </div>
            <div className="fs-check-end">
              {c.done ? (
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fs-success-ink)" }}>Done</span>
              ) : c.to ? (
                <FsButton to={c.to} size="sm">{c.cta}</FsButton>
              ) : (
                <span style={{ fontSize: 12, color: "var(--fs-muted)" }}>Waiting</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </FsCard>
  );
}

Checklist.propTypes = { checklist: PropTypes.object };

function CreditsGauge({ credits, planName }) {
  const limit = credits?.limit ?? 0;
  const left = credits?.left ?? 0;
  const pct = limit ? left / limit : 0;
  const arc = Math.PI * 96;
  return (
    <FsCard className="fs-span-4" title="Try-on credits" action={<FsPill>{`${PLAN_LABELS[planName] ?? "Preview"} plan`}</FsPill>}>
      <div className="fs-gauge">
        <svg width="240" height="136" viewBox="0 0 240 136" aria-hidden="true">
          <path d="M24 124 A96 96 0 0 1 216 124" fill="none" stroke="var(--fs-primary-soft)" strokeWidth="18" strokeLinecap="round" />
          <path d="M24 124 A96 96 0 0 1 216 124" fill="none" stroke={pct < 0.15 ? "var(--fs-warning)" : "var(--fs-primary)"} strokeWidth="18" strokeLinecap="round" strokeDasharray={`${pct * arc} ${arc}`} />
        </svg>
        <div className="fs-gauge-center">
          <span className="fs-tabular" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{left.toLocaleString()}</span>
          <span style={{ fontSize: 11, color: "var(--fs-muted)", marginTop: 4 }}>of {limit.toLocaleString()} left this month</span>
        </div>
      </div>
      <div className="fs-kv">
        <div><span>Used this month</span><span className="fs-tabular">{(credits?.used ?? 0).toLocaleString()} try-ons</span></div>
        <div><span>Status</span><span>{pct < 0.15 ? "Running low" : "Healthy"}</span></div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
        <FsButton to="/app/plans" variant="ghost" style={{ flex: 1 }}>{pct < 0.15 ? "Upgrade" : "View plans"}</FsButton>
        <FsButton to="/app/studio/create" style={{ flex: 1 }}>Create asset</FsButton>
      </div>
    </FsCard>
  );
}

CreditsGauge.propTypes = { credits: PropTypes.object, planName: PropTypes.string };

function Kpis({ week, currencyCode }) {
  const s = week?.summary ?? {};
  const c = week?.charts ?? {};
  const tryons = Number(s.tryon_initiated) || 0;
  const carts = Number(s.add_to_cart_count) || 0;
  const orders = Number(s.order_count) || 0;
  const revenue = Number(s.revenue_inr) || 0;

  if (tryons === 0) {
    return (
      <FsCard>
        <FsEmpty icon="shirt" text="No try-ons this week yet — open a product in your store and try it on to see it live." cta="Enable products" to="/app/products" />
      </FsCard>
    );
  }

  const money = (v) => v.toLocaleString(undefined, { style: "currency", currency: currencyCode, maximumFractionDigits: 2 });
  const cards = [
    { label: "Try-ons", value: tryons.toLocaleString(), delta: s.tryon_trend, note: "Last 7 days", data: c.tryons },
    { label: "Cart rate", value: `${((carts / tryons) * 100).toFixed(1)}%`, delta: s.cart_rate_trend, note: `${carts.toLocaleString()} added to cart`, data: c.cart_rate },
    { label: "Purchase rate", value: `${((orders / tryons) * 100).toFixed(1)}%`, delta: s.purch_rate_trend, note: `${orders.toLocaleString()} orders after try-on`, data: c.purch_rate },
    { label: "Revenue", value: money(revenue), delta: s.revenue_trend, note: "Attributed to try-on", data: c.revenue },
  ];
  return (
    <div className="fs-grid-4">
      {cards.map((k) => {
        const down = typeof k.delta === "string" && k.delta.trim().startsWith("-");
        return (
          <FsCard key={k.label} className="fs-kpi">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="fs-kpi-label">{k.label}</span>
              {k.delta && <FsPill tone={down ? "warning" : "success"}>{k.delta}</FsPill>}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div className="fs-kpi-value">{k.value}</div>
                <div className="fs-kpi-note">{k.note}</div>
              </div>
              <FsSparkline data={k.data} />
            </div>
          </FsCard>
        );
      })}
    </div>
  );
}

Kpis.propTypes = { week: PropTypes.object, currencyCode: PropTypes.string };

const TUTORIAL_YOUTUBE_ID = "fMRsrR3o4Zk";

const HOW_TO_STEPS = [
  { icon: "box", title: "1. Enable products", desc: "Turn on try-on for the products you want shoppers to try." },
  { icon: "sliders", title: "2. Customize your button", desc: "Match colors and text to your brand in Widget Settings." },
  { icon: "sparkle", title: "3. Create AI photos", desc: "Generate on-model images in AI Studio." },
  { icon: "users", title: "4. Track performance", desc: "See try-ons, add-to-carts and orders in Analytics." },
];

function HowToUseSlider() {
  const trackRef = useRef(null);
  const [active, setActive] = useState(0);

  const goTo = (i) => {
    const idx = Math.max(0, Math.min(HOW_TO_STEPS.length - 1, i));
    setActive(idx);
    const card = trackRef.current?.children?.[idx];
    card?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  return (
    <FsCard>
      <div className="fs-card-head">
        <div>
          <h3 className="fs-h3">How to use Brix-TryOn</h3>
          <p className="fs-card-sub">Four quick steps to get try-on live.</p>
        </div>
        <div className="fs-slider-nav">
          <button type="button" className="fs-slider-btn" aria-label="Previous step" disabled={active === 0} onClick={() => goTo(active - 1)}>
            <FsIcon name="chevronRight" size={16} style={{ transform: "rotate(180deg)" }} />
          </button>
          <button type="button" className="fs-slider-btn" aria-label="Next step" disabled={active === HOW_TO_STEPS.length - 1} onClick={() => goTo(active + 1)}>
            <FsIcon name="chevronRight" size={16} />
          </button>
        </div>
      </div>
      <div className="fs-slider">
        <div className="fs-slider-track" ref={trackRef}>
          {HOW_TO_STEPS.map((s) => (
            <div key={s.title} className="fs-card fs-action-tile" style={{ flexDirection: "column", alignItems: "flex-start", textAlign: "left" }}>
              <span className="fs-tile-icon"><FsIcon name={s.icon} size={18} /></span>
              <span className="fs-tile-title">{s.title}</span>
              <span className="fs-tile-sub">{s.desc}</span>
            </div>
          ))}
        </div>
        <div className="fs-slider-dots">
          {HOW_TO_STEPS.map((s, i) => (
            <button key={s.title} type="button" className={i === active ? "is-on" : ""} aria-label={`Go to step ${i + 1}`} onClick={() => goTo(i)} />
          ))}
        </div>
      </div>
    </FsCard>
  );
}

function TutorialModal({ onClose }) {
  return (
    <div className="fs-modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fs-modal" role="dialog" aria-modal="true" aria-label="Quick walkthrough video" style={{ width: 640 }}>
        <div className="fs-modal-head">
          <span>Quick walkthrough (1 min)</span>
          <button type="button" className="fs-icon-btn" aria-label="Close" onClick={onClose}><FsIcon name="x" size={16} /></button>
        </div>
        <div className="fs-video">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${TUTORIAL_YOUTUBE_ID}?rel=0&modestbranding=1&autoplay=1`}
            title="Brix-TryOn — quick walkthrough"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}

TutorialModal.propTypes = { onClose: PropTypes.func.isRequired };

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { settings, appEnabled: initialEnabled, shopName, currencyCode, week, shop } = useLoaderData();
  const appData = useRouteLoaderData("routes/app");
  const growth = appData?.growth ?? null;
  const onboarding = appData?.onboarding ?? null;
  const [videoOpen, setVideoOpen] = useState(false);
  const obSaved = onboarding?.saved ?? null;
  const [obOpen, setObOpen] = useState(() => !obSaved?.completed && !obSaved?.skipped);
  const checklist = growth?.checklist;
  const submit = useSubmit();
  const navigation = useNavigation();
  const actionData = useActionData();
  const celebrate = useCelebrate();
  const [appEnabled, setAppEnabled] = useState(initialEnabled ?? true);

  useEffect(() => { setAppEnabled(initialEnabled ?? true); }, [initialEnabled]);
  useEffect(() => {
    if (actionData?.ok) celebrate({ title: appEnabled ? "Try-on is live" : "Try-on paused", body: appEnabled ? "Shoppers can try on your products again." : "Your settings are kept for when you switch back on." });
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleApp = () => {
    const next = !appEnabled;
    setAppEnabled(next);
    submit({ ...settings, app_enabled: next }, { method: "post", encType: "application/json" });
  };

  const tryons = Number(week?.summary?.tryon_initiated) || 0;
  const carts = Number(week?.summary?.add_to_cart_count) || 0;
  const nextStep = checklist?.checklist?.find((c) => !c.done && c.to);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const counts = growth?.counts ?? {};

  return (
    <FsPage>
      {obOpen && appData?.apiKey && (
        <OnboardingWizard shop={shop} apiKey={appData.apiKey} onboarding={onboarding} currentPlan={growth?.planName} onClose={() => setObOpen(false)} />
      )}

      {!obOpen && !obSaved?.completed && (
        <div className="fs-card fs-card--gold fs-resume">
          <span className="fs-streak-icon"><FsIcon name="sparkle" size={20} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Finish setting up — {Math.min((Number(obSaved?.step) || 0) + 1, 7)} of 7</div>
            <div style={{ fontSize: 13, color: "var(--fs-gold-text)", marginTop: 2 }}>A few more steps and try-on will be live for shoppers.</div>
          </div>
          <FsButton variant="dark" size="sm" onClick={() => setObOpen(true)}>Resume setup</FsButton>
        </div>
      )}

      {/* Welcome */}
      <section className="fs-card fs-welcome">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <h2 className="fs-h1">Welcome back{shopName ? `, ${shopName}` : ""}</h2>
            <span style={{ fontSize: 13, color: "var(--fs-muted)" }}>{today}</span>
          </div>
          <p>
            {tryons > 0
              ? `${tryons.toLocaleString()} try-ons this week, ${carts.toLocaleString()} added to cart.`
              : (counts.tryons ?? 0) > 0
                ? "No try-ons yet this week."
                : "Let's get your first shoppers trying on your products."}
            {nextStep ? ` Next step: ${nextStep.title.toLowerCase()}.` : ""}
          </p>
          <div className="fs-welcome-actions">
            {nextStep ? <FsButton to={nextStep.to} size="sm">{nextStep.title}</FsButton> : <FsButton to="/app/studio/create" icon="sparkle" size="sm">Create AI asset</FsButton>}
            <FsButton to="/app/analytics" variant="ghost" size="sm">View analytics</FsButton>
          </div>
          <div className="fs-storefront">
            <span className={`fs-status-dot${appEnabled ? " is-on" : ""}`} />
            <div className="fs-storefront-text">
              <strong>{appEnabled ? "Try-on is live" : "Try-on is paused"}</strong>
              <span>
                {appEnabled ? "Shoppers see the button on enabled products." : "Shoppers won't see the try-on button."}{" "}
                <a href={`https://${shop}/admin/themes/current/editor?context=apps`} target="_blank" rel="noopener noreferrer">Theme editor</a>
              </span>
            </div>
            <div className="fs-onoff" role="group" aria-label="Try-on on your storefront">
              <button type="button" className={`is-enable${appEnabled ? " is-on" : ""}`} aria-pressed={appEnabled} disabled={appEnabled || navigation.state === "submitting"} onClick={toggleApp}>
                <FsIcon name="check" size={14} strokeWidth={2.6} />Enable
              </button>
              <button type="button" className={`is-disable${!appEnabled ? " is-on" : ""}`} aria-pressed={!appEnabled} disabled={!appEnabled || navigation.state === "submitting"} onClick={toggleApp}>
                <FsIcon name="x" size={14} strokeWidth={2.6} />Disable
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Checklist + credits */}
      <div className="fs-grid-12">
        <Checklist checklist={checklist} />
        <CreditsGauge credits={growth?.credits} planName={growth?.planName} />
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 8 }}>
        <h3 className="fs-h2">This week&apos;s performance</h3>
        <FsButton to="/app/analytics" variant="plain">Open analytics</FsButton>
      </div>
      <div style={{ marginTop: -8 }}>
        <Kpis week={week} currencyCode={currencyCode} />
      </div>

      {/* Quick actions */}
      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h3 className="fs-h2">Quick actions</h3>
        <div className="fs-grid-4">
          {[
            { to: "/app/products", icon: "box", title: "Enable more products", sub: counts.totalProducts ? `${counts.enabledProducts ?? 0} of ${counts.totalProducts} live` : "Choose try-on products" },
            { to: "/app/studio/create", icon: "sparkle", title: "Create an AI model photo", sub: "Guided, step by step" },
            { to: "/app/settings", icon: "sliders", title: "Customize your button", sub: "Colors, text and placement" },
            { to: "/app/analytics", icon: "users", title: "See captured leads", sub: "Shoppers who left details" },
          ].map((a) => (
            <Link key={a.to} to={a.to} className="fs-card fs-action-tile">
              <span className="fs-tile-icon"><FsIcon name={a.icon} size={20} /></span>
              <span style={{ flex: 1 }}><span className="fs-tile-title">{a.title}</span><span className="fs-tile-sub">{a.sub}</span></span>
              <FsIcon name="chevronRight" size={16} style={{ color: "#9CA3AF" }} />
            </Link>
          ))}
          <button type="button" className="fs-card fs-action-tile" style={{ width: "100%", font: "inherit", textAlign: "left", cursor: "pointer" }} onClick={() => setVideoOpen(true)}>
            <span className="fs-tile-icon"><FsIcon name="video" size={20} /></span>
            <span style={{ flex: 1 }}><span className="fs-tile-title">Watch quick walkthrough</span><span className="fs-tile-sub">1 min · see how try-on works</span></span>
            <FsIcon name="chevronRight" size={16} style={{ color: "#9CA3AF" }} />
          </button>
        </div>
      </section>

      <HowToUseSlider />

      {videoOpen && <TutorialModal onClose={() => setVideoOpen(false)} />}
    </FsPage>
  );
}
