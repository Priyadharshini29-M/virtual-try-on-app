// Wallet credits page (replaced the old /app/plans). Shows the merchant's
// credit balance, available top-up packs, and the recent transaction ledger.
// Payment runs through Razorpay Checkout — the action creates an order
// server-side, and the frontend opens Checkout, then calls /wallet/verify
// so the balance updates immediately (the webhook is the authoritative
// capture; verify is the fast-path for the UI).

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Form,
  useLoaderData,
  useNavigation,
  useActionData,
  useRouteError,
  useFetcher,
} from "react-router";

import { useCelebrate } from "../components/AppShell";
import { FsPage, FsCard, FsPill, FsIcon } from "../components/fs-ui";
import { TOURS } from "../lib/tours";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";

const RAZORPAY_CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  const url = new URL(request.url);
  const topupSuccess = url.searchParams.get("topup") === "1";

  const walletRes = await api.getWallet();
  const data = walletRes.ok ? walletRes.data : null;

  return {
    balance: Number(data?.balance ?? 0),
    used: Number(data?.used ?? 0),
    packs: Array.isArray(data?.packs) ? data.packs : [],
    recent: Array.isArray(data?.recent) ? data.recent : [],
    topupSuccess,
  };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "topup") {
    const packId = String(formData.get("pack_id") ?? "");
    if (!packId) return { error: "Please choose a credit pack." };
    const res = await api.walletTopup(packId);
    if (!res.ok) return { error: res.error ?? "Could not start payment." };
    return { order: res.data };
  }

  if (intent === "verify") {
    const payload = {
      order_id: String(formData.get("order_id") ?? ""),
      payment_id: String(formData.get("payment_id") ?? ""),
      signature: String(formData.get("signature") ?? ""),
    };
    const res = await api.walletVerify(payload);
    if (!res.ok) return { error: res.error ?? "Could not verify payment." };
    return { captured: res.data };
  }

  return { error: "Unknown action" };
}

// ─── Pack card ────────────────────────────────────────────────────────────────

function PackCard({ pack, isSubmitting, onBuy }) {
  const pricePerCredit = (pack.amount_minor / pack.credits) / 100;
  const money = (minor, cur) =>
    (minor / 100).toLocaleString(undefined, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    });

  return (
    <div className={`fs-card fs-plan${pack.popular ? " is-featured" : ""}`}>
      <div className="fs-plan-top">
        <span className="fs-plan-name">{pack.label}</span>
        {pack.popular ? (
          <FsPill tone="primary">Most popular</FsPill>
        ) : null}
      </div>
      <div className="fs-plan-price">
        <span className="fs-tabular">{pack.credits.toLocaleString()}</span>
        <small>credits</small>
      </div>
      <p className="fs-plan-desc">
        {money(pack.amount_minor, pack.currency)} · {pack.currency}{" "}
        {pricePerCredit.toFixed(2)} / credit
      </p>
      <div className="fs-plan-meta">
        <span>
          <FsIcon name="bolt" size={14} />
          {pack.credits.toLocaleString()} try-ons or AI generations
        </span>
      </div>
      <button
        type="button"
        className={`fs-btn fs-btn--${pack.popular ? "primary" : "dark"}`}
        style={{ width: "100%", height: 42 }}
        disabled={isSubmitting}
        onClick={() => onBuy(pack.id)}
      >
        {isSubmitting ? "Processing…" : `Buy ${pack.label}`}
      </button>
      <p className="fs-plan-trial">Credits never expire</p>
    </div>
  );
}

PackCard.propTypes = {
  pack: PropTypes.object.isRequired,
  isSubmitting: PropTypes.bool,
  onBuy: PropTypes.func.isRequired,
};

// ─── Transactions table ───────────────────────────────────────────────────────

const REASON_LABEL = {
  tryon: "Try-on",
  studio: "AI Studio",
  infographic: "Infographic",
  purchase: "Top-up",
  welcome_bonus: "Welcome bonus",
  refund: "Refund",
  admin_grant: "Admin grant",
  admin_debit: "Admin adjustment",
  release: "Refund (failed job)",
};

function TransactionsCard({ recent }) {
  if (!recent.length) {
    return (
      <FsCard title="Recent activity" subtitle="Your credit history will show up here as soon as you start using try-on.">
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--fs-muted)" }}>
          <FsIcon name="clock" size={24} />
          <p style={{ marginTop: 8 }}>No activity yet.</p>
        </div>
      </FsCard>
    );
  }

  return (
    <FsCard title="Recent activity" subtitle="Latest 20 wallet movements.">
      <div className="fs-table">
        <div className="fs-tr fs-tr--head">
          <span>When</span>
          <span>Reason</span>
          <span style={{ textAlign: "right" }}>Change</span>
          <span style={{ textAlign: "right" }}>Balance</span>
        </div>
        {recent.map((t) => {
          const dt = new Date((t.created_at ?? "").replace(" ", "T") + "Z");
          const when = isNaN(dt.getTime())
            ? t.created_at
            : dt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          const delta = Number(t.delta ?? 0);
          const positive = delta >= 0;
          return (
            <div key={t.id} className="fs-tr">
              <span>{when}</span>
              <span>{REASON_LABEL[t.reason] ?? t.reason}</span>
              <span className="fs-tabular" style={{ textAlign: "right", color: positive ? "var(--fs-success-ink)" : "var(--fs-ink)" }}>
                {positive ? "+" : ""}{delta.toLocaleString()}
              </span>
              <span className="fs-tabular" style={{ textAlign: "right" }}>{Number(t.balance_after).toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </FsCard>
  );
}

TransactionsCard.propTypes = { recent: PropTypes.array };

// ─── Checkout script loader ───────────────────────────────────────────────────

function useRazorpay() {
  const [ready, setReady] = useState(() =>
    typeof window !== "undefined" && typeof window.Razorpay === "function",
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.Razorpay === "function") { setReady(true); return; }
    const existing = document.querySelector(`script[src="${RAZORPAY_CHECKOUT_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => setReady(true), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = RAZORPAY_CHECKOUT_SCRIPT;
    s.async = true;
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, []);
  return ready;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Wallet() {
  const { balance, used, packs, recent, topupSuccess } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const verifyFetcher = useFetcher();
  const celebrate = useCelebrate();
  const razorpayReady = useRazorpay();
  const isSubmitting = navigation.state === "submitting";
  const [pendingPack, setPendingPack] = useState(null);

  // Celebrate when a payment finishes verifying.
  useEffect(() => {
    if (verifyFetcher.data?.captured) {
      celebrate({
        title: "Credits added",
        body: `${verifyFetcher.data.captured.credits.toLocaleString()} credits are now in your wallet.`,
      });
    }
  }, [verifyFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (topupSuccess) celebrate({ title: "Payment received", body: "Credits are now in your wallet." });
  }, [topupSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the server returns an order payload, open Razorpay Checkout.
  useEffect(() => {
    const order = actionData?.order;
    if (!order || !razorpayReady || typeof window === "undefined") return;

    const options = {
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      order_id: order.order_id,
      name: "Brix-TryOn credits",
      description: `${order.credits} credits`,
      notes: order.notes ?? {},
      prefill: {},
      theme: { color: "#111827" },
      handler: (resp) => {
        const fd = new FormData();
        fd.set("intent", "verify");
        fd.set("order_id", resp.razorpay_order_id);
        fd.set("payment_id", resp.razorpay_payment_id);
        fd.set("signature", resp.razorpay_signature);
        verifyFetcher.submit(fd, { method: "POST" });
      },
      modal: {
        ondismiss: () => setPendingPack(null),
      },
    };
    try {
      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      console.error("[wallet] razorpay open failed", err);
    }
  }, [actionData?.order, razorpayReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const popularPack = useMemo(
    () => packs.find((p) => p.popular) ?? packs[0],
    [packs],
  );

  const buyPack = (packId) => {
    setPendingPack(packId);
    const fd = new FormData();
    fd.set("intent", "topup");
    fd.set("pack_id", packId);
    const form = document.getElementById("wallet-topup-form");
    for (const el of form.querySelectorAll("input[name=pack_id],input[name=intent]")) el.remove();
    const i1 = document.createElement("input"); i1.type = "hidden"; i1.name = "intent";  i1.value = "topup";  form.appendChild(i1);
    const i2 = document.createElement("input"); i2.type = "hidden"; i2.name = "pack_id"; i2.value = packId; form.appendChild(i2);
    form.requestSubmit();
  };

  return (
    <FsPage tour={TOURS.plans}>
      {actionData?.error && (
        <div className="fs-banner fs-banner--critical" role="alert">
          <FsIcon name="info" size={18} />
          <span>{actionData.error}</span>
        </div>
      )}
      {verifyFetcher.data?.error && (
        <div className="fs-banner fs-banner--critical" role="alert">
          <FsIcon name="info" size={18} />
          <span>{verifyFetcher.data.error}</span>
        </div>
      )}
      {!razorpayReady && (
        <div className="fs-banner fs-banner--info">
          <FsIcon name="info" size={18} />
          <span>Loading secure payment widget…</span>
        </div>
      )}

      {/* Balance header */}
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "8px 0" }}>
        <FsPill tone="primary">Wallet</FsPill>
        <h2 className="fs-h1">Credits power every try-on</h2>
        <p className="fs-sub" style={{ margin: 0, maxWidth: 560 }}>
          1 credit = 1 try-on or AI generation. Pay as you go — no monthly commitments, no feature limits.
        </p>
      </div>

      <FsCard>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--fs-muted)" }}>Current balance</div>
            <div className="fs-tabular" style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>
              {balance.toLocaleString()}
            </div>
            <div style={{ fontSize: 13, color: "var(--fs-muted)", marginTop: 4 }}>
              {used.toLocaleString()} credits used lifetime
            </div>
          </div>
          {popularPack && (
            <button
              type="button"
              className="fs-btn fs-btn--primary"
              disabled={isSubmitting || !razorpayReady}
              style={{ height: 44, padding: "0 24px" }}
              onClick={() => buyPack(popularPack.id)}
            >
              {isSubmitting && pendingPack === popularPack.id ? "Opening payment…" : `Top up ${popularPack.credits.toLocaleString()} credits`}
            </button>
          )}
        </div>
      </FsCard>

      {/* Hidden form used by buyPack() to post the intent/pack_id */}
      <Form id="wallet-topup-form" method="post" style={{ display: "none" }} />

      <h3 className="fs-h2">Credit packs</h3>
      <div className="fs-plan-grid">
        {packs.map((p) => (
          <PackCard
            key={p.id}
            pack={p}
            isSubmitting={isSubmitting && pendingPack === p.id}
            onBuy={buyPack}
          />
        ))}
      </div>

      <TransactionsCard recent={recent} />
    </FsPage>
  );
}

// ─── Error boundary ───────────────────────────────────────────────────────────

export function ErrorBoundary() {
  const error = useRouteError();

  const message =
    error?.message ??
    error?.data ??
    (typeof error === "string" ? error : null) ??
    "An unexpected error occurred.";

  const stack = typeof error?.stack === "string" ? error.stack : null;

  return (
    <FsPage>
      <FsCard title="We couldn't load your wallet" subtitle="Refresh the page to try again. If it keeps happening, send the details below to support.">
        <pre className="fs-error-pre">{message}</pre>
        {stack && (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--fs-muted)" }}>Technical details</summary>
            <pre className="fs-error-pre" style={{ marginTop: 8 }}>{stack}</pre>
          </details>
        )}
      </FsCard>
    </FsPage>
  );
}
