import * as React from "react";
import { useNavigate } from "react-router";
import PlanGate from "../app/components/PlanGate";
import {
  Text,
  BlockStack,
  InlineStack,
  Icon,
  Button,
  Box,
  ProgressBar,
} from "@shopify/polaris";
import {
  ViewIcon,
  CartIcon,
  CashDollarIcon,
  ChartVerticalIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  SaveIcon,
  ChatIcon,
} from "@shopify/polaris-icons";

// Mock data shaped exactly like the real /analytics PHP endpoint response,
// so this preview proves the UI renders correctly without needing a live
// Shopify session, OAuth, or a merchant plan upgrade.
const MOCK_ANALYTICS = {
  summary: {
    tryon_initiated: 1842,
    add_to_cart_count: 612,
    order_count: 134,
    revenue_inr: 284600,
    save_count: 301,
    share_wa_count: 88,
    tryon_trend: "+12.4%",
    cart_rate_trend: "+3.1%",
    purch_rate_trend: "-1.2%",
    revenue_trend: "+18.9%",
    cart_trend: "+9.0%",
    save_trend: "+4.4%",
    share_wa_trend: "+2.1%",
    order_trend: "+6.7%",
  },
  charts: {
    tryons: [120, 140, 110, 180, 220, 200, 260, 240, 280, 300, 310],
    cart_rate: [20, 22, 19, 25, 28, 24, 30, 29, 33, 31, 34],
    purch_rate: [5, 6, 4, 7, 8, 6, 9, 8, 10, 9, 11],
    revenue: [12000, 13500, 11000, 17000, 19500, 18000, 22000, 21000, 25000, 24500, 26000],
  },
  top_products: [
    { id: 1, title: "Floral Wrap Saree", price: 2499, tryon_count: 412, buy_count: 88, image: null },
    { id: 2, title: "Linen Kurta Set", price: 1799, tryon_count: 305, buy_count: 71, image: null },
    { id: 3, title: "Denim Jacket", price: 2999, tryon_count: 264, buy_count: 52, image: null },
  ],
  device_split: { mobile: 64, desktop: 28, tablet: 8 },
};

function Sparkline({ data, color = "#3B5BDB", height = 40 }) {
  const hasRealData = Array.isArray(data) && data.length > 1 && data.some((v) => v > 0);
  const chartData = hasRealData ? data : Array(11).fill(0);
  const max = Math.max(...chartData);
  const min = Math.min(...chartData);
  const span = max - min || 1;
  const step = 100 / (chartData.length - 1);
  const points = chartData.map((val, i) => `${i * step},${height - ((val - min) / span) * height}`).join(" ");
  const fillPoints = `0,${height} ${points} 100,${height}`;
  const gradId = `grad-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <div className="vto-sparkline" style={{ marginTop: "24px" }}>
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.15 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={points} />
        <polygon fill={`url(#${gradId})`} points={fillPoints} />
      </svg>
    </div>
  );
}

function KpiCard({ label, value, trend, icon, color, sparkData }) {
  const isDown = typeof trend === "string" && trend.startsWith("-");
  return (
    <div className="vto-kpi-card">
      <div className="vto-kpi-icon-overlay" style={{ background: `${color}15`, color }}>
        <Icon source={icon} />
      </div>
      <BlockStack gap="100">
        <p className="vto-kpi-title">{label}</p>
        <p className="vto-kpi-value-large" style={{ fontSize: "32px", marginBottom: "8px", color: "var(--vto-text-main)" }}>
          {value}
        </p>
        <div className="vto-kpi-trend" style={{ color: isDown ? "#EF4444" : "#10B981" }}>
          <Icon source={isDown ? ArrowDownIcon : ArrowUpIcon} />
          {trend} <span style={{ color: "var(--vto-text-sub)", fontWeight: 400 }}>vs prev period</span>
        </div>
      </BlockStack>
      <Sparkline data={sparkData} color={color} />
    </div>
  );
}

function ActionCard({ label, value, trend, icon }) {
  return (
    <div className="vto-action-card">
      <div className="vto-action-icon" style={{ background: "var(--vto-primary-light)", color: "var(--vto-primary)" }}>
        <Icon source={icon} />
      </div>
      <BlockStack gap="050">
        <div style={{ color: "var(--vto-text-sub)", fontSize: "13px", fontWeight: "500", marginBottom: "4px" }}>{label}</div>
        <div style={{ fontSize: "28px", fontWeight: "800", color: "var(--vto-text-main)", marginBottom: "4px" }}>
          {Number(value).toLocaleString()}
        </div>
        <div style={{ color: "#10B981", fontSize: "12px", fontWeight: "600" }}>{trend}</div>
      </BlockStack>
    </div>
  );
}

function ProductFitCard({ title, price, tries, conversion, badge, badgeBg, currencyCode }) {
  return (
    <div className="vto-product-fit-card">
      {badge && (
        <div className="vto-product-fit-badge">
          <div style={{ background: badgeBg || "var(--vto-primary)", color: "white", fontSize: "10px", fontWeight: "800", padding: "4px 10px", borderRadius: "4px" }}>
            {badge}
          </div>
        </div>
      )}
      <div className="vto-product-fit-image" style={{ width: "130px", height: "130px", background: "#F9FAFB" }}>
        <Box padding="400" display="flex" alignItems="center" justifyContent="center" height="100%">
          <Text color="subdued" variant="bodyXs">No Image</Text>
        </Box>
      </div>
      <BlockStack gap="200" flex="1">
        <BlockStack gap="050">
          <Text variant="bodyMd" fontWeight="bold" color="subdued">{title}</Text>
          <Text variant="heading2xl" as="p" fontWeight="bold" style={{ color: "var(--vto-text-main)", fontSize: "24px" }}>
            {Number(price).toLocaleString(undefined, { style: "currency", currency: currencyCode || "USD", maximumFractionDigits: 2 })}
          </Text>
        </BlockStack>
        <InlineStack align="space-between">
          <BlockStack gap="0">
            <Text variant="headingMd" as="p" fontWeight="bold">{tries}</Text>
            <Text variant="bodyXs" color="subdued">tries</Text>
          </BlockStack>
          <BlockStack gap="0" align="end">
            <div style={{ color: "#10B981", fontSize: "14px", fontWeight: "700", display: "flex", alignItems: "center", gap: "4px" }}>
              <Icon source={ArrowUpIcon} />
              <span>{conversion}</span>
            </div>
            <Text variant="bodyXs" color="subdued">conversion</Text>
          </BlockStack>
        </InlineStack>
        <div style={{ background: "var(--vto-primary)", color: "white", fontSize: "10px", fontWeight: "700", padding: "4px 8px", borderRadius: "4px", display: "inline-block", width: "fit-content", marginTop: "auto" }}>
          92% AI ACCURACY
        </div>
      </BlockStack>
    </div>
  );
}

export default function PreviewAnalytics() {
  const navigate = useNavigate();
  const [currentPlan, setCurrentPlan] = React.useState("pro"); // toggle to "free" to see the plan-gate state
  const currencyCode = "INR";

  const analytics = MOCK_ANALYTICS;
  const kpis = analytics.summary;
  const topProducts = analytics.top_products;
  const deviceSplit = analytics.device_split;
  const charts = analytics.charts;

  const initiated = kpis.tryon_initiated || 0;
  const cartCount = kpis.add_to_cart_count || 0;
  const orderCount = kpis.order_count || 0;
  const revenue = kpis.revenue_inr || 0;
  const cartRate = initiated > 0 ? ((cartCount / initiated) * 100).toFixed(1) : "0.0";
  const purchRate = initiated > 0 ? ((orderCount / initiated) * 100).toFixed(2) : "0.00";

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <Text variant="bodyMd" fontWeight="bold">Preview plan state:</Text>
        <Button pressed={currentPlan === "free"} onClick={() => setCurrentPlan("free")}>Free (locked)</Button>
        <Button pressed={currentPlan === "pro"} onClick={() => setCurrentPlan("pro")}>Pro (unlocked)</Button>
      </div>

      <PlanGate currentPlan={currentPlan} requiredPlan="growth" featureName="Analytics Dashboard">
        <div className="vto-analytics-page">
          <BlockStack gap="800">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                <button type="button" onClick={() => navigate("/app")} aria-label="Back to Dashboard"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", padding: "4px", marginTop: "6px", borderRadius: "6px", color: "#111827" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <BlockStack gap="100">
                  <h1 style={{ fontSize: "32px", fontWeight: "800", letterSpacing: "-0.03em", color: "var(--vto-text-main)" }}>
                    Performance Overview
                  </h1>
                  <p style={{ color: "var(--vto-text-sub)", fontSize: "15px" }}>
                    Tracking AI engagement and conversion metrics (mock preview data).
                  </p>
                </BlockStack>
              </div>
            </div>

            <div className="vto-grid-4col">
              <KpiCard label="TRY-ONS INITIATED" value={Number(initiated).toLocaleString()} trend={kpis.tryon_trend} icon={ViewIcon} color="#3B5BDB" sparkData={charts.tryons} />
              <KpiCard label="CART RATE" value={`${cartRate}%`} trend={kpis.cart_rate_trend} icon={CartIcon} color="#10B981" sparkData={charts.cart_rate} />
              <KpiCard label="PURCHASE RATE" value={`${purchRate}%`} trend={kpis.purch_rate_trend} icon={CashDollarIcon} color="#F59E0B" sparkData={charts.purch_rate} />
              <KpiCard label="REVENUE" value={Number(revenue).toLocaleString(undefined, { style: "currency", currency: currencyCode, maximumFractionDigits: 0 })} trend={kpis.revenue_trend} icon={ChartVerticalIcon} color="#8B5CF6" sparkData={charts.revenue} />
            </div>

            <div className="vto-grid-60-40">
              <div className="vto-card" style={{ padding: "32px", borderRadius: "20px", margin: 0 }}>
                <InlineStack align="space-between" blockAlign="center" style={{ marginBottom: "32px" }}>
                  <Text variant="headingLg" as="h3" fontWeight="bold">User Action Breakdown</Text>
                  <div style={{ background: "var(--vto-primary-light)", color: "var(--vto-primary)", padding: "6px 14px", borderRadius: "99px", fontSize: "11px", fontWeight: "800" }}>
                    POST-TRY-ON EVENTS
                  </div>
                </InlineStack>
                <div className="vto-grid-2col-sm">
                  <ActionCard label="Add to Cart" value={kpis.add_to_cart_count} trend={kpis.cart_trend} icon={CartIcon} />
                  <ActionCard label="Save Image" value={kpis.save_count} trend={kpis.save_trend} icon={SaveIcon} />
                  <ActionCard label="Share WhatsApp" value={kpis.share_wa_count} trend={kpis.share_wa_trend} icon={ChatIcon} />
                  <ActionCard label="Orders Attributed" value={kpis.order_count} trend={kpis.order_trend} icon={CashDollarIcon} />
                </div>
              </div>

              <div className="vto-card vto-device-split-card" style={{ margin: 0 }}>
                <BlockStack gap="500">
                  <Text variant="headingLg" as="h3" fontWeight="bold">Device Split</Text>
                  <BlockStack gap="400">
                    {[
                      { label: "Mobile App", value: deviceSplit.mobile, color: "#3B5BDB" },
                      { label: "Desktop", value: deviceSplit.desktop, color: "#10B981" },
                      { label: "Tablet", value: deviceSplit.tablet, color: "#F59E0B" },
                    ].map((device) => (
                      <div key={device.label}>
                        <InlineStack align="space-between">
                          <InlineStack gap="200">
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: device.color, marginTop: 5 }} />
                            <Text variant="bodyMd" fontWeight="bold" color="subdued">{device.label}</Text>
                          </InlineStack>
                          <Text variant="bodyMd" fontWeight="bold">{device.value}%</Text>
                        </InlineStack>
                        <div style={{ marginTop: 8 }}>
                          <ProgressBar progress={device.value} size="small" tone="primary" />
                        </div>
                      </div>
                    ))}
                  </BlockStack>
                </BlockStack>
              </div>
            </div>

            <BlockStack gap="400">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <BlockStack gap="100">
                  <h2 style={{ fontSize: "24px", fontWeight: "800", color: "var(--vto-text-main)" }}>Top Performing Fits</h2>
                  <p style={{ color: "var(--vto-text-sub)", fontSize: "15px" }}>Products with highest Try-to-Cart conversion</p>
                </BlockStack>
                <Button variant="plain" icon={ArrowRightIcon} iconPosition="right">View all products</Button>
              </div>
              <div className="vto-grid-3col">
                {topProducts.slice(0, 3).map((product, idx) => {
                  const tryons = Number(product.tryon_count || 0);
                  const orders = Number(product.buy_count || 0);
                  const conv = tryons > 0 ? ((orders / tryons) * 100).toFixed(0) : 0;
                  return (
                    <ProductFitCard
                      key={product.id || idx}
                      title={product.title}
                      price={product.price || "0"}
                      currencyCode={currencyCode}
                      tries={tryons > 1000 ? `${(tryons / 1000).toFixed(1)}k` : tryons}
                      conversion={`${conv}% CV`}
                      badge={idx === 0 ? "BEST SELLER" : idx === 1 ? "HIGH CONVERSION" : "TRENDING"}
                      badgeBg={idx === 0 ? "#3B5BDB" : idx === 1 ? "#10B981" : "#8B5CF6"}
                    />
                  );
                })}
              </div>
            </BlockStack>
          </BlockStack>
        </div>
      </PlanGate>
    </div>
  );
}
