/**
 * app.studio._index.jsx — AI Studio dashboard: asset library + saved models.
 */

import { useState, useRef, useEffect } from "react";
import { useFetcher, useLoaderData, useNavigate, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchant } from "../lib/merchant.server";
import phpApiClient from "../lib/php-api.server";
import { PHP_API_URL } from "../lib/env.server";

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const [assetsRes, modelsRes] = await Promise.all([
    api.studioV2ListAssets(),
    api.studioV2ListModels(),
  ]);
  return {
    assets: assetsRes.ok ? (assetsRes.data?.assets ?? []) : [],
    models: modelsRes.ok ? (modelsRes.data?.models ?? []) : [],
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
  fd.append("photo", file);
  let res;
  try {
    res = await fetch("/api/upload", { method: "POST", body: fd });
  } catch {
    throw new Error("Network error — check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  if (!data.tempUrl) throw new Error("Upload succeeded but no URL was returned.");
  return data.tempUrl;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function validateModelFile(file) {
  if (!ACCEPTED_TYPES.includes(file.type)) return "Only JPG, PNG, or WEBP images are supported.";
  if (file.size > MAX_FILE_BYTES) return "File exceeds the 10 MB limit.";
  return null;
}

// ── Shared atoms ──────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="d-card">
      <div className="d-skel-thumb" />
      <div className="d-card-body">
        <div className="d-skel-line" style={{ width: "70%" }} />
        <div className="d-skel-line" style={{ width: "45%" }} />
      </div>
    </div>
  );
}

/** Thumbnail with graceful broken-image handling + retry (cache-busts the src). */
function AssetImage({ src, alt, className, style }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { setFailed(false); }, [src]);

  if (!src) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"#D1D5DB"}}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M3 15l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
      </div>
    );
  }

  if (failed) {
    return (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:"6px",color:"#9CA3AF"}}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.29 3.86l-8.18 14.18A1 1 0 003 19.5h18a1 1 0 00.87-1.5L13.71 3.86a1 1 0 00-1.72 0z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
        <span style={{fontSize:"10px"}}>Failed to load</span>
        <button
          type="button"
          className="d-act d-act-view"
          onClick={(e) => { e.stopPropagation(); setFailed(false); setAttempt((n) => n + 1); }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <img
      key={attempt}
      src={attempt > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src}
      alt={alt ?? ""}
      loading="lazy"
      className={className}
      style={style}
      onError={() => setFailed(true)}
    />
  );
}

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
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const fmt = (d) => d ? new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";

  if (loading) {
    return (
      <div className="d-grid">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="d-toolbar">
        <div className="d-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{position:"absolute",left:"11px",top:"50%",transform:"translateY(-50%)",color:"#9CA3AF",pointerEvents:"none"}}><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <input className="d-search" placeholder="Search assets…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
          <select className="d-select" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="all">All Types</option>
            {Object.entries(SOURCE_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="d-select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
      </div>

      {/* Empty */}
      {assets.length === 0 && (
        <div className="d-empty">
          <div className="d-empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="#4F46E5" strokeWidth="1.5" strokeLinejoin="round"/></svg>
          </div>
          <p className="d-empty-title">No assets yet</p>
          <p className="d-empty-sub">Create your first AI-generated product visual to get started.</p>
          <button className="d-btn-primary" onClick={onCreate}>Create New Asset</button>
        </div>
      )}

      {/* No results */}
      {assets.length > 0 && filtered.length === 0 && (
        <div className="d-empty" style={{paddingTop:"48px",paddingBottom:"48px"}}>
          <p className="d-empty-title" style={{fontSize:"13px"}}>No results</p>
          <p className="d-empty-sub">No assets match your current filters.</p>
          <button className="d-btn-ghost" onClick={() => { setSearch(""); setTypeFilter("all"); }}>Clear Filters</button>
        </div>
      )}

      {/* Grid */}
      {paged.length > 0 && (
        <div className="d-grid">
          {paged.map((a) => (
            <div key={a.id} className="d-card">
              <div className="d-card-thumb">
                <AssetImage src={a.thumbnail_url || a.url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />
              </div>
              <div className="d-card-body">
                <span style={{ fontSize:"10px",fontWeight:600,color:"#6B7280",background:"#F3F4F6",padding:"2px 8px",borderRadius:"4px" }}>
                  {SOURCE_LABELS[a.source_type] ?? a.source_type}
                </span>
                <p className="d-card-date">{fmt(a.created_at)}</p>
              </div>
              <div className="d-card-footer">
                <a href={a.url} target="_blank" rel="noreferrer" className="d-act d-act-view">View</a>
                <a href={a.url} download className="d-act d-act-dl">Download</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="d-pager">
          <button className="d-page-btn" disabled={page===1} onClick={() => setPage(p=>p-1)}>Previous</button>
          {Array.from({length:Math.min(7,totalPages)},(_,i)=>{
            const p = Math.max(1,Math.min(totalPages-6,page-3))+i;
            return <button key={p} className={`d-page-btn ${p===page?"active":""}`} onClick={() => setPage(p)}>{p}</button>;
          })}
          <button className="d-page-btn" disabled={page===totalPages} onClick={() => setPage(p=>p+1)}>Next</button>
          <span style={{fontSize:"11px",color:"#9CA3AF"}}>{filtered.length} assets</span>
        </div>
      )}
    </div>
  );
}

// ── Saved Models (flat, no categorization) ────────────────────────────────────

function ModelsView({ models, loading }) {
  const [items, setItems] = useState(models);
  const [search, setSearch] = useState("");
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
  }, [delFetcher.state, delFetcher.data]);

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

  const handleDelete = (model) => {
    setConfirmDel(model);
  };

  const confirmDelete = () => {
    delFetcher.submit({ _action: "delete-model", saved_model_id: confirmDel.id }, { method: "POST", encType: "application/json" });
  };

  const visible = items.filter((m) => !search || m.id.toLowerCase().includes(search.toLowerCase()));
  const fmt = (d) => d ? new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";

  if (loading) {
    return (
      <div className="d-models-grid">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  return (
    <div>
      <div className="d-models-top">
        <div>
          <p style={{fontWeight:700,fontSize:"13px",margin:"0 0 3px",color:"#111827"}}>Saved Models</p>
          <p style={{fontSize:"12px",color:"#6B7280",margin:0}}>
            Upload model photos to reuse across every product generation.
          </p>
        </div>
        <button className="d-btn-primary" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? "Uploading…" : "Upload New Model"}
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" style={{display:"none"}}
          onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value=""; }} />
      </div>

      <div className="d-banner d-banner-info" style={{marginBottom:"16px"}}>
        <strong>Photo tips:</strong> Front-facing full-body, clean background. JPG / JPEG / PNG / WEBP, max 10 MB.
      </div>
      {err && <div className="d-inline-err" style={{marginBottom:"16px"}}>{err}</div>}

      <div className="d-search-wrap" style={{marginBottom:"20px",maxWidth:"320px"}}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{position:"absolute",left:"11px",top:"50%",transform:"translateY(-50%)",color:"#9CA3AF",pointerEvents:"none"}}><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        <input className="d-search" placeholder="Search models…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {visible.length === 0 && (
        <div className="d-empty">
          <div className="d-empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="#4F46E5" strokeWidth="1.5"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="#4F46E5" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </div>
          <p className="d-empty-title">No saved models yet</p>
          <p className="d-empty-sub">Upload a model photo to start generating product visuals.</p>
          <button className="d-btn-primary" onClick={() => inputRef.current?.click()}>Upload New Model</button>
        </div>
      )}

      {visible.length > 0 && (
        <div className="d-models-grid">
          {visible.map((m) => (
            <div key={m.id} className="d-model-card">
              <div className="d-model-img">
                <AssetImage src={m.image_url} alt="Saved model" style={{width:"100%",height:"100%",objectFit:"cover"}} />
              </div>
              <div style={{padding:"10px 12px"}}>
                <p style={{fontSize:"10px",color:"#9CA3AF",margin:"0 0 8px"}}>{fmt(m.created_at)}</p>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                  <button className="d-btn-primary" style={{flex:1,fontSize:"10px",padding:"6px 10px"}}
                    onClick={() => navigate(`/app/studio/create?saved_model_id=${encodeURIComponent(m.id)}`)}>
                    Use
                  </button>
                  <a className="d-act d-act-dl" href={m.image_url} download>Download</a>
                  <button className="d-act d-act-del" onClick={() => handleDelete(m)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDel && (
        <div className="d-overlay" onClick={() => setConfirmDel(null)}>
          <div className="d-modal" onClick={(e) => e.stopPropagation()}>
            <p style={{fontWeight:700,fontSize:"13px",margin:"0 0 8px"}}>Delete this model?</p>
            <p style={{fontSize:"12px",color:"#6B7280",margin:"0 0 20px",lineHeight:1.6}}>
              This will permanently remove this saved model. This cannot be undone.
            </p>
            <div style={{display:"flex",gap:"8px",justifyContent:"flex-end"}}>
              <button className="d-btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="d-btn-danger" disabled={delFetcher.state !== "idle"} onClick={confirmDelete}>
                {delFetcher.state !== "idle" ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function StudioPage() {
  const { assets, models } = useLoaderData();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [tab, setTab] = useState("assets");
  const loading = navigation.state === "loading";

  return (
    <>
      <style>{CSS}</style>
      <div className="d-page">

        {/* Header */}
        <div className="d-header">
          <div>
            <h1 className="d-title">AI Studio</h1>
            <p className="d-subtitle">Generate AI-powered product visuals and marketing creatives.</p>
          </div>
          <button className="d-btn-primary d-cta" onClick={() => navigate("/app/studio/create")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{marginRight:"7px"}}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
            Create New Asset
          </button>
        </div>

        {/* Tabs */}
        <div className="d-tabs">
          <button className={`d-tab ${tab==="assets"?"active":""}`} onClick={() => setTab("assets")}>
            Asset Library
            <span className="d-tab-badge">{assets.length}</span>
          </button>
          <button className={`d-tab ${tab==="models"?"active":""}`} onClick={() => setTab("models")}>
            Saved Models
            <span className="d-tab-badge">{models.length}</span>
          </button>
        </div>

        {tab === "assets"
          ? <DashboardView assets={assets} loading={loading} onCreate={() => navigate("/app/studio/create")} />
          : <ModelsView models={models} loading={loading} />
        }
      </div>
    </>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
@keyframes si-spin { to { transform: rotate(360deg); } }
@keyframes si-shimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }

.d-page { max-width: 1200px; margin: 0 auto; padding: 28px 24px 80px; font-family: Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color: #111827; }

/* Header */
.d-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:24px; gap:16px; flex-wrap:wrap; }
.d-title { font-size:18px; font-weight:700; color:#111827; margin:0 0 4px; letter-spacing:-0.3px; }
.d-subtitle { font-size:11px; color:#6B7280; margin:0; }

/* Tabs */
.d-tabs { display:flex; gap:2px; border-bottom:1px solid #E5E7EB; margin-bottom:24px; }
.d-tab { display:inline-flex; align-items:center; gap:6px; padding:10px 16px; font-family:inherit; font-size:12px; font-weight:500; color:#6B7280; background:none; border:none; border-bottom:2px solid transparent; margin-bottom:-1px; cursor:pointer; transition:all 0.15s; }
.d-tab.active { color:#111827; border-bottom-color:#111827; font-weight:600; }
.d-tab:hover:not(.active) { color:#374151; }
.d-tab-badge { font-size:11px; font-weight:600; padding:2px 7px; border-radius:10px; background:#F3F4F6; color:#6B7280; }
.d-tab.active .d-tab-badge { background:#111827; color:#fff; }

/* Toolbar */
.d-toolbar { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; align-items:center; }
.d-search-wrap { position:relative; flex:1; min-width:180px; }
.d-search { width:100%; padding:8px 12px 8px 34px; border:1px solid #E5E7EB; border-radius:8px; font-size:12px; font-family:inherit; color:#111827; background:#fff; outline:none; box-sizing:border-box; transition:border-color 0.15s; }
.d-search:focus { border-color:#4F46E5; }
.d-select { padding:8px 10px; border:1px solid #E5E7EB; border-radius:8px; font-size:12px; font-family:inherit; color:#374151; background:#fff; outline:none; cursor:pointer; }
.d-select:focus { border-color:#4F46E5; }

/* Asset grid */
.d-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:14px; margin-bottom:24px; }
.d-card { background:#fff; border:1px solid #E5E7EB; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; transition:box-shadow 0.15s; }
.d-card:hover { box-shadow:0 4px 16px rgba(0,0,0,0.08); }
.d-card-thumb { height:180px; background:#F9FAFB; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden; }
.d-card-body { padding:12px 14px 8px; flex:1; }
.d-card-date { font-size:11px; color:#9CA3AF; margin:6px 0 0; }
.d-card-footer { display:flex; gap:6px; padding:8px 14px 12px; border-top:1px solid #F3F4F6; flex-wrap:wrap; }

/* Skeleton loaders */
.d-skel-thumb { height:180px; background:linear-gradient(90deg,#F3F4F6 25%,#E5E7EB 37%,#F3F4F6 63%); background-size:400px 100%; animation:si-shimmer 1.4s ease infinite; }
.d-skel-line { height:10px; border-radius:4px; margin:8px 0; background:linear-gradient(90deg,#F3F4F6 25%,#E5E7EB 37%,#F3F4F6 63%); background-size:400px 100%; animation:si-shimmer 1.4s ease infinite; }

/* Actions */
.d-act { font-size:11px; font-weight:600; padding:4px 10px; border-radius:6px; border:none; cursor:pointer; text-decoration:none; font-family:inherit; display:inline-flex; align-items:center; transition:all 0.15s; }
.d-act-view { background:#EEF2FF; color:#4F46E5; }
.d-act-view:hover { background:#E0E7FF; }
.d-act-dl { background:#F0FDF4; color:#059669; }
.d-act-dl:hover { background:#DCFCE7; }
.d-act-del { background:#FEF2F2; color:#EF4444; }
.d-act-del:hover { background:#FEE2E2; }

/* Pagination */
.d-pager { display:flex; align-items:center; gap:4px; justify-content:center; margin-top:20px; flex-wrap:wrap; }
.d-page-btn { padding:6px 12px; border:1px solid #E5E7EB; border-radius:7px; background:#fff; font-size:12px; font-weight:500; color:#374151; cursor:pointer; font-family:inherit; transition:all 0.15s; }
.d-page-btn.active { background:#111827; color:#fff; border-color:#111827; }
.d-page-btn:hover:not(.active):not(:disabled) { background:#F3F4F6; }
.d-page-btn:disabled { opacity:0.4; cursor:not-allowed; }

/* Empty */
.d-empty { text-align:center; padding:72px 24px; }
.d-empty-icon { width:64px; height:64px; border-radius:16px; background:#EEF2FF; display:flex; align-items:center; justify-content:center; margin:0 auto 16px; }
.d-empty-title { font-size:14px; font-weight:600; color:#111827; margin:0 0 6px; }
.d-empty-sub { font-size:11px; color:#6B7280; margin:0 0 20px; line-height:1.6; max-width:360px; margin-left:auto; margin-right:auto; }

/* Models */
.d-models-top { background:#fff; border:1px solid #E5E7EB; border-radius:12px; padding:20px; margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.d-models-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:24px; }
@media(max-width:900px){ .d-models-grid { grid-template-columns:repeat(3,1fr); } }
@media(max-width:600px){ .d-models-grid { grid-template-columns:repeat(2,1fr); } }
.d-model-card { background:#fff; border:1px solid #E5E7EB; border-radius:10px; overflow:hidden; transition:box-shadow 0.15s; }
.d-model-card:hover { box-shadow:0 4px 12px rgba(0,0,0,0.07); }
.d-model-img { height:160px; background:#F9FAFB; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden; }

/* Buttons */
.d-btn-primary { display:inline-flex; align-items:center; justify-content:center; background:#111827; color:#fff; font-size:12px; font-weight:600; padding:9px 18px; border-radius:8px; border:none; cursor:pointer; font-family:inherit; transition:all 0.15s; white-space:nowrap; }
.d-btn-primary:hover:not(:disabled) { background:#1F2937; }
.d-btn-primary:disabled { opacity:0.4; cursor:not-allowed; }
.d-btn-ghost { display:inline-flex; align-items:center; justify-content:center; background:#F3F4F6; color:#374151; font-size:12px; font-weight:500; padding:9px 18px; border-radius:8px; border:none; cursor:pointer; font-family:inherit; transition:all 0.15s; }
.d-btn-ghost:hover { background:#E5E7EB; }
.d-btn-danger { display:inline-flex; align-items:center; background:#EF4444; color:#fff; font-size:12px; font-weight:600; padding:9px 18px; border-radius:8px; border:none; cursor:pointer; font-family:inherit; transition:all 0.15s; }
.d-btn-danger:hover:not(:disabled) { background:#DC2626; }
.d-btn-danger:disabled { opacity:0.6; cursor:not-allowed; }
.d-cta { font-size:12px; padding:10px 20px; }

/* Banners */
.d-banner { padding:10px 14px; border-radius:8px; font-size:12px; line-height:1.6; }
.d-banner-warn { background:#FFFBEB; border:1px solid #FDE68A; color:#92400E; }
.d-banner-info { background:#EFF6FF; border:1px solid #BFDBFE; color:#1E40AF; }

/* Inline error */
.d-inline-err { font-size:11px; color:#DC2626; background:#FEF2F2; border:1px solid #FECACA; border-radius:6px; padding:4px 8px; margin-bottom:8px; line-height:1.4; }

/* Modal */
.d-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:9999; }
.d-modal { background:#fff; border-radius:14px; padding:24px; max-width:380px; width:90%; box-shadow:0 12px 40px rgba(0,0,0,0.18); }

@media(max-width:640px){ .d-page { padding:16px 14px 60px; } }
`;
