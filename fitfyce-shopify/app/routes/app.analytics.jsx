import { useLoaderData, useNavigate } from "react-router";
import * as React from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Select,
  DataTable,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";

function getFromDate(range) {
  const d = new Date();
  if (range === "last7")     { d.setDate(d.getDate() - 6);   }
  if (range === "last30")    { d.setDate(d.getDate() - 29);  }
  if (range === "thisMonth") { d.setDate(1);                 }
  if (range === "lastMonth") { d.setMonth(d.getMonth() - 1); d.setDate(1); }
  return d.toISOString().split("T")[0];
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);

  const url   = new URL(request.url);
  const range = url.searchParams.get("range") || "last30";
  const to    = new Date().toISOString().split("T")[0];
  const from  = getFromDate(range);

  const api    = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");
  const result = await api.getAnalytics({ from, to });

  return {
    analytics: result.ok ? result.data : null,
    range,
    shop: session.shop,
  };
}

function KpiCard({ label, value }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text variant="bodySm" tone="subdued" as="p">{label}</Text>
        <Text variant="headingLg" fontWeight="bold" as="p">{value}</Text>
      </BlockStack>
    </Card>
  );
}

function convBadge(rate) {
  const n = Number(rate) || 0;
  if (n >= 10) return <Badge tone="success">Good</Badge>;
  if (n >= 5)  return <Badge tone="warning">Low</Badge>;
  return <Badge tone="critical">Poor</Badge>;
}

export default function Analytics() {
  const { analytics, range } = useLoaderData();
  const navigate = useNavigate();

  const [selectedRange, setSelectedRange] = React.useState(range);

  const rangeOptions = [
    { label: "Last 7 days",   value: "last7"     },
    { label: "Last 30 days",  value: "last30"    },
    { label: "This month",    value: "thisMonth" },
    { label: "Last month",    value: "lastMonth" },
  ];

  const kpis        = analytics?.summary     || {};
  const topProducts = analytics?.top_products || [];

  const initiated   = kpis.tryon_initiated   || 0;
  const cartCount   = kpis.add_to_cart_count || 0;
  const orderCount  = kpis.order_count       || 0;
  const revenueInr  = Number(kpis.revenue_inr || 0).toFixed(0);
  const cartRate    = initiated > 0 ? Math.round((cartCount  / initiated) * 100) : 0;
  const purchRate   = initiated > 0 ? Math.round((orderCount / initiated) * 100) : 0;

  const tableRows = topProducts.map((p) => {
    const tryons  = Number(p.tryon_count || 0);
    const carts   = Number(p.cart_count  || 0);
    const orders  = Number(p.buy_count   || 0);
    const cRate   = tryons > 0 ? Math.round((carts  / tryons) * 100) : 0;
    const convRate = tryons > 0 ? Math.round((orders / tryons) * 100) : 0;
    return [p.title, tryons, `${cRate}%`, `${convRate}%`, convBadge(convRate)];
  });

  return (
    <Page title="Analytics" subtitle="Virtual try-on performance">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">

            <Select
              label="Date range"
              options={rangeOptions}
              value={selectedRange}
              onChange={(v) => {
                setSelectedRange(v);
                navigate(`?range=${v}`);
              }}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: "12px",
              }}
            >
              <KpiCard label="Try-ons initiated" value={Number(initiated).toLocaleString()} />
              <KpiCard label="Cart rate"          value={`${cartRate}%`} />
              <KpiCard label="Purchase rate"      value={`${purchRate}%`} />
              <KpiCard label="Revenue (INR)"      value={`₹${Number(revenueInr).toLocaleString()}`} />
            </div>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Action breakdown</Text>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                    gap: "12px",
                  }}
                >
                  {[
                    { label: "Add to cart",        value: kpis.add_to_cart_count || 0 },
                    { label: "Save image",          value: kpis.save_count        || 0 },
                    { label: "Share WhatsApp",      value: kpis.share_wa_count    || 0 },
                    { label: "Orders attributed",   value: kpis.order_count       || 0 },
                  ].map(({ label, value }) => (
                    <BlockStack gap="100" key={label}>
                      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                      <Text as="p" variant="headingMd">{Number(value).toLocaleString()}</Text>
                    </BlockStack>
                  ))}
                </div>
              </BlockStack>
            </Card>

            {tableRows.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Top products</Text>
                  <DataTable
                    columnContentTypes={["text", "numeric", "text", "text", "text"]}
                    headings={["Product", "Try-ons", "Cart rate", "Conv. rate", "Status"]}
                    rows={tableRows}
                  />
                </BlockStack>
              </Card>
            )}

          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
