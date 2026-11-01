/**
 * app.studio._index.jsx — AI Studio dashboard: workflow picker, asset library + saved models.
 */

import { useState, useRef, useEffect } from "react";
import { shrinkImageIfLarge } from "../lib/shrink-image.client";
import PropTypes from "prop-types";
import { useFetcher, useLoaderData, useNavigate, useNavigation } from "react-router";
import { FsPage, FsCard, FsButton, FsEmpty, FsIcon } from "../components/fs-ui";
import { TOURS } from "../lib/tours";
import WorkflowCards from "../components/WorkflowCards";
import { authenticate } from "../shopify.server";
import { ensureMerchant } from "../lib/merchant.server";
import phpApiClient from "../lib/php-api.server";
import { PHP_API_URL } from "../lib/env.server";

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const [assetsRes, modelsRes, defaultsRes, sessionsRes] = await Promise.all([
    api.studioV2ListAssets(),
    api.studioV2ListModels(),
    api.getDefaultModels(),
    api.studioListSessions({ limit: 200 }),
  ]);
  const assets = assetsRes.ok ? (assetsRes.data?.assets ?? []) : [];

  // Finished try-on generations: saved (or downloaded) ones belong in the
  // asset library; everything else is kept automatically as a draft so a
  // result is never lost just because the merchant navigated away.
  const finished = (sessionsRes.ok ? (sessionsRes.data?.sessions ?? []) : [])
    .filter((s) => s.status === "completed" && s.result_image_url);
  const knownUrls = new Set(assets.map((a) => a.url));
  const savedGenerations = finished
    .filter((s) => Number(s.saved_to_gallery) === 1 && !knownUrls.has(s.result_image_url))
    .map((s) => ({
      id: s.id,
      url: s.result_image_url,
      thumbnail_url: s.result_image_url,
      source_type: "generation",
      created_at: s.created_at,
    }));
  const drafts = finished
    .filter((s) => Number(s.saved_to_gallery) === 0)
    .map((s) => ({ id: s.id, url: s.result_image_url, garment_type: s.garment_type, created_at: s.created_at }));

  return {
    assets: [...assets, ...savedGenerations],
    drafts,
    models: modelsRes.ok ? (modelsRes.data?.models ?? []) : [],
    defaultModels: defaultsRes.ok ? (defaultsRes.data?.models ?? []) : [],
    shop:   session.shop,
  };
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body._action === "upload-model") {
    const res = await api.studioV2UploadModel(body.image_url);
    return Response.json(res.ok ? res.data : { error: res.error }, { status: res.ok ? 200 : 500 });
  }
  if (body._action === "delete-model") {
    const res = await api.studioV2DeleteModel(body.saved_model_id);
    return Response.json(res.ok ? res.data : { error: res.error }, { status: res.ok ? 200 : 500 });
  }
  if (body._action === "save-draft") {
    const res = await api.studioSaveGallery(body.session_id);
    return Response.json(res.ok ? { ok: true } : { error: res.error }, { status: res.ok ? 200 : 500 });
  }
  if (body._action === "toggle-default-model") {
    const res = await api.setDefaultModelActive(body.model_key, body.active);
    return Response.json(res.ok ? res.data : { error: res.error }, { status: res.ok ? 200 : 500 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
};

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_LABELS = {
  saved_model: "Saved Model",
  generation:  "Generated Model",
  infographic: "Infographic",
};

const PER_PAGE = 12;

async function uploadToTemp(file) {
  const fd = new FormData();
  // No size limit: big originals are downscaled in the browser first (see shrink-image.client.js).
  fd.append("photo", await shrinkImageIfLarge(file));
  let res;
  try {
    res = await fetch("/api/upload", { method: "POST", body: fd });
  } catch {
    throw new Error("Network error: check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  if (!data.tempUrl) throw new Error("Upload succeeded but no URL was returned.");
  return data.tempUrl;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

function validateModelFile(file) {
  if (!ACCEPTED_TYPES.includes(file.type)) return "Only JPG, PNG, or WEBP images are supported.";
  return null;
}

// ── Shared atoms ──────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="fs-card fs-asset" aria-hidden="true">
      <div className="fs-asset-img fs-skeleton" />
      <div className="fs-asset-body">
        <div className="fs-skeleton" style={{ height: 12, width: "70%", borderRadius: 4 }} />
        <div className="fs-skeleton" style={{ height: 10, width: "45%", borderRadius: 4, marginTop: 8 }} />
      </div>
    </div>
  );
}

/** Thumbnail with graceful broken-image handling + retry (cache-busts the src). */
function AssetImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { setFailed(false); }, [src]);

  if (!src) return <FsIcon name="image" size={28} style={{ color: "#C4C7CC" }} />;

  if (failed) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--fs-muted)", fontSize: 12 }}>
        <FsIcon name="info" size={20} />
        Couldn&apos;t load
        <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" onClick={(e) => { e.stopPropagation(); setFailed(false); setAttempt((n) => n + 1); }}>Retry</button>
      </div>
    );
  }

  return (
    <img
      key={attempt}
      src={attempt > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src}
      alt={alt ?? ""}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

AssetImage.propTypes = { src: PropTypes.string, alt: PropTypes.string };

const fmtDate = (d) => (d ? new Date(String(d).replace(" ", "T")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

// ── Asset Library ─────────────────────────────────────────────────────────────

function DashboardView({ assets, loading, onCreate }) {
  const [search, setSearch]     = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort]         = useState("newest");
  const [page, setPage]         = useState(1);

  const filtered = assets
    .filter((a) => {
      if (typeFilter !== "all" && a.source_type !== typeFilter) return false;
      if (search) {
        const name = `${SOURCE_LABELS[a.source_type] ?? a.source_type} ${a.id}`.toLowerCase();
        if (!name.includes(search.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const ta = new Date(a.created_at ?? 0).getTime();
      const tb = new Date(b.created_at ?? 0).getTime();
      return sort === "newest" ? tb - ta : ta - tb;
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, totalPages);
  const paged = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const counts = assets.reduce((m, a) => ({ ...m, [a.source_type]: (m[a.source_type] ?? 0) + 1 }), {});

  if (loading) {
    return <div className="fs-asset-grid">{Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}</div>;
  }

  if (assets.length === 0) {
    return (
      <FsCard>
        <FsEmpty icon="sparkle" text="Your AI photos and infographics will live here. Create your first one in about a minute." cta="Create new asset" onClick={onCreate} />
      </FsCard>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="fs-lib-toolbar">
        <label className="fs-lib-search">
          <FsIcon name="search" size={15} />
          <input type="search" placeholder="Search assets" aria-label="Search assets" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </label>
        <div className="fs-lib-filters" role="group" aria-label="Filter by type">
          {[["all", "All", assets.length], ...Object.entries(SOURCE_LABELS).map(([k, v]) => [k, v, counts[k] ?? 0])].map(([k, label, n]) => (
            <button key={k} type="button" className={`fs-lib-filter${typeFilter === k ? " is-on" : ""}`} aria-pressed={typeFilter === k}
              disabled={k !== "all" && n === 0} onClick={() => { setTypeFilter(k); setPage(1); }}>
              {label}<span className="fs-tabular">{n}</span>
            </button>
          ))}
        </div>
        <button type="button" className="fs-lib-sort" aria-label={`Sort: ${sort === "newest" ? "newest first" : "oldest first"}`}
          onClick={() => setSort((v) => (v === "newest" ? "oldest" : "newest"))}>
          <FsIcon name="clock" size={14} />
          {sort === "newest" ? "Newest" : "Oldest"}
          <FsIcon name="chevronRight" size={12} style={{ transform: sort === "newest" ? "rotate(90deg)" : "rotate(-90deg)" }} />
        </button>
      </div>

      {filtered.length === 0 ? (
        <FsCard><FsEmpty icon="search" text="No assets match these filters." cta="Clear filters" onClick={() => { setSearch(""); setTypeFilter("all"); }} /></FsCard>
      ) : (
        <div className="fs-asset-grid">
          {paged.map((a) => (
            <article key={a.id} className="fs-card fs-asset">
              <div className="fs-asset-img">
                <AssetImage src={a.thumbnail_url || a.url} alt={SOURCE_LABELS[a.source_type] ?? "Asset"} />
                <span className="fs-pill fs-asset-tag">{SOURCE_LABELS[a.source_type] ?? a.source_type}</span>
                <div className="fs-asset-hover">
                  <a className="fs-btn fs-btn--primary fs-btn--sm" href={a.url} target="_blank" rel="noreferrer" style={{ width: "100%" }}><FsIcon name="eye" size={13} />Open</a>
                  <a className="fs-btn fs-btn--sm" href={`/api/download?url=${encodeURIComponent(a.url)}&filename=${encodeURIComponent(`brix-tryon-${a.id}.jpg`)}`} style={{ width: "100%", background: "#FFFFFF", color: "var(--fs-ink)" }}><FsIcon name="download" size={13} />Download</a>
                </div>
              </div>
              <div className="fs-asset-body">
                <div className="fs-asset-title">{SOURCE_LABELS[a.source_type] ?? "Asset"}</div>
                <div className="fs-asset-date">{fmtDate(a.created_at)}</div>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="fs-pager" style={{ padding: 0 }}>
          <span className="fs-tabular">{filtered.length} assets</span>
          <nav aria-label="Pagination" style={{ display: "flex", gap: 6 }}>
            <button type="button" className="fs-page-btn" disabled={current === 1} onClick={() => setPage(current - 1)} aria-label="Previous page">‹</button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              const p = Math.max(1, Math.min(totalPages - 6, current - 3)) + i;
              return <button key={p} type="button" className={`fs-page-btn${p === current ? " is-on" : ""}`} aria-current={p === current ? "page" : undefined} onClick={() => setPage(p)}>{p}</button>;
            })}
            <button type="button" className="fs-page-btn" disabled={current === totalPages} onClick={() => setPage(current + 1)} aria-label="Next page">›</button>
          </nav>
        </div>
      )}
    </div>
  );
}

DashboardView.propTypes = { assets: PropTypes.array, loading: PropTypes.bool, onCreate: PropTypes.func };

// ── Drafts ────────────────────────────────────────────────────────────────────

const GARMENT_LABELS = { top: "Top wear", bottom: "Bottom wear", full: "Full body", outfit: "Paired outfit", group: "Duo / group" };

/**
 * Finished generations the merchant hasn't saved or downloaded yet. They are
 * kept here automatically; saving or downloading moves one into the library.
 */
function DraftsView({ drafts, loading, onCreate }) {
  const fetcher = useFetcher();
  const [moved, setMoved] = useState(() => new Set());
  const visible = drafts.filter((d) => !moved.has(d.id));

  const keep = (id) => {
    setMoved((prev) => new Set(prev).add(id));
    fetcher.submit({ _action: "save-draft", session_id: id }, { method: "POST", encType: "application/json" });
  };

  if (loading) {
    return <div className="fs-asset-grid">{Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}</div>;
  }
  if (visible.length === 0) {
    return (
      <FsCard>
        <FsEmpty icon="image" text="No drafts. Generated images you haven't saved or downloaded yet are kept here automatically." cta="Create new asset" onClick={onCreate} />
      </FsCard>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="fs-sub" style={{ fontSize: 12, margin: 0 }}>
        Kept automatically: save or download a draft to move it into your asset library.
      </p>
      <div className="fs-asset-grid">
        {visible.map((d) => (
          <article key={d.id} className="fs-card fs-asset">
            <div className="fs-asset-img">
              <AssetImage src={d.url} alt="Draft" />
              <span className="fs-pill fs-asset-tag">Draft</span>
              <div className="fs-asset-hover">
                <button type="button" className="fs-btn fs-btn--primary fs-btn--sm" style={{ width: "100%" }} onClick={() => keep(d.id)}>
                  <FsIcon name="check" size={13} />Save to library
                </button>
                <a className="fs-btn fs-btn--sm" style={{ width: "100%", background: "#FFFFFF", color: "var(--fs-ink)" }}
                  href={`/api/download?url=${encodeURIComponent(d.url)}&filename=${encodeURIComponent(`brix-tryon-${d.id}.jpg`)}`}
                  onClick={() => keep(d.id)}>
                  <FsIcon name="download" size={13} />Download
                </a>
              </div>
            </div>
            <div className="fs-asset-body">
              <div className="fs-asset-title">{GARMENT_LABELS[d.garment_type] ?? "Generated image"}</div>
              <div className="fs-asset-date">{fmtDate(d.created_at)}</div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

DraftsView.propTypes = { drafts: PropTypes.array, loading: PropTypes.bool, onCreate: PropTypes.func };

// ── Saved Models (flat, no categorization) ────────────────────────────────────

function ModelsView({ models, loading }) {
  const [items, setItems] = useState(models);
  const inputRef = useRef(null);
  const uploadFetcher = useFetcher();
  const delFetcher = useFetcher();
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { setItems(models); }, [models]);

  useEffect(() => {
    if (uploadFetcher.state === "idle" && uploadFetcher.data !== undefined) {
      setUploading(false);
      if (uploadFetcher.data?.ok) {
        setItems((p) => [{ id: uploadFetcher.data.id, image_url: uploadFetcher.data.image_url, created_at: uploadFetcher.data.created_at }, ...p]);
        setErr(null);
      } else {
        setErr(uploadFetcher.data?.error ?? "Upload failed.");
      }
    }
  }, [uploadFetcher.state, uploadFetcher.data]);

  useEffect(() => {
    if (delFetcher.state === "idle" && delFetcher.data?.ok && confirmDel) {
      setItems((p) => p.filter((m) => m.id !== confirmDel.id));
      setConfirmDel(null);
    }
  }, [delFetcher.state, delFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = async (file) => {
    if (!file) return;
    const validationError = validateModelFile(file);
    if (validationError) { setErr(validationError); return; }
    setUploading(true); setErr(null);
    try {
      const url = await uploadToTemp(file);
      uploadFetcher.submit({ _action: "upload-model", image_url: url }, { method: "POST", encType: "application/json" });
    } catch (e) { setUploading(false); setErr(e.message ?? "Upload failed."); }
  };

  const confirmDelete = () => {
    delFetcher.submit({ _action: "delete-model", saved_model_id: confirmDel.id }, { method: "POST", encType: "application/json" });
  };

  if (loading) {
    return <div className="fs-asset-grid">{Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FsCard style={{ flexDirection: "row", alignItems: "center", gap: 16, padding: 20, flexWrap: "wrap" }}>
        <span className="fs-tile-icon"><FsIcon name="users" size={20} /></span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Custom models</div>
          <p className="fs-card-sub" style={{ marginTop: 2 }}>Front-facing, full body, clean background · JPG, PNG or WEBP, any size</p>
        </div>
        <FsButton icon="upload" disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? "Uploading…" : "Upload model"}</FsButton>
        <input ref={inputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" style={{ display: "none" }} aria-label="Upload model photo"
          onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
      </FsCard>
      {err && <div className="fs-banner fs-banner--critical" role="alert"><FsIcon name="info" size={16} /><span>{err}</span></div>}

      {items.length === 0 ? (
        <FsCard><FsEmpty icon="users" text="Save a model photo once, then reuse it for every product." cta="Upload model" onClick={() => inputRef.current?.click()} /></FsCard>
      ) : (
        <div className="fs-asset-grid">
          {items.map((m) => (
            <article key={m.id} className="fs-card fs-asset">
              <div className="fs-asset-img"><AssetImage src={m.image_url} alt="Saved model" /></div>
              <div className="fs-asset-body" style={{ gap: 10, display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 12, color: "var(--fs-muted)" }}>Added {fmtDate(m.created_at)}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <FsButton size="sm" style={{ flex: 1 }} onClick={() => navigate(`/app/studio/create?workflow=model-generation&saved_model_id=${encodeURIComponent(m.id)}`)}>Use</FsButton>
                  <a className="fs-btn fs-btn--ghost fs-btn--sm" href={m.image_url} download aria-label="Download model photo"><FsIcon name="download" size={14} /></a>
                  <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" aria-label="Delete model" onClick={() => setConfirmDel(m)}><FsIcon name="trash" size={14} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {confirmDel && (
        <div className="fs-modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setConfirmDel(null); }}>
          <div className="fs-modal" role="dialog" aria-modal="true" aria-label="Delete model" style={{ width: 400, padding: 24 }}>
            <h3 className="fs-h3">Delete this model?</h3>
            <p className="fs-sub" style={{ margin: "8px 0 20px", fontSize: 13, lineHeight: 1.6 }}>It&apos;s removed from your saved models. Images you already created stay in your library.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <FsButton variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</FsButton>
              <button type="button" className="fs-btn fs-btn--danger" disabled={delFetcher.state !== "idle"} onClick={confirmDelete}>{delFetcher.state !== "idle" ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

ModelsView.propTypes = { models: PropTypes.array, loading: PropTypes.bool };

// ── Default model library ─────────────────────────────────────────────────────

function DefaultModelCard({ model }) {
  const fetcher = useFetcher();
  // Optimistic: show the new state while the toggle is saving.
  const pending = fetcher.state !== "idle" && fetcher.json ? !!fetcher.json.active : null;
  const activated = pending ?? (fetcher.data?.ok ? !!fetcher.data.active : model.activated);
  const toggle = () => fetcher.submit(
    { _action: "toggle-default-model", model_key: model.model_key, active: !activated },
    { method: "POST", encType: "application/json" },
  );

  return (
    <article className={`fs-card fs-dm-card${activated ? " is-on" : ""}`}>
      <div className="fs-dm-img">
        <AssetImage src={model.thumb_url} alt={`${model.name}, default model`} />
        {activated && <span className="fs-pill fs-pill--success fs-dm-badge"><FsIcon name="check" size={11} strokeWidth={3} />Activated</span>}
      </div>
      <div className="fs-dm-body">
        <div className="fs-dm-name">{model.name}</div>
        <div className="fs-dm-meta">{model.look} · {model.age_group}</div>
        <button type="button" className={`fs-btn fs-btn--sm ${activated ? "fs-btn--ghost" : "fs-btn--dark"}`} style={{ width: "100%" }} onClick={toggle} disabled={fetcher.state !== "idle"}>
          {activated ? "Deactivate" : "Activate"}
        </button>
      </div>
    </article>
  );
}

DefaultModelCard.propTypes = { model: PropTypes.object.isRequired };

function DefaultLibrary({ models }) {
  const [gender, setGender] = useState("all");
  const [onlyActive, setOnlyActive] = useState(false);
  const ready = models.filter((m) => m.status === "ready" && m.thumb_url);
  const activeCount = ready.filter((m) => m.activated).length;
  const shown = ready.filter((m) => (gender === "all" || m.gender === gender) && (!onlyActive || m.activated));

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 className="fs-h2">Default models</h3>
          <p className="fs-sub" style={{ fontSize: 13 }}>
            {ready.length ? `${ready.length} ready-to-use models · ${activeCount} activated. Activated models appear first when you create an asset.` : "Studio-quality models you can use in any workflow."}
          </p>
        </div>
        {ready.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[["all", "All"], ["female", "Women"], ["male", "Men"]].map(([v, l]) => (
              <button key={v} type="button" className={`fs-chip${gender === v ? " is-on" : ""}`} aria-pressed={gender === v} onClick={() => setGender(v)}>
                {l} <small className="fs-tabular">{v === "all" ? ready.length : ready.filter((m) => m.gender === v).length}</small>
              </button>
            ))}
            <button type="button" className={`fs-chip${onlyActive ? " is-on" : ""}`} aria-pressed={onlyActive} onClick={() => setOnlyActive((o) => !o)}>
              Activated <small className="fs-tabular">{activeCount}</small>
            </button>
          </div>
        )}
      </div>
      {ready.length === 0 ? (
        <FsCard><FsEmpty icon="users" text="The default model library is being prepared. Upload your own model above in the meantime." /></FsCard>
      ) : shown.length === 0 ? (
        <FsCard><FsEmpty icon="search" text="No models match this filter." cta="Show all" onClick={() => { setGender("all"); setOnlyActive(false); }} /></FsCard>
      ) : (
        <div className="fs-dm-grid">
          {shown.map((m) => <DefaultModelCard key={m.model_key} model={m} />)}
        </div>
      )}
    </section>
  );
}

DefaultLibrary.propTypes = { models: PropTypes.array };

// ── Page root ─────────────────────────────────────────────────────────────────

export default function StudioPage() {
  const { assets, drafts = [], models, defaultModels = [] } = useLoaderData();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [tab, setTab] = useState("assets");
  const loading = navigation.state === "loading" && navigation.location?.pathname === "/app/studio";
  const createNew = () => navigate("/app/studio/create");

  return (
    <FsPage
      tour={TOURS.studio}
      title="AI Studio"
      subtitle="Turn one product photo into on-model images and marketing creatives."
      actions={<FsButton icon="plus" onClick={createNew}>Create new asset</FsButton>}
    >
      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h3 className="fs-h2">Start a workflow</h3>
          <p className="fs-sub" style={{ fontSize: 13 }}>Pick what you have: we&apos;ll guide you step by step.</p>
        </div>
        <WorkflowCards />
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
        <div role="tablist" aria-label="Library" className="fs-lib-tabs">
          {[
            ["assets", "Asset library", "image", assets.length],
            ["drafts", "Drafts", "clock", drafts.length],
            ["models", "Models", "users", models.length + defaultModels.filter((m) => m.status === "ready").length],
          ].map(([id, label, icon, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`fs-lib-tab${tab === id ? " is-on" : ""}`} onClick={() => setTab(id)}>
              <FsIcon name={icon} size={15} />
              {label}
              <span className={`fs-lib-count fs-tabular${id === "drafts" && n > 0 ? " is-alert" : ""}`}>{n}</span>
            </button>
          ))}
        </div>
        {tab === "assets"
          ? <DashboardView assets={assets} loading={loading} onCreate={createNew} />
          : tab === "drafts"
          ? <DraftsView drafts={drafts} loading={loading} onCreate={createNew} />
          : (
            <>
              <ModelsView models={models} loading={loading} />
              <DefaultLibrary models={defaultModels} />
            </>
          )}
      </section>
    </FsPage>
  );
}
