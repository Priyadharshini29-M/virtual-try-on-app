import { useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  BlockStack,
  InlineStack,
  ProgressBar,
  Badge,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);

  const api = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");

  const today = new Date().toISOString().split("T")[0];
  const from30 = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const [analyticsRes, planRes] = await Promise.allSettled([
    api.getAnalytics({ from: from30, to: today }),
    api.checkPlanLimit(),
  ]);

  const analytics =
    analyticsRes.status === "fulfilled" && analyticsRes.value.ok
      ? analyticsRes.value.data
      : null;

  const plan =
    planRes.status === "fulfilled" && planRes.value.ok
      ? planRes.value.data
      : null;

  return { analytics, plan, shop: session.shop };
}

function SimpleBarChart({ data }) {
  if (!data || data.length === 0) {
    return <Text as="p" tone="subdued">No data available</Text>;
  }
  const maxVal = Math.max(...data.map((d) => d.tryon_initiated || 0), 1);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "6px",
        height: "100px",
        padding: "8px 0",
      }}
    >
      {data.map((row, i) => {
        const val = row.tryon_initiated || 0;
        const h   = Math.round((val / maxVal) * 100);
        return (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Text as="span" variant="bodySm" tone="subdued">{val}</Text>
            <div
              style={{
                width: "100%",
                height: `${h}%`,
                minHeight: val > 0 ? "3px" : "0",
                background: "#1B3A6B",
                borderRadius: "2px 2px 0 0",
              }}
            />
            <Text as="span" variant="bodySm" tone="subdued">
              {row.date ? row.date.slice(5) : ""}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

export default function Index() {
  const { analytics, plan, shop } = useLoaderData();
  const navigate = useNavigate();

  const summary   = analytics?.summary ?? {};
  const daily     = analytics?.daily   ?? [];
  const last7     = daily.slice(-7);

  const initiated  = summary.tryon_initiated   || 0;
  const cartCount  = summary.add_to_cart_count || 0;
  const orderCount = summary.order_count       || 0;
  const cartRate   = initiated > 0 ? Math.round((cartCount  / initiated) * 100) : 0;
  const purchRate  = initiated > 0 ? Math.round((orderCount / initiated) * 100) : 0;

  const planUsed    = plan?.used         ?? 0;
  const planLimit   = plan?.limit        ?? 0;
  const isUnlimited = plan?.is_unlimited ?? false;
  const usagePct    = !isUnlimited && planLimit > 0
    ? Math.min(100, Math.round((planUsed / planLimit) * 100))
    : 0;
  const nearLimit = usagePct >= 80;

  return (
    <Page title="TryFit Dashboard" subtitle={shop}>
      <Layout>

        {nearLimit && !isUnlimited && (
          <Layout.Section>
            <Banner tone="warning" title="Approaching plan limit">
              You&apos;ve used {usagePct}% of your monthly try-on quota.
              Consider upgrading.
            </Banner>
          </Layout.Section>
        )}

        {/* KPI cards */}
        <Layout.Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: "12px",
            }}
          >
            <Card>
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm" tone="subdued">Try-ons this month</Text>
                <Text as="p" variant="headingXl">{Number(initiated).toLocaleString()}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm" tone="subdued">Cart rate</Text>
                <Text as="p" variant="headingXl">{cartRate}%</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm" tone="subdued">Purchase rate</Text>
                <Text as="p" variant="headingXl">{purchRate}%</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm" tone="subdued">Plan usage</Text>
                <Text as="p" variant="headingXl">
                  {isUnlimited ? "Unlimited" : `${planUsed} / ${planLimit}`}
                </Text>
                {!isUnlimited && planLimit > 0 && (
                  <ProgressBar
                    progress={usagePct}
                    tone={nearLimit ? "critical" : "primary"}
                    size="small"
                  />
                )}
                {plan && (
                  <Badge tone={nearLimit ? "critical" : "info"}>
                    {(plan.plan || "basic").toUpperCase()}
                  </Badge>
                )}
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* 7-day bar chart */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Try-ons — last 7 days</Text>
              <SimpleBarChart data={last7} />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Quick actions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Quick actions</Text>
              <InlineStack gap="300" wrap>
                <Button onClick={() => navigate("/app/products")}>Manage Products</Button>
                <Button onClick={() => navigate("/app/settings")}>Widget Settings</Button>
                <Button onClick={() => navigate("/app/analytics")}>View Analytics</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Upgrade CTA */}
        {nearLimit && !isUnlimited && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Upgrade your plan</Text>
                <Text as="p">
                  You&apos;re at {usagePct}% of your monthly quota. Upgrade to keep
                  try-ons running without interruption.
                </Text>
                <Button onClick={() => navigate("/app/plans")} variant="primary">
                  Upgrade Now
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

      </Layout>
    </Page>
  );
}
