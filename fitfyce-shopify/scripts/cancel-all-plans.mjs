// Hard-cutover migration: cancel every active Shopify subscription so no
// merchant keeps getting billed under the retired plans model. The wallet
// migration (fitfyce-php/database/migrations/015_wallet_credits.sql) seeds a
// 25-credit welcome bonus for every existing merchant, so they can keep
// working while they decide to top up.
//
// Run once, after deploying the non-embedded + wallet build:
//   node scripts/cancel-all-plans.mjs
//
// Needs these env vars (Fly or local .env):
//   SHOPIFY_API_KEY, SHOPIFY_API_SECRET  — to call Shopify admin APIs
//   DATABASE_URL (or dev.sqlite present) — to list installed shops
//   NODE_ENV                             — 'test' for test subscriptions
//
// Safe to re-run: Shopify's subscription cancel for an already-cancelled
// subscription is a no-op, and the wallet migration's INSERT uses a NOT
// EXISTS guard.

import { PrismaClient } from "@prisma/client";
import "@shopify/shopify-app-react-router/adapters/node";
import {
  shopifyApp,
  ApiVersion,
  AppDistribution,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

const PLAN_NAMES = [
  "Brix-TryOn Growth",
  "Brix-TryOn Pro",
  "FitSnap Growth",
  "FitSnap Pro",
];

const prisma = new PrismaClient();

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET ?? "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(",") ?? [],
  appUrl: process.env.SHOPIFY_APP_URL ?? "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  isEmbeddedApp: false,
  future: {},
});

const ACTIVE_SUBS_QUERY = `#graphql
  query ActiveSubs {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

const CANCEL_MUTATION = `#graphql
  mutation CancelSub($id: ID!, $prorate: Boolean) {
    appSubscriptionCancel(id: $id, prorate: $prorate) {
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

async function cancelForShop(shop) {
  try {
    const { admin } = await shopify.unauthenticated.admin(shop);
    const res = await admin.graphql(ACTIVE_SUBS_QUERY);
    const json = await res.json();
    const subs = json?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const toCancel = subs.filter(
      (s) => PLAN_NAMES.includes(s.name) && s.status === "ACTIVE",
    );
    if (toCancel.length === 0) return { shop, cancelled: 0 };

    let cancelled = 0;
    for (const sub of toCancel) {
      const cRes = await admin.graphql(CANCEL_MUTATION, {
        variables: { id: sub.id, prorate: true },
      });
      const cJson = await cRes.json();
      const errs = cJson?.data?.appSubscriptionCancel?.userErrors ?? [];
      if (errs.length) {
        console.warn(`[${shop}] cancel userErrors for ${sub.id}:`, errs);
      } else {
        cancelled += 1;
      }
    }
    return { shop, cancelled };
  } catch (err) {
    return { shop, error: err?.message ?? String(err) };
  }
}

async function main() {
  // Distinct installed shops: one session per shop is enough.
  const sessions = await prisma.session.findMany({
    distinct: ["shop"],
    select: { shop: true },
  });
  console.log(`Found ${sessions.length} shops. Cancelling plan subscriptions…`);

  let totalCancelled = 0;
  let errorCount = 0;
  for (const { shop } of sessions) {
    const r = await cancelForShop(shop);
    if (r.error) {
      console.error(`[${shop}] ERROR: ${r.error}`);
      errorCount += 1;
    } else {
      totalCancelled += r.cancelled;
      console.log(`[${shop}] cancelled: ${r.cancelled}`);
    }
  }
  console.log(
    `Done. Shops: ${sessions.length}, subscriptions cancelled: ${totalCancelled}, errors: ${errorCount}.`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
