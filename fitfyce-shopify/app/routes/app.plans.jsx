import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Icon,
  List,
  Divider,
  Box,
  Banner,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";

const PLAN_KEY_MAP = {
  pro: "TryFit Pro",
  premium: "TryFit Premium",
};

export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");

  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");
  const pendingPlan = url.searchParams.get("plan");

  // Return from Shopify billing confirmation page
  if (chargeId && pendingPlan && PLAN_KEY_MAP[pendingPlan]) {
    const gqlRes = await admin.graphql(`
      #graphql
      query {
        currentAppInstallation {
          activeSubscriptions {
            name
            status
          }
        }
      }
    `);
    const gqlData = await gqlRes.json();
    const activeSubs =
      gqlData.data?.currentAppInstallation?.activeSubscriptions ?? [];

    const isActive = activeSubs.some(
      (s) => s.name === PLAN_KEY_MAP[pendingPlan] && s.status === "ACTIVE"
    );

    if (isActive) {
      await api.updatePlan(pendingPlan);
    }

    throw redirect("/app/plans");
  }

  const [plansRes, currentPlanRes] = await Promise.all([
    api.getPlans(),
    api.checkPlanLimit(),
  ]);

  return {
    plans: plansRes.ok ? plansRes.data.plans : [],
    currentPlan: currentPlanRes.ok ? currentPlanRes.data?.plan || "basic" : "basic",
  };
}

export async function action({ request }) {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const planName = formData.get("plan");

  const planKey = PLAN_KEY_MAP[planName];
  if (!planKey) {
    return { error: "Invalid plan selected" };
  }

  const appUrl = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "");

  await billing.request({
    plan: planKey,
    isTest: process.env.NODE_ENV !== "production",
    returnUrl: `${appUrl}/app/plans?plan=${planName}`,
  });

  return null;
}

const PLAN_FEATURES = {
  basic: [
    "100 Monthly Try-ons",
    "1 Active Product",
    "Standard Support",
    "TryFit Branding",
  ],
  pro: [
    "2,000 Monthly Try-ons",
    "Unlimited Products",
    "Remove TryFit Branding",
    "Advanced Analytics",
    "Priority Email Support",
  ],
  premium: [
    "10,000 Monthly Try-ons",
    "Custom API Access",
    "Whitelabel Support",
    "Dedicated Account Manager",
    "Advanced 3D Mapping",
  ],
};

function PlanCard({ plan, isCurrent, isSubmitting }) {
  const isPremium = plan.plan === "premium";
  const planFeatures = PLAN_FEATURES[plan.plan] || [];

  return (
    <Card roundedAbove="sm">
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingLg">
            {plan.plan.toUpperCase()}
          </Text>
          {isCurrent && <Badge tone="success">Current Plan</Badge>}
        </InlineStack>

        <InlineStack align="start" blockAlign="baseline" gap="100">
          <Text as="span" variant="heading2xl">
            ₹{Number(plan.price_inr_monthly).toLocaleString()}
          </Text>
          <Text as="span" variant="bodyMd" tone="subdued">
            / month
          </Text>
        </InlineStack>

        <Divider />

        <Box minHeight="200px">
          <List type="bullet">
            {planFeatures.map((feature, i) => (
              <List.Item key={i}>
                <InlineStack gap="200">
                  <Icon source={CheckIcon} tone="success" />
                  <Text as="span" variant="bodyMd">
                    {feature}
                  </Text>
                </InlineStack>
              </List.Item>
            ))}
          </List>
        </Box>

        {isCurrent ? (
          <Button disabled fullWidth>
            Active
          </Button>
        ) : isPremium ? (
          <Button
            fullWidth
            onClick={() => window.open("mailto:support@digifyce.com")}
          >
            Contact Sales
          </Button>
        ) : (
          <Form method="post">
            <input type="hidden" name="plan" value={plan.plan} />
            <Button
              variant="primary"
              submit
              fullWidth
              loading={isSubmitting}
            >
              Upgrade to {plan.plan.charAt(0).toUpperCase() + plan.plan.slice(1)}
            </Button>
          </Form>
        )}
      </BlockStack>
    </Card>
  );
}

export default function Plans() {
  const { plans, currentPlan } = useLoaderData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <Page
      title="Plans & Pricing"
      backAction={{ content: "Dashboard", url: "/app" }}
      subtitle="Choose the perfect plan for your store's size and needs."
    >
      <Layout>
        {currentPlan === "basic" && (
          <Layout.Section>
            <Banner tone="info" title="You're on the free Basic plan">
              Upgrade to Pro or Premium to unlock more try-ons and remove
              TryFit branding.
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "20px",
            }}
          >
            {plans.map((plan) => (
              <PlanCard
                key={plan.plan}
                plan={plan}
                isCurrent={currentPlan === plan.plan}
                isSubmitting={isSubmitting}
              />
            ))}
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Need more?
              </Text>
              <Text as="p">
                If you have a high-volume store with over 50,000 monthly
                sessions, contact us for a custom Enterprise plan tailored to
                your scale.
              </Text>
              <Button
                plain
                onClick={() => window.open("mailto:support@digifyce.com")}
              >
                Contact Support
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
