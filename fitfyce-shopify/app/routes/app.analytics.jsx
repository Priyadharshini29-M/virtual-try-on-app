import { useCallback, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useLoaderData, useNavigate } from "react-router";
import { DatePicker } from "@shopify/polaris";
import PlanGate from "../components/PlanGate";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";
import { phpPlanToUi, planAtLeast } from "../lib/plans";
import { FsPage, FsCard, FsButton, FsPill, FsSparkline, FsEmpty, FsIcon } from "../components/fs-ui";

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
    return f.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const fStr = f.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const tStr = t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  const range = url.searchParams.get("range") || "last30";
  const customFrom = url.searchParams.get("from");
  const customTo = url.searchParams.get("to");

  const to = customTo || new Date().toISOString().split("T")[0];
  const from = customFrom || getFromDate(range);

  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const [result, currencyRes, planRes, leadsRes] = await Promise.allSettled([
    api.getAnalytics({ from, to }),
    admin.graphql(CURRENCY_QUERY),
    api.checkPlanLimit(),
    api.getLeads(500),
  ]);

  let currencyCode = "USD";
  if (currencyRes.status === "fulfilled") {
    const cj = await currencyRes.value.json().catch(() => null);
    currencyCode = cj?.data?.shop?.currencyCode || "USD";
  }

  const planData = planRes.status === "fulfilled" && planRes.value.ok ? planRes.value.data : null;
  const leads = leadsRes.status === "fulfilled" && leadsRes.value.ok ? leadsRes.value.data?.leads ?? [] : [];

  return {
    analytics: result.status === "fulfilled" && result.value.ok ? result.value.data : null,
    range,
    from,
    to,
    shop: session.shop,
    currencyCode,
    currentPlan: phpPlanToUi(planData?.plan ?? "basic"),
    leads,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 days", value: "last7" },
  { label: "Last 30 days", value: "last30" },
  { label: "Last 90 days", value: "last90" },
  { label: "This month", value: "thisMonth" },
  { label: "Last month", value: "lastMonth" },
  { label: "Last 12 months", value: "year" },
];

const QUICK = [
  { label: "7D", value: "last7" },
  { label: "30D", value: "last30" },
  { label: "90D", value: "last90" },
];

function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const parseDate = (s) => new Date(String(s ?? "").replace(" ", "T"));
const isDown = (t) => typeof t === "string" && t.trim().startsWith("-");

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Kpi({ label, value, delta, note, data }) {
  return (
    <FsCard className="fs-kpi">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="fs-kpi-label">{label}</span>
        {delta && <FsPill tone={isDown(delta) ? "warning" : "success"}>{delta}</FsPill>}
      </div>
      <div className="fs-kpi-value">{value}</div>
      <FsSparkline data={data} width={280} height={44} />
      <div className="fs-kpi-note" style={{ marginTop: 0 }}>{note}</div>
    </FsCard>
  );
}

Kpi.propTypes = { label: PropTypes.string, value: PropTypes.node, delta: PropTypes.string, note: PropTypes.string, data: PropTypes.array };

function Funnel({ kpis }) {
  const tryons = Number(kpis.tryon_initiated) || 0;
  const steps = [
    { label: "Try-ons", val: tryons, of: "Starting point" },
    { label: "Saved image", val: Number(kpis.save_count) || 0, of: "of try-ons" },
    { label: "WhatsApp shares", val: Number(kpis.share_wa_count) || 0, of: "of try-ons" },
    { label: "Add to cart", val: Number(kpis.add_to_cart_count) || 0, of: "of try-ons" },
    { label: "Orders", val: Number(kpis.order_count) || 0, of: "of add to carts", base: Number(kpis.add_to_cart_count) || 0 },
  ];
  // sqrt scale keeps small steps visible next to a large first step
  const max = Math.sqrt(Math.max(tryons, 1));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {steps.map((s, i) => {
        const base = i === 0 ? s.val : (s.base ?? tryons);
        const rate = i === 0 ? "100%" : base > 0 ? `${((s.val / base) * 100).toFixed(1)}%` : "—";
        const w = s.val > 0 ? Math.max(8, (Math.sqrt(s.val) / max) * 100) : 0;
        return (
          <div key={s.label} className="fs-funnel-row">
            <span className="fs-funnel-label">{s.label}</span>
            <div className="fs-funnel-track">
              <div className="fs-funnel-bar" style={{ width: `${w}%`, background: i === steps.length - 1 ? "var(--fs-ink)" : "var(--fs-primary)" }}>
                {w >= 14 && <span className="fs-tabular">{s.val.toLocaleString()}</span>}
              </div>
              {w < 14 && <span className="fs-funnel-outside fs-tabular">{s.val.toLocaleString()}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <span className="fs-tabular" style={{ fontSize: 14, fontWeight: 600 }}>{rate}</span>
              <span style={{ fontSize: 12, color: "var(--fs-muted)" }}>{s.of}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

Funnel.propTypes = { kpis: PropTypes.object };

// Engagement funnel (widget open → camera permission → try-on → save →
// cart). Unlike Funnel above, these steps aren't tracked yet — the widget
// doesn't instrument camera-permission grants or count opens separately
// from try-on starts — so this renders as an always-visible teaser (blurred
// placeholder values, illustrative bar heights) gated behind the app's top
// plan tier, the same pattern as the reference design's "Scale" lock, using
// this app's actual top plan ("pro") instead since there's no Scale tier here.
const ENGAGEMENT_STAGES = [
  { label: "Widget Opens", h: 132 },
  { label: "Camera Granted", h: 104 },
  { label: "Try-on Attempted", h: 80 },
  { label: "Looks Saved", h: 54 },
  { label: "Add to Cart", h: 38 },
];

// Chart geometry — a combo bar+line funnel chart drawn in one SVG (bars,
// baseline, connecting trend line and marker dots), not just floating divs.
const CHART_W = 500;
const CHART_H = 150;
const CHART_PAD_TOP = 26; // headroom for the line/dots above the tallest bar
const N = ENGAGEMENT_STAGES.length;
const SLOT = CHART_W / N;
const BAR_W = SLOT * 0.46;

/** Builds {cx, barH, topY, barX} for each stage from an array of raw values. */
function buildChartPoints(stages) {
  const maxVal = Math.max(1, ...stages.map((s) => s.val));
  return stages.map((s, i) => {
    const cx = SLOT * i + SLOT / 2;
    const barH = s.val > 0 ? Math.max(6, (s.val / maxVal) * (CHART_H - CHART_PAD_TOP)) : 0;
    const topY = CHART_H - barH;
    return { ...s, cx, barH, topY, barX: cx - BAR_W / 2 };
  });
}

function EngagementFunnelTeaser({ currentPlan, kpis, className }) {
  const unlocked = planAtLeast(currentPlan, "pro");

  const realStages = [
    { label: "Widget Opens", val: Number(kpis?.widget_open_count) || 0 },
    { label: "Camera Granted", val: Number(kpis?.camera_granted_count) || 0 },
    { label: "Try-on Attempted", val: Number(kpis?.tryon_initiated) || 0 },
    { label: "Looks Saved", val: Number(kpis?.save_count) || 0 },
    { label: "Add to Cart", val: Number(kpis?.add_to_cart_count) || 0 },
  ];
  const hasRealData = realStages.some((s) => s.val > 0);

  // Locked (teaser): illustrative descending shape, values always blurred —
  // showing a brand-new shop's real (all-zero) funnel here would just look
  // broken, and the point of the teaser is "upgrade to see this", not to
  // leak accurate relative proportions for free.
  // Unlocked (Pro): the actual tracked counts.
  const stages = unlocked ? realStages : ENGAGEMENT_STAGES.map((s) => ({ label: s.label, val: s.h }));
  const points = buildChartPoints(stages);
  const linePoints = points.map((p) => `${p.cx},${p.topY - 10}`).join(" ");

  return (
    <FsCard
      className={className}
      title="Engagement Funnel"
      subtitle="From the first widget open through to cart"
      action={
        !unlocked ? (
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FsIcon name="lock" size={14} style={{ color: "var(--fs-muted)" }} />
            <FsPill tone="primary">Pro</FsPill>
          </span>
        ) : null
      }
    >
      <div style={{ position: "relative", padding: "4px 4px 0" }}>
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ width: "100%", height: 170, display: "block" }}
        >
          <line x1="0" y1={CHART_H - 0.5} x2={CHART_W} y2={CHART_H - 0.5} stroke="#E5E7EB" strokeWidth="1" />
          {points.map((p) => (
            <rect key={p.label} x={p.barX} y={p.topY} width={BAR_W} height={p.barH} rx="8" fill="#D1D5DB" />
          ))}
          <polyline points={linePoints} fill="none" stroke="var(--fs-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p) => (
            <circle key={`${p.label}-dot`} cx={p.cx} cy={p.topY - 10} r="4.5" fill="#FFFFFF" stroke="var(--fs-primary)" strokeWidth="2.5" />
          ))}
        </svg>
        {points.map((p) => (
          unlocked ? (
            <span
              key={`${p.label}-val`}
              className="fs-tabular"
              style={{
                position: "absolute",
                left: `${(p.cx / CHART_W) * 100}%`,
                top: `${((p.topY - 26) / CHART_H) * 100}%`,
                transform: "translateX(-50%)",
                fontSize: 12, fontWeight: 700, color: "var(--fs-ink)", whiteSpace: "nowrap",
              }}
            >
              {p.val.toLocaleString()}
            </span>
          ) : (
            <span
              key={`${p.label}-blur`}
              aria-hidden="true"
              style={{
                position: "absolute",
                left: `${(p.cx / CHART_W) * 100}%`,
                top: `${((p.topY - 30) / CHART_H) * 100}%`,
                transform: "translateX(-50%)",
                width: 30, height: 13, borderRadius: 6, background: "#D1D5DB", filter: "blur(3px)",
              }}
            />
          )
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-around", marginTop: 4 }}>
        {stages.map((s) => (
          <span key={s.label} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 11, color: "var(--fs-muted)", lineHeight: 1.3 }}>{s.label}</span>
        ))}
      </div>
      {!unlocked && (
        <FsButton to="/app/plans" variant="plain" style={{ marginTop: 12 }}>
          See your full engagement funnel → Upgrade to Pro
        </FsButton>
      )}
      {unlocked && !hasRealData && (
        <p className="fs-help" style={{ marginTop: 8, textAlign: "center" }}>Not enough activity yet in this period to show real numbers.</p>
      )}
    </FsCard>
  );
}

EngagementFunnelTeaser.propTypes = { currentPlan: PropTypes.string, kpis: PropTypes.object, className: PropTypes.string };

function DeviceDonut({ split, tryons }) {
  const parts = [
    { label: "Mobile", v: Number(split.mobile) || 0, color: "var(--fs-primary)" },
    { label: "Desktop", v: Number(split.desktop) || 0, color: "var(--fs-ink)" },
    { label: "Tablet", v: Number(split.tablet) || 0, color: "#9CA3AF" },
  ];
  const total = parts.reduce((n, p) => n + p.v, 0);
  const r = 64;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", position: "relative" }}>
        <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label={parts.map((p) => `${p.label} ${p.v}%`).join(", ")}>
          <circle cx="90" cy="90" r={r} fill="none" stroke="#F1F1F3" strokeWidth="22" />
          {total > 0 && parts.map((p) => {
            const len = (p.v / Math.max(total, 100)) * c;
            const el = (
              <circle key={p.label} cx="90" cy="90" r={r} fill="none" stroke={p.color} strokeWidth="22"
                strokeDasharray={`${Math.max(len - 2, 0)} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 90 90)" />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span className="fs-tabular" style={{ fontSize: 20, fontWeight: 700 }}>{tryons.toLocaleString()}</span>
          <span style={{ fontSize: 12, color: "var(--fs-muted)" }}>try-ons</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {parts.map((p) => (
          <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />
            <span style={{ flex: 1 }}>{p.label}</span>
            <span className="fs-tabular" style={{ fontWeight: 600 }}>{p.v}%</span>
          </div>
        ))}
      </div>
    </>
  );
}

DeviceDonut.propTypes = { split: PropTypes.object, tryons: PropTypes.number };

const MEDALS = [
  { bg: "#F5B301", border: "#E0A200" },
  { bg: "#E5E7EB", border: "#C9CDD3" },
  { bg: "#E6B98A", border: "#CD9A66" },
];

function TopProducts({ products, currencyCode }) {
  if (!products.length) {
    return <FsEmpty icon="trophy" text="Your best-performing products will rank here after the first try-ons." cta="Enable products" to="/app/products" />;
  }
  const money = (v) => Number(v || 0).toLocaleString(undefined, { style: "currency", currency: currencyCode, maximumFractionDigits: 2 });
  const maxTry = Math.max(...products.map((p) => Number(p.tryon_count) || 0), 1);
  return (
    <div className="fs-table-wrap">
      <table className="fs-table">
        <thead>
          <tr><th style={{ width: 72 }}>Rank</th><th>Product</th><th className="num">Price</th><th className="num">Try-ons</th><th className="num">Orders</th><th className="num">Conversion</th><th style={{ width: 180 }}>Try-on share</th></tr>
        </thead>
        <tbody>
          {products.slice(0, 10).map((p, i) => {
            const t = Number(p.tryon_count) || 0;
            const o = Number(p.buy_count) || 0;
            const m = MEDALS[i];
            return (
              <tr key={p.id || i}>
                <td>
                  <span className="fs-rank" style={m ? { background: m.bg, borderColor: m.border, color: "var(--fs-ink)" } : undefined}>{i + 1}</span>
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="fs-thumb">{p.image ? <img src={p.image} alt="" /> : <FsIcon name="shirt" size={16} />}</span>
                    <span style={{ fontWeight: 600 }}>{p.title}</span>
                  </div>
                </td>
                <td className="num fs-tabular">{money(p.price)}</td>
                <td className="num fs-tabular">{t.toLocaleString()}</td>
                <td className="num fs-tabular">{o.toLocaleString()}</td>
                <td className="num fs-tabular" style={{ fontWeight: 600 }}>{t > 0 ? `${((o / t) * 100).toFixed(1)}%` : "—"}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="fs-progress fs-progress--primary" style={{ height: 6, flex: 1 }}><span style={{ width: `${(t / maxTry) * 100}%` }} /></div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

TopProducts.propTypes = { products: PropTypes.array, currencyCode: PropTypes.string };

const PAGE_SIZE = 10;

function Leads({ leads }) {
  const [query, setQuery] = useState("");
  const [consent, setConsent] = useState("all");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      const opted = Number(l.consent_marketing) === 1;
      if (consent === "yes" && !opted) return false;
      if (consent === "no" && opted) return false;
      if (!q) return true;
      return `${l.email ?? ""} ${l.phone ?? ""}`.toLowerCase().includes(q);
    });
  }, [leads, query, consent]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const exportCsv = () => downloadCsv("brix-tryon-leads.csv", [
    ["Email", "Phone", "Marketing consent", "Captured"],
    ...filtered.map((l) => [l.email, l.phone, Number(l.consent_marketing) === 1 ? "Yes" : "No", l.created_at]),
  ]);

  return (
    <FsCard style={{ padding: 0, gap: 0, overflow: "hidden" }}>
      <div className="fs-card-head" style={{ padding: "20px 24px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3 className="fs-h3">Captured leads</h3>
            <FsPill tone="primary">{leads.length.toLocaleString()}</FsPill>
          </div>
          <p className="fs-card-sub">Shoppers who left their email or phone to unlock their try-on</p>
        </div>
        <label className="fs-search">
          <FsIcon name="search" size={16} />
          <input type="search" placeholder="Search email or phone" aria-label="Search leads" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
        </label>
        <div className="fs-seg" role="group" aria-label="Marketing consent filter">
          {[["all", "All"], ["yes", "Opted in"], ["no", "Not given"]].map(([v, l]) => (
            <button key={v} type="button" className={consent === v ? "is-on" : ""} aria-pressed={consent === v} onClick={() => { setConsent(v); setPage(1); }}>{l}</button>
          ))}
        </div>
        <FsButton variant="dark" icon="download" onClick={exportCsv} disabled={!filtered.length}>Export CSV</FsButton>
      </div>

      {leads.length === 0 ? (
        <FsEmpty icon="users" text="Leads show up here when shoppers leave their email to see their try-on." cta="Turn on lead capture" to="/app/settings" />
      ) : filtered.length === 0 ? (
        <FsEmpty icon="search" text="No leads match your search." cta="Clear filters" onClick={() => { setQuery(""); setConsent("all"); }} />
      ) : (
        <>
          <div className="fs-table-wrap">
            <table className="fs-table">
              <thead><tr><th>Shopper</th><th>Phone</th><th>Captured</th><th>Marketing consent</th></tr></thead>
              <tbody>
                {rows.map((l) => {
                  const opted = Number(l.consent_marketing) === 1;
                  const d = parseDate(l.created_at);
                  return (
                    <tr key={l.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span className="fs-avatar">{(l.email || l.phone || "?").slice(0, 2).toUpperCase()}</span>
                          <span style={{ fontWeight: 600 }}>{l.email || "—"}</span>
                        </div>
                      </td>
                      <td className="fs-tabular">{l.phone || "—"}</td>
                      <td style={{ color: "var(--fs-muted)" }}>
                        {Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                      </td>
                      <td>{opted ? <FsPill tone="success"><FsIcon name="check" size={12} strokeWidth={3} />Opted in</FsPill> : <FsPill>Not given</FsPill>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="fs-pager">
            <span className="fs-tabular">Showing {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()}</span>
            <nav aria-label="Pagination" style={{ display: "flex", gap: 6 }}>
              <button type="button" className="fs-page-btn" aria-label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)}>‹</button>
              {Array.from({ length: pages }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === pages || Math.abs(n - current) <= 1)
                .map((n, i, arr) => (
                  <span key={n} style={{ display: "flex", gap: 6 }}>
                    {i > 0 && n - arr[i - 1] > 1 && <span className="fs-page-gap">…</span>}
                    <button type="button" className={`fs-page-btn${n === current ? " is-on" : ""}`} aria-current={n === current ? "page" : undefined} onClick={() => setPage(n)}>{n}</button>
                  </span>
                ))}
              <button type="button" className="fs-page-btn" aria-label="Next page" disabled={current === pages} onClick={() => setPage(current + 1)}>›</button>
            </nav>
          </div>
        </>
      )}
    </FsCard>
  );
}

Leads.propTypes = { leads: PropTypes.array };

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { analytics, range, from, to, currencyCode = "USD", currentPlan, leads = [] } = useLoaderData();
  const navigate = useNavigate();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeRange, setActiveRange] = useState(range);
  const [{ month, year }, setMonth] = useState({ month: new Date(to).getMonth(), year: new Date(to).getFullYear() });
  const [selectedDates, setSelectedDates] = useState({ start: new Date(from), end: new Date(to) });
  const handleMonthChange = useCallback((m, y) => setMonth({ month: m, year: y }), []);

  const applyPreset = (value) => {
    setActiveRange(value);
    setSelectedDates({ start: new Date(getFromDate(value)), end: new Date() });
    navigate(`?range=${value}`);
    setPickerOpen(false);
  };
  const applyCustom = () => {
    const f = selectedDates.start.toISOString().split("T")[0];
    const t = selectedDates.end.toISOString().split("T")[0];
    navigate(`?from=${f}&to=${t}&range=custom`);
    setPickerOpen(false);
  };

  const kpis = analytics?.summary || {};
  const topProducts = analytics?.top_products || [];
  const deviceSplit = analytics?.device_split || { mobile: 0, desktop: 0, tablet: 0 };
  const charts = analytics?.charts || {};

  const initiated = Number(kpis.tryon_initiated) || 0;
  const cartCount = Number(kpis.add_to_cart_count) || 0;
  const orderCount = Number(kpis.order_count) || 0;
  const revenue = Number(kpis.revenue_inr) || 0;
  const money = (v) => v.toLocaleString(undefined, { style: "currency", currency: currencyCode, maximumFractionDigits: 2 });
  const cartRate = initiated > 0 ? ((cartCount / initiated) * 100).toFixed(1) : "0.0";
  const purchRate = initiated > 0 ? ((orderCount / initiated) * 100).toFixed(1) : "0.0";
  const shareRate = initiated > 0 ? ((Number(kpis.share_wa_count) || 0) / initiated) * 100 : 0;

  const exportSummary = () => downloadCsv(`brix-tryon-analytics-${from}-to-${to}.csv`, [
    ["Metric", "Value", "Change vs previous period"],
    ["Try-ons", initiated, kpis.tryon_trend ?? ""],
    ["Add to cart", cartCount, kpis.cart_trend ?? ""],
    ["Cart rate %", cartRate, kpis.cart_rate_trend ?? ""],
    ["Orders", orderCount, kpis.order_trend ?? ""],
    ["Purchase rate %", purchRate, kpis.purch_rate_trend ?? ""],
    [`Revenue (${currencyCode})`, revenue, kpis.revenue_trend ?? ""],
    ["Saved images", kpis.save_count ?? 0, kpis.save_trend ?? ""],
    ["WhatsApp shares", kpis.share_wa_count ?? 0, kpis.share_wa_trend ?? ""],
    [],
    ["Top product", "Try-ons", "Orders"],
    ...topProducts.map((p) => [p.title, p.tryon_count, p.buy_count]),
  ]);

  const actions = [
    { label: "Add to cart", value: cartCount, trend: kpis.cart_trend, icon: "cart", tone: "primary" },
    { label: "Save image", value: Number(kpis.save_count) || 0, trend: kpis.save_trend, icon: "download", tone: "primary" },
    { label: "WhatsApp share", value: Number(kpis.share_wa_count) || 0, trend: kpis.share_wa_trend, icon: "message", tone: "success" },
    { label: "Orders", value: orderCount, trend: kpis.order_trend, icon: "bag", tone: "dark" },
  ];

  return (
    <PlanGate currentPlan={currentPlan} requiredPlan="growth" featureName="Analytics">
      <FsPage
        title="Try-on performance"
        subtitle="How shoppers use virtual try-on, and what it earns you."
        actions={
          <>
            <div className="fs-seg" role="group" aria-label="Quick ranges">
              {QUICK.map((q) => (
                <button key={q.value} type="button" className={activeRange === q.value ? "is-on" : ""} aria-pressed={activeRange === q.value} onClick={() => applyPreset(q.value)}>{q.label}</button>
              ))}
            </div>
            <FsButton variant="ghost" icon="calendar" onClick={() => setPickerOpen(true)}>{formatDateRange(from, to)}</FsButton>
            <FsButton variant="dark" icon="download" onClick={exportSummary}>Export</FsButton>
          </>
        }
      >
        {pickerOpen && (
          <div className="fs-modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setPickerOpen(false); }}>
            <div className="fs-modal" role="dialog" aria-modal="true" aria-label="Select date range" style={{ width: 820 }}>
              <div className="fs-modal-head">
                <span>Select date range</span>
                <button type="button" className="fs-icon-btn" aria-label="Close" onClick={() => setPickerOpen(false)}><FsIcon name="x" size={16} /></button>
              </div>
              <div style={{ display: "flex" }}>
                <div className="fs-preset-list">
                  {PRESETS.map((p) => (
                    <button key={p.value} type="button" className={activeRange === p.value ? "is-on" : ""} onClick={() => applyPreset(p.value)}>{p.label}</button>
                  ))}
                </div>
                <div style={{ flex: 1, padding: "20px 24px" }}>
                  <DatePicker
                    month={month}
                    year={year}
                    onChange={(dates) => { setSelectedDates(dates); setActiveRange("custom"); }}
                    onMonthChange={handleMonthChange}
                    selected={selectedDates}
                    allowRange
                    disableDatesAfter={new Date()}
                  />
                </div>
              </div>
              <div className="fs-modal-foot">
                <span className="fs-tabular" style={{ flex: 1, fontSize: 13, color: "var(--fs-muted)" }}>
                  {formatDateRange(selectedDates.start.toISOString().split("T")[0], selectedDates.end.toISOString().split("T")[0])}
                </span>
                <FsButton variant="ghost" onClick={() => setPickerOpen(false)}>Cancel</FsButton>
                <FsButton onClick={applyCustom}>Apply</FsButton>
              </div>
            </div>
          </div>
        )}

        {initiated === 0 && (
          <FsCard>
            <FsEmpty icon="chart" text={`No try-ons between ${formatDateRange(from, to)}. Try a longer range, or make sure try-on is enabled on your products.`} cta="Enable products" to="/app/products" />
          </FsCard>
        )}

        <div className="fs-grid-4">
          <Kpi label="Try-ons" value={initiated.toLocaleString()} delta={kpis.tryon_trend} note="Shoppers who started a try-on" data={charts.tryons} />
          <Kpi label="Cart rate" value={`${cartRate}%`} delta={kpis.cart_rate_trend} note={`${cartCount.toLocaleString()} of ${initiated.toLocaleString()} try-ons`} data={charts.cart_rate} />
          <Kpi label="Purchase rate" value={`${purchRate}%`} delta={kpis.purch_rate_trend} note={`${orderCount.toLocaleString()} orders after a try-on`} data={charts.purch_rate} />
          <Kpi label="Attributed revenue" value={money(revenue)} delta={kpis.revenue_trend} note={orderCount > 0 ? `Average order ${money(revenue / orderCount)}` : "From try-on orders"} data={charts.revenue} />
        </div>

        <div className="fs-grid-12">
          <FsCard className="fs-span-8" title="Conversion funnel" subtitle="From try-on to order · step conversion on the right"
            action={<FsPill tone="primary">{purchRate}% try-on to order</FsPill>}>
            <Funnel kpis={kpis} />
            {initiated > 0 && (
              <div className="fs-note">
                <FsIcon name="message" size={16} style={{ color: "var(--fs-primary)" }} />
                {shareRate >= 10
                  ? `${shareRate.toFixed(0)}% of shoppers share their try-on — social proof is working for you.`
                  : "Shoppers who share get a second opinion. Keep WhatsApp share switched on in Widget Settings."}
              </div>
            )}
          </FsCard>
          <FsCard className="fs-span-4" title="Device split">
            <DeviceDonut split={deviceSplit} tryons={initiated} />
          </FsCard>
        </div>

        <div className="fs-grid-12">
          <EngagementFunnelTeaser currentPlan={currentPlan} kpis={kpis} className="fs-span-6" />
          <FsCard className="fs-span-6" title="Top products" subtitle="Ranked by try-ons in this period" action={<FsButton to="/app/products" variant="plain">All products</FsButton>} style={{ paddingBottom: topProducts.length ? 0 : 24 }}>
            <div style={{ margin: topProducts.length ? "0 -24px" : 0 }}>
              <TopProducts products={topProducts} currencyCode={currencyCode} />
            </div>
          </FsCard>
        </div>

        <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h3 className="fs-h2">What shoppers did after trying on</h3>
          <div className="fs-grid-4">
            {actions.map((a) => (
              <FsCard key={a.label} style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 20 }}>
                <span className={`fs-tile-icon fs-tile-icon--${a.tone}`}><FsIcon name={a.icon} size={22} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--fs-muted)" }}>{a.label}</div>
                  <div className="fs-tabular" style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{a.value.toLocaleString()}</div>
                </div>
                {a.trend && <span style={{ fontSize: 12, fontWeight: 600, color: isDown(a.trend) ? "var(--fs-warning-ink)" : "var(--fs-success-ink)" }}>{a.trend}</span>}
              </FsCard>
            ))}
          </div>
        </section>

        <Leads leads={leads} />
      </FsPage>
    </PlanGate>
  );
}
