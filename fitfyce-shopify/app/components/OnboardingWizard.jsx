// First-run onboarding overlay — 7 steps shown over the dashboard.
// Every step is saved immediately through /api/onboarding, so a merchant who
// closes the tab resumes exactly where they left off.
import { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useFetcher, useNavigate } from "react-router";
import { FsIcon, FsPill } from "./fs-ui";
import { PLAN_LABELS, PLAN_PRICES, PLAN_TRYONS } from "../lib/plans";

const TUTORIAL_YOUTUBE_ID = "fMRsrR3o4Zk";

const STEPS = [
  { key: "goals", label: "Goals" },
  { key: "store", label: "Your store" },
  { key: "products", label: "Products" },
  { key: "theme", label: "Add to store" },
  { key: "contact", label: "Alerts" },
  { key: "plan", label: "Plan" },
  { key: "done", label: "Launch" },
];

const GOALS = [
  { id: "sell_more", title: "Sell more", desc: "Shoppers buy what they've seen on themselves", icon: "cart" },
  { id: "fewer_returns", title: "Fewer returns", desc: "Cut fit and style surprises after delivery", icon: "refresh" },
  { id: "collect_emails", title: "Collect emails", desc: "Grow your list through the try-on", icon: "message" },
  { id: "stand_out", title: "Stand out", desc: "A store shoppers remember and share", icon: "sparkle" },
  { id: "order_value", title: "Bigger orders", desc: "Help shoppers try and buy complete looks", icon: "bag" },
  { id: "other", title: "Something else", desc: "Tell us more later", icon: "star" },
];

const HEARD_FROM = [
  ["", "Select an option"],
  ["app_store", "Shopify App Store"],
  ["google", "Google search"],
  ["social", "Instagram / Facebook"],
  ["youtube", "YouTube"],
  ["referral", "A friend or colleague"],
  ["agency", "Agency or developer"],
  ["blog", "Blog or article"],
  ["other", "Other"],
];

const STORE_TYPES = [
  ["fashion", "Fashion & apparel", "shirt"],
  ["ethnic", "Ethnic wear", "sparkle"],
  ["jewellery", "Jewellery & accessories", "star"],
  ["eyewear", "Eyewear", "eye"],
  ["kids", "Kids wear", "users"],
  ["other", "Something else", "box"],
];
const CATALOG_SIZES = [
  ["1-20", "1–20", "Just getting started"],
  ["21-100", "21–100", "A growing catalog"],
  ["101-500", "101–500", "An established store"],
  ["500+", "500+", "A large catalog"],
];

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 18 }, (_, i) => ({
    left: (i * 53) % 100,
    delay: (i % 9) * 70,
    color: ["var(--fs-primary)", "#9CA3AF", "var(--fs-gold)"][i % 3],
    size: 6 + (i % 3) * 2,
    rot: (i * 47) % 360,
  })), []);
  return (
    <div className="fs-ob-confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span key={i} style={{ left: `${p.left}%`, width: p.size, height: p.size * 0.5, background: p.color, animationDelay: `${p.delay}ms`, "--rot": `${p.rot}deg` }} />
      ))}
    </div>
  );
}

function OptionCard({ selected, onClick, icon, title, desc, role = "checkbox" }) {
  return (
    <button type="button" role={role} aria-checked={selected} className={`fs-ob-option${selected ? " is-on" : ""}`} onClick={onClick}>
      <span className="fs-ob-option-icon"><FsIcon name={icon} size={18} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="fs-ob-option-title">{title}</span>
        {desc && <span className="fs-ob-option-desc">{desc}</span>}
      </span>
      <span className="fs-ob-option-check">{selected && <FsIcon name="check" size={12} strokeWidth={3.2} />}</span>
    </button>
  );
}

OptionCard.propTypes = { selected: PropTypes.bool, onClick: PropTypes.func, icon: PropTypes.string, title: PropTypes.string, desc: PropTypes.string, role: PropTypes.string };

export default function OnboardingWizard({ shop, apiKey, onboarding, currentPlan, onClose }) {
  const navigate = useNavigate();
  const saved = onboarding?.saved ?? {};
  const saveFetcher = useFetcher();
  const productsFetcher = useFetcher();
  const enableFetcher = useFetcher();
  const planFetcher = useFetcher();

  const [step, setStep] = useState(() => Math.min(Math.max(Number(saved.step) || 0, 0), STEPS.length - 1));
  const [earned, setEarned] = useState(() => new Set(STEPS.slice(0, Number(saved.step) || 0).map((s) => s.key)));
  const [error, setError] = useState(null);

  // Answers
  const [goals, setGoals] = useState(() => (Array.isArray(saved.goals) ? saved.goals : []));
  const [heardFrom, setHeardFrom] = useState(saved.heard_from ?? "");
  const [storeType, setStoreType] = useState(saved.store_type ?? "");
  const [catalogSize, setCatalogSize] = useState(saved.catalog_size ?? "");
  const [productScope, setProductScope] = useState(saved.product_scope ?? "");
  const [embedConfirmed, setEmbedConfirmed] = useState(!!saved.embed_confirmed);
  const [blockConfirmed, setBlockConfirmed] = useState(!!saved.block_confirmed);
  const [showVideo, setShowVideo] = useState(false);
  const [contactName, setContactName] = useState(saved.contact_name ?? onboarding?.shopName ?? "");
  const [contactEmail, setContactEmail] = useState(saved.contact_email ?? onboarding?.shopEmail ?? "");
  const [contactPhone, setContactPhone] = useState(saved.contact_phone ?? "");
  const [selectedPlan, setSelectedPlan] = useState(saved.selected_plan ?? "");

  const dialogRef = useRef(null);
  const current = STEPS[step];

  // Lock page scroll behind the overlay and focus the dialog.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => { dialogRef.current?.scrollTo?.({ top: 0 }); setError(null); }, [step]);

  // Billing: the plans action returns a Shopify confirmation URL for paid plans.
  useEffect(() => {
    if (planFetcher.data?.billingUrl) {
      try { window.top.location.href = planFetcher.data.billingUrl; } catch { /* fallback link shown */ }
    } else if (planFetcher.data?.error) {
      setError(planFetcher.data.error);
    }
  }, [planFetcher.data]);

  useEffect(() => {
    if (saveFetcher.data?.ok === false) setError(saveFetcher.data.error ?? "We couldn't save your progress.");
  }, [saveFetcher.data]);

  const answers = {
    goals, heard_from: heardFrom, store_type: storeType, catalog_size: catalogSize, product_scope: productScope,
    embed_confirmed: embedConfirmed, block_confirmed: blockConfirmed,
    contact_name: contactName, contact_email: contactEmail, contact_phone: contactPhone, selected_plan: selectedPlan,
  };

  const persist = (extra) => {
    // enabledCount is declared further down; this runs on click, after render, so it's initialized.
    const productsEnabled = enabledCount || Number(saved.products_enabled) || 0;
    saveFetcher.submit({ ...answers, products_enabled: productsEnabled, ...extra }, { method: "POST", action: "/api/onboarding", encType: "application/json" });
  };

  const award = () => {
    if (earned.has(current.key)) return;
    setEarned((s) => new Set(s).add(current.key));
  };

  const goNext = () => {
    award();
    const nextStep = Math.min(step + 1, STEPS.length - 1);
    persist({ step: nextStep, completed: nextStep === STEPS.length - 1 });
    setStep(nextStep);
  };

  const skipAll = () => {
    persist({ step, skipped: true });
    onClose();
  };

  const finish = (to) => {
    award();
    persist({ step: STEPS.length - 1, completed: true });
    onClose();
    if (to) navigate(to);
  };

  // ── Step 3: enable every product ──
  const products = useMemo(() => {
    const cols = productsFetcher.data?.collections ?? [];
    const map = new Map();
    cols.forEach((c) => c.products.forEach((p) => { if (!map.has(p.id)) map.set(p.id, { ...p, collection: c }); }));
    return Array.from(map.values());
  }, [productsFetcher.data]);
  // Products switched on in this session (the loader data isn't refetched mid-wizard).
  const [enabledIds, setEnabledIds] = useState(() => new Set());
  const lastBatch = useRef([]);
  const toEnable = products.filter((p) => !p.isTryonEnabled && !enabledIds.has(p.id));
  const enabledCount = enabledIds.size;
  const enableDone = enabledCount > 0 && toEnable.length === 0;
  const lastFailed = enableFetcher.state === "idle" && enableFetcher.data?.bulk ? (enableFetcher.data.failed ?? 0) : 0;

  useEffect(() => {
    const d = enableFetcher.data;
    if (!d?.bulk || enableFetcher.state !== "idle") return;
    const failed = new Set(d.failedIds ?? []);
    setEnabledIds((prev) => {
      const next = new Set(prev);
      (lastBatch.current ?? []).forEach((id) => { if (!failed.has(id)) next.add(id); });
      return next;
    });
  }, [enableFetcher.data, enableFetcher.state]);

  useEffect(() => {
    if (step === 2 && productsFetcher.state === "idle" && !productsFetcher.data) productsFetcher.load("/app/products");
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const enableAll = () => {
    setProductScope("all");
    if (!toEnable.length) return;
    const fd = new FormData();
    fd.set("intent", "bulk_toggle_products");
    fd.set("enabled", "true");
    fd.set("products_json", JSON.stringify(toEnable.map((p) => ({
      id: p.id, numericId: p.numericId, handle: p.handle, vendor: p.vendor, productType: p.productType, tags: p.tags,
      collectionId: p.collection?.numericId, collectionTitle: p.collection?.title, collectionHandle: p.collection?.handle,
    }))));
    lastBatch.current = toEnable.map((p) => p.id);
    enableFetcher.submit(fd, { method: "POST", action: "/app/products" });
  };

  const choosePlan = (plan) => {
    setSelectedPlan(plan);
    award();
    persist({ step: step + 1, selected_plan: plan });
    if (plan === "free" || plan === currentPlan) {
      setStep(step + 1);
      return;
    }
    const fd = new FormData();
    fd.set("plan", plan);
    planFetcher.submit(fd, { method: "POST", action: "/app/plans" });
  };

  const emailValid = !contactEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail);
  const canContinue = {
    goals: goals.length > 0,
    store: !!storeType && !!catalogSize,
    products: !!productScope && enableFetcher.state === "idle",
    theme: true,
    contact: contactName.trim() !== "" && contactEmail.trim() !== "" && emailValid,
    plan: true,
    done: true,
  }[current.key];

  const embedUrl = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${apiKey}/tryon-embed`;
  const blockUrl = `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/tryon-button&target=mainSection`;
  return (
    <div className="fs-ob-backdrop">
      <div className="fs-ob-shell">
        {/* Top bar: brand · progress */}
        <div className="fs-ob-top">
          <span className="fs-ob-brand">Welcome to Brix-TryOn</span>
          <span className="fs-ob-count">Step {step + 1} of {STEPS.length}</span>
        </div>

        {/* Step track: every step and what's been completed */}
        <div className="fs-ob-quest">
          <ol className="fs-ob-steps">
            {STEPS.map((s, i) => {
              const done = earned.has(s.key);
              const isCurrent = i === step;
              const reachable = i <= step;
              return (
                <li key={s.key} className={`fs-ob-step${done ? " is-done" : ""}${isCurrent ? " is-current" : ""}${reachable ? "" : " is-locked"}`}>
                  <button type="button" disabled={!reachable || isCurrent} onClick={() => setStep(i)}
                    aria-current={isCurrent ? "step" : undefined}
                    aria-label={`Step ${i + 1}: ${s.label}${done ? ", completed" : ""}`}>
                    <span className="fs-ob-step-dot">
                      {done && !isCurrent ? <FsIcon name="check" size={13} strokeWidth={3} /> : reachable ? i + 1 : <FsIcon name="lock" size={11} strokeWidth={2.4} />}
                    </span>
                    <span className="fs-ob-step-label">{s.label}</span>                  </button>
                </li>
              );
            })}
          </ol>
        </div>

      <div className="fs-ob" role="dialog" aria-modal="true" aria-labelledby="fs-ob-title" tabIndex={-1} ref={dialogRef}>
        <div className="fs-ob-body">
          {error && <div className="fs-banner fs-banner--critical" role="alert" style={{ marginBottom: 16 }}><FsIcon name="info" size={16} /><span>{error}</span></div>}

          {current.key === "goals" && (
            <>
              <StepTitle n={1} title="What do you want try-on to do for you?" sub="Pick any that apply — we'll tailor your setup." />
              <div className="fs-ob-grid-3">
                {GOALS.map((g) => (
                  <OptionCard key={g.id} icon={g.icon} title={g.title} desc={g.desc} selected={goals.includes(g.id)}
                    onClick={() => setGoals((prev) => (prev.includes(g.id) ? prev.filter((x) => x !== g.id) : [...prev, g.id]))} />
                ))}
              </div>
              <div style={{ maxWidth: 420, margin: "24px auto 0" }}>
                <label className="fs-label" htmlFor="ob-heard">How did you hear about us?</label>
                <select id="ob-heard" className="fs-select" value={heardFrom} onChange={(e) => setHeardFrom(e.target.value)}>
                  {HEARD_FROM.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </>
          )}

          {current.key === "store" && (
            <>
              <StepTitle n={2} title="Tell us about your store" sub="So we can suggest the right models and settings." />
              <span className="fs-label">What do you sell?</span>
              <div className="fs-ob-grid-3">
                {STORE_TYPES.map(([id, label, icon]) => (
                  <OptionCard key={id} role="radio" icon={icon} title={label} selected={storeType === id} onClick={() => setStoreType(id)} />
                ))}
              </div>
              <span className="fs-label" style={{ marginTop: 24 }}>How many products do you have?</span>
              <div className="fs-ob-sizes" role="radiogroup" aria-label="Catalog size">
                {CATALOG_SIZES.map(([v, l, hint]) => (
                  <button key={v} type="button" role="radio" aria-checked={catalogSize === v}
                    className={`fs-ob-size${catalogSize === v ? " is-on" : ""}`} onClick={() => setCatalogSize(v)}>
                    <span className="fs-ob-size-value">{l}</span>
                    <span className="fs-ob-size-hint">{hint}</span>
                    <span className="fs-ob-option-check">{catalogSize === v && <FsIcon name="check" size={12} strokeWidth={3.2} />}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {current.key === "products" && (
            <>
              <StepTitle n={3} title="Which products need virtual try-on?" sub="Choose where shoppers see try-on. You can fine-tune this any time in Products." />
              <div className="fs-ob-grid-3">
                <div className={`fs-ob-choice${productScope === "all" ? " is-on" : ""}`}>
                  <FsIcon name="box" size={20} style={{ color: "var(--fs-primary)" }} />
                  <div className="fs-ob-option-title">All products</div>
                  <p className="fs-ob-option-desc">Turn on try-on everywhere. The fastest way to launch.</p>
                  {enableDone ? (
                    <FsPill tone="success"><FsIcon name="check" size={12} strokeWidth={3} />{enabledCount} products enabled</FsPill>
                  ) : (
                    <button type="button" className="fs-btn fs-btn--primary fs-btn--sm" onClick={enableAll}
                      disabled={productsFetcher.state !== "idle" || enableFetcher.state !== "idle" || !productsFetcher.data}>
                      {productsFetcher.state !== "idle" ? "Loading products…"
                        : enableFetcher.state !== "idle" ? `Enabling ${lastBatch.current.length} products…`
                          : lastFailed > 0 && toEnable.length ? `Retry ${toEnable.length}`
                            : toEnable.length ? `Enable all ${toEnable.length}` : products.length ? "All already enabled" : "Enable all"}
                    </button>
                  )}
                </div>
                <div className={`fs-ob-choice${productScope === "collection" ? " is-on" : ""}`}>
                  <FsIcon name="grid" size={20} style={{ color: "var(--fs-primary)" }} />
                  <div className="fs-ob-option-title">By collection</div>
                  <p className="fs-ob-option-desc">Enable whole collections. Easiest to manage at scale.</p>
                  <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" onClick={() => setProductScope("collection")}>{productScope === "collection" ? "Selected" : "Choose later"}</button>
                </div>
                <div className={`fs-ob-choice${productScope === "product" ? " is-on" : ""}`}>
                  <FsIcon name="check" size={20} style={{ color: "var(--fs-primary)" }} />
                  <div className="fs-ob-option-title">By product</div>
                  <p className="fs-ob-option-desc">Pick specific products. Best for testing a small drop.</p>
                  <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" onClick={() => setProductScope("product")}>{productScope === "product" ? "Selected" : "Choose later"}</button>
                </div>
              </div>
              {lastFailed > 0 && toEnable.length > 0 && (
                <p className="fs-help" style={{ color: "var(--fs-warning-ink)" }}>
                  {enabledCount > 0 ? `${enabledCount} enabled. ` : ""}{toEnable.length} {toEnable.length === 1 ? "product" : "products"} couldn&apos;t be enabled — click Retry to try {toEnable.length === 1 ? "it" : "them"} again.
                  {enableFetcher.data?.error && <><br /><span style={{ color: "var(--fs-muted)" }}>Reason: {enableFetcher.data.error}</span></>}
                </p>
              )}
            </>
          )}

          {current.key === "theme" && (
            <>
              <StepTitle n={4} title="Add try-on to your store" sub="Two quick switches in your theme editor. Each opens in a new tab, right where you need it." />
              <div className="fs-ob-tasks">
                <div className="fs-ob-task">
                  <button type="button" className={`fs-ob-tick${embedConfirmed ? " is-on" : ""}`} aria-pressed={embedConfirmed} aria-label="Mark app embed as done" onClick={() => setEmbedConfirmed(!embedConfirmed)}>
                    {embedConfirmed && <FsIcon name="check" size={13} strokeWidth={3.2} />}
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Turn on the Brix-TryOn app embed</div>
                    <div className="fs-help" style={{ marginTop: 2 }}>Switch on “Brix-TryOn”, click Save, then tick this step.</div>
                  </div>
                  <a className="fs-btn fs-btn--ghost fs-btn--sm" href={embedUrl} target="_blank" rel="noopener noreferrer">Open theme editor</a>
                </div>
                <div className={`fs-ob-task${embedConfirmed ? "" : " is-locked"}`}>
                  <button type="button" className={`fs-ob-tick${blockConfirmed ? " is-on" : ""}`} aria-pressed={blockConfirmed} aria-label="Mark product block as done" disabled={!embedConfirmed} onClick={() => setBlockConfirmed(!blockConfirmed)}>
                    {blockConfirmed && <FsIcon name="check" size={13} strokeWidth={3.2} />}
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Add the try-on button to product pages</div>
                    <div className="fs-help" style={{ marginTop: 2 }}>{embedConfirmed ? "Place the Brix-TryOn block, click Save, then tick this step." : "Turn on the app embed first."}</div>
                  </div>
                  {embedConfirmed ? (
                    <a className="fs-btn fs-btn--ghost fs-btn--sm" href={blockUrl} target="_blank" rel="noopener noreferrer">Open theme editor</a>
                  ) : (
                    <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" disabled>Open theme editor</button>
                  )}
                </div>
              </div>
              <button type="button" className="fs-btn fs-btn--plain fs-btn--sm" style={{ marginTop: 12 }} aria-expanded={showVideo} onClick={() => setShowVideo((v) => !v)}>
                <FsIcon name="chevronRight" size={14} style={{ transform: showVideo ? "rotate(90deg)" : "none" }} />Watch how (1 min)
              </button>
              {showVideo && (
                <div className="fs-video" style={{ borderRadius: 12, overflow: "hidden", marginTop: 10 }}>
                  <iframe src={`https://www.youtube-nocookie.com/embed/${TUTORIAL_YOUTUBE_ID}?rel=0&modestbranding=1`} title="How to add Brix-TryOn to your theme" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                </div>
              )}
            </>
          )}

          {current.key === "contact" && (
            <>
              <StepTitle n={5} title="Who should we alert when try-ons run low?" sub="We'll only use this for important account alerts — never marketing." />
              <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label className="fs-label" htmlFor="ob-name">Your name</label>
                  <input id="ob-name" className="fs-input" value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="name" />
                </div>
                <div>
                  <label className="fs-label" htmlFor="ob-email">Email address</label>
                  <input id="ob-email" type="email" className="fs-input" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} autoComplete="email" aria-invalid={!emailValid} />
                  {!emailValid && <p className="fs-help" style={{ color: "#B91C1C" }}>Please enter a valid email address.</p>}
                </div>
                <div>
                  <label className="fs-label" htmlFor="ob-phone">Phone number <span style={{ fontWeight: 400, color: "var(--fs-muted)" }}>(optional)</span></label>
                  <input id="ob-phone" type="tel" className="fs-input" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} autoComplete="tel" placeholder="+91 98765 43210" />
                </div>
              </div>
            </>
          )}

          {current.key === "plan" && (
            <>
              <StepTitle n={6} title="Choose your plan" sub="Start free and upgrade whenever you're ready. Paid plans include a 3-day free trial." />
              <div className="fs-ob-grid-3">
                {["free", "growth", "pro"].map((p) => (
                  <div key={p} className={`fs-ob-plan${p === "growth" ? " is-featured" : ""}${currentPlan === p ? " is-current" : ""}`}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 24 }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{PLAN_LABELS[p]}</span>
                      {currentPlan === p ? <FsPill tone="success">Current</FsPill> : p === "growth" ? <FsPill tone="primary">Recommended</FsPill> : null}
                    </div>
                    <div className="fs-tabular" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>{PLAN_PRICES[p].replace("/month", "")}<small style={{ fontSize: 13, fontWeight: 400, color: "var(--fs-muted)" }}>{p === "free" ? "" : " / month"}</small></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><FsIcon name="bolt" size={14} style={{ color: "var(--fs-primary)" }} />{PLAN_TRYONS[p]} try-ons every month</div>
                    <button type="button" className={p === "growth" ? "fs-ob-primary" : "fs-ob-secondary"} style={{ width: "100%", marginTop: "auto" }}
                      disabled={planFetcher.state !== "idle"} onClick={() => choosePlan(p)}>
                      {planFetcher.state !== "idle" && selectedPlan === p ? "Opening billing…" : currentPlan === p ? "Keep this plan" : p === "free" ? "Continue free" : `Choose ${PLAN_LABELS[p]}`}
                    </button>
                  </div>
                ))}
              </div>
              {planFetcher.data?.billingUrl && (
                <p className="fs-help" style={{ textAlign: "center" }}>Not redirected? <a href={planFetcher.data.billingUrl} target="_top" rel="noreferrer">Open Shopify billing</a></p>
              )}
            </>
          )}

          {current.key === "done" && (
            <div className="fs-ob-done">
              <Confetti />
              <span className="fs-ob-badge"><FsIcon name="trophy" size={34} /></span>
              <h2 id="fs-ob-title" className="fs-h1" style={{ fontSize: 28 }}>You&apos;re ready to launch!</h2>
              <p className="fs-sub" style={{ margin: 0, maxWidth: 520 }}>
                Your store is set up and try-on is ready to go.
              </p>
              <div className="fs-ob-summary">
                <SummaryRow done={goals.length > 0} label="Goals set" />
                <SummaryRow done={productScope === "all" ? !!enableDone || !toEnable.length : !!productScope} label={productScope === "all" ? "Try-on enabled on products" : "Products to choose in Products"} />
                <SummaryRow done={embedConfirmed && blockConfirmed} label="Try-on added to your theme" />
                <SummaryRow done={!!contactEmail} label="Alert contact saved" />
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                {productScope && productScope !== "all" && <button type="button" className="fs-btn fs-btn--ghost" onClick={() => finish("/app/products")}>Choose products</button>}
                <button type="button" className="fs-btn fs-btn--ghost" onClick={() => finish("/app/settings")}>Style my button</button>
                <button type="button" className="fs-ob-primary" onClick={() => finish()}>Go to dashboard</button>
              </div>
            </div>
          )}
        </div>

        {current.key !== "done" && current.key !== "plan" && (
          <div className="fs-ob-foot">
            {step > 0 ? <button type="button" className="fs-ob-secondary" onClick={() => setStep(step - 1)}>Back</button> : <span />}
            <div style={{ flex: 1 }} />
            {current.key === "theme" && (
              <button type="button" className="fs-ob-link" onClick={goNext}>I&apos;ll do this later</button>
            )}
            <button type="button" className="fs-ob-primary" disabled={!canContinue || saveFetcher.state !== "idle"} onClick={goNext}>
              Continue
            </button>
          </div>
        )}
        {current.key === "plan" && (
          <div className="fs-ob-foot">
            <button type="button" className="fs-ob-secondary" onClick={() => setStep(step - 1)}>Back</button>
            <div style={{ flex: 1 }} />
            <button type="button" className="fs-ob-link" onClick={skipAll}>Skip setup</button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

OnboardingWizard.propTypes = {
  shop: PropTypes.string.isRequired,
  apiKey: PropTypes.string.isRequired,
  onboarding: PropTypes.object,
  currentPlan: PropTypes.string,
  onClose: PropTypes.func.isRequired,
};

function StepTitle({ title, sub }) {
  return (
    <div className="fs-ob-title">
      <h2 id="fs-ob-title">{title}</h2>
      <p>{sub}</p>
    </div>
  );
}

StepTitle.propTypes = { title: PropTypes.string, sub: PropTypes.string };

function SummaryRow({ done, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
      <span className={`fs-ob-tick${done ? " is-on" : ""}`} style={{ cursor: "default" }}>{done && <FsIcon name="check" size={12} strokeWidth={3.2} />}</span>
      <span style={{ color: done ? "var(--fs-ink)" : "var(--fs-muted)" }}>{label}{done ? "" : " — pending"}</span>
    </div>
  );
}

SummaryRow.propTypes = { done: PropTypes.bool, label: PropTypes.string };
