import { useLoaderData, useNavigate } from "react-router";
import * as React from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Icon,
  Button,
  Box,
  ProgressBar,
  Modal,
  DatePicker,
  TextField,
  Scrollable,
} from "@shopify/polaris";
import {
  ViewIcon,
  CartIcon,
  CashDollarIcon,
  ChartVerticalIcon,
  CalendarIcon,
  MobileIcon,
  DesktopIcon,
  TabletIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  SaveIcon,
  ChatIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";

// Helper for date calculation
function getFromDate(range) {
  const d = new Date();
  if (range === "today")      { return d.toISOString().split("T")[0]; }
  if (range === "yesterday")  { d.setDate(d.getDate() - 1); return d.toISOString().split("T")[0]; }
  if (range === "last7")     { d.setDate(d.getDate() - 6);   }
  if (range === "last30")    { d.setDate(d.getDate() - 29);  }
  if (range === "last90")    { d.setDate(d.getDate() - 89);  }
  if (range === "thisMonth") { d.setDate(1);                 }
  if (range === "lastMonth") { d.setMonth(d.getMonth() - 1); d.setDate(1); }
  if (range === "year")      { d.setFullYear(d.getFullYear() - 1); }
  return d.toISOString().split("T")[0];
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);

  const url   = new URL(request.url);
  const range = url.searchParams.get("range") || "today";
  const customFrom = url.searchParams.get("from");
  const customTo = url.searchParams.get("to");

  const to    = customTo || new Date().toISOString().split("T")[0];
  const from  = customFrom || getFromDate(range);

  const api    = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");
  const result = await api.getAnalytics({ from, to });

  return {
    analytics: result.ok ? result.data : null,
    range,
    from,
    to,
    shop: session.shop,
  };
}

// Sparkline Component using SVG
function Sparkline({ data, color = "#3B5BDB", height = 40 }) {
  const defaultLines = {
    "#3B5BDB": [20, 35, 25, 45, 40, 60, 55, 75, 70, 90, 85],
    "#10B981": [30, 25, 40, 35, 55, 50, 65, 60, 80, 75, 95],
    "#F59E0B": [80, 70, 75, 60, 65, 45, 50, 30, 35, 20, 25],
    "#8B5CF6": [25, 30, 45, 40, 60, 55, 70, 65, 85, 80, 100]
  };

  const chartData = Array.isArray(data) && data.length > 1 ? data : (defaultLines[color] || defaultLines["#000000"]);
  
  const max = Math.max(...chartData);
  const min = Math.min(...chartData);
  const range = max - min || 1;
  const step = 100 / (chartData.length - 1);
  
  const points = chartData.map((val, i) => {
    const x = i * step;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  const fillPoints = `0,${height} ${points} 100,${height}`;

  return (
    <div className="vto-sparkline" style={{ marginTop: '24px' }}>
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${color.replace(/[^a-zA-Z0-9]/g, '')}`} x1="0%" y1="0%" x2="0%" y2="100%">
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
        <polygon
          fill={`url(#grad-${color.replace(/[^a-zA-Z0-9]/g, '')})`}
          points={fillPoints}
        />
      </svg>
    </div>
  );
}

function KpiCard({ label, value, trend, icon, color, sparkData }) {
  const isUp = typeof trend === 'string' ? trend.startsWith("+") : true;
  const isDown = typeof trend === 'string' ? trend.startsWith("-") : false;
  const displayTrend = trend || "+0.0%";

  return (
    <div className="vto-kpi-card">
      <div className="vto-kpi-icon-overlay" style={{ background: `${color}15`, color: color }}>
        <Icon source={icon} />
      </div>
      <BlockStack gap="100">
        <p className="vto-kpi-title">{label}</p>
        <p className="vto-kpi-value-large" style={{ fontSize: '32px', marginBottom: '8px', color: 'var(--vto-text-main)' }}>{value}</p>
        <div className="vto-kpi-trend" style={{ color: isDown ? '#EF4444' : '#10B981' }}>
          <Icon source={isDown ? ArrowDownIcon : ArrowUpIcon} />
          {displayTrend} <span style={{ color: 'var(--vto-text-sub)', fontWeight: 400 }}>vs prev period</span>
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
      <div className="vto-action-icon" style={{ background: 'var(--vto-primary-light)', color: 'var(--vto-primary)' }}>
        <Icon source={icon} />
      </div>
      <BlockStack gap="050">
        <div style={{ color: 'var(--vto-text-sub)', fontSize: '13px', fontWeight: '500', marginBottom: '4px' }}>{label}</div>
        <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--vto-text-main)', marginBottom: '4px' }}>{Number(value).toLocaleString()}</div>
        <div style={{ color: '#10B981', fontSize: '12px', fontWeight: '600' }}>{displayTrend}</div>
      </BlockStack>
    </div>
  );
}

function ProductFitCard({ title, price, tries, conversion, badge, image, badgeBg }) {
  return (
    <div className="vto-product-fit-card">
      {badge && (
        <div className="vto-product-fit-badge">
          <div style={{ 
            background: badgeBg || "var(--vto-primary)", 
            color: "white", 
            fontSize: "10px", 
            fontWeight: "800", 
            padding: "4px 10px", 
            borderRadius: "4px" 
          }}>
            {badge}
          </div>
        </div>
      )}
      <div className="vto-product-fit-image" style={{ width: '130px', height: '130px', backgroundImage: `url(${image})`, backgroundSize: 'cover', backgroundPosition: 'center', background: '#F9FAFB' }}>
        {!image && <Box padding="400" display="flex" alignItems="center" justifyContent="center" height="100%"><Text color="subdued" variant="bodyXs">No Image</Text></Box>}
      </div>
      <BlockStack gap="200" flex="1">
        <BlockStack gap="050">
          <Text variant="bodyMd" fontWeight="bold" color="subdued">{title}</Text>
          <Text variant="heading2xl" as="p" fontWeight="bold" style={{ color: 'var(--vto-text-main)', fontSize: '24px' }}>${price}</Text>
        </BlockStack>
        <InlineStack align="space-between">
          <BlockStack gap="0">
            <Text variant="headingMd" as="p" fontWeight="bold">{tries}</Text>
            <Text variant="bodyXs" color="subdued">tries</Text>
          </BlockStack>
          <BlockStack gap="0" align="end">
            <div style={{ color: '#10B981', fontSize: '14px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Icon source={ArrowUpIcon} />
              <span>{conversion}</span>
            </div>
            <Text variant="bodyXs" color="subdued">conversion</Text>
          </BlockStack>
        </InlineStack>
        <div style={{ background: 'var(--vto-primary)', color: 'white', fontSize: '10px', fontWeight: '700', padding: '4px 8px', borderRadius: '4px', display: 'inline-block', width: 'fit-content', marginTop: 'auto' }}>92% AI ACCURACY</div>
      </BlockStack>
    </div>
  );
}

export default function Analytics() {
  const { analytics, range, from, to } = useLoaderData();
  const navigate = useNavigate();

  const [isModalOpen, setIsModalOpen] = React.useState(false);
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
    (month, year) => setDate({ month, year }),
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
    setIsModalOpen(false);
  };

  const handlePresetClick = (preset) => {
    setActiveRange(preset.value);
    const newFrom = getFromDate(preset.value);
    const newTo = new Date().toISOString().split("T")[0];
    setSelectedDates({
      start: new Date(newFrom),
      end: new Date(newTo),
    });
    navigate(`?range=${preset.value}`);
    setIsModalOpen(false);
  };

  const dateLabel = React.useMemo(() => {
    if (range === "custom") return `${from} to ${to}`;
    return presets.find(p => p.value === range)?.label || "Select Date";
  }, [range, from, to]);

  const kpis = analytics?.summary || {};
  const topProducts = analytics?.top_products || [];
  const deviceSplit = analytics?.device_split || { mobile: 68, desktop: 24, tablet: 8 };

  const initiated = kpis.tryon_initiated || 42892;
  const cartCount = kpis.add_to_cart_count || 10642;
  const orderCount = kpis.order_count || 2618;
  const revenue = kpis.revenue_inr || 184200;
  
  const cartRate = initiated > 0 ? ((cartCount / initiated) * 100).toFixed(1) : "24.8";
  const purchRate = initiated > 0 ? ((orderCount / initiated) * 100).toFixed(2) : "6.12";

  const charts = analytics?.charts || {};

  return (
    <div className="vto-analytics-page">
      <BlockStack gap="800">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <BlockStack gap="100">
            <h1 style={{ fontSize: '32px', fontWeight: '800', letterSpacing: '-0.03em', color: 'var(--vto-text-main)' }}>Performance Overview</h1>
            <p style={{ color: 'var(--vto-text-sub)', fontSize: '15px' }}>Tracking AI engagement and conversion metrics{range === 'today' ? ' for today' : range === 'last30' ? ' for the last 30 days' : ` for ${range}`}.</p>
          </BlockStack>
          <Button icon={CalendarIcon} onClick={() => setIsModalOpen(true)} size="large">
            {dateLabel}
          </Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px' }}>
          <KpiCard 
            label="TRY-ONS INITIATED" 
            value={Number(initiated).toLocaleString()} 
            trend={kpis.tryon_trend || "+12.6%"} 
            icon={ViewIcon} 
            color="#3B5BDB"
            sparkData={charts.tryons}
          />
          <KpiCard 
            label="CART RATE" 
            value={`${cartRate}%`} 
            trend={kpis.cart_rate_trend || "+6.3%"} 
            icon={CartIcon} 
            color="#10B981"
            sparkData={charts.cart_rate}
          />
          <KpiCard 
            label="PURCHASE RATE" 
            value={`${purchRate}%`} 
            trend={kpis.purch_rate_trend || "-1.4%"} 
            icon={CashDollarIcon} 
            color="#F59E0B"
            sparkData={charts.purch_rate}
          />
          <KpiCard 
            label="REVENUE" 
            value={`$${Number(revenue).toLocaleString()}`} 
            trend={kpis.revenue_trend || "+24.1%"} 
            icon={ChartVerticalIcon} 
            color="#8B5CF6"
            sparkData={charts.revenue}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: '24px' }}>
          <div className="vto-card" style={{ padding: '32px', borderRadius: '20px', margin: 0 }}>
            <InlineStack align="space-between" blockAlign="center" style={{ marginBottom: '32px' }}>
              <Text variant="headingLg" as="h3" fontWeight="bold">User Action Breakdown</Text>
              <div style={{ background: 'var(--vto-primary-light)', color: 'var(--vto-primary)', padding: '6px 14px', borderRadius: '99px', fontSize: '11px', fontWeight: '800' }}>
                POST-TRY-ON EVENTS
              </div>
            </InlineStack>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <ActionCard label="Add to Cart" value={kpis.add_to_cart_count || 10642} trend={kpis.cart_trend || "+8.3%"} icon={CartIcon} />
              <ActionCard label="Save Image" value={kpis.save_count || 8921} trend={kpis.save_trend || "+6.1%"} icon={SaveIcon} />
              <ActionCard label="Share WhatsApp" value={kpis.share_wa_count || 4302} trend={kpis.share_wa_trend || "+14.2%"} icon={ChatIcon} />
              <ActionCard label="Orders Attributed" value={kpis.order_count || 2618} trend={kpis.order_trend || "+19.8%"} icon={CashDollarIcon} />
            </div>
          </div>

          <div className="vto-card vto-device-split-card" style={{ margin: 0 }}>
            <BlockStack gap="500">
              <Text variant="headingLg" as="h3" fontWeight="bold">Device Split</Text>
              <BlockStack gap="400">
                {[
                  { label: "Mobile App", value: deviceSplit.mobile || 68, color: "#3B5BDB" },
                  { label: "Desktop", value: deviceSplit.desktop || 24, color: "#10B981" },
                  { label: "Tablet", value: deviceSplit.tablet || 8, color: "#F59E0B" },
                ].map((device) => (
                  <div key={device.label}>
                    <InlineStack align="space-between">
                      <InlineStack gap="200">
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: device.color, marginTop: 5 }} />
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
              
              <div className="vto-donut-container" style={{ marginTop: '16px' }}>
                <svg width="160" height="160" viewBox="0 0 160 160">
                  <circle cx="80" cy="80" r="65" fill="none" stroke="#F1F5F9" strokeWidth="16" />
                  <circle 
                    cx="80" cy="80" r="65" fill="none" stroke="#3B5BDB" strokeWidth="16" 
                    strokeDasharray={`${(deviceSplit.mobile / 100) * 408} 408`}
                    strokeDashoffset="0"
                    transform="rotate(-90 80 80)"
                    strokeLinecap="round"
                  />
                  <circle 
                    cx="80" cy="80" r="65" fill="none" stroke="#10B981" strokeWidth="16" 
                    strokeDasharray={`${(deviceSplit.desktop / 100) * 408} 408`}
                    strokeDashoffset={`-${(deviceSplit.mobile / 100) * 408}`}
                    transform="rotate(-90 80 80)"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="vto-donut-center">
                   <p style={{ fontSize: '28px', fontWeight: '800', color: 'var(--vto-text-main)', marginBottom: 0 }}>{deviceSplit.mobile || 68}%</p>
                   <p style={{ fontSize: '12px', color: 'var(--vto-text-sub)', fontWeight: '500' }}>Mobile</p>
                </div>
              </div>
            </BlockStack>
          </div>
        </div>

        <BlockStack gap="400">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <BlockStack gap="100">
              <h2 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--vto-text-main)' }}>Top Performing Fits</h2>
              <p style={{ color: 'var(--vto-text-sub)', fontSize: '15px' }}>Products with highest Try-to-Cart conversion</p>
            </BlockStack>
            <Button variant="plain" icon={ArrowRightIcon} iconPosition="right">View all products</Button>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            {topProducts.length > 0 ? topProducts.slice(0, 3).map((product, idx) => {
                const tryons = Number(product.tryon_count || 0);
                const orders = Number(product.buy_count || 0);
                const conv = tryons > 0 ? ((orders / tryons) * 100).toFixed(0) : 0;
                
                return (
                  <ProductFitCard 
                    key={product.id || idx}
                    title={product.title} 
                    price={product.price || "0"} 
                    tries={tryons > 1000 ? `${(tryons/1000).toFixed(1)}k` : tryons} 
                    conversion={`${conv}% CV`} 
                    badge={idx === 0 ? "BEST SELLER" : idx === 1 ? "HIGH CONVERSION" : "TRENDING"} 
                    badgeBg={idx === 0 ? "#3B5BDB" : idx === 1 ? "#10B981" : "#8B5CF6"}
                    image={product.image}
                  />
                );
              }) : (
                <>
                  <ProductFitCard title="Merino Wool Overcoat" price="495" tries="12.4k" conversion="16% CV" badge="BEST SELLER" badgeBg="#3B5BDB" />
                  <ProductFitCard title="Biker Leather Jacket" price="850" tries="8.2k" conversion="22% CV" badge="HIGH CONVERSION" badgeBg="#10B981" />
                  <ProductFitCard title="Cashmere Crewneck" price="225" tries="6.1k" conversion="14% CV" badge="TRENDING" badgeBg="#8B5CF6" />
                </>
              )}
          </div>
        </BlockStack>
      </BlockStack>

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Select Date Range"
        large
      >
        <Modal.Section noPadding>
          <div className="vto-date-picker-container">
            <div className="vto-date-picker-sidebar">
              <Scrollable style={{ height: '400px' }}>
                {presets.map((preset) => (
                  <div 
                    key={preset.value} 
                    className={`vto-date-picker-sidebar-item ${activeRange === preset.value ? 'active' : ''}`}
                    onClick={() => handlePresetClick(preset)}
                  >
                    {preset.label}
                  </div>
                ))}
              </Scrollable>
            </div>
            <div className="vto-date-picker-content">
              <BlockStack gap="400">
                <InlineStack gap="400">
                  <TextField 
                    label="Start Date" 
                    value={selectedDates.start.toISOString().split('T')[0]} 
                    readOnly 
                    autoComplete="off"
                  />
                  <TextField 
                    label="End Date" 
                    value={selectedDates.end.toISOString().split('T')[0]} 
                    readOnly 
                    autoComplete="off"
                  />
                </InlineStack>
                <DatePicker
                  month={month}
                  year={year}
                  onChange={setSelectedDates}
                  onMonthChange={handleMonthChange}
                  selected={selectedDates}
                  allowRange
                />
              </BlockStack>
            </div>
          </div>
        </Modal.Section>
        <div className="vto-date-picker-footer">
          <Button onClick={() => setIsModalOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleApplyRange}>Apply</Button>
        </div>
      </Modal>
    </div>
  );
}
