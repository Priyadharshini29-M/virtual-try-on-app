import {
  useLoaderData,
  useActionData,
  useNavigation,
  useNavigate,
  useSubmit,
} from "react-router";
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
  StoreManagedIcon,
  CheckCircleIcon,
  ViewIcon,
  CartIcon,
  CashDollarIcon,
  PlayIcon,
  PlusIcon,
  ExternalIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  SettingsIcon,
  AppsIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";

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
  const api = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");

  const [planRes, settingsRes, metaRes, shopRes, plansRes] = await Promise.allSettled([
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
      ? plansRes.value.data?.plans ?? []
      : [];

  return {
    plan,
    settings,
    appEnabled,
    shopInfo,
    plans,
    shop: session.shop,
    apiKey: process.env.SHOPIFY_API_KEY,
  };
}

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");
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
        }
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
          className={`vto-chart-bar ${i === bars.length - 1 ? 'vto-chart-bar-active' : ''}`}
          style={{ height: `${h}%`, background: i === bars.length - 1 ? "#000000" : color }}
        />
      ))}
    </div>
  );
};

const DeviceRow = ({ label, percentage, color = "#000000" }) => (
  <div className="vto-device-row">
    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: color }} />
    <Text variant="bodySm" tone="subdued" style={{ width: "60px" }}>{label}</Text>
    <div className="vto-device-bar-bg">
      <div className="vto-device-bar-fill" style={{ width: `${percentage}%`, background: color }} />
    </div>
    <Text variant="bodySm" fontWeight="bold" style={{ width: "30px", textAlign: "right" }}>{percentage}%</Text>
  </div>
);

const RoadmapCard = ({ step, title, description, children, completed }) => (
  <div className="vto-roadmap-card">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
      <div className="vto-step-number" style={{ background: '#F3F4F6', color: '#000000' }}>{step}</div>
      {completed && <div style={{ color: "#000000" }}><Icon source={CheckCircleIcon} size="small" /></div>}
    </div>
    <Text variant="headingSm" fontWeight="bold">{title}</Text>
    <Text variant="bodySm" tone="subdued">{description}</Text>
    {children}
  </div>
);

const FitCard = ({ title, price, views, trend, image, badge }) => (
  <div className="vto-product-card" style={{ flex: "0 0 200px" }}>
    <div className="vto-product-image-container" style={{ height: "160px" }}>
      <img src={image || "https://via.placeholder.com/200x160"} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      {badge && (
        <div style={{
          position: "absolute", top: "8px", left: "8px",
          background: "#000000",
          color: "white", fontSize: "10px", fontWeight: "700", padding: "2px 8px", borderRadius: "4px"
        }}>
          {badge}
        </div>
      )}
    </div>
    <div className="vto-card-content" style={{ padding: "12px" }}>
      <Text variant="bodySm" fontWeight="bold">{title}</Text>
      <Text variant="bodySm" fontWeight="bold" style={{ color: '#000000' }}>${price}</Text>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
        <Text variant="bodyXs" tone="subdued">👁 {views}</Text>
        <div style={{ color: '#000000', fontSize: '11px', fontWeight: '700' }}>↑ {trend}%</div>
      </div>
    </div>
  </div>
);

export default function Index() {
  const { plan, settings, appEnabled: initialAppEnabled, shopInfo, plans, shop, apiKey } = useLoaderData();
  const currentPlanRow = plans.find((p) => p.plan === plan?.plan) ?? null;
  const planPrice = currentPlanRow
    ? currentPlanRow.price_inr_monthly === 0
      ? "Free"
      : `₹${currentPlanRow.price_inr_monthly}`
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
    if (actionData?.ok) setToastActive(true);
  }, [actionData]);

  const handleToggle = () => {
    const next = !appEnabled;
    setAppEnabled(next);
    submit(
      { ...settings, app_enabled: next },
      { method: "post", encType: "application/json" }
    );
  };

  const scrollSlider = (direction) => {
    if (sliderRef.current) {
      const scrollAmount = 300;
      sliderRef.current.scrollBy({
        left: direction === "next" ? scrollAmount : -scrollAmount,
        behavior: "smooth",
      });
    }
  };

  const howToUseCards = [
    { title: "Step 1: Setup", desc: "Connect your store and sync your products with our AI engine.", img: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&q=80" },
    { title: "Step 2: Training", desc: "Our AI learns your product catalog to create perfect digital twins.", img: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&q=80" },
    { title: "Step 3: Styling", desc: "Customize the virtual try-on button to match your brand's aesthetic.", img: "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=400&q=80" },
    { title: "Step 4: Analytics", desc: "Track conversions and see how virtual try-ons boost your sales.", img: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&q=80" },
    { title: "Step 5: Scaling", desc: "Expand your AI model coverage to your entire collection.", img: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&q=80" },
  ];

  return (
    <Frame>
      <Page fullWidth>
        {/* Header Section */}
        <Box paddingBlockEnd="600">
          <BlockStack gap="100">
            <h1 className="vto-title">FitFyce Dashboard</h1>
            <p className="vto-subtitle">
              Revolutionize shopping with AI-powered virtual fitting. Drive more sales effortlessly.
            </p>
          </BlockStack>
        </Box>

        {/* Top Row: Video (70%) and Integration Progress (30%) */}
        <div style={{ display: "grid", gridTemplateColumns: "7fr 3fr", gap: "20px", marginBottom: "24px" }}>
          {/* Video Tutorial Section */}
          <div className="vto-video-container">
            <img
              src="https://images.unsplash.com/photo-1441984908746-d47b8b240bd8?w=1200&q=80"
              alt="Video Thumbnail"
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }}
            />
            <div className="vto-play-button">
              <Icon source={PlayIcon} tone="textInverse" size="large" />
            </div>
            <div className="vto-video-overlay">
              <Text variant="bodyXs" tone="textInverse" fontWeight="bold">QUICK START</Text>
              <div style={{ marginTop: "4px" }}>
                <Text variant="headingLg" tone="textInverse" fontWeight="bold">How to maximize ROI with FitFyce AI</Text>
              </div>
            </div>
          </div>

          {/* Integration Progress Card */}
          <div className="vto-card" style={{ display: "flex", flexDirection: "column", height: "100%", margin: 0, padding: "20px" }}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" fontWeight="bold">Integration</Text>
                <Text variant="bodySm" fontWeight="bold">66%</Text>
              </InlineStack>

              <div style={{ height: "6px", background: "#F1F5F9", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{ width: "66%", height: "100%", background: "#000000", borderRadius: "3px" }} />
              </div>

              <BlockStack gap="150">
                {[
                  { label: "Connect Store", completed: true },
                  { label: "Sync Products", completed: true },
                  { label: "Generate Models", completed: true },
                  { label: "Final Launch", completed: false },
                ].map((item, i) => (
                  <InlineStack key={i} gap="150" blockAlign="center">
                    <div style={{ color: item.completed ? "#000000" : "#CBD5E1" }}>
                      <Icon source={CheckCircleIcon} size="small" />
                    </div>
                    <Text variant="bodySm" tone={item.completed ? "default" : "subdued"}>{item.label}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </div>
        </div>

        {/* Second Row: App Status and Active Plan */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "48px" }}>

          {/* App Status Card */}
          <div className="vto-card" style={{ display: "flex", flexDirection: "column", height: "100%", margin: 0, padding: "24px" }}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" fontWeight="bold">App Status</Text>
                <div style={{ background: appEnabled ? "#000000" : "#F3F4F6", color: appEnabled ? "#FFFFFF" : "#6B7280", padding: "2px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "700" }}>
                  {appEnabled ? "ACTIVE" : "INACTIVE"}
                </div>
              </InlineStack>

              <Text variant="bodySm" tone="subdued">App embed is helping customers find their perfect fit.</Text>

              <div style={{ marginTop: "8px" }}>
                <button className="vto-status-btn" onClick={handleToggle} disabled={isSaving} style={{ padding: "8px", fontSize: "13px", background: '#000000', color: '#FFFFFF', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
                  {appEnabled ? "Disable in App" : "Enable in App"}
                </button>
                <button className="vto-status-btn vto-status-btn-secondary" onClick={() => window.open(`https://${shop}/admin/themes/current/editor`, '_blank')} style={{ padding: "8px", fontSize: "13px", marginTop: '8px', width: '100%', border: '1px solid #E5E7EB', borderRadius: '8px', background: 'transparent', cursor: 'pointer' }}>
                  {appEnabled ? "Disable in Theme Editor" : "Enable in Theme Editor"}
                </button>
              </div>
            </BlockStack>
          </div>

          {/* Active Plan Card */}
          <div className="vto-card" style={{ display: "flex", flexDirection: "column", height: "100%", margin: 0, padding: "24px" }}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" fontWeight="bold">Current Plan</Text>
                <div style={{ background: "#F3F4F6", color: "#000000", padding: "2px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "700" }}>
                  {(plan?.plan ?? "basic").toUpperCase()}
                </div>
              </InlineStack>

              <div style={{ background: "#F9FAFB", padding: "12px 16px", borderRadius: "12px", border: "1px solid #E5E7EB" }}>
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingXl" fontWeight="bold">
                    {planPrice}
                    {currentPlanRow?.price_inr_monthly > 0 && (
                      <span style={{ fontSize: "12px", fontWeight: "500", color: "#6B7280" }}>/mo</span>
                    )}
                  </Text>
                  <Button variant="primary" size="slim" onClick={() => navigate("/app/plans")}>
                    {plan?.plan === "premium" ? "Manage" : "Upgrade"}
                  </Button>
                </InlineStack>
              </div>
              <Text variant="bodyXs" tone="subdued">
                {plan?.is_unlimited
                  ? "Unlimited try-ons included."
                  : `${plan?.used ?? 0} / ${plan?.limit ?? "—"} try-ons used this month.`}
              </Text>
            </BlockStack>
          </div>
        </div>

        {/* How to Use Section */}
        <Box paddingBlockEnd="800">
          <BlockStack gap="300">
            <Text variant="headingLg" fontWeight="bold">Master the Art of Virtual Fitting</Text>

            <div className="vto-slider-wrapper">
              <div className="vto-slider-nav vto-slider-nav-prev" onClick={() => scrollSlider("prev")}>
                <Icon source={ChevronLeftIcon} tone="base" />
              </div>
              <div className="vto-slider-nav vto-slider-nav-next" onClick={() => scrollSlider("next")}>
                <Icon source={ChevronRightIcon} tone="base" />
              </div>

              <div className="vto-slider-container" ref={sliderRef}>
                {howToUseCards.map((card, i) => (
                  <div key={i} className="vto-slider-card">
                    <img src={card.img} alt={card.title} className="vto-slider-image" />
                    <div className="vto-slider-content">
                      <Text variant="bodySm" fontWeight="bold">{card.title}</Text>
                      <div style={{ marginTop: "4px" }}>
                        <Text variant="bodyXs" tone="subdued">{card.desc}</Text>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </BlockStack>
        </Box>

        {/* Redirection Card to Widget Settings */}
        <Box paddingBlockEnd="800">
          <div className="vto-card" style={{
            background: "#000000",
            padding: "24px", borderRadius: "16px", cursor: "pointer", border: "none"
          }} onClick={() => navigate("/app/settings")}>
            <InlineStack align="space-between" blockAlign="center">
              <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
                <div style={{ background: "rgba(255,255,255,0.1)", padding: "12px", borderRadius: "12px" }}>
                  <Icon source={SettingsIcon} tone="textInverse" />
                </div>
                <BlockStack gap="0">
                  <Text variant="headingMd" fontWeight="bold" tone="textInverse">Customize Your Try-On Widget</Text>
                  <Text variant="bodySm" tone="textInverse" style={{ opacity: 0.8 }}>Tailor the button colors, icons, and position to perfectly match your brand.</Text>
                </BlockStack>
              </div>
              <div style={{ background: "white", padding: "8px 20px", borderRadius: "8px" }}>
                <Text variant="bodySm" fontWeight="bold">Widget Settings</Text>
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
