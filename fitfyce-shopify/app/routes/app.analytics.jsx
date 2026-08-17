import { useLoaderData, useNavigate } from "react-router";
import PlanGate from "../components/PlanGate";
import * as React from "react";
import {
  Text,
  BlockStack,
  InlineStack,
  Icon,
  Button,
  Box,
  ProgressBar,
  DatePicker,
  TextField,
} from "@shopify/polaris";
import {
  ViewIcon,
  CartIcon,
  CashDollarIcon,
  ChartVerticalIcon,
  CalendarIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  SaveIcon,
  ChatIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";
import { phpPlanToUi } from "../lib/plans";

function getFromDate(range) {
  const d = new Date();
  if (range === "today") {
    return d.toISOString().split("T")[0];
  }
  if (range === "yesterday") {
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  }
  if (range === "last7") {
    d.setDate(d.getDate() - 6);
  }
  if (range === "last30") {
    d.setDate(d.getDate() - 29);
  }
  if (range === "last90") {
    d.setDate(d.getDate() - 89);
  }
  if (range === "thisMonth") {
    d.setDate(1);
  }
  if (range === "lastMonth") {
    d.setMonth(d.getMonth() - 1);
    d.setDate(1);
  }
  if (range === "year") {
    d.setFullYear(d.getFullYear() - 1);
  }
  return d.toISOString().split("T")[0];
}

function formatDateRange(from, to) {
  const f = new Date(from + "T00:00:00");
  const t = new Date(to + "T00:00:00");
  if (from === to)
    return f.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const fStr = f.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const tStr = t.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${fStr} – ${tStr}`;
}

const CURRENCY_QUERY = `#graphql
  query {
    shop {
      currencyCode
      currencyFormats { moneyFormat }
    }
  }
`;

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);

  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "today";
  const customFrom = url.searchParams.get("from");
  const customTo = url.searchParams.get("to");

  const to = customTo || new Date().toISOString().split("T")[0];
  const from = customFrom || getFromDate(range);

  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const [result, currencyRes, planRes] = await Promise.allSettled([
    api.getAnalytics({ from, to }),
    admin.graphql(CURRENCY_QUERY),
    api.checkPlanLimit(),
  ]);

  let currencyCode = "USD";
  if (currencyRes.status === "fulfilled") {
    const cj = await currencyRes.value.json().catch(() => null);
    currencyCode = cj?.data?.shop?.currencyCode || "USD";
  }

  const planData = planRes.status === "fulfilled" && planRes.value.ok ? planRes.value.data : null;

  return {
    analytics:   result.status === "fulfilled" && result.value.ok ? result.value.data : null,
    range,
    from,
    to,
    shop:        session.shop,
    currencyCode,
    currentPlan: phpPlanToUi(planData?.plan ?? "basic"),
  };
}

function Sparkline({ data, color = "#3B5BDB", height = 40 }) {
  const hasRealData =
    Array.isArray(data) && data.length > 1 && data.some((v) => v > 0);
  const chartData = hasRealData ? data : Array(11).fill(0);

  const max = Math.max(...chartData);
  const min = Math.min(...chartData);
  const span = max - min || 1;
  const step = 100 / (chartData.length - 1);

  const points = chartData
    .map((val, i) => {
      const x = i * step;
      const y = height - ((val - min) / span) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const fillPoints = `0,${height} ${points} 100,${height}`;
  const gradId = `grad-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="vto-sparkline" style={{ marginTop: "24px" }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.15 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
        <polygon fill={`url(#${gradId})`} points={fillPoints} />
      </svg>
    </div>
  );
}

function KpiCard({ label, value, trend, icon, color, sparkData }) {
  const isDown = typeof trend === "string" && trend.startsWith("-");
  const displayTrend = trend || "+0.0%";

  return (
    <div className="vto-kpi-card">
      <div
        className="vto-kpi-icon-overlay"
        style={{ background: `${color}15`, color }}
      >
        <Icon source={icon} />
      </div>
      <BlockStack gap="100">
        <p className="vto-kpi-title">{label}</p>
        <p
          className="vto-kpi-value-large"
          style={{
            marginBottom: "8px",
            color: "var(--vto-text-main)",
          }}
        >
          {value}
        </p>
        <div
          className="vto-kpi-trend"
          style={{ color: isDown ? "#EF4444" : "#10B981" }}
        >
          <Icon source={isDown ? ArrowDownIcon : ArrowUpIcon} />
          {displayTrend}{" "}
          <span style={{ color: "var(--vto-text-sub)", fontWeight: 400 }}>
            vs prev period
          </span>
        </div>
      </BlockStack>
      <Sparkline data={sparkData} color={color} />
    </div>
  );
}

function ActionCard({ label, value, trend, icon }) {
  const displayTrend = trend || "+0.0%";
  return (
    <div className="vto-action-card">
      <div
        className="vto-action-icon"
        style={{
          background: "var(--vto-primary-light)",
          color: "var(--vto-primary)",
        }}
      >
        <Icon source={icon} />
      </div>
      <BlockStack gap="050">
        <div
          style={{
            color: "var(--vto-text-sub)",
            fontSize: "11px",
            fontWeight: "500",
            marginBottom: "4px",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: "20px",
            fontWeight: "800",
            color: "var(--vto-text-main)",
            marginBottom: "4px",
          }}
        >
          {Number(value).toLocaleString()}
        </div>
        <div style={{ color: "#10B981", fontSize: "11px", fontWeight: "600" }}>
          {displayTrend}
        </div>
      </BlockStack>
    </div>
  );
}

function ProductFitCard({
  title,
  price,
  tries,
  conversion,
  badge,
  image,
  badgeBg,
  currencyCode,
}) {
  return (
    <div className="vto-product-fit-card">
      {badge && (
        <div className="vto-product-fit-badge">
          <div
            style={{
              background: badgeBg || "var(--vto-primary)",
              color: "white",
              fontSize: "10px",
              fontWeight: "800",
              padding: "4px 10px",
              borderRadius: "4px",
            }}
          >
            {badge}
          </div>
        </div>
      )}
      <div
        className="vto-product-fit-image"
        style={{
          width: "130px",
          height: "130px",
          backgroundImage: image ? `url(${image})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
          background: "#F9FAFB",
        }}
      >
        {!image && (
          <Box
            padding="400"
            display="flex"
            alignItems="center"
            justifyContent="center"
            height="100%"
          >
            <Text color="subdued" variant="bodyXs">
              No Image
            </Text>
          </Box>
        )}
      </div>
      <BlockStack gap="200" flex="1">
        <BlockStack gap="050">
          <Text variant="bodyMd" fontWeight="bold" color="subdued">
            {title}
          </Text>
          <Text
            variant="heading2xl"
            as="p"
            fontWeight="bold"
            style={{ color: "var(--vto-text-main)", fontSize: "20px" }}
          >
            {Number(price).toLocaleString(undefined, { style: "currency", currency: currencyCode || "USD", maximumFractionDigits: 2 })}
          </Text>
        </BlockStack>
        <InlineStack align="space-between">
          <BlockStack gap="0">
            <Text variant="headingMd" as="p" fontWeight="bold">
              {tries}
            </Text>
            <Text variant="bodyXs" color="subdued">
              tries
            </Text>
          </BlockStack>
          <BlockStack gap="0" align="end">
            <div
              style={{
                color: "#10B981",
                fontSize: "11px",
                fontWeight: "700",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Icon source={ArrowUpIcon} />
              <span>{conversion}</span>
            </div>
            <Text variant="bodyXs" color="subdued">
              conversion
            </Text>
          </BlockStack>
        </InlineStack>
        <div
          style={{
            background: "var(--vto-primary)",
            color: "white",
            fontSize: "10px",
            fontWeight: "700",
            padding: "4px 8px",
            borderRadius: "4px",
            display: "inline-block",
            width: "fit-content",
            marginTop: "auto",
          }}
        >
          92% AI ACCURACY
        </div>
      </BlockStack>
    </div>
  );
}

export default function Analytics() {
  const { analytics, range, from, to, currencyCode = "USD", currentPlan } = useLoaderData();
  const navigate = useNavigate();

  const [popoverActive, setPopoverActive] = React.useState(false);
  const [activeRange, setActiveRange] = React.useState(range);

  const [{ month, year }, setDate] = React.useState({
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
  });
  const [selectedDates, setSelectedDates] = React.useState({
    start: new Date(from),
    end: new Date(to),
  });

  const handleMonthChange = React.useCallback(
    (m, y) => setDate({ month: m, year: y }),
    [],
  );

  const presets = [
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "Last 7 days", value: "last7" },
    { label: "Last 30 days", value: "last30" },
    { label: "Last 90 days", value: "last90" },
    { label: "This month", value: "thisMonth" },
    { label: "Last month", value: "lastMonth" },
    { label: "Year", value: "year" },
  ];

  const handleApplyRange = () => {
    const fromStr = selectedDates.start.toISOString().split("T")[0];
    const endStr = selectedDates.end.toISOString().split("T")[0];
    navigate(`?from=${fromStr}&to=${endStr}&range=custom`);
    setPopoverActive(false);
  };

  const handlePresetClick = (preset) => {
    setActiveRange(preset.value);
    const newFrom = getFromDate(preset.value);
    const newTo = new Date().toISOString().split("T")[0];
    setSelectedDates({ start: new Date(newFrom), end: new Date(newTo) });
    navigate(`?range=${preset.value}`);
    setPopoverActive(false);
  };

  const dateLabel = formatDateRange(from, to);

  const kpis = analytics?.summary || {};
  const topProducts = analytics?.top_products || [];
  const deviceSplit = analytics?.device_split || {
    mobile: 0,
    desktop: 0,
    tablet: 0,
  };
  const charts = analytics?.charts || {};

  const initiated = kpis.tryon_initiated || 0;
  const cartCount = kpis.add_to_cart_count || 0;
  const orderCount = kpis.order_count || 0;
  const revenue = kpis.revenue_inr || 0;

  const cartRate =
    initiated > 0 ? ((cartCount / initiated) * 100).toFixed(1) : "0.0";
  const purchRate =
    initiated > 0 ? ((orderCount / initiated) * 100).toFixed(2) : "0.00";

  return (
    <PlanGate currentPlan={currentPlan} requiredPlan="growth" featureName="Analytics Dashboard">
    <div className="vto-analytics-page">
      <BlockStack gap="800">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <button
              type="button"
              onClick={() => navigate("/app")}
              aria-label="Back to Dashboard"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                marginTop: "6px",
                borderRadius: "6px",
                color: "#111827",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          <BlockStack gap="100">
            <h1
              style={{
                fontSize: "18px",
                fontWeight: "800",
                letterSpacing: "-0.03em",
                color: "var(--vto-text-main)",
              }}
            >
              Performance Overview
            </h1>
            <p style={{ color: "var(--vto-text-sub)", fontSize: "12px" }}>
              Tracking AI engagement and conversion metrics
              {range === "today"
                ? " for today"
                : range === "last30"
                  ? " for the last 30 days"
                  : ` for ${range}`}
              .
            </p>
          </BlockStack>
          </div>
          <Button
            icon={CalendarIcon}
            onClick={() => setPopoverActive((v) => !v)}
            disclosure
          >
            {dateLabel}
          </Button>

          {/* ── Centered date-range picker overlay ── */}
          {popoverActive && (
            <>
              {/* Backdrop */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Close date picker"
                onClick={() => setPopoverActive(false)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" ||
                    e.key === " " ||
                    e.key === "Escape"
                  ) {
                    setPopoverActive(false);
                  }
                }}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.45)",
                  zIndex: 518,
                  cursor: "pointer",
                }}
              />

              {/* Panel */}
              <div
                style={{
                  position: "fixed",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  zIndex: 519,
                  width: "820px",
                  maxWidth: "95vw",
                  background: "#fff",
                  borderRadius: "16px",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.22)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Header */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "16px 24px",
                    borderBottom: "1px solid #E4E5E7",
                  }}
                >
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: "700",
                      color: "#202223",
                    }}
                  >
                    Select date range
                  </span>
                  <button
                    type="button"
                    aria-label="Close date picker"
                    onClick={() => setPopoverActive(false)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" ||
                        e.key === " " ||
                        e.key === "Escape"
                      ) {
                        setPopoverActive(false);
                      }
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: "20px",
                      color: "#6D7175",
                      cursor: "pointer",
                      lineHeight: 1,
                      padding: "4px 8px",
                    }}
                  >
                    ×
                  </button>
                </div>

                {/* Body: presets + calendar */}
                <div style={{ display: "flex", flex: 1 }}>
                  {/* Preset list */}
                  <div
                    style={{
                      width: "190px",
                      borderRight: "1px solid #E4E5E7",
                      padding: "8px 0",
                      flexShrink: 0,
                    }}
                  >
                    {presets.map((preset) => {
                      const isActive = activeRange === preset.value;
                      return (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => handlePresetClick(preset)}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 20px",
                            fontSize: "12px",
                            fontWeight: isActive ? "600" : "400",
                            color: isActive ? "#3B5BDB" : "#202223",
                            background: isActive ? "#EEF2FF" : "transparent",
                            border: "none",
                            borderLeft: isActive
                              ? "3px solid #3B5BDB"
                              : "3px solid transparent",
                            cursor: "pointer",
                          }}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Calendar area */}
                  <div style={{ flex: 1, padding: "20px 24px" }}>
                    <DatePicker
                      month={month}
                      year={year}
                      onChange={(dates) => {
                        setSelectedDates(dates);
                        setActiveRange("custom");
                      }}
                      onMonthChange={handleMonthChange}
                      selected={selectedDates}
                      allowRange
                    />
                  </div>
                </div>

                {/* Footer: date inputs + actions */}
                <div
                  style={{
                    borderTop: "1px solid #E4E5E7",
                    padding: "14px 24px",
                    display: "flex",
                    alignItems: "flex-end",
                    gap: "12px",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="From"
                      value={selectedDates.start.toISOString().split("T")[0]}
                      readOnly
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="To"
                      value={selectedDates.end.toISOString().split("T")[0]}
                      readOnly
                      autoComplete="off"
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      paddingBottom: "2px",
                    }}
                  >
                    <Button onClick={() => setPopoverActive(false)}>
                      Cancel
                    </Button>
                    <Button variant="primary" onClick={handleApplyRange}>
                      Apply
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="vto-grid-4col">
          <KpiCard
            label="TRY-ONS INITIATED"
            value={Number(initiated).toLocaleString()}
            trend={kpis.tryon_trend || "+0.0%"}
            icon={ViewIcon}
            color="#3B5BDB"
            sparkData={charts.tryons}
          />
          <KpiCard
            label="CART RATE"
            value={`${cartRate}%`}
            trend={kpis.cart_rate_trend || "+0.0%"}
            icon={CartIcon}
            color="#10B981"
            sparkData={charts.cart_rate}
          />
          <KpiCard
            label="PURCHASE RATE"
            value={`${purchRate}%`}
            trend={kpis.purch_rate_trend || "+0.0%"}
            icon={CashDollarIcon}
            color="#F59E0B"
            sparkData={charts.purch_rate}
          />
          <KpiCard
            label="REVENUE"
            value={Number(revenue).toLocaleString(undefined, { style: "currency", currency: currencyCode, maximumFractionDigits: 0 })}
            trend={kpis.revenue_trend || "+0.0%"}
            icon={ChartVerticalIcon}
            color="#8B5CF6"
            sparkData={charts.revenue}
          />
        </div>

        <div className="vto-grid-60-40">
          <div
            className="vto-card"
            style={{ padding: "32px", borderRadius: "20px", margin: 0 }}
          >
            <InlineStack
              align="space-between"
              blockAlign="center"
              style={{ marginBottom: "32px" }}
            >
              <Text variant="headingLg" as="h3" fontWeight="bold">
                User Action Breakdown
              </Text>
              <div
                style={{
                  background: "var(--vto-primary-light)",
                  color: "var(--vto-primary)",
                  padding: "6px 14px",
                  borderRadius: "99px",
                  fontSize: "10px",
                  fontWeight: "800",
                }}
              >
                POST-TRY-ON EVENTS
              </div>
            </InlineStack>
            <div className="vto-grid-2col-sm">
              <ActionCard
                label="Add to Cart"
                value={kpis.add_to_cart_count || 0}
                trend={kpis.cart_trend || "+0.0%"}
                icon={CartIcon}
              />
              <ActionCard
                label="Save Image"
                value={kpis.save_count || 0}
                trend={kpis.save_trend || "+0.0%"}
                icon={SaveIcon}
              />
              <ActionCard
                label="Share WhatsApp"
                value={kpis.share_wa_count || 0}
                trend={kpis.share_wa_trend || "+0.0%"}
                icon={ChatIcon}
              />
              <ActionCard
                label="Orders Attributed"
                value={kpis.order_count || 0}
                trend={kpis.order_trend || "+0.0%"}
                icon={CashDollarIcon}
              />
            </div>
          </div>

          <div className="vto-card vto-device-split-card" style={{ margin: 0 }}>
            <BlockStack gap="500">
              <Text variant="headingLg" as="h3" fontWeight="bold">
                Device Split
              </Text>
              <BlockStack gap="400">
                {[
                  {
                    label: "Mobile App",
                    value: deviceSplit.mobile || 0,
                    color: "#3B5BDB",
                  },
                  {
                    label: "Desktop",
                    value: deviceSplit.desktop || 0,
                    color: "#10B981",
                  },
                  {
                    label: "Tablet",
                    value: deviceSplit.tablet || 0,
                    color: "#F59E0B",
                  },
                ].map((device) => (
                  <div key={device.label}>
                    <InlineStack align="space-between">
                      <InlineStack gap="200">
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: device.color,
                            marginTop: 5,
                          }}
                        />
                        <Text
                          variant="bodyMd"
                          fontWeight="bold"
                          color="subdued"
                        >
                          {device.label}
                        </Text>
                      </InlineStack>
                      <Text variant="bodyMd" fontWeight="bold">
                        {device.value}%
                      </Text>
                    </InlineStack>
                    <div style={{ marginTop: 8 }}>
                      <ProgressBar
                        progress={device.value}
                        size="small"
                        tone="primary"
                      />
                    </div>
                  </div>
                ))}
              </BlockStack>

              <div
                className="vto-donut-container"
                style={{ marginTop: "16px" }}
              >
                <svg width="160" height="160" viewBox="0 0 160 160">
                  <circle
                    cx="80"
                    cy="80"
                    r="65"
                    fill="none"
                    stroke="#F1F5F9"
                    strokeWidth="16"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r="65"
                    fill="none"
                    stroke="#3B5BDB"
                    strokeWidth="16"
                    strokeDasharray={`${(deviceSplit.mobile / 100) * 408} 408`}
                    strokeDashoffset="0"
                    transform="rotate(-90 80 80)"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r="65"
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="16"
                    strokeDasharray={`${(deviceSplit.desktop / 100) * 408} 408`}
                    strokeDashoffset={`-${(deviceSplit.mobile / 100) * 408}`}
                    transform="rotate(-90 80 80)"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="vto-donut-center">
                  <p
                    style={{
                      fontSize: "20px",
                      fontWeight: "800",
                      color: "var(--vto-text-main)",
                      marginBottom: 0,
                    }}
                  >
                    {deviceSplit.mobile || 0}%
                  </p>
                  <p
                    style={{
                      fontSize: "11px",
                      color: "var(--vto-text-sub)",
                      fontWeight: "500",
                    }}
                  >
                    Mobile
                  </p>
                </div>
              </div>
            </BlockStack>
          </div>
        </div>

        <BlockStack gap="400">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <BlockStack gap="100">
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: "800",
                  color: "var(--vto-text-main)",
                }}
              >
                Top Performing Fits
              </h2>
              <p style={{ color: "var(--vto-text-sub)", fontSize: "12px" }}>
                Products with highest Try-to-Cart conversion
              </p>
            </BlockStack>
            <Button variant="plain" icon={ArrowRightIcon} iconPosition="right">
              View all products
            </Button>
          </div>

          <div className="vto-grid-3col">
            {topProducts.length > 0 ? (
              topProducts.slice(0, 3).map((product, idx) => {
                const tryons = Number(product.tryon_count || 0);
                const orders = Number(product.buy_count || 0);
                const conv =
                  tryons > 0 ? ((orders / tryons) * 100).toFixed(0) : 0;
                return (
                  <ProductFitCard
                    key={product.id || idx}
                    title={product.title}
                    price={product.price || "0"}
                    currencyCode={currencyCode}
                    tries={
                      tryons > 1000 ? `${(tryons / 1000).toFixed(1)}k` : tryons
                    }
                    conversion={`${conv}% CV`}
                    badge={
                      idx === 0
                        ? "BEST SELLER"
                        : idx === 1
                          ? "HIGH CONVERSION"
                          : "TRENDING"
                    }
                    badgeBg={
                      idx === 0 ? "#3B5BDB" : idx === 1 ? "#10B981" : "#8B5CF6"
                    }
                    image={product.image}
                  />
                );
              })
            ) : (
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "48px 24px",
                  background: "var(--vto-card-bg, #fff)",
                  borderRadius: "16px",
                  border: "1px dashed #E4E5E7",
                  color: "var(--vto-text-sub)",
                }}
              >
                <div style={{ fontSize: "40px", marginBottom: "12px" }}>👗</div>
                <Text variant="headingMd" as="p" fontWeight="bold">
                  No try-on data yet
                </Text>
                <Text variant="bodyMd" color="subdued">
                  Product data will appear here once customers complete try-ons
                  in the selected period.
                </Text>
              </div>
            )}
          </div>
        </BlockStack>
      </BlockStack>
    </div>
    </PlanGate>
  );
}
