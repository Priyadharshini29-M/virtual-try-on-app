/**
 * app.studio.create.jsx — AI Studio: workflow selector + 5 multi-step wizards.
 * Route: /app/studio/create
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useFetcher, useLoaderData, useNavigate, useRouteLoaderData, useSearchParams } from "react-router";
import { useCelebrate } from "../components/AppShell";
import WorkflowCards from "../components/WorkflowCards";
import { FsIcon } from "../components/fs-ui";
import { authenticate } from "../shopify.server";
import { ensureMerchant } from "../lib/merchant.server";
import phpApiClient from "../lib/php-api.server";
import { PHP_API_URL } from "../lib/env.server";

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const [modelsRes, sessionsRes, productsRes, ragStatusRes, defaultsRes] = await Promise.all([
    api.studioGetModels(),
    api.studioListSessions({ limit: 50 }),
    api.getProducts(),
    api.ragStatus(),
    api.getDefaultModels(),
  ]);
  const sessions = sessionsRes.ok ? (sessionsRes.data?.sessions ?? []) : [];
  // Only offer results the merchant explicitly saved to the gallery — a fresh
  // Fashn AI generation the merchant hasn't kept yet shouldn't show up here.
  const seenSources = new Set();
  const savedGenerations = sessions.filter((s) => {
    if (
      Number(s.saved_to_gallery) !== 1 ||
      s.status !== "completed" ||
      !s.result_image_url
    )
      return false;
    // Dedupe repeat generations of the same source garment photo — sessions
    // are newest-first, so the first one seen per source image is the one kept.
    const sourceKey = s.front_image_url || s.result_image_url;
    if (seenSources.has(sourceKey)) return false;
    seenSources.add(sourceKey);
    return true;
  });
  return {
    models: modelsRes.ok ? (modelsRes.data?.models ?? {}) : {},
    // Built-in library (ready photos only), activated ones first — read by ModelSelector.
    defaultModels: (defaultsRes.ok ? (defaultsRes.data?.models ?? []) : [])
      .filter((m) => m.status === "ready" && m.image_url)
      .sort((a, b) => Number(b.activated) - Number(a.activated)),
    savedGenerations,
    // For the Marketing Infographic wizard's product picker — grounds
    // generation in real product facts instead of only free-text description
    // (see docs/rag-qdrant-implementation-plan.md).
    products: productsRes.ok ? (productsRes.data ?? []) : [],
    ragStatus: ragStatusRes.ok
      ? ragStatusRes.data
      : { enabled: false, indexed_products: 0, last_indexed_at: null },
  };
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body._action === "generate") {
    // Map workflow_type → garment_type so PHP's /studio/generate controller
    // can route to the correct AI model. PHP requires this field.
    const garmentTypeByWorkflow = {
      "model-generation": "full",
      "flat-lay": "top",
      mannequin: "top",
      accessories: "top",
      infographic: "full",
    };

    const modelKey = body.model_key || null;

    // "Upload New Model" in the wizard has no model_key — just an ad-hoc
    // photo URL. PHP accepts model_image_url directly now, unlimited, not
    // constrained by the registry's fixed 7-per-gender slots.
    const modelImageUrl = !modelKey ? body.model_image_url || null : null;
    const modelGender = body.model_gender === "male" ? "male" : "female";

    const phpBody = {
      front_image_url: body.front_image_url || null,
      back_image_url: body.back_image_url || null,
      detail_image_1_url: body.detail_image_1_url || null,
      detail_image_2_url: body.detail_image_2_url || null,
      detail_image_3_url: body.detail_image_3_url || null,
      model_key: modelKey,
      model_image_url: modelImageUrl,
      model_gender: modelGender,
      garment_type:
        body.garment_type ??
        garmentTypeByWorkflow[body.workflow_type] ??
        "full",
      clothing_prompt: body.clothing_prompt || null,
      workflow_type: body.workflow_type || null,
      // Wizard's explicit product type (e.g. "saree") — PHP uses it to pick
      // the try-on engine instead of guessing from the free-text prompt.
      product_type: body.product_type || null,
      // Accessories Try-On: which accessory and where it goes on the model,
      // so PHP can tell the try-on engine exactly where to place it.
      accessory_category: body.accessory_category || null,
      accessory_placement: body.accessory_placement || null,
    };
    if (!phpBody.front_image_url) {
      return Response.json(
        { error: "Product image is required." },
        { status: 400 },
      );
    }
    const res = await api.studioGenerate(phpBody);
    if (res.ok) return Response.json(res.data, { status: 200 });
    return Response.json(
      {
        error: res.error,
        session_id: res.data?.session_id,
        raw_error: res.data?.raw_error,
      },
      { status: 500 },
    );
  }
  if (body._action === "generate-status") {
    const res = await api.studioGenerateStatus(body.session_id);
    return Response.json(res.ok ? res.data : { error: res.error }, {
      status: res.ok ? 200 : 500,
    });
  }
  if (body._action === "set-model-image") {
    const res = await api.studioSetModelImage(body.model_key, body.image_url);
    return Response.json(res.ok ? res.data : { error: res.error }, {
      status: res.ok ? 200 : 500,
    });
  }
  if (body._action === "save-gallery") {
    await api.studioSaveGallery(body.session_id);
    return Response.json({ ok: true });
  }
  if (body._action === "infographic-create") {
    const res = await api.infographicCreate({
      product_image_url: body.product_image_url,
      description: body.description,
      // No more merchant-picked style/category — the PHP side looks at the
      // photo itself (gpt-4o-mini vision) and picks whichever real design
      // archetype (fmcg / clothing / kids clothing, then a specific layout
      // pattern) actually suits it. custom_style_prompt is still an optional
      // free-text override the merchant can type on top of that.
      custom_style_prompt: body.custom_style_prompt || null,
      size: body.size || null,
      collage: !!body.collage,
      // Optional "match a reference" mode — when set, the PHP side skips
      // archetype detection entirely and replicates THIS image's actual
      // design (background/composition/palette/label mechanic) instead.
      reference_image_url: body.reference_image_url || null,
      // RAG grounding — when set, the PHP side extracts key points from real
      // product facts (title/vendor/type/tags/description) instead of only
      // the free-text description above (see docs/rag-qdrant-implementation-plan.md).
      product_id: body.product_id || null,
    });
    return Response.json(
      res.ok
        ? res.data
        : { error: res.error ?? "Infographic generation failed" },
      { status: res.ok ? 200 : 500 },
    );
  }
  if (body._action === "infographic-edit") {
    const res = await api.infographicEdit({
      image_url: body.image_url,
      edit_prompt: body.edit_prompt,
      background_image_url: body.background_image_url || null,
    });
    return Response.json(
      res.ok ? res.data : { error: res.error ?? "Infographic edit failed" },
      { status: res.ok ? 200 : 500 },
    );
  }
  if (body._action === "infographic-generate") {
    const res = await api.infographicGenerate({
      product_image_url: body.product_image_url,
      key_points: body.key_points,
      // Vision classification (fmcg/clothing/kids clothing + archetype) runs
      // fresh on the PHP side for every call, including "Regenerate" — see
      // the infographic-create comment above.
      custom_style_prompt: body.custom_style_prompt || null,
      variation: body.variation ?? 1,
      size: body.size || null,
      collage: !!body.collage,
      reference_image_url: body.reference_image_url || null,
      product_id: body.product_id || null,
      // "Regenerate" variety — archetype ids already shown in this gallery,
      // so the PHP side hard-filters them out and is forced to pick a
      // genuinely different skill.md archetype this time.
      exclude_archetypes: body.exclude_archetypes || [],
    });
    return Response.json(
      res.ok
        ? res.data
        : { error: res.error ?? "Infographic generation failed" },
      { status: res.ok ? 200 : 500 },
    );
  }
  if (body._action === "rag-reindex") {
    const res = await api.ragReindex();
    return Response.json(
      res.ok ? res.data : { error: res.error ?? "Reindex failed" },
      { status: res.ok ? 200 : 500 },
    );
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
};

// ── Constants ─────────────────────────────────────────────────────────────────

const FEMALE_KEYS = [
  "female_child_5_8",
  "female_child_9_12",
  "female_teen_13_17",
  "female_young_adult",
  "female_adult",
  "female_mature_adult",
  "female_plus_size",
];
const MALE_KEYS = [
  "male_child_5_8",
  "male_child_9_12",
  "male_teen_13_17",
  "male_young_adult",
  "male_adult",
  "male_mature_adult",
  "male_plus_size",
];
const FALLBACK_LABELS = {
  female_child_5_8: "Female Child (5–8 yrs)",
  female_child_9_12: "Female Child (9–12 yrs)",
  female_teen_13_17: "Female Teen (13–17 yrs)",
  female_young_adult: "Female Young Adult (18–25)",
  female_adult: "Female Adult (26–35)",
  female_mature_adult: "Female Mature (36–50)",
  female_plus_size: "Female Plus Size",
  male_child_5_8: "Male Child (5–8 yrs)",
  male_child_9_12: "Male Child (9–12 yrs)",
  male_teen_13_17: "Male Teen (13–17 yrs)",
  male_young_adult: "Male Young Adult (18–25)",
  male_adult: "Male Adult (26–35)",
  male_mature_adult: "Male Mature (36–50)",
  male_plus_size: "Male Plus Size",
};

const WORKFLOWS = [
  {
    id: "model-generation",
    title: "AI Model Generation",
    desc: "Generate realistic product-on-model images from your product photo.",
    steps: ["Product Image", "Model", "Garment & Shot Type", "Details & Settings", "Output"],
  },
  {
    id: "flat-lay",
    title: "Flat Lay to Model",
    desc: "Convert flat lay garment photos into realistic worn-on-model photography.",
    steps: ["Flat Lay Image", "Model", "Garment & Shot Type", "Details & Settings", "Output"],
  },
  {
    id: "mannequin",
    title: "Ghost Mannequin to Model",
    desc: "Transform invisible mannequin photography into realistic model photography.",
    steps: ["Mannequin Image", "Model", "Garment & Shot Type", "Details & Settings", "Output"],
  },
  {
    id: "accessories",
    title: "Accessories Try-On",
    desc: "Place watches, jewellery, and bags on realistic model visuals.",
    steps: ["Accessory Image", "Model", "Type & Placement", "Details & Settings", "Output"],
  },
  {
    id: "infographic",
    title: "Marketing Infographic",
    desc: "Turn a saved Fashn AI model photo — or a fresh upload — into a promotional infographic with OpenAI-extracted highlights.",
    steps: ["Source Image", "Description", "Options", "Output"],
  },
];

const ACCESSORY_PLACEMENTS = {
  watch: ["Wrist (Left)", "Wrist (Right)"],
  necklace: ["Center Neck", "Layered", "Collarbone"],
  earring: ["Both Ears", "Left Ear", "Right Ear"],
  handbag: ["Held in Hand", "Shoulder (Left)", "Shoulder (Right)", "Crossbody"],
  sunglasses: ["On Face", "Held in Hand"],
  bracelet: ["Wrist (Left)", "Wrist (Right)", "Stacked"],
  ring: ["Ring Finger (Left)", "Ring Finger (Right)", "Index Finger"],
};

const SIZE_OPTIONS = [
  { id: "portrait", label: "Portrait", desc: "1024×1536 — tall, best for full-length garment/model shots." },
  { id: "square", label: "Square", desc: "1024×1024 — best for packaged goods and social posts." },
  { id: "landscape", label: "Landscape", desc: "1536×1024 — wide, best for banners." },
];

// ── Product type data ─────────────────────────────────────────────────────────

const PRODUCT_CATS = [
  // Ethnic / Full-Body Wear
  {
    id: "saree",
    label: "Saree",
    group: "ethnic",
    garmentType: "full",
    desc: "Silk, cotton or synthetic saree",
  },
  {
    id: "lehenga",
    label: "Lehenga / Ghagra",
    group: "ethnic",
    garmentType: "full",
    desc: "Bridal or festive lehenga",
  },
  {
    id: "dress",
    label: "Dress / Gown",
    group: "ethnic",
    garmentType: "full",
    desc: "Western or fusion dress",
  },
  {
    id: "coord-set",
    label: "Co-ord Set",
    group: "ethnic",
    garmentType: "full",
    desc: "Matching top & bottom set",
  },
  // Top Wear
  {
    id: "kurta",
    label: "Kurta / Kurti",
    group: "top-wear",
    garmentType: "top",
    desc: "Traditional Indian top wear",
  },
  {
    id: "tshirt",
    label: "T-Shirt / Top",
    group: "top-wear",
    garmentType: "top",
    desc: "Casual or graphic tee",
  },
  {
    id: "shirt",
    label: "Shirt / Blouse",
    group: "top-wear",
    garmentType: "top",
    desc: "Formal or casual shirt",
  },
  {
    id: "jacket",
    label: "Jacket / Blazer",
    group: "top-wear",
    garmentType: "top",
    desc: "Outerwear or formal jacket",
  },
  // Bottom Wear
  {
    id: "pants",
    label: "Pants / Jeans",
    group: "bottom-wear",
    garmentType: "bottom",
    desc: "Trousers, joggers or denim",
  },
  {
    id: "skirt",
    label: "Skirt / Palazzo",
    group: "bottom-wear",
    garmentType: "bottom",
    desc: "Skirt or wide-leg palazzo",
  },
  {
    id: "shorts",
    label: "Shorts / Leggings",
    group: "bottom-wear",
    garmentType: "bottom",
    desc: "Shorts or active leggings",
  },
  // Accessories
  {
    id: "jewellery",
    label: "Jewellery",
    group: "accessories",
    garmentType: "top",
    desc: "Necklace, earring, ring…",
    accCategory: "necklace",
  },
  {
    id: "watch",
    label: "Watch",
    group: "accessories",
    garmentType: "top",
    desc: "Wrist watch or smartwatch",
    accCategory: "watch",
  },
  {
    id: "handbag",
    label: "Bag / Handbag",
    group: "accessories",
    garmentType: "top",
    desc: "Clutch, tote or shoulder bag",
    accCategory: "handbag",
  },
  {
    id: "sunglasses",
    label: "Sunglasses",
    group: "accessories",
    garmentType: "top",
    desc: "Fashion or sport eyewear",
    accCategory: "sunglasses",
  },
  {
    id: "footwear",
    label: "Footwear",
    group: "accessories",
    garmentType: "bottom",
    desc: "Shoes, sandals or heels",
    accCategory: null,
  },
  // Other
  {
    id: "electronics",
    label: "Electronics / Mobile",
    group: "other",
    garmentType: "full",
    desc: "Gadgets, mobile or device",
  },
  {
    id: "other",
    label: "Other Product",
    group: "other",
    garmentType: "full",
    desc: "Product not listed above",
  },
];

const CLOTHING_GROUPS = ["ethnic", "top-wear", "bottom-wear"];

const WEAR_TYPES = [
  { id: "full", label: "Full Body", desc: "Complete head-to-toe look" },
  { id: "top", label: "Top Wear Focus", desc: "Waist-up / bust shot" },
  { id: "bottom", label: "Bottom Wear Focus", desc: "Hip-down / leg shot" },
];

function buildProductPrompt(productType, wearType) {
  const cat = PRODUCT_CATS.find((c) => c.id === productType);
  if (!cat) return null;
  const wearSuffix =
    wearType === "top"
      ? ", waist-up model shot"
      : wearType === "bottom"
        ? ", hip-down model shot"
        : ", full-body model shot";
  return `${cat.label}${wearSuffix}`;
}

// ── Upload helper (with proper error handling) ────────────────────────────────

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
  if (!data.tempUrl)
    throw new Error("Upload succeeded but no URL was returned.");
  return data.tempUrl;
}

/**
 * Triggers a real file download for a (usually cross-origin) generated-image
 * URL. A plain <a download> is silently ignored by browsers when the URL is
 * cross-origin, so this routes through /api/download, which proxies the file
 * server-side and forces it with a Content-Disposition header.
 */
function downloadUrl(url, filename) {
  if (!url) return;
  const a = document.createElement("a");
  a.href = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
  a.click();
}

// Infographic gallery entries key off `{archetype_id}-v{variation}` (see
// InfographicController::toResults()) — this pulls the archetype id back
// out so "Regenerate" can tell the PHP side which archetypes have already
// been shown for this product, forcing genuine variety across clicks
// instead of the same archetype re-styled each time.
function archetypeIdFromResultKey(key) {
  return typeof key === "string" ? key.replace(/-v\d+$/, "") : null;
}

/**
 * Shared submit-and-wait helper for the infographic-create/-generate/-edit
 * actions — synchronous: PHP runs the whole pipeline (classification,
 * extraction, scene/layout planning, compose, QC) inline and responds with
 * the finished result in one request/response cycle. A single gpt-image-1
 * compose call alone can measure 100-115s+ (see php-api.server.js's
 * infographicCreate/Generate/Edit timeouts, sized to match). Kept as a
 * shared hook (rather than inlining a useFetcher() at each call site)
 * purely to dedupe the small amount of submit/result/error plumbing needed
 * at all 7 call sites across this file (the dedicated Infographic wizard,
 * the 4 quick-addon flows, OutputScreen's regenerate, and InfographicCard's
 * edit) instead of duplicating it at each one.
 *
 * Callers read `result`/`error` via their own small useEffect (plain state
 * values in the dependency array, same idiom the rest of this file already
 * uses) rather than passing completion callbacks into this hook — avoids
 * stale-closure/exhaustive-deps complications entirely.
 */
function useInfographicJob() {
  const submitFetcher = useFetcher();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const isPending = submitFetcher.state !== "idle";

  useEffect(() => {
    if (submitFetcher.state === "idle" && submitFetcher.data) {
      if (submitFetcher.data.error) {
        setError(submitFetcher.data.error);
      } else {
        setResult(submitFetcher.data);
      }
    }
  }, [submitFetcher.state, submitFetcher.data]);

  const submit = useCallback(
    (payload) => {
      setError(null);
      setResult(null);
      submitFetcher.submit(payload, {
        method: "POST",
        action: "/app/studio/create",
        encType: "application/json",
      });
    },
    [submitFetcher],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { submit, reset, isPending, result, error };
}

// ── Resolve model info ────────────────────────────────────────────────────────

function resolveModel(models, key) {
  const s = models[key];
  return {
    key,
    label: s?.label ?? FALLBACK_LABELS[key] ?? key,
    gender: s?.gender ?? (key.startsWith("male") ? "male" : "female"),
    image_exists: s?.image_exists ?? false,
    image_url: s?.image_url ?? null,
    image_hash: s?.image_hash ?? null,
  };
}

// ── Shared atoms ──────────────────────────────────────────────────────────────

function Spin({ size = 20, color = "var(--accent-500)" }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        border: `2px solid ${color}22`,
        borderTop: `2px solid ${color}`,
        borderRadius: "50%",
        display: "inline-block",
        animation: "cr-spin 0.75s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

function FieldLabel({ children, required, hint }) {
  return (
    <div
      style={{
        marginBottom: "6px",
        display: "flex",
        alignItems: "baseline",
        gap: "4px",
      }}
    >
      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-900)" }}>
        {children}
      </span>
      {required && (
        <span style={{ color: "var(--danger-500)", fontSize: "12px" }}>*</span>
      )}
      {hint && (
        <span style={{ fontSize: "11px", color: "var(--ink-300)", fontWeight: 400 }}>
          {hint}
        </span>
      )}
    </div>
  );
}

function CrSelect({ label, required, value, onChange, options, hint }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      {label && (
        <FieldLabel required={required} hint={hint}>
          {label}
        </FieldLabel>
      )}
      <select
        className="cr-input"
        style={{ cursor: "pointer" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => {
          const isObj = o !== null && typeof o === "object";
          const optValue = isObj ? (o.value ?? "") : o;
          const optLabel = isObj ? (o.label || o.value || "") : o;
          return (
            <option key={optValue} value={optValue}>
              {optLabel}
            </option>
          );
        })}
      </select>
    </div>
  );
}

function CrTextarea({
  label,
  required,
  value,
  onChange,
  placeholder,
  rows = 3,
  hint,
}) {
  return (
    <div style={{ marginBottom: "14px" }}>
      {label && (
        <FieldLabel required={required} hint={hint}>
          {label}
        </FieldLabel>
      )}
      <textarea
        className="cr-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        style={{ resize: "vertical", lineHeight: 1.5 }}
      />
    </div>
  );
}

function CrInput({ label, value, onChange, placeholder, hint }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      {label && <FieldLabel hint={hint}>{label}</FieldLabel>}
      <input
        className="cr-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

// ── Upload Zone ───────────────────────────────────────────────────────────────

function UploadZone({
  label,
  required,
  value,
  onChange,
  hint,
  compact = false,
  note,
}) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = useCallback(
    async (file) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("Invalid file type. Please use JPEG, PNG, or WEBP.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("File is too large. Maximum size is 5 MB.");
        return;
      }
      setError(null);
      setUploading(true);
      try {
        const url = await uploadToTemp(file);
        onChange(url);
      } catch (e) {
        setError(e.message ?? "Upload failed. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [onChange],
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDrag(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const height = compact ? "90px" : "140px";

  return (
    <div style={{ marginBottom: "16px" }}>
      {label && (
        <FieldLabel required={required} hint={hint}>
          {label}
        </FieldLabel>
      )}
      {note && (
        <p
          style={{
            fontSize: "12px",
            color: "var(--ink-500)",
            margin: "0 0 8px",
            lineHeight: 1.5,
            background: "var(--surface-2)",
            padding: "8px 10px",
            borderRadius: "6px",
            borderLeft: "3px solid var(--border-strong)",
          }}
        >
          {note}
        </p>
      )}

      <div
        className={`cr-zone ${drag ? "drag" : ""} ${value ? "filled" : ""} ${error ? "errored" : ""}`}
        style={{ height }}
        role="button"
        tabIndex={0}
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !uploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        {uploading ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Spin size={22} />
            <span style={{ fontSize: "12px", color: "var(--ink-500)" }}>
              Uploading…
            </span>
          </div>
        ) : value ? (
          <>
            <img
              src={value}
              alt="Uploaded"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                padding: "6px",
                boxSizing: "border-box",
              }}
            />
            <div className="cr-zone-bar">✓ Uploaded — click to replace</div>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "12px" }}>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              style={{
                color: "var(--ink-300)",
                display: "block",
                margin: "0 auto 8px",
              }}
            >
              <path
                d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <polyline
                points="17,8 12,3 7,8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <line
                x1="12"
                y1="3"
                x2="12"
                y2="15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <p
              style={{
                fontSize: "12px",
                color: "var(--ink-500)",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Drop image here or{" "}
              <span style={{ color: "var(--accent-500)", fontWeight: 600 }}>
                click to browse
              </span>
            </p>
            <p
              style={{ fontSize: "10px", color: "var(--ink-300)", margin: "4px 0 0" }}
            >
              JPEG · PNG · WEBP · Max 5 MB
            </p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <div className="cr-field-error">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            style={{ flexShrink: 0 }}
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M12 8v4M12 16h.01"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              fontSize: "14px",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

// ── Workflow colour map ───────────────────────────────────────────────────────

const BRAND = { accent: "var(--accent-500)", light: "var(--accent-50)", dark: "var(--accent-600)" };

const WF_COLORS = {
  "model-generation": { ...BRAND, time: "~45 sec" },
  "flat-lay": { ...BRAND, time: "~60 sec" },
  mannequin: { ...BRAND, time: "~50 sec" },
  accessories: { ...BRAND, time: "~40 sec" },
  infographic: { ...BRAND, time: "~90 sec" },
};

// ── Step navigation ───────────────────────────────────────────────────────────

function StepNav({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
  isGenerate = false,
}) {
  return (
    <div className="cr-nav">
      {onBack ? (
        <button className="cr-btn cr-btn-ghost" onClick={onBack}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            style={{ marginRight: "5px" }}
          >
            <path
              d="M19 12H5M5 12l6 6M5 12l6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </button>
      ) : (
        <div />
      )}
      {isGenerate ? (
        <div className="cr-gen-wrap">
          <button
            className="cr-btn-generate"
            onClick={onNext}
            disabled={nextDisabled}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              style={{ marginRight: "8px" }}
            >
              <path
                d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                fill="currentColor"
              />
            </svg>
            {nextLabel}
          </button>
          <p className="cr-credit-note">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              style={{
                display: "inline",
                marginRight: "3px",
                verticalAlign: "middle",
              }}
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M12 8v4M12 16h.01"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Uses 1 generation credit · Est. 30–90 seconds
          </p>
        </div>
      ) : (
        <button
          className="cr-btn cr-btn-primary"
          onClick={onNext}
          disabled={nextDisabled}
        >
          {nextLabel}
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            style={{ marginLeft: "6px" }}
          >
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── Step card wrapper ─────────────────────────────────────────────────────────

function Card({ children, style }) {
  return (
    <div className="cr-card" style={style}>
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 className="cr-card-title">{children}</h2>;
}

function SectionDesc({ children }) {
  return <p className="cr-card-desc">{children}</p>;
}

// ── Infographic Addon ─────────────────────────────────────────────────────────

function InfographicAddon({
  checked,
  onChange,
  description,
  onDescriptionChange,
  customStyle,
  onCustomStyleChange,
  collage,
  onCollageChange,
  referenceImageUrl,
  onReferenceImageChange,
}) {
  return (
    <div className="cr-addon-row">
      <div
        className="cr-addon-inner"
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        style={{ cursor: "pointer" }}
      >
        <div className="cr-addon-icon-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect
              x="3"
              y="3"
              width="18"
              height="18"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M7 17V13M10 17V9M13 17v-5M16 17V7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="cr-addon-text">
          <p className="cr-addon-title">Also generate Marketing Infographic</p>
          <p className="cr-addon-sub">
            AI reads your product description, pulls out key highlights, and
            looks at the photo itself to pick a matching design before
            composing the infographic.
          </p>
        </div>
        <div className="cr-addon-right">
          <span className="cr-addon-credit">+1 credit</span>
          <div className={`cr-toggle ${checked ? "on" : ""}`}>
            <div className="cr-toggle-thumb" />
          </div>
        </div>
      </div>

      {checked && (
        <div
          style={{ padding: "12px 14px 14px", borderTop: "1px solid var(--surface-2)" }}
        >
          <div style={{ marginBottom: "10px" }}>
            <FieldLabel
              required
              hint="AI extracts 3–4 short highlights — no sentences"
            >
              Product Description
            </FieldLabel>
            <textarea
              className="cr-input"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="e.g. This Banarasi silk saree is crafted from 100% pure Katan silk with intricate gold zari weaving across the pallu and double-layered border. Machine wash safe. Free size."
              rows={3}
              style={{ resize: "vertical", lineHeight: 1.5, margin: 0 }}
            />
          </div>
          <div style={{ marginBottom: "10px" }}>
            <FieldLabel hint="optional — describe how you want the background/theme to look">
              Custom Background / Theme
            </FieldLabel>
            <textarea
              className="cr-input"
              value={customStyle}
              onChange={(e) => onCustomStyleChange(e.target.value)}
              placeholder="e.g. soft pastel pink background with floating stars, or a festive Diwali theme with diyas and marigold accents"
              rows={2}
              style={{ resize: "vertical", lineHeight: 1.5, margin: 0 }}
            />
          </div>
          <div style={{ marginBottom: "10px" }}>
            <FieldLabel hint="optional — upload an example infographic to replicate its exact design instead of AI auto-picking one">
              Match a Reference Design
            </FieldLabel>
            <UploadZone
              compact
              value={referenceImageUrl}
              onChange={onReferenceImageChange}
              note="If set, this overrides auto-detection — the layout, palette, and label style are copied from this image."
            />
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              color: referenceImageUrl ? "var(--ink-300)" : "var(--ink-700)",
              cursor: referenceImageUrl ? "not-allowed" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={collage}
              disabled={!!referenceImageUrl}
              onChange={(e) => onCollageChange(e.target.checked)}
            />
            Generate as a 4-image collage set (hero, 2 detail zooms, features)
            instead of one image
          </label>
        </div>
      )}
    </div>
  );
}

// ── Product Type Selector ─────────────────────────────────────────────────────

const PT_GROUPS = [
  { label: "Ethnic / Full-Body Wear", key: "ethnic" },
  { label: "Top Wear", key: "top-wear" },
  { label: "Bottom Wear", key: "bottom-wear" },
  { label: "Accessories & Jewellery", key: "accessories" },
  { label: "Other", key: "other" },
];

// Dropdown pairing of garment type + model shot type, used as a single step
// after the image/model uploads (replaces the old ProductTypeStep button grid).
function TypeShotStep({ productType, wearType, onTypeChange, onWearChange }) {
  const selected = PRODUCT_CATS.find((c) => c.id === productType);
  const isClothing = selected && CLOTHING_GROUPS.includes(selected.group);
  const options = [
    { value: "", label: "Select a type…" },
    ...PT_GROUPS.flatMap((g) =>
      PRODUCT_CATS.filter((c) => c.group === g.key).map((c) => ({
        value: c.id,
        label: `${c.label} — ${g.label}`,
      })),
    ),
  ];

  return (
    <div className="cr-settings-grid">
      <CrSelect
        label="Garment Type"
        required
        value={productType ?? ""}
        onChange={(v) => {
          onTypeChange(v || null);
          const cat = PRODUCT_CATS.find((c) => c.id === v);
          if (cat) onWearChange(cat.garmentType);
        }}
        options={options}
      />
      {isClothing && (
        <CrSelect
          label="Model Shot Type"
          hint="how should the model display this garment?"
          value={wearType}
          onChange={onWearChange}
          options={WEAR_TYPES.map((w) => ({ value: w.id, label: w.label }))}
        />
      )}
    </div>
  );
}

// ── Model Selector ────────────────────────────────────────────────────────────

function ModelSelector({ models, selectedKey, onSelect }) {
  const defaultModels = useRouteLoaderData("routes/app.studio.create")?.defaultModels ?? [];
  const [tab, setTab] = useState(defaultModels.length ? "library" : "saved");
  const [newUrl, setNewUrl] = useState(null);
  const [libGender, setLibGender] = useState("all");
  const [libPick, setLibPick] = useState(null); // model_key of the picked library model
  const libShown = defaultModels.filter((m) => libGender === "all" || m.gender === libGender);
  const activatedCount = defaultModels.filter((m) => m.activated).length;
  const pickedLib = libPick && selectedKey === "__custom__" ? defaultModels.find((m) => m.model_key === libPick) : null;

  // Merge both gender brackets into one flat list, keep only slots that
  // actually have a photo, and drop duplicate photos. Slots always have
  // distinct URLs (one file per slot), so the same photo saved into more
  // than one bracket is detected by content hash instead.
  const seenHashes = new Set();
  const savedModels = [...FEMALE_KEYS, ...MALE_KEYS]
    .map((key) => resolveModel(models, key))
    .filter((m) => {
      if (!m.image_exists || !m.image_url) return false;
      const dedupeKey = m.image_hash ?? m.image_url;
      if (seenHashes.has(dedupeKey)) return false;
      seenHashes.add(dedupeKey);
      return true;
    })
    .map((m, i) => ({ ...m, label: `Model ${i + 1}` }));

  return (
    <div>
      <div className="cr-model-tabs">
        {defaultModels.length > 0 && (
          <button
            type="button"
            className={`cr-model-tab ${tab === "library" ? "active" : ""}`}
            onClick={() => setTab("library")}
          >
            Model library
          </button>
        )}
        <button
          className={`cr-model-tab ${tab === "saved" ? "active" : ""}`}
          onClick={() => setTab("saved")}
        >
          Select Saved Model
        </button>
        <button
          className={`cr-model-tab ${tab === "upload" ? "active" : ""}`}
          onClick={() => setTab("upload")}
        >
          Upload New Model
        </button>
      </div>

      {tab === "library" ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {[["all", "All"], ["female", "Women"], ["male", "Men"]].map(([v, l]) => (
              <button key={v} type="button" className={`cr-choice-btn ${libGender === v ? "active" : ""}`} onClick={() => setLibGender(v)}>
                {l}
              </button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-500)" }}>
              {activatedCount > 0 ? `Your ${activatedCount} activated model${activatedCount === 1 ? "" : "s"} are shown first` : "Activate favourites in AI Studio → Models"}
            </span>
          </div>
          <div className="cr-model-grid">
            {libShown.map((m) => {
              const sel = pickedLib?.model_key === m.model_key;
              const pick = () => { setLibPick(m.model_key); onSelect("__custom__", m.image_url, m.gender); };
              return (
                <div
                  key={m.model_key}
                  className={`cr-model-card ${sel ? "selected" : ""}`}
                  title={`${m.name} — ${m.look}, ${m.age_group}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={sel}
                  onClick={pick}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }}
                >
                  <div className="cr-model-thumb">
                    <img src={m.thumb_url || m.image_url} alt={m.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {sel && <div className="cr-model-tick">✓</div>}
                    {m.activated && !sel && <span className="cr-model-fav" aria-label="Activated">★</span>}
                  </div>
                  <div className="cr-model-name">{m.name}</div>
                </div>
              );
            })}
          </div>
          {pickedLib && (
            <div className="cr-ok-banner">
              ✓ Selected: <strong>{pickedLib.name}</strong> · {pickedLib.look}, {pickedLib.age_group}
            </div>
          )}
        </div>
      ) : tab === "upload" ? (
        <div>
          <p
            style={{
              fontSize: "12px",
              color: "var(--ink-500)",
              margin: "0 0 12px",
              lineHeight: 1.6,
              background: "var(--surface-2)",
              padding: "8px 10px",
              borderRadius: "6px",
              borderLeft: "3px solid var(--border-strong)",
            }}
          >
            Upload a full-body, front-facing model photo on a clean background.
            Min 768×1024 px. Max 5 MB.
          </p>
          <UploadZone
            label="Model Photo"
            required
            value={newUrl}
            onChange={(url) => {
              setNewUrl(url);
              setLibPick(null);
              onSelect("__custom__", url, "female");
            }}
          />
          {newUrl && (
            <div className="cr-ok-banner">
              ✓ Model photo ready. Continue to the next step.
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="cr-model-grid">
            {savedModels.map((m) => {
              const sel = selectedKey === m.key;
              return (
                <div
                  key={m.key}
                  className={`cr-model-card ${sel ? "selected" : ""}`}
                  title={m.label}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(m.key, m.image_url, m.gender)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(m.key, m.image_url, m.gender);
                    }
                  }}
                >
                  <div className="cr-model-thumb">
                    <img
                      src={m.image_url}
                      alt={m.label}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                    {sel && <div className="cr-model-tick">✓</div>}
                  </div>
                  <div className="cr-model-name">{m.label}</div>
                </div>
              );
            })}
            {savedModels.length === 0 && (
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--ink-300)",
                  gridColumn: "1 / -1",
                }}
              >
                No saved model photos yet — go to Studio Models to add one, or
                upload a new model above.
              </p>
            )}
          </div>
          {selectedKey && selectedKey !== "__custom__" && (
            <div className="cr-ok-banner">
              ✓ Selected:{" "}
              <strong>
                {savedModels.find((m) => m.key === selectedKey)?.label ??
                  "Model"}
              </strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Generating Screen ─────────────────────────────────────────────────────────

function GeneratingScreen({ wfId }) {
  const col = WF_COLORS[wfId] ?? BRAND;
  const stages =
    wfId === "infographic"
      ? [
          "Loading your product image",
          "Composing infographic canvas",
          "Placing product on layout",
          "Rendering key-point badges",
          "Applying final design polish",
          "Saving your infographic",
        ]
      : [
          "Analysing uploaded image references",
          "Detecting garment shape and texture",
          "Selecting best model pose and drape",
          "Applying fabric physics and lighting",
          "Rendering at high resolution",
          "Final commercial quality pass",
        ];
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const stage = setInterval(
      () => setIdx((i) => Math.min(i + 1, stages.length - 1)),
      12000,
    );
    const clock = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(stage);
      clearInterval(clock);
    };
  }, [stages.length]);

  const pct = Math.min(
    95,
    Math.round((idx / (stages.length - 1)) * 90) + Math.round(elapsed * 0.3),
  );

  return (
    <div className="cr-generating">
      {/* Animated ring */}
      <div className="cr-gen-orbit" style={{ "--accent": col.accent }}>
        <div className="cr-gen-orbit-ring" />
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
            fill={col.accent}
          />
        </svg>
      </div>

      <h3 className="cr-gen-title">Creating your image…</h3>
      <p className="cr-gen-sub">
        Do not close this tab — generation is in progress.
      </p>

      {/* Progress bar */}
      <div className="cr-gen-bar-track">
        <div
          className="cr-gen-bar-fill"
          style={{ width: `${pct}%`, background: col.accent }}
        />
      </div>
      <div className="cr-gen-pct" style={{ color: col.accent }}>
        {pct}%
      </div>

      {/* Stage list */}
      <div className="cr-gen-stages">
        {stages.map((s, i) => (
          <div
            key={i}
            className={`cr-gen-stage ${i < idx ? "done" : i === idx ? "active" : ""}`}
          >
            <div
              className="cr-gen-stage-icon"
              style={i === idx ? { background: col.accent } : {}}
            >
              {i < idx ? (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 12l5 5L20 7"
                    stroke="#fff"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              ) : i === idx ? (
                <span className="cr-gen-pulse" />
              ) : (
                <span
                  style={{
                    width: "5px",
                    height: "5px",
                    borderRadius: "50%",
                    background: "var(--border-strong)",
                  }}
                />
              )}
            </div>
            {s}
          </div>
        ))}
      </div>

      <p className="cr-gen-timer">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          style={{
            display: "inline",
            marginRight: "4px",
            verticalAlign: "middle",
          }}
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 7v5l3 3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        {elapsed}s elapsed · Typical range: 30–90 seconds
      </p>
    </div>
  );
}

// ── Output Screen ─────────────────────────────────────────────────────────────

function OutputScreen({
  result,
  sessionId,
  onRegenerate,
  wfId,
  infographicResult,
  infographicLoading,
  infographicError,
  onInfographicUpdate,
  infographicRegenInput,
  onInfographicAppend,
}) {
  const col = WF_COLORS[wfId] ?? BRAND;
  const fetcher = useFetcher();
  const productFetcher = useFetcher();
  const celebrate = useCelebrate();
  const [saved, setSaved] = useState(false);
  const [attachedTo, setAttachedTo] = useState(null);

  useEffect(() => {
    if (result) celebrate({ title: "Your image is ready", body: "Save it to your library to keep it for later." });
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setSaved(true);
      celebrate({ title: "Saved to library", body: "Find it any time in AI Studio." });
    }
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (productFetcher.state === "idle" && productFetcher.data?.ok && attachedTo) {
      setSaved(true);
      celebrate({ title: "Added to your product", body: `The image is now in ${attachedTo}'s media.` });
    }
  }, [productFetcher.state, productFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shopify's own product picker (App Bridge), then attach via the existing
  // save-gallery endpoint, which adds the image to the product's media.
  const attachToProduct = async () => {
    const picker = typeof window !== "undefined" ? window.shopify?.resourcePicker : null;
    if (!picker) return;
    const selection = await picker({ type: "product", multiple: false, action: "select" });
    const product = selection?.[0];
    if (!product?.id) return;
    setAttachedTo(product.title ?? "the product");
    productFetcher.submit(
      { _action: "save-gallery", session_id: sessionId, result_image_url: result, shopify_product_gid: product.id },
      { method: "POST", action: "/api/studio", encType: "application/json" },
    );
  };

  const save = () =>
    fetcher.submit(
      { _action: "save-gallery", session_id: sessionId },
      {
        method: "POST",
        action: "/app/studio/create",
        encType: "application/json",
      },
    );
  const download = () => downloadUrl(result, `studio_${Date.now()}.jpg`);

  // ── Infographic "regenerate" (up to 5 visually distinct variations) ────────
  const regenJob = useInfographicJob();
  const [regenError, setRegenError] = useState(null);
  const isRegenerating = regenJob.isPending;
  const regenCount = infographicResult?.length ?? 0;
  const canRegenerate =
    !!infographicRegenInput?.imageUrl &&
    infographicRegenInput?.keyPoints?.length > 0;

  useEffect(() => {
    if (regenJob.result) {
      setRegenError(null);
      onInfographicAppend?.(regenJob.result.results?.[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regenJob.result]);

  useEffect(() => {
    if (regenJob.error) setRegenError(regenJob.error);
  }, [regenJob.error]);

  const regenerate = () => {
    if (!infographicRegenInput) return;
    setRegenError(null);
    regenJob.submit({
      _action: "infographic-generate",
      product_image_url: infographicRegenInput.imageUrl,
      key_points: infographicRegenInput.keyPoints,
      custom_style_prompt: infographicRegenInput.customStylePrompt || null,
      size: infographicRegenInput.size || null,
      collage: !!infographicRegenInput.collage,
      reference_image_url: infographicRegenInput.referenceImageUrl || null,
      variation: regenCount + 1,
      exclude_archetypes: [
        ...new Set(
          (infographicResult ?? [])
            .map((r) => archetypeIdFromResultKey(r.key))
            .filter(Boolean),
        ),
      ],
    });
  };

  return (
    <div>
      {/* Celebration header */}
      <div
        className="cr-complete-header"
        style={{ "--accent": col.accent, "--light": col.light }}
      >
        <div className="cr-complete-check">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12l5 5L20 7"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <p className="cr-complete-title">Your image is ready</p>
          <p className="cr-complete-sub">
            Download it in HD, save it to your library, or add it straight to a
            product.
          </p>
        </div>
      </div>

      {/* Result image */}
      {result && (
        <>
          <a
            href={result}
            target="_blank"
            rel="noreferrer"
            className="cr-result-img-wrap"
            style={{ cursor: "zoom-in" }}
          >
            <img
              src={result}
              alt="Generated result"
              className="cr-result-img"
            />
          </a>

          {/* Actions */}
          <div className="cr-result-actions">
            <button className="cr-btn cr-btn-ghost" onClick={onRegenerate}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                style={{ marginRight: "5px" }}
              >
                <path
                  d="M3 12a9 9 0 119 9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M3 7v5h5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Try Again
            </button>
            <button className="cr-btn cr-btn-outline" onClick={download}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                style={{ marginRight: "5px" }}
              >
                <path
                  d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <polyline
                  points="7,10 12,15 17,10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="12"
                  y1="3"
                  x2="12"
                  y2="15"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
              Download HD
            </button>
            <button
              type="button"
              className="cr-btn cr-btn-outline"
              onClick={attachToProduct}
              disabled={productFetcher.state !== "idle" || !sessionId}
            >
              <FsIcon name="box" size={14} style={{ marginRight: 5 }} />
              {productFetcher.state !== "idle"
                ? "Adding…"
                : attachedTo && productFetcher.data?.ok
                  ? "Added to product"
                  : "Use on product"}
            </button>
            <button
              className="cr-btn-save"
              style={{ background: col.accent }}
              onClick={save}
              disabled={saved || fetcher.state !== "idle"}
            >
              {saved
                ? "✓ Saved"
                : fetcher.state !== "idle"
                  ? "Saving…"
                  : "Save to Library →"}
            </button>
          </div>
        </>
      )}

      {/* Infographic result — OpenAI-generated creative variants */}
      {(infographicLoading ||
        infographicResult?.length > 0 ||
        infographicError) && (
        <div className="cr-info-result">
          <div className="cr-info-result-hdr">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              style={{ color: "#059669", flexShrink: 0 }}
            >
              <rect
                x="3"
                y="3"
                width="18"
                height="18"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M7 17V13M10 17V9M13 17v-5M16 17V7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            <p className="cr-info-result-title">Marketing Infographic</p>
            {infographicLoading && <Spin size={13} color="#059669" />}
          </div>
          {infographicLoading && (
            <div className="cr-info-loading">
              <Spin size={16} color="#059669" />
              <span className="cr-info-loading-text">
                Generating creatives in background…
              </span>
            </div>
          )}
          {infographicError &&
            !infographicLoading &&
            !infographicResult?.length && (
              <p
                style={{
                  fontSize: "12px",
                  color: "#DC2626",
                  margin: "4px 0 0",
                }}
              >
                Infographic generation failed: {infographicError}
              </p>
            )}
          {infographicResult?.length > 0 && (
            <InfographicGallery
              results={infographicResult}
              onUpdate={onInfographicUpdate}
            />
          )}
          {canRegenerate && (
            <div style={{ marginTop: "12px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                {regenCount < 5 ? (
                  <button
                    type="button"
                    className="cr-btn cr-btn-outline"
                    onClick={regenerate}
                    disabled={isRegenerating}
                  >
                    {isRegenerating ? (
                      <>
                        <Spin size={13} color="#059669" /> Generating…
                      </>
                    ) : (
                      `Regenerate — Try a Different Idea (${regenCount}/5)`
                    )}
                  </button>
                ) : (
                  <span style={{ fontSize: "12px", color: "var(--ink-300)" }}>
                    Max 5 variations reached.
                  </span>
                )}
              </div>
              {regenError && (
                <p
                  style={{
                    fontSize: "12px",
                    color: "#DC2626",
                    margin: "8px 0 0",
                  }}
                >
                  Regeneration failed: {regenError}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Grid of OpenAI-generated infographic creative variants, one per layout template. */
function InfographicGallery({ results, onUpdate }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(results.length, 3)}, minmax(0,1fr))`,
        gap: "12px",
        marginTop: "10px",
      }}
    >
      {results.map((r, i) => (
        <InfographicCard
          key={r.key}
          result={r}
          onUpdate={(newImage) => onUpdate?.(i, newImage)}
        />
      ))}
    </div>
  );
}

/** Single infographic result with download + a "describe your change" edit prompt (OpenAI images/edits). */
const TEXT_COLORS = [
  "#111827",
  "#1E3A8A",
  "#B91C1C",
  "#059669",
  "#B45309",
  "#7C3AED",
  "#FFFFFF",
];
const BG_COLORS = [
  "#FFFFFF",
  "#F3F4F6",
  "#FEF3C7",
  "#DBEAFE",
  "#FCE7F3",
  "#D1FAE5",
  "#111827",
];
const BG_GRADIENTS = [
  {
    id: "sunset",
    label: "Sunset",
    css: "linear-gradient(135deg,#FDE68A,#FCA5A5)",
    desc: "warm sunset gradient from soft yellow (#FDE68A) to soft coral (#FCA5A5)",
  },
  {
    id: "ocean",
    label: "Ocean",
    css: "linear-gradient(135deg,#BAE6FD,#818CF8)",
    desc: "cool ocean gradient from sky blue (#BAE6FD) to indigo (#818CF8)",
  },
  {
    id: "blush",
    label: "Blush",
    css: "linear-gradient(135deg,#FBCFE8,#E9D5FF)",
    desc: "soft blush gradient from pink (#FBCFE8) to lavender (#E9D5FF)",
  },
  {
    id: "mint",
    label: "Mint",
    css: "linear-gradient(135deg,#D1FAE5,#A7F3D0)",
    desc: "fresh mint gradient from light green (#D1FAE5) to mint (#A7F3D0)",
  },
  {
    id: "dusk",
    label: "Dusk",
    css: "linear-gradient(135deg,#1F2937,#4B5563)",
    desc: "moody dusk gradient from charcoal (#1F2937) to slate grey (#4B5563)",
  },
];

function InfographicCard({ result, onUpdate }) {
  const editJob = useInfographicJob();
  const [panel, setPanel] = useState(null); // null | "style" — the prompt bar is always visible now
  const [editPrompt, setEditPrompt] = useState("");
  const [textColor, setTextColor] = useState(null);
  const [textSize, setTextSize] = useState(null);
  const [textWeight, setTextWeight] = useState(null);
  const [bgColor, setBgColor] = useState(null);
  const [bgGradient, setBgGradient] = useState(null);
  const [bgImageUrl, setBgImageUrl] = useState(null);
  const [bgUploading, setBgUploading] = useState(false);
  const [editError, setEditError] = useState(null);
  const isEditing = editJob.isPending;

  useEffect(() => {
    if (editJob.result?.results?.length) {
      onUpdate(editJob.result.results[0].image);
      setPanel(null);
      setEditPrompt("");
      setTextColor(null);
      setTextSize(null);
      setTextWeight(null);
      setBgColor(null);
      setBgGradient(null);
      setBgImageUrl(null);
      setEditError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editJob.result]);

  useEffect(() => {
    if (editJob.error) setEditError(editJob.error);
  }, [editJob.error]);

  const submitEdit = (prompt, backgroundImageUrl = null) => {
    setEditError(null);
    editJob.submit({
      _action: "infographic-edit",
      image_url: result.image,
      edit_prompt: prompt,
      background_image_url: backgroundImageUrl,
    });
  };

  const applyEdit = () => {
    if (editPrompt.trim()) submitEdit(editPrompt);
  };

  const pickSolidColor = (c) => {
    setBgColor((v) => (v === c ? null : c));
    setBgGradient(null);
    setBgImageUrl(null);
  };
  const pickGradient = (g) => {
    setBgGradient((v) => (v?.id === g.id ? null : g));
    setBgColor(null);
    setBgImageUrl(null);
  };

  const uploadBgImage = async (file) => {
    if (!file) return;
    setBgUploading(true);
    setEditError(null);
    try {
      const url = await uploadToTemp(file);
      setBgImageUrl(url);
      setBgColor(null);
      setBgGradient(null);
    } catch (e) {
      setEditError(e.message ?? "Background upload failed.");
    } finally {
      setBgUploading(false);
    }
  };

  const hasStyleChange = !!(
    textColor ||
    textSize ||
    textWeight ||
    bgColor ||
    bgGradient ||
    bgImageUrl
  );
  const applyStyle = () => {
    if (!hasStyleChange) return;
    const parts = [];
    if (textColor) parts.push(`change all label text color to ${textColor}`);
    if (textSize) parts.push(`make the label text ${textSize}-sized`);
    if (textWeight) parts.push(`make the label text ${textWeight}`);
    if (bgColor)
      parts.push(`change the background to a solid ${bgColor} color`);
    if (bgGradient) parts.push(`change the background to a ${bgGradient.desc}`);
    if (bgImageUrl)
      parts.push(
        "use the second provided reference image as the new background, extended/cropped to fill the frame",
      );
    submitEdit(
      `Update this marketing infographic: ${parts.join("; ")}. Keep the product photo — including the model's ` +
        `exact face, identity, and expression if a person appears in it — plus the label positions and label text ` +
        `content exactly the same. Only apply the styling changes described above.`,
      bgImageUrl,
    );
  };

  return (
    <div>
      <a
        href={result.image}
        target="_blank"
        rel="noreferrer"
        className="cr-result-img-wrap"
        style={{ position: "relative", cursor: "zoom-in" }}
      >
        <img src={result.image} alt={result.label} className="cr-result-img" />
        {isEditing && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.85)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            <Spin size={20} color="#059669" />
            <span
              style={{ fontSize: "11px", fontWeight: 600, color: "#059669" }}
            >
              Applying edit…
            </span>
          </div>
        )}
      </a>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: "8px",
          gap: "8px",
        }}
      >
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-700)" }}>
          {result.label}
        </span>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            className="cr-btn cr-btn-outline"
            style={{ padding: "4px 10px", fontSize: "12px" }}
            onClick={() => setPanel((p) => (p === "style" ? null : "style"))}
            disabled={isEditing}
          >
            Style
          </button>
          <button
            type="button"
            className="cr-btn cr-btn-outline"
            style={{ padding: "4px 10px", fontSize: "12px" }}
            onClick={() =>
              downloadUrl(
                result.image,
                `infographic_${result.key}_${Date.now()}.png`,
              )
            }
          >
            Download
          </button>
        </div>
      </div>

      {/* Always-visible AI edit prompt bar — type a change and regenerate, chat-box style. */}
      <div
        style={{ display: "flex", gap: "6px", marginTop: "8px" }}
      >
        <input
          type="text"
          className="cr-input"
          style={{ flex: 1, margin: 0, fontSize: "12px" }}
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && editPrompt.trim() && !isEditing) {
              e.preventDefault();
              applyEdit();
            }
          }}
          placeholder="Describe a change and regenerate — e.g. “remove the bottom label”, “add a festive theme”"
          disabled={isEditing}
        />
        <button
          type="button"
          className="cr-btn-save"
          style={{
            background: "#059669",
            fontSize: "12px",
            padding: "6px 14px",
            whiteSpace: "nowrap",
          }}
          onClick={applyEdit}
          disabled={isEditing || !editPrompt.trim()}
        >
          {isEditing ? "Applying…" : "Regenerate"}
        </button>
      </div>
      {editError && (
        <p style={{ fontSize: "11px", color: "#DC2626", margin: "6px 0 0" }}>
          {editError}
        </p>
      )}

      {panel === "style" && (
        <div
          style={{
            marginTop: "8px",
            padding: "10px",
            background: "var(--surface-2)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "8px",
          }}
        >
          <FieldLabel hint="optional">Text Color</FieldLabel>
          <div
            style={{
              display: "flex",
              gap: "6px",
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: "10px",
            }}
          >
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setTextColor((v) => (v === c ? null : c))}
                title={c}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: c,
                  cursor: "pointer",
                  border:
                    textColor === c ? "2px solid var(--accent-500)" : "1px solid var(--border-subtle)",
                }}
              />
            ))}
            <input
              type="color"
              title="Custom color"
              value={textColor ?? "#111827"}
              onChange={(e) => setTextColor(e.target.value)}
              style={{
                width: 24,
                height: 24,
                padding: 0,
                border: "1px solid var(--border-subtle)",
                borderRadius: "50%",
                cursor: "pointer",
                overflow: "hidden",
              }}
            />
          </div>
          <FieldLabel hint="optional">Text Size</FieldLabel>
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            {["small", "medium", "large"].map((s) => (
              <button
                key={s}
                type="button"
                className={`cr-choice-btn ${textSize === s ? "active" : ""}`}
                onClick={() => setTextSize((v) => (v === s ? null : s))}
              >
                {s}
              </button>
            ))}
          </div>
          <FieldLabel hint="optional">Text Weight</FieldLabel>
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            {["regular", "bold"].map((w) => (
              <button
                key={w}
                type="button"
                className={`cr-choice-btn ${textWeight === w ? "active" : ""}`}
                onClick={() => setTextWeight((v) => (v === w ? null : w))}
              >
                {w}
              </button>
            ))}
          </div>
          <FieldLabel hint="optional — solid color">Background</FieldLabel>
          <div
            style={{
              display: "flex",
              gap: "6px",
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: "10px",
            }}
          >
            {BG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => pickSolidColor(c)}
                title={c}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "6px",
                  background: c,
                  cursor: "pointer",
                  border:
                    bgColor === c ? "2px solid var(--accent-500)" : "1px solid var(--border-subtle)",
                }}
              />
            ))}
            <input
              type="color"
              title="Custom color"
              value={bgColor ?? "#FFFFFF"}
              onChange={(e) => pickSolidColor(e.target.value)}
              style={{
                width: 24,
                height: 24,
                padding: 0,
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                cursor: "pointer",
                overflow: "hidden",
              }}
            />
          </div>
          <FieldLabel hint="optional — linear gradient">
            Gradient Background
          </FieldLabel>
          <div
            style={{
              display: "flex",
              gap: "6px",
              flexWrap: "wrap",
              marginBottom: "10px",
            }}
          >
            {BG_GRADIENTS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => pickGradient(g)}
                title={g.label}
                style={{
                  width: 28,
                  height: 22,
                  borderRadius: "6px",
                  background: g.css,
                  cursor: "pointer",
                  border:
                    bgGradient?.id === g.id
                      ? "2px solid var(--accent-500)"
                      : "1px solid var(--border-subtle)",
                }}
              />
            ))}
          </div>
          <FieldLabel hint="optional — upload your own background photo">
            Image Background
          </FieldLabel>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "10px",
            }}
          >
            {bgImageUrl ? (
              <>
                <img
                  src={bgImageUrl}
                  alt="Background reference"
                  style={{
                    width: 36,
                    height: 36,
                    objectFit: "cover",
                    borderRadius: "6px",
                    border: "1px solid var(--border-subtle)",
                  }}
                />
                <button
                  type="button"
                  className="cr-btn cr-btn-outline"
                  style={{ padding: "3px 8px", fontSize: "11px" }}
                  onClick={() => setBgImageUrl(null)}
                >
                  Remove
                </button>
              </>
            ) : (
              <label
                className="cr-btn cr-btn-outline"
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  cursor: "pointer",
                  display: "inline-flex",
                }}
              >
                {bgUploading ? "Uploading…" : "Upload Image"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: "none" }}
                  disabled={bgUploading}
                  onChange={(e) => {
                    uploadBgImage(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
          {editError && (
            <p
              style={{ fontSize: "11px", color: "#DC2626", margin: "0 0 8px" }}
            >
              {editError}
            </p>
          )}
          <button
            type="button"
            className="cr-btn-save"
            style={{
              background: "#059669",
              fontSize: "12px",
              padding: "6px 14px",
            }}
            onClick={applyStyle}
            disabled={isEditing || !hasStyleChange}
          >
            {isEditing ? "Applying…" : "Apply Style"}
          </button>
        </div>
      )}

    </div>
  );
}

// ── Error Banner ──────────────────────────────────────────────────────────────

function ErrBanner({ msg, onDismiss }) {
  return (
    <div className="cr-err-banner">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        style={{ flexShrink: 0 }}
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 8v4M12 16h.01"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span style={{ flex: 1 }}>{msg}</span>
      <button
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          fontSize: "16px",
          padding: "0 2px",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW 1 — AI MODEL GENERATION
// ════════════════════════════════════════════════════════════════════════════

function WorkflowModelGeneration({ models }) {
  const wfId = "model-generation";
  const fetcher = useFetcher();
  const igJob = useInfographicJob();
  const [step, setStep] = useState(0);
  const [productType, setProductType] = useState(null);
  const [wearType, setWearType] = useState("full");
  const [frontUrl, setFrontUrl] = useState(null);
  const [backUrl, setBackUrl] = useState(null);
  const [extraUrls, setExtraUrls] = useState([]);
  const extraRef = useRef(null);
  const [uploadingExtra, setUploadingExtra] = useState(false);
  const [extraErr, setExtraErr] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [modelUrl, setModelUrl] = useState(null);
  const [modelGender, setModelGender] = useState(null);
  const [settings, setSettings] = useState({
    gender: "female",
    ageGroup: "adult",
    ethnicity: "any",
    bodyType: "average",
    pose: "standing-natural",
    background: "clean-white",
    aspectRatio: "3:4",
  });
  const MG_INPUT_STEP = 3;
  const [result, setResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  const [error, setError] = useState(null);
  const [withInfographic, setWithInfographic] = useState(false);
  const [infoDescription, setInfoDescription] = useState("");
  const [infoCustomStyle, setInfoCustomStyle] = useState("");
  const [infoCollage, setInfoCollage] = useState(false);
  const [infoReferenceUrl, setInfoReferenceUrl] = useState(null);
  const [infographicResult, setInfographicResult] = useState(null);
  const [infographicKeyPoints, setInfographicKeyPoints] = useState([]);
  const [infographicError, setInfographicError] = useState(null);
  const statusFetcher = useFetcher();

  const isGenerating = fetcher.state !== "idle" || !!pendingSessionId;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.status === "processing" && fetcher.data.session_id) {
        setPendingSessionId(fetcher.data.session_id);
      } else if (fetcher.data.error) {
        setError(fetcher.data.error);
        setStep(MG_INPUT_STEP);
      } // back to the input step on failure
    }
  }, [fetcher.state, fetcher.data]);

  // Poll for the async result — generation runs on Fashn's side and a single
  // request can't block on it without risking the host's connection timeout.
  useEffect(() => {
    if (!pendingSessionId) return;
    const poll = () => {
      if (statusFetcher.state === "idle") {
        statusFetcher.submit(
          { _action: "generate-status", session_id: pendingSessionId },
          {
            method: "POST",
            action: "/app/studio/create",
            encType: "application/json",
          },
        );
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [pendingSessionId, statusFetcher]);

  useEffect(() => {
    if (statusFetcher.state === "idle" && statusFetcher.data) {
      if (statusFetcher.data.status === "completed") {
        setResult(statusFetcher.data.result_image);
        setSessionId(statusFetcher.data.session_id ?? null);
        setPendingSessionId(null);
      } else if (statusFetcher.data.status === "failed") {
        setError(statusFetcher.data.error);
        setPendingSessionId(null);
        setStep(MG_INPUT_STEP); // back to the input step on failure
      }
    }
  }, [statusFetcher.state, statusFetcher.data]);

  useEffect(() => {
    if (igJob.result) {
      setInfographicError(null);
      setInfographicResult(igJob.result.results ?? []);
      setInfographicKeyPoints(igJob.result.key_points ?? []);
    }
  }, [igJob.result]);

  useEffect(() => {
    if (igJob.error) setInfographicError(igJob.error);
  }, [igJob.error]);

  const addExtra = async (file) => {
    if (!file || extraUrls.length >= 3) return;
    if (!file.type.startsWith("image/")) {
      setExtraErr("Images only.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setExtraErr("Max 5 MB.");
      return;
    }
    setUploadingExtra(true);
    setExtraErr(null);
    try {
      const url = await uploadToTemp(file);
      setExtraUrls((p) => [...p, url]);
    } catch (e) {
      setExtraErr(e.message ?? "Upload failed.");
    } finally {
      setUploadingExtra(false);
    }
  };

  const doGenerate = () => {
    setError(null);
    const productPrompt = buildProductPrompt(productType, wearType);
    const productCat = PRODUCT_CATS.find((c) => c.id === productType);
    fetcher.submit(
      {
        _action: "generate",
        workflow_type: "model-generation",
        front_image_url: frontUrl,
        back_image_url: backUrl || null,
        detail_image_1_url: extraUrls[0] || null,
        detail_image_2_url: extraUrls[1] || null,
        detail_image_3_url: extraUrls[2] || null,
        model_key: selectedModel !== "__custom__" ? selectedModel : null,
        model_image_url: selectedModel === "__custom__" ? modelUrl : null,
        model_gender: selectedModel === "__custom__" ? modelGender : null,
        garment_type: productCat?.garmentType ?? wearType ?? "full",
        product_type: productType,
        clothing_prompt: productPrompt || null,
        ...settings,
      },
      {
        method: "POST",
        action: "/app/studio/create",
        encType: "application/json",
      },
    );
    if (withInfographic && infoDescription.trim()) {
      igJob.submit({
        _action: "infographic-create",
        product_image_url: frontUrl,
        description: infoDescription,
        custom_style_prompt: infoCustomStyle,
        collage: infoCollage,
        reference_image_url: infoReferenceUrl,
      });
    }
  };

  const S = (f, v) => setSettings((p) => ({ ...p, [f]: v }));

  if (result)
    return (
      <div>
        <Card>
          <OutputScreen
            result={result}
            sessionId={sessionId}
            wfId={wfId}
            onRegenerate={() => {
              setResult(null);
              setInfographicResult(null);
              setStep(0);
            }}
            infographicResult={infographicResult}
            infographicLoading={
              withInfographic && igJob.isPending && !infographicResult
            }
            infographicError={infographicError}
            onInfographicUpdate={(idx, url) =>
              setInfographicResult((prev) =>
                prev
                  ? prev.map((r, i) => (i === idx ? { ...r, image: url } : r))
                  : prev,
              )
            }
            onInfographicAppend={(r) =>
              setInfographicResult((prev) => (prev ? [...prev, r] : [r]))
            }
            infographicRegenInput={{
              imageUrl: frontUrl,
              keyPoints: infographicKeyPoints,
              customStylePrompt: infoCustomStyle,
              collage: infoCollage,
              referenceImageUrl: infoReferenceUrl,
            }}
          />
        </Card>
      </div>
    );
  if (isGenerating)
    return (
      <div>
        <Card>
          <GeneratingScreen wfId={wfId} />
        </Card>
      </div>
    );

  return (
    <div>
      {error && <ErrBanner msg={error} onDismiss={() => setError(null)} />}

      {step === 0 && (
        <Card>
          <SectionTitle>Upload Product Images</SectionTitle>
          <SectionDesc>
            Add front, back and detail shots — more angles give the AI better
            accuracy and drape results.
          </SectionDesc>
          <div className="cr-req-row">
            {["High resolution", "Clean background", "JPEG / PNG / WEBP"].map(
              (r) => (
                <span key={r} className="cr-req">
                  {r}
                </span>
              ),
            )}
          </div>
          <div className="cr-img-pair">
            <UploadZone
              label="Front View"
              required
              value={frontUrl}
              onChange={setFrontUrl}
            />
            <UploadZone
              label="Back View"
              value={backUrl}
              onChange={setBackUrl}
              hint="optional"
            />
          </div>
          <div style={{ marginBottom: "4px" }}>
            <FieldLabel hint="optional — up to 3 more">
              Additional Detail Images
            </FieldLabel>
            <div className="cr-img-grid">
              {extraUrls.map((url, i) => (
                <div key={i} className="cr-img-thumb">
                  <img
                    src={url}
                    alt={`Detail ${i + 1}`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                  <button
                    className="cr-img-rm"
                    onClick={() =>
                      setExtraUrls((p) => p.filter((_, j) => j !== i))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              {extraUrls.length < 3 && (
                <div
                  className={`cr-img-add ${uploadingExtra ? "busy" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => !uploadingExtra && extraRef.current?.click()}
                  onKeyDown={(e) => {
                    if (
                      (e.key === "Enter" || e.key === " ") &&
                      !uploadingExtra
                    ) {
                      e.preventDefault();
                      extraRef.current?.click();
                    }
                  }}
                >
                  {uploadingExtra ? (
                    <Spin size={18} />
                  ) : (
                    <>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        style={{ color: "var(--ink-300)" }}
                      >
                        <path
                          d="M12 5v14M5 12h14"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                      <span
                        style={{
                          fontSize: "11px",
                          color: "var(--ink-300)",
                          marginTop: "3px",
                        }}
                      >
                        Add Image
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            <input
              ref={extraRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                addExtra(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {extraErr && (
              <div className="cr-field-error">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ flexShrink: 0 }}
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M12 8v4M12 16h.01"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                {extraErr}
              </div>
            )}
          </div>
          <StepNav onNext={() => setStep(1)} nextDisabled={!frontUrl} />
        </Card>
      )}

      {step === 1 && (
        <Card>
          <SectionTitle>Select Model</SectionTitle>
          <SectionDesc>
            Choose a saved studio model or upload a new reference photo.
          </SectionDesc>
          <ModelSelector
            models={models}
            selectedKey={selectedModel}
            onSelect={(k, u, g) => {
              setSelectedModel(k);
              setModelUrl(u);
              setModelGender(g);
            }}
          />
          <StepNav
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
            nextDisabled={!selectedModel}
          />
        </Card>
      )}

      {step === 2 && (
        <Card>
          <SectionTitle>Garment &amp; Shot Type</SectionTitle>
          <SectionDesc>
            Select what this is and how the model should display it.
          </SectionDesc>
          <TypeShotStep
            productType={productType}
            wearType={wearType}
            onTypeChange={setProductType}
            onWearChange={setWearType}
          />
          <StepNav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={!productType}
          />
        </Card>
      )}

      {step === 3 && (
        <Card>
          <SectionTitle>Details &amp; Settings</SectionTitle>
          <SectionDesc>
            Adjust how the AI generates the final image.
          </SectionDesc>
          <div className="cr-settings-grid">
            <CrSelect
              label="Gender"
              value={settings.gender}
              onChange={(v) => S("gender", v)}
              options={[
                { value: "female", label: "Female" },
                { value: "male", label: "Male" },
                { value: "non-binary", label: "Non-binary" },
              ]}
            />
            <CrSelect
              label="Age Group"
              value={settings.ageGroup}
              onChange={(v) => S("ageGroup", v)}
              options={[
                { value: "child", label: "Child (5–12)" },
                { value: "teen", label: "Teen (13–17)" },
                { value: "young-adult", label: "Young Adult (18–25)" },
                { value: "adult", label: "Adult (26–40)" },
                { value: "mature", label: "Mature (40+)" },
              ]}
            />
            <CrSelect
              label="Pose"
              value={settings.pose}
              onChange={(v) => S("pose", v)}
              options={[
                { value: "standing-natural", label: "Standing (Natural)" },
                { value: "standing-hands-on-hips", label: "Hands on Hips" },
                { value: "walking", label: "Walking" },
                { value: "sitting", label: "Sitting" },
                { value: "dynamic", label: "Dynamic / Editorial" },
              ]}
            />
            <CrSelect
              label="Background"
              value={settings.background}
              onChange={(v) => S("background", v)}
              options={[
                { value: "clean-white", label: "Clean White" },
                { value: "solid-light-grey", label: "Light Grey" },
                { value: "gradient-soft", label: "Soft Gradient" },
                { value: "lifestyle-indoor", label: "Lifestyle Indoor" },
                { value: "lifestyle-outdoor", label: "Lifestyle Outdoor" },
                { value: "studio", label: "Studio Lighting" },
              ]}
            />
          </div>
          <InfographicAddon
            checked={withInfographic}
            onChange={(v) => {
              setWithInfographic(v);
              if (!v) setInfographicResult(null);
            }}
            description={infoDescription}
            onDescriptionChange={setInfoDescription}
            customStyle={infoCustomStyle}
            onCustomStyleChange={setInfoCustomStyle}
            collage={infoCollage}
            onCollageChange={setInfoCollage}
            referenceImageUrl={infoReferenceUrl}
            onReferenceImageChange={setInfoReferenceUrl}
          />
          <StepNav
            onBack={() => setStep(2)}
            onNext={doGenerate}
            nextLabel="Generate Image"
            isGenerate
          />
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW 2 — FLAT LAY TO MODEL
// ════════════════════════════════════════════════════════════════════════════

function WorkflowFlatLay({ models }) {
  const wfId = "flat-lay";
  const fetcher = useFetcher();
  const igJob = useInfographicJob();
  const [step, setStep] = useState(0);
  const [productType, setProductType] = useState(null);
  const [wearType, setWearType] = useState("full");
  const [flatUrl, setFlatUrl] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [modelUrl, setModelUrl] = useState(null);
  const [modelGender, setModelGender] = useState(null);
  const [details, setDetails] = useState({
    fabric: "",
    fit: "",
    sleeve: "",
    embroidery: "",
    notes: "",
  });
  const [settings, setSettings] = useState({
    pose: "standing-natural",
    background: "clean-white",
    aspectRatio: "3:4",
    resolution: "standard",
  });
  const [result, setResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  const [error, setError] = useState(null);
  const [withInfographic, setWithInfographic] = useState(false);
  const [infoDescription, setInfoDescription] = useState("");
  const [infoCustomStyle, setInfoCustomStyle] = useState("");
  const [infoCollage, setInfoCollage] = useState(false);
  const [infoReferenceUrl, setInfoReferenceUrl] = useState(null);
  const [infographicResult, setInfographicResult] = useState(null);
  const [infographicKeyPoints, setInfographicKeyPoints] = useState([]);
  const [infographicError, setInfographicError] = useState(null);
  const statusFetcher = useFetcher();
  const isGenerating = fetcher.state !== "idle" || !!pendingSessionId;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.status === "processing" && fetcher.data.session_id) {
        setPendingSessionId(fetcher.data.session_id);
      } else if (fetcher.data.error) {
        setError(fetcher.data.error);
        setStep(3);
      } // back to the input step on failure
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (!pendingSessionId) return;
    const poll = () => {
      if (statusFetcher.state === "idle") {
        statusFetcher.submit(
          { _action: "generate-status", session_id: pendingSessionId },
          {
            method: "POST",
            action: "/app/studio/create",
            encType: "application/json",
          },
        );
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [pendingSessionId, statusFetcher]);

  useEffect(() => {
    if (statusFetcher.state === "idle" && statusFetcher.data) {
      if (statusFetcher.data.status === "completed") {
        setResult(statusFetcher.data.result_image);
        setSessionId(statusFetcher.data.session_id ?? null);
        setPendingSessionId(null);
      } else if (statusFetcher.data.status === "failed") {
        setError(statusFetcher.data.error);
        setPendingSessionId(null);
        setStep(3); // back to the input step on failure
      }
    }
  }, [statusFetcher.state, statusFetcher.data]);

  useEffect(() => {
    if (igJob.result) {
      setInfographicError(null);
      setInfographicResult(igJob.result.results ?? []);
      setInfographicKeyPoints(igJob.result.key_points ?? []);
    }
  }, [igJob.result]);

  useEffect(() => {
    if (igJob.error) setInfographicError(igJob.error);
  }, [igJob.error]);

  const doGenerate = () => {
    const productPrompt = buildProductPrompt(productType, wearType);
    const detailsPrompt = [
      details.fabric,
      details.fit,
      details.sleeve,
      details.embroidery,
      details.notes,
    ]
      .filter(Boolean)
      .join(", ");
    const fullPrompt = [productPrompt, detailsPrompt]
      .filter(Boolean)
      .join("; ");
    const productCat = PRODUCT_CATS.find((c) => c.id === productType);
    fetcher.submit(
      {
        _action: "generate",
        workflow_type: "flat-lay",
        front_image_url: flatUrl,
        back_image_url: null,
        model_key: selectedModel !== "__custom__" ? selectedModel : null,
        model_image_url: selectedModel === "__custom__" ? modelUrl : null,
        model_gender: selectedModel === "__custom__" ? modelGender : null,
        garment_type: productCat?.garmentType ?? wearType ?? "full",
        product_type: productType,
        clothing_prompt: fullPrompt || null,
        ...settings,
      },
      {
        method: "POST",
        action: "/app/studio/create",
        encType: "application/json",
      },
    );
    if (withInfographic && infoDescription.trim()) {
      igJob.submit({
        _action: "infographic-create",
        product_image_url: flatUrl,
        description: infoDescription,
        custom_style_prompt: infoCustomStyle,
        collage: infoCollage,
        reference_image_url: infoReferenceUrl,
      });
    }
  };

  const D = (f, v) => setDetails((p) => ({ ...p, [f]: v }));
  const S = (f, v) => setSettings((p) => ({ ...p, [f]: v }));

  if (result)
    return (
      <div>
        <Card>
          <OutputScreen
            result={result}
            sessionId={sessionId}
            wfId={wfId}
            onRegenerate={() => {
              setResult(null);
              setInfographicResult(null);
              setStep(0);
            }}
            infographicResult={infographicResult}
            infographicLoading={
              withInfographic && igJob.isPending && !infographicResult
            }
            infographicError={infographicError}
            onInfographicUpdate={(idx, url) =>
              setInfographicResult((prev) =>
                prev
                  ? prev.map((r, i) => (i === idx ? { ...r, image: url } : r))
                  : prev,
              )
            }
            onInfographicAppend={(r) =>
              setInfographicResult((prev) => (prev ? [...prev, r] : [r]))
            }
            infographicRegenInput={{
              imageUrl: flatUrl,
              keyPoints: infographicKeyPoints,
              customStylePrompt: infoCustomStyle,
              collage: infoCollage,
              referenceImageUrl: infoReferenceUrl,
            }}
          />
        </Card>
      </div>
    );
  if (isGenerating)
    return (
      <div>
        <Card>
          <GeneratingScreen wfId={wfId} />
        </Card>
      </div>
    );

  return (
    <div>
      {error && <ErrBanner msg={error} onDismiss={() => setError(null)} />}

      {step === 0 && (
        <Card>
          <SectionTitle>Upload Flat Lay Image</SectionTitle>
          <SectionDesc>
            Upload your garment photographed flat on a surface. The AI will
            reconstruct how it looks on a real model.
          </SectionDesc>
          <UploadZone
            label="Flat Lay Image"
            required
            value={flatUrl}
            onChange={setFlatUrl}
            note="Garment laid flat on a clean surface, shot from above. Even slightly wrinkled flat-lays work well."
          />
          <StepNav onNext={() => setStep(1)} nextDisabled={!flatUrl} />
        </Card>
      )}

      {step === 1 && (
        <Card>
          <SectionTitle>Select Model</SectionTitle>
          <ModelSelector
            models={models}
            selectedKey={selectedModel}
            onSelect={(k, u, g) => {
              setSelectedModel(k);
              setModelUrl(u);
              setModelGender(g);
            }}
          />
          <StepNav
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
            nextDisabled={!selectedModel}
          />
        </Card>
      )}

      {step === 2 && (
        <Card>
          <SectionTitle>Garment &amp; Shot Type</SectionTitle>
          <SectionDesc>
            Select what this is and how the model should display it.
          </SectionDesc>
          <TypeShotStep
            productType={productType}
            wearType={wearType}
            onTypeChange={setProductType}
            onWearChange={setWearType}
          />
          <StepNav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={!productType}
          />
        </Card>
      )}

      {step === 3 && (
        <Card>
          <SectionTitle>Details &amp; Settings</SectionTitle>
          <SectionDesc>
            Prompt is required — the more context you give, the more accurately
            the AI can recreate the garment.
          </SectionDesc>
          <div className="cr-two-col">
            <CrInput
              label="Fabric Type"
              value={details.fabric}
              onChange={(v) => D("fabric", v)}
              placeholder="e.g. Banarasi silk, cotton lawn…"
              hint="optional"
            />
            <CrInput
              label="Fit / Silhouette"
              value={details.fit}
              onChange={(v) => D("fit", v)}
              placeholder="e.g. A-line, slim-fit, flowy…"
              hint="optional"
            />
          </div>
          <CrTextarea
            label="Prompt"
            required
            value={details.notes}
            onChange={(v) => D("notes", v)}
            placeholder="e.g. Drape the dupatta over the left shoulder."
          />
          <div className="cr-settings-grid">
            <CrSelect
              label="Pose"
              value={settings.pose}
              onChange={(v) => S("pose", v)}
              options={[
                { value: "standing-natural", label: "Standing (Natural)" },
                { value: "standing-hands-on-hips", label: "Hands on Hips" },
                { value: "walking", label: "Walking" },
                { value: "sitting", label: "Sitting" },
              ]}
            />
            <CrSelect
              label="Background"
              value={settings.background}
              onChange={(v) => S("background", v)}
              options={[
                { value: "clean-white", label: "Clean White" },
                { value: "solid-light-grey", label: "Light Grey" },
                { value: "gradient-soft", label: "Soft Gradient" },
                { value: "lifestyle-indoor", label: "Lifestyle Indoor" },
                { value: "lifestyle-outdoor", label: "Lifestyle Outdoor" },
              ]}
            />
          </div>
          <InfographicAddon
            checked={withInfographic}
            onChange={(v) => {
              setWithInfographic(v);
              if (!v) setInfographicResult(null);
            }}
            description={infoDescription}
            onDescriptionChange={setInfoDescription}
            customStyle={infoCustomStyle}
            onCustomStyleChange={setInfoCustomStyle}
            collage={infoCollage}
            onCollageChange={setInfoCollage}
            referenceImageUrl={infoReferenceUrl}
            onReferenceImageChange={setInfoReferenceUrl}
          />
          <StepNav
            onBack={() => setStep(2)}
            onNext={doGenerate}
            nextLabel="Generate Image"
            nextDisabled={!details.notes.trim()}
            isGenerate
          />
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW 3 — GHOST MANNEQUIN TO MODEL
// ════════════════════════════════════════════════════════════════════════════

function WorkflowMannequin({ models }) {
  const wfId = "mannequin";
  const fetcher = useFetcher();
  const igJob = useInfographicJob();
  const [step, setStep] = useState(0);
  const [productType, setProductType] = useState(null);
  const [wearType, setWearType] = useState("full");
  const [mannUrl, setMannUrl] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [modelUrl, setModelUrl] = useState(null);
  const [modelGender, setModelGender] = useState(null);
  const [settings, setSettings] = useState({
    pose: "standing-natural",
    expression: "natural",
    background: "clean-white",
    cameraAngle: "front",
  });
  const [result, setResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  const [error, setError] = useState(null);
  const [withInfographic, setWithInfographic] = useState(false);
  const [infoDescription, setInfoDescription] = useState("");
  const [infoCustomStyle, setInfoCustomStyle] = useState("");
  const [infoCollage, setInfoCollage] = useState(false);
  const [infoReferenceUrl, setInfoReferenceUrl] = useState(null);
  const [infographicResult, setInfographicResult] = useState(null);
  const [infographicKeyPoints, setInfographicKeyPoints] = useState([]);
  const [infographicError, setInfographicError] = useState(null);
  const statusFetcher = useFetcher();
  const isGenerating = fetcher.state !== "idle" || !!pendingSessionId;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.status === "processing" && fetcher.data.session_id) {
        setPendingSessionId(fetcher.data.session_id);
      } else if (fetcher.data.error) {
        setError(fetcher.data.error);
        setStep(3);
      } // back to the input step on failure
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (!pendingSessionId) return;
    const poll = () => {
      if (statusFetcher.state === "idle") {
        statusFetcher.submit(
          { _action: "generate-status", session_id: pendingSessionId },
          {
            method: "POST",
            action: "/app/studio/create",
            encType: "application/json",
          },
        );
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [pendingSessionId, statusFetcher]);

  useEffect(() => {
    if (statusFetcher.state === "idle" && statusFetcher.data) {
      if (statusFetcher.data.status === "completed") {
        setResult(statusFetcher.data.result_image);
        setSessionId(statusFetcher.data.session_id ?? null);
        setPendingSessionId(null);
      } else if (statusFetcher.data.status === "failed") {
        setError(statusFetcher.data.error);
        setPendingSessionId(null);
        setStep(3); // back to the input step on failure
      }
    }
  }, [statusFetcher.state, statusFetcher.data]);

  useEffect(() => {
    if (igJob.result) {
      setInfographicError(null);
      setInfographicResult(igJob.result.results ?? []);
      setInfographicKeyPoints(igJob.result.key_points ?? []);
    }
  }, [igJob.result]);

  useEffect(() => {
    if (igJob.error) setInfographicError(igJob.error);
  }, [igJob.error]);

  const doGenerate = () => {
    setError(null);
    const productPrompt = buildProductPrompt(productType, wearType);
    const productCat = PRODUCT_CATS.find((c) => c.id === productType);
    fetcher.submit(
      {
        _action: "generate",
        workflow_type: "mannequin",
        front_image_url: mannUrl,
        back_image_url: null,
        model_key: selectedModel !== "__custom__" ? selectedModel : null,
        model_image_url: selectedModel === "__custom__" ? modelUrl : null,
        model_gender: selectedModel === "__custom__" ? modelGender : null,
        garment_type: productCat?.garmentType ?? wearType ?? "full",
        product_type: productType,
        clothing_prompt: productPrompt || null,
        ...settings,
      },
      {
        method: "POST",
        action: "/app/studio/create",
        encType: "application/json",
      },
    );
    if (withInfographic && infoDescription.trim()) {
      igJob.submit({
        _action: "infographic-create",
        product_image_url: mannUrl,
        description: infoDescription,
        custom_style_prompt: infoCustomStyle,
        collage: infoCollage,
        reference_image_url: infoReferenceUrl,
      });
    }
  };

  const S = (f, v) => setSettings((p) => ({ ...p, [f]: v }));

  if (result)
    return (
      <div>
        <Card>
          <OutputScreen
            result={result}
            sessionId={sessionId}
            wfId={wfId}
            onRegenerate={() => {
              setResult(null);
              setInfographicResult(null);
              setStep(0);
            }}
            infographicResult={infographicResult}
            infographicLoading={
              withInfographic && igJob.isPending && !infographicResult
            }
            infographicError={infographicError}
            onInfographicUpdate={(idx, url) =>
              setInfographicResult((prev) =>
                prev
                  ? prev.map((r, i) => (i === idx ? { ...r, image: url } : r))
                  : prev,
              )
            }
            onInfographicAppend={(r) =>
              setInfographicResult((prev) => (prev ? [...prev, r] : [r]))
            }
            infographicRegenInput={{
              imageUrl: mannUrl,
              keyPoints: infographicKeyPoints,
              customStylePrompt: infoCustomStyle,
              collage: infoCollage,
              referenceImageUrl: infoReferenceUrl,
            }}
          />
        </Card>
      </div>
    );
  if (isGenerating)
    return (
      <div>
        <Card>
          <GeneratingScreen wfId={wfId} />
        </Card>
      </div>
    );

  return (
    <div>
      {error && <ErrBanner msg={error} onDismiss={() => setError(null)} />}

      {step === 0 && (
        <Card>
          <SectionTitle>Upload Ghost Mannequin Image</SectionTitle>
          <SectionDesc>
            Upload your invisible mannequin product photo. The AI removes the
            mannequin and replaces it with a real AI-generated model.
          </SectionDesc>
          <div className="cr-req-row">
            {[
              "Ghost / invisible mannequin",
              "Front-facing",
              "High resolution",
              "No real model visible",
            ].map((r) => (
              <span key={r} className="cr-req">
                {r}
              </span>
            ))}
          </div>
          <UploadZone
            label="Mannequin Image"
            required
            value={mannUrl}
            onChange={setMannUrl}
          />
          <StepNav onNext={() => setStep(1)} nextDisabled={!mannUrl} />
        </Card>
      )}

      {step === 1 && (
        <Card>
          <SectionTitle>Select Model</SectionTitle>
          <ModelSelector
            models={models}
            selectedKey={selectedModel}
            onSelect={(k, u, g) => {
              setSelectedModel(k);
              setModelUrl(u);
              setModelGender(g);
            }}
          />
          <StepNav
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
            nextDisabled={!selectedModel}
          />
        </Card>
      )}

      {step === 2 && (
        <Card>
          <SectionTitle>Garment &amp; Shot Type</SectionTitle>
          <SectionDesc>
            Select what this is and how the model should display it.
          </SectionDesc>
          <TypeShotStep
            productType={productType}
            wearType={wearType}
            onTypeChange={setProductType}
            onWearChange={setWearType}
          />
          <StepNav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={!productType}
          />
        </Card>
      )}

      {step === 3 && (
        <Card>
          <SectionTitle>Details &amp; Settings</SectionTitle>
          <div className="cr-settings-grid">
            <CrSelect
              label="Pose"
              value={settings.pose}
              onChange={(v) => S("pose", v)}
              options={[
                { value: "standing-natural", label: "Standing (Natural)" },
                { value: "standing-hands-on-hips", label: "Hands on Hips" },
                { value: "walking", label: "Walking" },
                { value: "three-quarter", label: "Three-Quarter Turn" },
              ]}
            />
            <CrSelect
              label="Background"
              value={settings.background}
              onChange={(v) => S("background", v)}
              options={[
                { value: "clean-white", label: "Clean White" },
                { value: "solid-light-grey", label: "Light Grey" },
                { value: "gradient-soft", label: "Soft Gradient" },
                { value: "lifestyle-indoor", label: "Lifestyle Indoor" },
                { value: "lifestyle-outdoor", label: "Lifestyle Outdoor" },
              ]}
            />
          </div>
          <InfographicAddon
            checked={withInfographic}
            onChange={(v) => {
              setWithInfographic(v);
              if (!v) setInfographicResult(null);
            }}
            description={infoDescription}
            onDescriptionChange={setInfoDescription}
            customStyle={infoCustomStyle}
            onCustomStyleChange={setInfoCustomStyle}
            collage={infoCollage}
            onCollageChange={setInfoCollage}
            referenceImageUrl={infoReferenceUrl}
            onReferenceImageChange={setInfoReferenceUrl}
          />
          <StepNav
            onBack={() => setStep(2)}
            onNext={doGenerate}
            nextLabel="Generate Image"
            isGenerate
          />
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW 4 — ACCESSORIES (mode selector → model try-on OR infographic)
// ════════════════════════════════════════════════════════════════════════════

function WorkflowAccessories({ models }) {
  const wfId = "accessories";

  // All hooks must be unconditional ─────────────────────────────────────────
  const fetcher = useFetcher(); // Fashn AI try-on
  const igJob = useInfographicJob(); // infographic addon

  const [step, setStep] = useState(0);
  const [category, setCategory] = useState("watch");
  const [accUrl, setAccUrl] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [modelUrl, setModelUrl] = useState(null);
  const [modelGender, setModelGender] = useState(null);
  const [placement, setPlacement] = useState(ACCESSORY_PLACEMENTS["watch"][0]);
  const [settings, setSettings] = useState({
    pose: "standing-natural",
    background: "clean-white",
    styling: "editorial",
  });
  const [result, setResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  const [error, setError] = useState(null);
  const [withInfographic, setWithInfographic] = useState(false);
  const [infoDescription, setInfoDescription] = useState("");
  const [infoCustomStyle, setInfoCustomStyle] = useState("");
  const [infoCollage, setInfoCollage] = useState(false);
  const [infoReferenceUrl, setInfoReferenceUrl] = useState(null);
  const [infographicResult, setInfographicResult] = useState(null);
  const [infographicKeyPoints, setInfographicKeyPoints] = useState([]);
  const [infographicError, setInfographicError] = useState(null);

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    setPlacement(ACCESSORY_PLACEMENTS[category]?.[0] ?? "");
  }, [category]);

  const statusFetcher = useFetcher();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.status === "processing" && fetcher.data.session_id) {
        setPendingSessionId(fetcher.data.session_id);
      } else if (fetcher.data.error) {
        setError(fetcher.data.error);
        setStep(3);
      }
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (!pendingSessionId) return;
    const poll = () => {
      if (statusFetcher.state === "idle") {
        statusFetcher.submit(
          { _action: "generate-status", session_id: pendingSessionId },
          {
            method: "POST",
            action: "/app/studio/create",
            encType: "application/json",
          },
        );
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [pendingSessionId, statusFetcher]);

  useEffect(() => {
    if (statusFetcher.state === "idle" && statusFetcher.data) {
      if (statusFetcher.data.status === "completed") {
        setResult(statusFetcher.data.result_image);
        setSessionId(statusFetcher.data.session_id ?? null);
        setPendingSessionId(null);
      } else if (statusFetcher.data.status === "failed") {
        setError(statusFetcher.data.error);
        setPendingSessionId(null);
        setStep(3);
      }
    }
  }, [statusFetcher.state, statusFetcher.data]);

  useEffect(() => {
    if (igJob.result) {
      setInfographicError(null);
      setInfographicResult(igJob.result.results ?? []);
      setInfographicKeyPoints(igJob.result.key_points ?? []);
    }
  }, [igJob.result]);

  useEffect(() => {
    if (igJob.error) setInfographicError(igJob.error);
  }, [igJob.error]);

  // ── Submit handlers ───────────────────────────────────────────────────────
  const doModelGenerate = () => {
    setError(null);
    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
    const fullPrompt = `${categoryLabel}, full-body model shot; ${category}: ${placement}`;
    fetcher.submit(
      {
        _action: "generate",
        workflow_type: "accessories",
        front_image_url: accUrl,
        back_image_url: null,
        model_key: selectedModel !== "__custom__" ? selectedModel : null,
        model_image_url: selectedModel === "__custom__" ? modelUrl : null,
        model_gender: selectedModel === "__custom__" ? modelGender : null,
        clothing_prompt: fullPrompt,
        accessory_category: category,
        accessory_placement: placement,
        ...settings,
      },
      {
        method: "POST",
        action: "/app/studio/create",
        encType: "application/json",
      },
    );
    if (withInfographic && infoDescription.trim()) {
      igJob.submit({
        _action: "infographic-create",
        product_image_url: accUrl,
        description: infoDescription,
        custom_style_prompt: infoCustomStyle,
        collage: infoCollage,
        reference_image_url: infoReferenceUrl,
      });
    }
  };

  const S = (f, v) => setSettings((p) => ({ ...p, [f]: v }));

  const isModelGenerating = fetcher.state !== "idle" || !!pendingSessionId;

  if (result)
    return (
      <div>
        <Card>
          <OutputScreen
            result={result}
            sessionId={sessionId}
            wfId={wfId}
            onRegenerate={() => {
              setResult(null);
              setInfographicResult(null);
              setStep(0);
            }}
            infographicResult={infographicResult}
            infographicLoading={
              withInfographic && igJob.isPending && !infographicResult
            }
            infographicError={infographicError}
            onInfographicUpdate={(idx, url) =>
              setInfographicResult((prev) =>
                prev
                  ? prev.map((r, i) => (i === idx ? { ...r, image: url } : r))
                  : prev,
              )
            }
            onInfographicAppend={(r) =>
              setInfographicResult((prev) => (prev ? [...prev, r] : [r]))
            }
            infographicRegenInput={{
              imageUrl: accUrl,
              keyPoints: infographicKeyPoints,
              customStylePrompt: infoCustomStyle,
              collage: infoCollage,
              referenceImageUrl: infoReferenceUrl,
            }}
          />
        </Card>
      </div>
    );
  if (isModelGenerating)
    return (
      <div>
        <Card>
          <GeneratingScreen wfId={wfId} />
        </Card>
      </div>
    );

  return (
    <div>
      {error && <ErrBanner msg={error} onDismiss={() => setError(null)} />}

      {step === 0 && (
        <Card>
          <SectionTitle>Upload Accessory Image</SectionTitle>
          <SectionDesc>
            Upload a clean product-only shot of the accessory.
          </SectionDesc>
          <UploadZone
            label="Accessory Image"
            required
            value={accUrl}
            onChange={setAccUrl}
            note="Clean product-only shot on a plain white or transparent background, with the whole item in frame (handle, clasp, strap, chain, pendant). No model, no props, nothing covering it — the result can only be as accurate as this photo."
          />
          <StepNav onNext={() => setStep(1)} nextDisabled={!accUrl} />
        </Card>
      )}

      {step === 1 && (
        <Card>
          <SectionTitle>Select Model</SectionTitle>
          <ModelSelector
            models={models}
            selectedKey={selectedModel}
            onSelect={(k, u, g) => {
              setSelectedModel(k);
              setModelUrl(u);
              setModelGender(g);
            }}
          />
          <StepNav
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
            nextDisabled={!selectedModel}
          />
        </Card>
      )}

      {step === 2 && (
        <Card>
          <SectionTitle>Accessory Type &amp; Placement</SectionTitle>
          <SectionDesc>
            Select what this is and where it should appear on the model.
          </SectionDesc>
          <div className="cr-settings-grid">
            <CrSelect
              label="Accessory Type"
              required
              value={category}
              onChange={setCategory}
              options={Object.keys(ACCESSORY_PLACEMENTS).map((cat) => ({
                value: cat,
                label: cat.charAt(0).toUpperCase() + cat.slice(1),
              }))}
            />
            <CrSelect
              label="Placement"
              value={placement}
              onChange={setPlacement}
              options={(ACCESSORY_PLACEMENTS[category] ?? []).map((p) => ({
                value: p,
                label: p,
              }))}
            />
          </div>
          <StepNav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={!category || !placement}
          />
        </Card>
      )}

      {step === 3 && (
        <Card>
          <SectionTitle>Details &amp; Settings</SectionTitle>
          <div className="cr-settings-grid">
            <CrSelect
              label="Pose"
              value={settings.pose}
              onChange={(v) => S("pose", v)}
              options={[
                { value: "standing-natural", label: "Standing (Natural)" },
                { value: "posed", label: "Editorial Pose" },
                { value: "walking", label: "Walking" },
                { value: "sitting", label: "Sitting" },
              ]}
            />
            <CrSelect
              label="Background"
              value={settings.background}
              onChange={(v) => S("background", v)}
              options={[
                { value: "clean-white", label: "Clean White" },
                { value: "solid-light-grey", label: "Light Grey" },
                { value: "lifestyle-indoor", label: "Lifestyle Indoor" },
                { value: "luxury-studio", label: "Luxury Studio" },
              ]}
            />
          </div>
          <InfographicAddon
            checked={withInfographic}
            onChange={(v) => {
              setWithInfographic(v);
              if (!v) setInfographicResult(null);
            }}
            description={infoDescription}
            onDescriptionChange={setInfoDescription}
            customStyle={infoCustomStyle}
            onCustomStyleChange={setInfoCustomStyle}
            collage={infoCollage}
            onCollageChange={setInfoCollage}
            referenceImageUrl={infoReferenceUrl}
            onReferenceImageChange={setInfoReferenceUrl}
          />
          <StepNav
            onBack={() => setStep(2)}
            onNext={doModelGenerate}
            nextLabel="Generate Try-On"
            isGenerate
          />
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW 5 — MARKETING INFOGRAPHIC (standalone)
// ════════════════════════════════════════════════════════════════════════════

function WorkflowInfographic({ savedGenerations, products = [], ragStatus }) {
  const igJob = useInfographicJob();
  const reindexFetcher = useFetcher();

  const [useUpload, setUseUpload] = useState(savedGenerations.length === 0);
  const [igStep, setIgStep] = useState(0);
  const [igImageUrl, setIgImageUrl] = useState(null);
  const [igDesc, setIgDesc] = useState("");
  // RAG grounding — picking a product lets InfographicController extract key
  // points from its real title/vendor/type/tags/description instead of only
  // this free-text box (see docs/rag-qdrant-implementation-plan.md).
  const [igProductId, setIgProductId] = useState(null);
  const [igProductQuery, setIgProductQuery] = useState("");
  const [igSize, setIgSize] = useState("portrait");
  const [igCollage, setIgCollage] = useState(false);
  const [igReferenceUrl, setIgReferenceUrl] = useState(null);
  const [igCustomStyle, setIgCustomStyle] = useState("");
  const [igResults, setIgResults] = useState(null);
  const [igKPs, setIgKPs] = useState([]);
  const [igArchetype, setIgArchetype] = useState(null);
  const [igQuality, setIgQuality] = useState(null);
  const [igError, setIgError] = useState(null);

  useEffect(() => {
    if (igJob.result) {
      setIgResults(igJob.result.results ?? []);
      setIgKPs(igJob.result.key_points ?? []);
      setIgArchetype(igJob.result.archetype ?? null);
      setIgQuality(igJob.result.quality ?? null);
    }
  }, [igJob.result]);

  useEffect(() => {
    if (igJob.error) {
      setIgError(igJob.error);
      setIgStep(2); // back to the input step
    }
  }, [igJob.error]);

  const doIgGenerate = () => {
    setIgError(null);
    igJob.submit({
      _action: "infographic-create",
      product_image_url: igImageUrl,
      description: igDesc,
      // No style/category to send — the PHP side looks at igImageUrl
      // itself (gpt-4o-mini vision) and picks whichever real design
      // archetype suits it. custom_style_prompt is still an optional
      // free-text nudge on top of that.
      custom_style_prompt: igCustomStyle,
      size: igSize,
      collage: igCollage,
      reference_image_url: igReferenceUrl,
      product_id: igProductId,
    });
  };

  const isIgGenerating = igJob.isPending;
  const fmt = (d) =>
    d
      ? new Date(d).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";

  if (igResults?.length)
    return (
      <div>
        <Card>
          <OutputScreen
            result={null}
            sessionId={null}
            wfId="infographic"
            onRegenerate={() => {
              setIgResults(null);
              setIgKPs([]);
              setIgStep(2);
            }}
            infographicResult={igResults}
            infographicLoading={false}
            onInfographicUpdate={(idx, url) =>
              setIgResults((prev) =>
                prev
                  ? prev.map((r, i) => (i === idx ? { ...r, image: url } : r))
                  : prev,
              )
            }
            onInfographicAppend={(r) =>
              setIgResults((prev) => (prev ? [...prev, r] : [r]))
            }
            infographicRegenInput={{
              imageUrl: igImageUrl,
              keyPoints: igKPs,
              customStylePrompt: igCustomStyle,
              size: igSize,
              collage: igCollage,
              referenceImageUrl: igReferenceUrl,
            }}
          />
          {igArchetype?.name && (
            <div
              style={{
                marginTop: "16px",
                padding: "10px 14px",
                background: "var(--accent-50)",
                borderRadius: "10px",
                border: "1px solid #E0E7FF",
                fontSize: "12px",
                color: "var(--accent-600)",
              }}
            >
              {igArchetype.id === "reference-match" ? (
                <>AI replicated the design from your reference image.</>
              ) : (
                <>
                  AI matched this photo to the{" "}
                  <strong>{igArchetype.name}</strong> design
                  {igArchetype.category ? ` (${igArchetype.category})` : ""} —
                  picked automatically from the photo itself.
                </>
              )}
            </div>
          )}
          {igQuality?.checked &&
            ((igQuality.overall_score ?? 10) < 8 ||
              igQuality.issues?.length > 0) && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "10px 14px",
                  background: "#FFFBEB",
                  borderRadius: "10px",
                  border: "1px solid #FDE68A",
                  fontSize: "12px",
                  color: "#92400E",
                }}
              >
                <p style={{ fontWeight: 700, margin: "0 0 6px" }}>
                  AI quality check
                  {typeof igQuality.overall_score === "number"
                    ? `: ${igQuality.overall_score}/10`
                    : ""}{" "}
                  — already auto-retried once server-side; consider
                  Regenerating again if it still isn&apos;t right:
                </p>
                {igQuality.issues?.length > 0 && (
                  <ul style={{ margin: "0 0 6px", paddingLeft: "18px" }}>
                    {igQuality.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                )}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                    fontSize: "11px",
                  }}
                >
                  {[
                    ["Product focus", igQuality.product_dominance],
                    ["Readability", igQuality.text_readability],
                    ["Density", igQuality.information_density],
                    ["Layout", igQuality.layout_quality],
                    ["Hierarchy", igQuality.visual_hierarchy],
                    ["Category fit", igQuality.category_accuracy],
                  ]
                    .filter(([, v]) => typeof v === "number")
                    .map(([label, v]) => (
                      <span key={label}>
                        {label}: {v}/10
                      </span>
                    ))}
                </div>
              </div>
            )}
          {igKPs.length > 0 && (
            <div
              style={{
                marginTop: "16px",
                padding: "14px",
                background: "#F0FDF4",
                borderRadius: "10px",
                border: "1px solid #D1FAE5",
              }}
            >
              <p
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#065F46",
                  margin: "0 0 8px",
                }}
              >
                Key highlights used in this infographic
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {igKPs.map((pt, i) => (
                  <span
                    key={i}
                    style={{
                      background: "#D1FAE5",
                      color: "#059669",
                      fontWeight: 700,
                      fontSize: "12px",
                      padding: "3px 10px",
                      borderRadius: "999px",
                    }}
                  >
                    {pt}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    );

  if (isIgGenerating)
    return (
      <div>
        <Card>
          <GeneratingScreen wfId="infographic" />
        </Card>
      </div>
    );

  return (
    <div>
      {igError && (
        <ErrBanner msg={igError} onDismiss={() => setIgError(null)} />
      )}

      {igStep === 0 && (
        <Card>
          <SectionTitle>Choose Source Image</SectionTitle>
          <SectionDesc>
            {savedGenerations.length > 0
              ? "Reuse a Fashn AI model photo you've already saved, or upload a fresh product image."
              : "Upload a clean product photo. This will be the centrepiece of the infographic."}
          </SectionDesc>

          {savedGenerations.length > 0 && !useUpload && (
            <div style={{ marginBottom: "16px" }}>
              <FieldLabel required>Saved Fashn AI Models</FieldLabel>
              <div className="cr-model-grid">
                {savedGenerations.map((g) => {
                  const sel = igImageUrl === g.result_image_url;
                  const label = g.garment_type
                    ? g.garment_type.charAt(0).toUpperCase() +
                      g.garment_type.slice(1)
                    : "Model";
                  return (
                    <div
                      key={g.id}
                      className={`cr-model-card ${sel ? "selected" : ""}`}
                      title={`${label} — ${fmt(g.created_at)}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setIgImageUrl(g.result_image_url)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setIgImageUrl(g.result_image_url);
                        }
                      }}
                    >
                      <div className="cr-model-thumb">
                        <img
                          src={g.result_image_url}
                          alt={label}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                        {sel && <div className="cr-model-tick">✓</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  setUseUpload(true);
                  setIgImageUrl(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  marginTop: "10px",
                  color: "var(--accent-500)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Or upload a new image instead
              </button>
            </div>
          )}

          {(savedGenerations.length === 0 || useUpload) && (
            <div>
              <div className="cr-req-row">
                {[
                  "Clean background",
                  "High resolution",
                  "JPEG / PNG / WEBP",
                ].map((r) => (
                  <span key={r} className="cr-req">
                    {r}
                  </span>
                ))}
              </div>
              <UploadZone
                label="Product Photo"
                required
                value={igImageUrl}
                onChange={setIgImageUrl}
              />
              {savedGenerations.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setUseUpload(false);
                    setIgImageUrl(null);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    marginTop: "6px",
                    color: "var(--accent-500)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Or choose a saved Fashn AI model instead
                </button>
              )}
            </div>
          )}

          <StepNav onNext={() => setIgStep(1)} nextDisabled={!igImageUrl} />
        </Card>
      )}

      {igStep === 1 && (
        <Card>
          <SectionTitle>Ground It in a Real Product</SectionTitle>
          <SectionDesc>
            Pick one of your synced products so AI extracts highlights from its
            actual title, vendor, type, tags and description — instead of only
            guessing from free text. Picking a product is optional; the
            description box below still works on its own.
          </SectionDesc>

          {ragStatus?.enabled ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                padding: "10px 12px",
                marginBottom: "14px",
                background: "#F0FDF4",
                border: "1px solid #D1FAE5",
                borderRadius: "8px",
                fontSize: "12px",
                color: "#065F46",
              }}
            >
              <span>
                Product knowledge index:{" "}
                <strong>{ragStatus.indexed_products}</strong> product
                {ragStatus.indexed_products === 1 ? "" : "s"}
                {ragStatus.last_indexed_at
                  ? ` · last updated ${fmt(ragStatus.last_indexed_at)}`
                  : ""}
              </span>
              <button
                type="button"
                onClick={() =>
                  reindexFetcher.submit(
                    { _action: "rag-reindex" },
                    {
                      method: "POST",
                      action: "/app/studio/create",
                      encType: "application/json",
                    },
                  )
                }
                disabled={reindexFetcher.state !== "idle"}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#065F46",
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontSize: "12px",
                }}
              >
                {reindexFetcher.state !== "idle" ? "Re-indexing…" : "Re-index"}
              </button>
            </div>
          ) : null}

          {products.length > 0 && (
            <div style={{ marginBottom: "18px" }}>
              <FieldLabel hint="optional — grounds the AI in this product's real facts">
                Product
              </FieldLabel>
              {igProductId ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    border: "1px solid var(--vto-border, var(--border-subtle))",
                    borderRadius: "8px",
                    background: "#F8FAFC",
                  }}
                >
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    {products.find((p) => String(p.id) === String(igProductId))
                      ?.title ?? `Product #${igProductId}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIgProductId(null)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#64748B",
                      cursor: "pointer",
                      fontSize: "12px",
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={igProductQuery}
                    onChange={(e) => setIgProductQuery(e.target.value)}
                    placeholder="Search your products…"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: "1px solid var(--vto-border, var(--border-subtle))",
                      borderRadius: "8px",
                      fontSize: "13px",
                      marginBottom: "6px",
                    }}
                  />
                  <div
                    style={{
                      maxHeight: "180px",
                      overflowY: "auto",
                      border: "1px solid var(--vto-border, var(--border-subtle))",
                      borderRadius: "8px",
                    }}
                  >
                    {products
                      .filter((p) =>
                        (p.title ?? "")
                          .toLowerCase()
                          .includes(igProductQuery.trim().toLowerCase()),
                      )
                      .slice(0, 25)
                      .map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setIgProductId(p.id)}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 12px",
                            border: "none",
                            borderBottom: "1px solid var(--surface-2)",
                            background: "white",
                            cursor: "pointer",
                            fontSize: "13px",
                          }}
                        >
                          {p.title || `Product #${p.id}`}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </div>
          )}

          <SectionTitle>Describe Your Product</SectionTitle>
          <SectionDesc>
            {igProductId
              ? "Optional — add any extra notes AI should consider alongside the selected product's real facts."
              : "Write a short paragraph about the product. AI will extract 3–4 short highlights — no full sentences — and overlay them as bold badges on the infographic."}
          </SectionDesc>
          <CrTextarea
            label="Product Description"
            required={!igProductId}
            value={igDesc}
            onChange={setIgDesc}
            rows={5}
            placeholder="e.g. This 18-karat gold-plated watch features a sapphire crystal glass, Italian leather strap, and 50m water resistance. Swiss movement, 3-year international warranty."
          />
          <p
            style={{
              fontSize: "12px",
              color: "var(--ink-500)",
              margin: "-4px 0 0",
              lineHeight: 1.5,
            }}
          >
            AI extracts highlights like <em>&ldquo;18k Gold Plated&rdquo;</em>,{" "}
            <em>&ldquo;Sapphire Crystal&rdquo;</em>,{" "}
            <em>&ldquo;50m Water Resistant&rdquo;</em> — short phrases only,
            never sentences.
          </p>
          <StepNav
            onBack={() => setIgStep(0)}
            onNext={() => setIgStep(2)}
            nextDisabled={!igDesc.trim() && !igProductId}
          />
        </Card>
      )}

      {igStep === 2 && (
        <Card>
          <SectionTitle>Output Options</SectionTitle>
          <SectionDesc>
            AI looks at your product photo itself and picks whichever real
            design layout suits it — no style or product-type picker needed.
            These options control the output format only.
          </SectionDesc>
          <div style={{ marginBottom: "18px" }}>
            <FieldLabel hint="output image dimensions">Output Size</FieldLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {SIZE_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`cr-choice-btn ${igSize === s.id ? "active" : ""}`}
                  onClick={() => setIgSize(s.id)}
                  title={s.desc}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: "18px" }}>
            <FieldLabel hint="4 matching hero, detail-zoom & feature shots instead of one image">
              Layout
            </FieldLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              <button
                type="button"
                className={`cr-choice-btn ${!igCollage ? "active" : ""}`}
                onClick={() => setIgCollage(false)}
              >
                Single Infographic
              </button>
              <button
                type="button"
                className={`cr-choice-btn ${igCollage ? "active" : ""}`}
                disabled={!!igReferenceUrl}
                onClick={() => setIgCollage(true)}
              >
                Multi-Panel Collage (4 images)
              </button>
            </div>
          </div>
          <div style={{ marginBottom: "18px" }}>
            <FieldLabel hint="optional — upload an example infographic to replicate its exact design instead of AI auto-picking one">
              Match a Reference Design
            </FieldLabel>
            <UploadZone
              compact
              value={igReferenceUrl}
              onChange={setIgReferenceUrl}
              note="If set, this overrides auto-detection and disables Collage — the layout, palette, and label style are copied from this image."
            />
          </div>
          <div>
            <FieldLabel hint="optional — describe how you want the background/theme to look">
              Custom Background / Theme
            </FieldLabel>
            <textarea
              className="cr-input"
              value={igCustomStyle}
              onChange={(e) => setIgCustomStyle(e.target.value)}
              placeholder="e.g. soft pastel pink background with floating stars, or a festive Diwali theme with diyas and marigold accents"
              rows={2}
              style={{ resize: "vertical", lineHeight: 1.5, margin: 0 }}
            />
          </div>
          <p
            style={{
              fontSize: "12px",
              color: "var(--ink-500)",
              background: "var(--surface-2)",
              padding: "10px 12px",
              borderRadius: "8px",
              margin: "4px 0",
              lineHeight: 1.6,
            }}
          >
            3–4 short highlights will be extracted and overlaid as bold callout
            badges on the infographic. No sentences.
          </p>
          <StepNav
            onBack={() => setIgStep(1)}
            onNext={doIgGenerate}
            nextLabel="Generate Infographic"
            isGenerate
          />
        </Card>
      )}
    </div>
  );
}

// ── Workflow Selector ─────────────────────────────────────────────────────────

function WorkflowSelector({ onSelect }) {
  return (
    <div>
      <div className="cr-sel-hero">
        <p className="cr-sel-label">Create new asset</p>
        <h2 className="cr-sel-title">What would you like to make?</h2>
        <p className="cr-sel-sub">
          Pick the workflow that matches the photo you have — we&apos;ll guide
          you step by step.
        </p>
      </div>
      <WorkflowCards onSelect={onSelect} />
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function CreatePage() {
  const { models, savedGenerations, products, ragStatus } = useLoaderData();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // ?workflow=<id> deep-links straight into a wizard (AI Studio workflow cards).
  const initialWf = WORKFLOWS.some((w) => w.id === searchParams.get("workflow"))
    ? searchParams.get("workflow")
    : null;
  const [phase, setPhase] = useState(initialWf ? "workflow" : "select");
  const [wfType, setWfType] = useState(initialWf);
  const wf = WORKFLOWS.find((w) => w.id === wfType);
  const col = WF_COLORS[wfType] ?? BRAND;

  const selectWorkflow = (id) => {
    setWfType(id);
    setPhase("workflow");
    setSearchParams({ workflow: id }, { replace: true, preventScrollReset: true });
  };
  const backToPicker = () => {
    setPhase("select");
    setSearchParams({}, { replace: true, preventScrollReset: true });
  };

  return (
    <>
      <div className="cr-page">
        {/* Header */}
        <div className="cr-page-hdr">
          <button
            type="button"
            className="cr-back"
            onClick={() => (phase === "workflow" ? backToPicker() : navigate("/app/studio"))}
          >
            <FsIcon name="arrowLeft" size={16} />
            {phase === "select" ? "AI Studio" : "All workflows"}
          </button>
          <span className="cr-crumb-sep">/</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="cr-page-title">
              {phase === "select" ? "Create new asset" : (wf?.title ?? "Create")}
            </h1>
          </div>
          {phase === "workflow" && (
            <span className="cr-page-sub">
              <FsIcon name="clock" size={13} />
              {col.time} · {wf?.steps?.length} steps
            </span>
          )}
        </div>

        <div className="cr-body">
          {phase === "select" && <WorkflowSelector onSelect={selectWorkflow} />}
          {phase === "workflow" && wfType === "model-generation" && (
            <WorkflowModelGeneration models={models} />
          )}
          {phase === "workflow" && wfType === "flat-lay" && (
            <WorkflowFlatLay models={models} />
          )}
          {phase === "workflow" && wfType === "mannequin" && (
            <WorkflowMannequin models={models} />
          )}
          {phase === "workflow" && wfType === "accessories" && (
            <WorkflowAccessories models={models} />
          )}
          {phase === "workflow" && wfType === "infographic" && (
            <WorkflowInfographic
              savedGenerations={savedGenerations}
              products={products}
              ragStatus={ragStatus}
            />
          )}
        </div>
      </div>
    </>
  );
}

