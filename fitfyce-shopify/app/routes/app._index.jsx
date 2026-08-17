import {
  useLoaderData,
  useActionData,
  useNavigation,
  useNavigate,
  useSubmit,
} from "react-router";
import PropTypes from "prop-types";

import { useState, useEffect, useRef } from "react";
import {
  Page,
  Text,
  Button,
  InlineStack,
  BlockStack,
  Icon,
  Frame,
  Toast,
  Box,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  PlayIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL, SHOPIFY_API_KEY } from "../lib/env.server";
import { phpPlanToUi } from "../lib/plans";

// ─── Server ──────────────────────────────────────────────────────────────────

const APP_ENABLED_QUERY = `#graphql
  query {
    shop {
      metafield(namespace: "fitfyce", key: "app_enabled") {
        value
      }
    }
  }
`;

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  const [planRes, settingsRes, metaRes, shopRes, plansRes] =
    await Promise.allSettled([
      api.checkPlanLimit(),
      api.getSettings(),
      admin.graphql(APP_ENABLED_QUERY),
      api.getShopInfo(),
      api.getPlans(),
    ]);

  const plan =
    planRes.status === "fulfilled" && planRes.value.ok
      ? planRes.value.data
      : null;

  const settings =
    settingsRes.status === "fulfilled" && settingsRes.value.ok
      ? settingsRes.value.data
      : null;

  let appEnabled = true;
  if (metaRes.status === "fulfilled") {
    const metaData = await metaRes.value.json().catch(() => null);
    const metaValue = metaData?.data?.shop?.metafield?.value;
    if (metaValue !== undefined) appEnabled = metaValue !== "false";
  }

  const shopInfo =
    shopRes.status === "fulfilled" && shopRes.value.ok
      ? shopRes.value.data
      : null;

  const plans =
    plansRes.status === "fulfilled" && plansRes.value.ok
      ? (plansRes.value.data?.plans ?? [])
      : [];

  return {
    plan,
    settings,
    appEnabled,
    shopInfo,
    plans,
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

// ─── Components ──────────────────────────────────────────────────────────────

const MiniChart = ({ color = "rgba(0, 0, 0, 0.1)" }) => {
  const bars = [40, 60, 30, 80, 50, 90, 70, 100, 60, 85];
  return (
    <div className="vto-chart-container">
      {bars.map((h, i) => (
        <div
          key={i}
          className={`vto-chart-bar ${i === bars.length - 1 ? "vto-chart-bar-active" : ""}`}
          style={{
            height: `${h}%`,
            background: i === bars.length - 1 ? "#000000" : color,
          }}
        />
      ))}
    </div>
  );
};

const DeviceRow = ({ label, percentage, color = "#000000" }) => (
  <div className="vto-device-row">
    <div
      style={{
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: color,
      }}
    />
    <Text variant="bodySm" tone="subdued" style={{ width: "60px" }}>
      {label}
    </Text>
    <div className="vto-device-bar-bg">
      <div
        className="vto-device-bar-fill"
        style={{ width: `${percentage}%`, background: color }}
      />
    </div>
    <Text
      variant="bodySm"
      fontWeight="bold"
      style={{ width: "30px", textAlign: "right" }}
    >
      {percentage}%
    </Text>
  </div>
);

const RoadmapCard = ({ step, title, description, children, completed }) => (
  <div className="vto-roadmap-card">
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "12px",
      }}
    >
      <div
        className="vto-step-number"
        style={{ background: "#F3F4F6", color: "#000000" }}
      >
        {step}
      </div>
      {completed && (
        <div style={{ color: "#000000" }}>
          <Icon source={CheckCircleIcon} size="small" />
        </div>
      )}
    </div>
    <Text variant="headingSm" fontWeight="bold">
      {title}
    </Text>
    <Text variant="bodySm" tone="subdued">
      {description}
    </Text>
    {children}
  </div>
);

const FitCard = ({ title, price, views, trend, image, badge }) => (
  <div className="vto-product-card" style={{ flex: "0 0 200px" }}>
    <div className="vto-product-image-container" style={{ height: "160px" }}>
      <img
        src={image || "https://via.placeholder.com/200x160"}
        alt={title}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {badge && (
        <div
          style={{
            position: "absolute",
            top: "8px",
            left: "8px",
            background: "#000000",
            color: "white",
            fontSize: "10px",
            fontWeight: "700",
            padding: "2px 8px",
            borderRadius: "4px",
          }}
        >
          {badge}
        </div>
      )}
    </div>
    <div className="vto-card-content" style={{ padding: "12px" }}>
      <Text variant="bodySm" fontWeight="bold">
        {title}
      </Text>
      <Text variant="bodySm" fontWeight="bold" style={{ color: "#000000" }}>
        ${price}
      </Text>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "8px",
        }}
      >
        <Text variant="bodyXs" tone="subdued">
          👁 {views}
        </Text>
        <div style={{ color: "#000000", fontSize: "10px", fontWeight: "700" }}>
          ↑ {trend}%
        </div>
      </div>
    </div>
  </div>
);

MiniChart.propTypes = {
  color: PropTypes.string,
};

DeviceRow.propTypes = {
  label: PropTypes.string.isRequired,
  percentage: PropTypes.number.isRequired,
  color: PropTypes.string,
};

RoadmapCard.propTypes = {
  step: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  children: PropTypes.node,
  completed: PropTypes.bool,
};

FitCard.propTypes = {
  title: PropTypes.string.isRequired,
  price: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  views: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  trend: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  image: PropTypes.string,
  badge: PropTypes.string,
};

const PLAN_LIMITS = { free: 10, growth: 100, pro: 500 };

const PLAN_FEATURES = {
  free: [
    "10 monthly AI try-ons",
    "Mobile & desktop responsive widget",
    "Privacy consent screen",
    "Product page try-on support",
    "Standard AI processing",
    "Email support",
  ],
  growth: [
    "100 monthly AI try-ons",
    "Collection page try-on icons",
    "Variant image mapping system",
    "Advanced widget customization",
    "Analytics dashboard",
    "Customer email collection",
    "Faster AI processing",
    "Standard support",
  ],
  pro: [
    "500 monthly AI try-ons",
    "Advanced analytics dashboard",
    "Device-based analytics",
    "7-day trend reporting",
    "Multi-language widget support",
    "Priority AI processing",
    "Custom icon positioning",
    "Priority support",
    "Early access to new features",
  ],
};

export default function Index() {
  const {
    plan,
    settings,
    appEnabled: initialAppEnabled,
    plans,
    shop,
  } = useLoaderData();
  const effectivePlan = phpPlanToUi(plan?.plan ?? "basic");
  const planLimit = plan?.limit || PLAN_LIMITS[effectivePlan] || 10;
  const currentPlanRow = plans.find((p) => p.plan === effectivePlan) ?? null;
  const planPrice = currentPlanRow
    ? currentPlanRow.price_inr_monthly === 0
      ? "Free"
      : `₹${currentPlanRow.price_inr_monthly}`
    : effectivePlan === "free"
    ? "Free"
    : "—";
  const actionData = useActionData();
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [appEnabled, setAppEnabled] = useState(initialAppEnabled ?? true);
  const [toastActive, setToastActive] = useState(false);
  const sliderRef = useRef(null);

  useEffect(() => {
    setAppEnabled(initialAppEnabled ?? true);
  }, [initialAppEnabled]);

  useEffect(() => {
    if (actionData?.ok) setToastActive(true);
  }, [actionData]);

  const handleToggle = () => {
    const next = !appEnabled;
    setAppEnabled(next);
    submit(
      { ...settings, app_enabled: next },
      { method: "post", encType: "application/json" },
    );
  };

  const scrollSlider = (direction) => {
    if (!sliderRef.current) return;
    const card = sliderRef.current.querySelector(".vto-slider-card");
    const gap = 18;
    const amount = card ? card.offsetWidth + gap : 298;
    sliderRef.current.scrollBy({
      left: direction === "next" ? amount : -amount,
      behavior: "smooth",
    });
  };

  const howToUseCards = [
    {
      step: "01",
      title: "Open FitSnap",
      desc: "Open FitSnap from your Shopify Apps. Your dashboard shows integration status, plan quota, and quick-start checklist.",
      img: "/steps/step1.png",
    },
    {
      step: "02",
      title: "Enable in Theme Editor",
      desc: "Go to Online Store → Themes → Customize → App Embeds and toggle on FitSnap Try-On to activate it on your storefront.",
      img: "/steps/step2.png",
    },
    {
      step: "03",
      title: "Enable Try-On for Products",
      desc: "From the Products tab, enable try-on for individual products or entire collections and preview results instantly.",
      img: "/steps/step3.png",
    },
    {
      step: "04",
      title: "Map Variant Images",
      desc: "Assign a flat-lay or model image to each variant, set the garment type, and add an optional styling prompt for best AI results.",
      img: "/steps/step4.png",
    },
    {
      step: "05",
      title: "Style the Widget",
      desc: "Customise button text, colors, size, padding, and typography from Widget Settings — see changes live in the preview.",
      img: "/steps/step5.png",
    },
    {
      step: "06",
      title: "Add Block to Product Page",
      desc: "In the Theme Editor, add the FitSnap Try-On block inside your product template so the button appears for every shopper.",
      img: "/steps/step6.png",
    },
    {
      step: "07",
      title: "Track Performance",
      desc: "Monitor try-on sessions, cart rate, purchase rate, device split, and top-performing products from your Analytics dashboard.",
      img: "/steps/step7.png",
    },
  ];

  return (
    <Frame>
      <Page fullWidth>
        {/* Header Section */}
        <Box paddingBlockEnd="600">
          <BlockStack gap="100">
            <h1 className="vto-title">FitSnap Dashboard</h1>
            <p className="vto-subtitle">
              Revolutionize shopping with AI-powered virtual fitting. Drive more
              sales effortlessly.
            </p>
            <p className="vto-section-intro">
              This dashboard brings your integration, activation, and
              performance signals together in one refined view. Get clear
              direction on the next action steps and keep your virtual fitting
              experience fully aligned with store performance.
            </p>
          </BlockStack>
        </Box>

        {/* Top Row: Video (70%) and Integration Progress (30%) */}
        <div className="vto-grid-70-30">
          {/* Video Tutorial Section */}
          <a
            href="https://youtu.be/fMRsrR3o4Zk"
            target="_blank"
            rel="noopener noreferrer"
            className="vto-video-container"
            style={{ display: "block", textDecoration: "none" }}
            aria-label="Watch tutorial video"
          >
            <img
              src="/steps/videothumbnail.png"
              alt="Video Thumbnail"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
            <div className="vto-play-button">
              <Icon source={PlayIcon} tone="textInverse" size="large" />
            </div>
            <div className="vto-video-overlay">
              <Text variant="bodyXs" tone="textInverse" fontWeight="bold">
                QUICK START
              </Text>
              <div style={{ marginTop: "4px" }}>
                <Text variant="headingLg" tone="textInverse" fontWeight="bold">
                  How to maximize ROI with FitSnap AI
                </Text>
              </div>
            </div>
          </a>

          {/* Integration Progress Card */}
          <div
            className="vto-card"
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              margin: 0,
              padding: "20px",
            }}
          >
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" fontWeight="bold">
                  Integration
                </Text>
                <Text variant="bodySm" fontWeight="bold">
                  66%
                </Text>
              </InlineStack>

              <div
                style={{
                  height: "6px",
                  background: "#F1F5F9",
                  borderRadius: "3px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: "66%",
                    height: "100%",
                    background: "#000000",
                    borderRadius: "3px",
                  }}
                />
              </div>

              <Text
                variant="bodyMd"
                style={{ color: "#111827", lineHeight: 1.6 }}
              >
                Your integration is almost complete. One final launch step
                remains before virtual try-ons are fully enabled across your
                storefront.
              </Text>

              <BlockStack gap="150">
                {[
                  { label: "Connect Store", completed: true },
                  { label: "Sync Products", completed: true },
                  { label: "Generate Models", completed: true },
                  { label: "Final Launch", completed: false },
                ].map((item, i) => (
                  <InlineStack key={i} gap="150" blockAlign="center">
                    <div
                      style={{ color: item.completed ? "#000000" : "#CBD5E1" }}
                    >
                      <Icon source={CheckCircleIcon} size="small" />
                    </div>
                    <Text
                      variant="bodySm"
                      style={{ color: item.completed ? "#111827" : "#475569" }}
                    >
                      {item.label}
                    </Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </div>
        </div>

        {/* Second Row: App Status and Active Plan */}
        <div className="vto-grid-2col" style={{ marginBottom: "48px" }}>
          {/* App Status Card */}
          <div
            className="vto-card"
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              margin: 0,
              padding: "24px",
            }}
          >
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" fontWeight="bold">
                  App Status
                </Text>
                <div
                  style={{
                    background: appEnabled ? "#000000" : "#F3F4F6",
                    color: appEnabled ? "#FFFFFF" : "#6B7280",
                    padding: "2px 10px",
                    borderRadius: "12px",
                    fontSize: "10px",
                    fontWeight: "700",
                  }}
                >
                  {appEnabled ? "ACTIVE" : "INACTIVE"}
                </div>
              </InlineStack>

              <Text
                variant="bodyMd"
                style={{ color: "#111827", lineHeight: 1.6 }}
              >
                The widget is active in your store. Manage availability from the
                app or the theme editor without losing saved settings.
              </Text>

              <div style={{ marginTop: "10px" }}>
                <button
                  className="vto-status-btn"
                  onClick={handleToggle}
                  disabled={isSaving}
                  style={{
                    padding: "8px",
                    fontSize: "11px",
                    background: "#000000",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                  }}
                >
                  {appEnabled ? "Disable in App" : "Enable in App"}
                </button>
                <button
                  className="vto-status-btn vto-status-btn-secondary"
                  onClick={() =>
                    window.open(
                      `https://${shop}/admin/themes/current/editor`,
                      "_blank",
                    )
                  }
                  style={{
                    padding: "8px",
                    fontSize: "11px",
                    marginTop: "8px",
                    width: "100%",
                    border: "1px solid #E5E7EB",
                    borderRadius: "8px",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  {appEnabled
                    ? "Disable in Theme Editor"
                    : "Enable in Theme Editor"}
                </button>
              </div>
            </BlockStack>
          </div>

          {/* Active Plan Card */}
          <div
            className="vto-card"
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              margin: 0,
              padding: "24px",
            }}
          >
            <BlockStack gap="300">
              {/* Header */}
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" fontWeight="bold">
                  Current Plan
                </Text>
                <div
                  style={{
                    background: "#F3F4F6",
                    color: "#000000",
                    padding: "2px 10px",
                    borderRadius: "12px",
                    fontSize: "10px",
                    fontWeight: "700",
                  }}
                >
                  {effectivePlan.toUpperCase()}
                </div>
              </InlineStack>

              {/* Price + CTA */}
              <div
                style={{
                  background: "#F9FAFB",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  border: "1px solid #E5E7EB",
                }}
              >
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingXl" fontWeight="bold">
                    {planPrice}
                    {currentPlanRow?.price_inr_monthly > 0 && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: "500",
                          color: "#6B7280",
                        }}
                      >
                        /mo
                      </span>
                    )}
                  </Text>
                  <Button
                    variant="primary"
                    size="slim"
                    onClick={() => navigate("/app/plans")}
                  >
                    {effectivePlan === "pro" ? "Manage" : "Upgrade"}
                  </Button>
                </InlineStack>
              </div>

              {/* Usage bar */}
              {(() => {
                const used = plan?.used ?? 0;
                const pct = planLimit > 0 ? Math.min(100, Math.round((used / planLimit) * 100)) : 0;
                const barColor = pct >= 90 ? "#EF4444" : pct >= 70 ? "#F59E0B" : "#1D9E75";
                return (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "#374151" }}>Monthly Try-Ons</span>
                      <span style={{ fontSize: "11px", color: "#6B7280" }}>{used} / {planLimit} used</span>
                    </div>
                    <div style={{ height: "6px", background: "#F3F4F6", borderRadius: "999px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: "999px", transition: "width 0.4s ease" }} />
                    </div>
                    {pct >= 90 && (
                      <p style={{ fontSize: "10px", color: "#EF4444", marginTop: "5px", fontWeight: 500 }}>
                        {pct}% of quota used — extra try-ons are charged per use.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Plan features */}
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {(PLAN_FEATURES[effectivePlan] ?? PLAN_FEATURES.free).map((f, i) => (
                  <li key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "5px" }}>
                    <span style={{ color: "#1D9E75", fontWeight: 700, flexShrink: 0, fontSize: "11px" }}>✓</span>
                    <Text variant="bodySm">{f}</Text>
                  </li>
                ))}
              </ul>
            </BlockStack>
          </div>
        </div>

        {/* How to Use Section */}
        <Box paddingBlockEnd="800">
          <BlockStack gap="300">
            <Text
              variant="headingLg"
              fontWeight="bold"
            >
              Master the Art of Virtual Fitting
            </Text>
            <Text
              variant="bodyMd"
              style={{
                color: "#6B7280",
                lineHeight: 1.6,
                marginTop: "6px",
              }}
            >
              Seven steps to get virtual try-on live on your store.
            </Text>

            <div className="vto-slider-wrapper">
              <div
                className="vto-slider-nav vto-slider-nav-prev"
                role="button"
                tabIndex={0}
                onClick={() => scrollSlider("prev")}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" ||
                    e.key === " " ||
                    e.key === "Spacebar"
                  )
                    scrollSlider("prev");
                }}
                aria-label="Scroll slider previous"
              >
                <Icon source={ChevronLeftIcon} tone="base" />
              </div>
              <div
                className="vto-slider-nav vto-slider-nav-next"
                role="button"
                tabIndex={0}
                onClick={() => scrollSlider("next")}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" ||
                    e.key === " " ||
                    e.key === "Spacebar"
                  )
                    scrollSlider("next");
                }}
                aria-label="Scroll slider next"
              >
                <Icon source={ChevronRightIcon} tone="base" />
              </div>

              <div className="vto-slider-container" ref={sliderRef}>
                {howToUseCards.map((card, i) => (
                  <div key={i} className="vto-slider-card">
                    <img
                      src={card.img}
                      alt={card.title}
                      className="vto-slider-image"
                    />
                    <div className="vto-slider-content">
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                        <span style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          color: "#fff",
                          background: "#111827",
                          borderRadius: "6px",
                          padding: "2px 8px",
                          letterSpacing: "0.04em",
                          flexShrink: 0,
                        }}>
                          {card.step}
                        </span>
                        <div className="vto-slider-card-title">{card.title}</div>
                      </div>
                      <div className="vto-slider-card-desc">{card.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </BlockStack>
        </Box>

        {/* Redirection Card to Widget Settings */}
        <Box paddingBlockEnd="800">
          <div
            className="vto-card"
            style={{
              background: "#111827",
              padding: "24px",
              borderRadius: "16px",
              cursor: "pointer",
              border: "none",
            }}
            role="button"
            tabIndex={0}
            onClick={() => navigate("/app/settings")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " " || e.key === "Spacebar")
                navigate("/app/settings");
            }}
            aria-label="Go to Widget Settings"
          >
            <InlineStack align="space-between" blockAlign="center">
              <div
                style={{ display: "flex", gap: "20px", alignItems: "center" }}
              >
                <div
                  style={{
                    background: "rgba(255,255,255,0.18)",
                    padding: "10px",
                    borderRadius: "14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    style={{ color: "#FFFFFF" }}
                  >
                    <path
                      d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z"
                      fill="currentColor"
                    />
                    <path
                      d="M19.4 13.2c.1-.4.1-.8.1-1.2s0-.8-.1-1.2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.4a.5.5 0 0 0-.6-.2l-2.5 1a7.8 7.8 0 0 0-2-1.2L14 2.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.4L8.4 4.1a7.8 7.8 0 0 0-2 1.2l-2.5-1a.5.5 0 0 0-.6.2L1.3 8.8a.5.5 0 0 0 .1.6l2.1 1.6c-.1.4-.1.8-.1 1.2s0 .8.1 1.2L1.4 14.4a.5.5 0 0 0-.1.6l2 3.4a.5.5 0 0 0 .6.2l2.5-1c.6.5 1.3.9 2 1.2l.6 2.1a.5.5 0 0 0 .5.4h4a.5.5 0 0 0 .5-.4l.6-2.1c.7-.3 1.4-.7 2-1.2l2.5 1a.5.5 0 0 0 .6-.2l2-3.4a.5.5 0 0 0-.1-.6l-2.1-1.6z"
                      fill="currentColor"
                      opacity="0.9"
                    />
                  </svg>
                </div>
                <BlockStack gap="0">
                  <div className="vto-widget-card-heading">
                    Customize Your Try-On Widget
                  </div>
                  <div className="vto-widget-card-copy">
                    Tailor the button colors, icons, and position to perfectly
                    match your brand.
                  </div>
                </BlockStack>
              </div>
              <div
                style={{
                  background: "white",
                  padding: "8px 20px",
                  borderRadius: "8px",
                }}
              >
                <Text variant="bodySm" fontWeight="bold">
                  Widget Settings
                </Text>
              </div>
            </InlineStack>
          </div>
        </Box>

        {toastActive && (
          <Toast
            content="Settings saved successfully"
            onDismiss={() => setToastActive(false)}
          />
        )}
      </Page>
    </Frame>
  );
}
