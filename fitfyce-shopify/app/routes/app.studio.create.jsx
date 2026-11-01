/**
 * app.studio.create.jsx — AI Studio: workflow selector + multi-step wizards.
 * Route: /app/studio/create
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { shrinkImageIfLarge } from "../lib/shrink-image.client";
import { useFetcher, useLoaderData, useNavigate, useRouteLoaderData, useSearchParams } from "react-router";
import { useCelebrate } from "../components/AppShell";
import WorkflowCards, { GROUP_WORKFLOW_ENABLED } from "../components/WorkflowCards";
import { FsIcon } from "../components/fs-ui";
import { PageTour } from "../components/GuidedTour";
import { TOURS } from "../lib/tours";
import { authenticate } from "../shopify.server";
import { ensureMerchant } from "../lib/merchant.server";
import phpApiClient from "../lib/php-api.server";
import { PHP_API_URL } from "../lib/env.server";
import { buildGeneratePayload } from "../lib/studio-generate.server";

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
    const phpBody = buildGeneratePayload(body);
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

const ALL_WORKFLOWS = [
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
    desc: "Turn a saved Fashn AI model photo, or a fresh upload, into a promotional infographic with OpenAI-extracted highlights.",
    steps: ["Source Image", "Description", "Options", "Output"],
  },
  {
    id: "group",
    title: "Duo & Group Try-On",
    desc: "Put 2 to 4 people in one photo, each in their own outfit.",
    steps: ["Who's in it", "Dress each person", "Scene", "Output"],
  },
];

// Duo & Group is parked (see GROUP_WORKFLOW_ENABLED in WorkflowCards).
const WORKFLOWS = ALL_WORKFLOWS.filter((w) => GROUP_WORKFLOW_ENABLED || w.id !== "group");

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
  { id: "portrait", label: "Portrait", desc: "1024×1536: tall, best for full-length garment/model shots." },
  { id: "square", label: "Square", desc: "1024×1024: best for packaged goods and social posts." },
  { id: "landscape", label: "Landscape", desc: "1536×1024: wide, best for banners." },
];

// ── Product type data ─────────────────────────────────────────────────────────

const PRODUCT_CATS = [
  // Paired outfit — top + bottom in one full-body generation. The front image
  // is the top; the bottom is uploaded separately on the type step and PHP
  // applies it in a second try-on pass on top of the top-wear result.
  {
    id: "paired-outfit",
    audience: ["women", "men", "unisex"],
    label: "Top + Bottom (paired outfit)",
    menLabel: "Shirt + Pant (paired outfit)",
    group: "outfit",
    garmentType: "full",
    outfit: true,
    desc: "Top and bottom together, full-body shot",
  },
  // Ethnic / Full-Body Wear
  {
    id: "saree",
    audience: ["women"],
    label: "Saree",
    group: "ethnic",
    garmentType: "full",
    desc: "Silk, cotton or synthetic saree",
  },
  {
    id: "lehenga",
    audience: ["women"],
    label: "Lehenga / Ghagra",
    group: "ethnic",
    garmentType: "full",
    desc: "Bridal or festive lehenga",
  },
  {
    id: "dress",
    audience: ["women"],
    label: "Dress / Gown",
    group: "ethnic",
    garmentType: "full",
    desc: "Western or fusion dress",
  },
  {
    // Kurta with matching pants/salwar: sent as one full-body garment so the
    // bottom is transferred too (a plain "Kurta" is top wear only).
    id: "kurta-set",
    audience: ["women", "men"],
    label: "Kurta set (with pants)",
    group: "ethnic",
    garmentType: "full",
    desc: "Kurta with matching pants, salwar or churidar",
  },
  {
    id: "coord-set",
    audience: ["women", "unisex"],
    label: "Co-ord Set",
    group: "ethnic",
    garmentType: "full",
    desc: "Matching top & bottom set",
  },
  // Top Wear
  {
    id: "kurta",
    menLabel: "Kurta",
    audience: ["women", "men"],
    label: "Kurta / Kurti",
    group: "top-wear",
    garmentType: "top",
    desc: "Traditional Indian top wear",
  },
  {
    id: "tshirt",
    audience: ["women", "men", "unisex"],
    label: "T-Shirt / Top",
    group: "top-wear",
    garmentType: "top",
    desc: "Casual or graphic tee",
  },
  {
    id: "shirt",
    menLabel: "Shirt",
    audience: ["women", "men", "unisex"],
    label: "Shirt / Blouse",
    group: "top-wear",
    garmentType: "top",
    desc: "Formal or casual shirt",
  },
  {
    id: "jacket",
    audience: ["women", "men", "unisex"],
    label: "Jacket / Blazer",
    group: "top-wear",
    garmentType: "top",
    desc: "Outerwear or formal jacket",
  },
  // Bottom Wear
  {
    id: "pants",
    menLabel: "Pants / Jeans / Trousers",
    audience: ["women", "men", "unisex"],
    label: "Pants / Jeans",
    group: "bottom-wear",
    garmentType: "bottom",
    desc: "Trousers, joggers or denim",
  },
  {
    id: "skirt",
    audience: ["women"],
    label: "Skirt / Palazzo",
    group: "bottom-wear",
    garmentType: "bottom",
    desc: "Skirt or wide-leg palazzo",
  },
  {
    id: "shorts",
    menLabel: "Shorts / Track Pants",
    audience: ["women", "men", "unisex"],
    label: "Shorts / Leggings",
    group: "bottom-wear",
    garmentType: "bottom",
    desc: "Shorts or active leggings",
  },
  // Accessories
  {
    id: "jewellery",
    audience: ["women", "men", "unisex"],
    label: "Jewellery",
    group: "accessories",
    garmentType: "top",
    desc: "Necklace, earring, ring…",
    accCategory: "necklace",
  },
  {
    id: "watch",
    audience: ["women", "men", "unisex"],
    label: "Watch",
    group: "accessories",
    garmentType: "top",
    desc: "Wrist watch or smartwatch",
    accCategory: "watch",
  },
  {
    id: "handbag",
    audience: ["women", "unisex"],
    label: "Bag / Handbag",
    group: "accessories",
    garmentType: "top",
    desc: "Clutch, tote or shoulder bag",
    accCategory: "handbag",
  },
  {
    id: "sunglasses",
    audience: ["women", "men", "unisex"],
    label: "Sunglasses",
    group: "accessories",
    garmentType: "top",
    desc: "Fashion or sport eyewear",
    accCategory: "sunglasses",
  },
  {
    id: "footwear",
    audience: ["women", "men", "unisex"],
    label: "Footwear",
    group: "accessories",
    garmentType: "bottom",
    desc: "Shoes, sandals or heels",
    accCategory: null,
  },
  // Other
  {
    id: "electronics",
    audience: ["women", "men", "unisex"],
    label: "Electronics / Mobile",
    group: "other",
    garmentType: "full",
    desc: "Gadgets, mobile or device",
  },
  {
    id: "other",
    audience: ["women", "men", "unisex"],
    label: "Other Product",
    group: "other",
    garmentType: "full",
    desc: "Product not listed above",
  },
];

const CLOTHING_GROUPS = ["outfit", "ethnic", "top-wear", "bottom-wear"];

const AUDIENCES = [
  { id: "women", label: "Women" },
  { id: "men", label: "Men" },
  { id: "unisex", label: "Unisex" },
];

const isOutfitType = (productType) => !!PRODUCT_CATS.find((c) => c.id === productType)?.outfit;

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

const LOW_RES_EDGE = 700;

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
  const [dims, setDims] = useState(null);

  // Read the uploaded image's real size so a tiny photo is flagged before it
  // produces a blurry generation (the try-on engine needs ~768px+ to keep detail).
  useEffect(() => {
    setDims(null);
    if (!value) return undefined;
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setDims({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = value;
    return () => { alive = false; };
  }, [value]);
  const lowRes = dims && Math.min(dims.w, dims.h) < LOW_RES_EDGE;

  const handleFile = useCallback(
    async (file) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("Invalid file type. Please use JPEG, PNG, or WEBP.");
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
            <div className="cr-zone-actions">
              <button
                type="button"
                className="cr-zone-act"
                aria-label={`Change ${label ?? "image"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Change
              </button>
              <button
                type="button"
                className="cr-zone-act cr-zone-act--danger"
                aria-label={`Remove ${label ?? "image"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setError(null);
                  onChange(null);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Remove
              </button>
            </div>
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
              JPEG · PNG · WEBP · any size
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

      {value && lowRes && !error && (
        <div className="cr-field-warn" role="status">
          Low resolution ({dims.w}×{dims.h} px): the result will look blurry. Use a photo at least 768 px wide for sharp detail.
        </div>
      )}
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
  group: { ...BRAND, time: "~2–4 min" },
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
            <FieldLabel hint="optional: fills the description below">
              Fill from a Shopify product
            </FieldLabel>
            <ShopifyProductAutofill onFill={(product, text) => { if (product) onDescriptionChange(text); }} />
          </div>
          <div style={{ marginBottom: "10px" }}>
            <FieldLabel
              required
              hint="AI extracts 3–4 short highlights: no sentences"
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
            <FieldLabel hint="optional: describe how you want the background/theme to look">
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
            <FieldLabel hint="optional: upload an example infographic to replicate its exact design instead of AI auto-picking one">
              Match a Reference Design
            </FieldLabel>
            <UploadZone
              compact
              value={referenceImageUrl}
              onChange={onReferenceImageChange}
              note="If set, this overrides auto-detection: the layout, palette, and label style are copied from this image."
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
  { label: "Full Outfit", key: "outfit" },
  { label: "Ethnic / Full-Body Wear", key: "ethnic" },
  { label: "Top Wear", key: "top-wear" },
  { label: "Bottom Wear", key: "bottom-wear" },
  { label: "Accessories & Jewellery", key: "accessories" },
  { label: "Other", key: "other" },
];

const catLabel = (c, audience) => (audience === "men" && c.menLabel) || c.label;

// Dropdown pairing of garment type + model shot type, used as a single step
// after the image/model uploads (replaces the old ProductTypeStep button grid).
// Men / Women / Unisex narrows the list; the paired "Top + Bottom" outfit adds a
// second upload for the bottom wear (the earlier product image is the top).
function TypeShotStep({ productType, wearType, onTypeChange, onWearChange, modelGender, bottomUrl, onBottomChange }) {
  const selected = PRODUCT_CATS.find((c) => c.id === productType);
  const [audience, setAudience] = useState(() => {
    if (selected?.audience?.length === 1) return selected.audience[0];
    return modelGender === "male" ? "men" : "women";
  });
  const isClothing = selected && CLOTHING_GROUPS.includes(selected.group);
  const isOutfit = !!selected?.outfit;
  const options = [
    { value: "", label: "Select a type…" },
    ...PT_GROUPS.flatMap((g) =>
      PRODUCT_CATS.filter((c) => c.group === g.key && c.audience.includes(audience)).map((c) => ({
        value: c.id,
        label: `${catLabel(c, audience)} · ${g.label}`,
      })),
    ),
  ];

  const changeAudience = (a) => {
    setAudience(a);
    // Drop a pick that doesn't exist in the new category (e.g. Saree → Men).
    if (selected && !selected.audience.includes(a)) {
      onTypeChange(null);
      onBottomChange?.(null);
    }
  };

  return (
    <div>
      <FieldLabel required>Category</FieldLabel>
      <div className="cr-model-tabs" role="tablist" aria-label="Category">
        {AUDIENCES.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={audience === a.id}
            className={`cr-model-tab ${audience === a.id ? "active" : ""}`}
            onClick={() => changeAudience(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="cr-settings-grid">
        <CrSelect
          label="Garment Type"
          required
          value={productType ?? ""}
          onChange={(v) => {
            onTypeChange(v || null);
            const cat = PRODUCT_CATS.find((c) => c.id === v);
            if (cat) onWearChange(cat.garmentType);
            if (!cat?.outfit) onBottomChange?.(null);
          }}
          options={options}
        />
        {isClothing && !isOutfit && (
          <CrSelect
            label="Model Shot Type"
            hint="how should the model display this garment?"
            value={wearType}
            onChange={onWearChange}
            options={WEAR_TYPES.map((w) => ({ value: w.id, label: w.label }))}
          />
        )}
      </div>
      {isOutfit && (
        <div className="cr-outfit">
          <p className="cr-outfit-note">
            <strong>Paired outfit, full-body shot.</strong> The product image you uploaded earlier is used as the
            top wear. Add the bottom wear below and both are dressed on the model together in one result.
          </p>
          <UploadZone
            label="Bottom Wear Photo (pant, skirt, jeans…)"
            required
            value={bottomUrl}
            onChange={onBottomChange}
            compact
          />
        </div>
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
                  title={`${m.name}: ${m.look}, ${m.age_group}`}
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
            Min 768×1024 px. No file-size limit.
          </p>
          <UploadZone
            label="Model Photo"
            required
            value={newUrl}
            onChange={(url) => {
              setNewUrl(url);
              setLibPick(null);
              // Removing the photo also clears the selection so the step can't proceed without a model.
              if (url) onSelect("__custom__", url, "female");
              else if (selectedKey === "__custom__") onSelect(null, null, null);
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
                No saved model photos yet: go to Studio Models to add one, or
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
        Do not close this tab. Generation is in progress.
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
  // Downloading counts as keeping it — the image moves out of Drafts too.
  const download = () => {
    downloadUrl(result, `studio_${Date.now()}.jpg`);
    if (sessionId && !saved) save();
  };

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
                      `Regenerate: Try a Different Idea (${regenCount}/5)`
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
          placeholder="Describe a change and regenerate: e.g. “remove the bottom label”, “add a festive theme”"
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
          <FieldLabel hint="optional: solid color">Background</FieldLabel>
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
          <FieldLabel hint="optional: linear gradient">
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
          <FieldLabel hint="optional: upload your own background photo">
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
  const [bottomUrl, setBottomUrl] = useState(null);
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
    poseReferenceUrl: null,
    background: "clean-white",
    aspectRatio: "3:4",
  });
  const MG_INPUT_STEP = 3;
  const [result, setResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  const [resultWarning, setResultWarning] = useState(null);
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
        // e.g. pose/background or the paired bottom couldn't be applied.
        setResultWarning(statusFetcher.data.warning ?? null);
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
        bottom_image_url: isOutfitType(productType) ? bottomUrl : null,
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
        {resultWarning && <ErrBanner msg={resultWarning} onDismiss={() => setResultWarning(null)} />}
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
            Add front, back and detail shots: more angles give the AI better
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
            <FieldLabel hint="optional: up to 3 more">
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
            modelGender={modelGender}
            bottomUrl={bottomUrl}
            onBottomChange={setBottomUrl}
          />
          <StepNav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={!productType || (isOutfitType(productType) && !bottomUrl)}
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
            <UploadZone
              label="Pose Reference"
              hint="optional: a photo of the pose you want; the model copies it"
              value={settings.poseReferenceUrl ?? null}
              onChange={(v) => S("poseReferenceUrl", v)}
              compact
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
                { value: "custom", label: "Upload your own…" },
              ]}
            />
            {settings.background === "custom" && (
              <UploadZone
                label="Background Image"
                hint="your own scene: the model is placed into it"
                value={settings.backgroundImageUrl ?? null}
                onChange={(v) => S("backgroundImageUrl", v)}
                compact
              />
            )}
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
  const [bottomUrl, setBottomUrl] = useState(null);
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
    poseReferenceUrl: null,
    background: "clean-white",
    aspectRatio: "3:4",
    resolution: "standard",
  });
  const [result, setResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  const [resultWarning, setResultWarning] = useState(null);
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
        // e.g. pose/background or the paired bottom couldn't be applied.
        setResultWarning(statusFetcher.data.warning ?? null);
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
        bottom_image_url: isOutfitType(productType) ? bottomUrl : null,
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
        {resultWarning && <ErrBanner msg={resultWarning} onDismiss={() => setResultWarning(null)} />}
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
            modelGender={modelGender}
            bottomUrl={bottomUrl}
            onBottomChange={setBottomUrl}
          />
          <StepNav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={!productType || (isOutfitType(productType) && !bottomUrl)}
          />
        </Card>
      )}

      {step === 3 && (
        <Card>
          <SectionTitle>Details &amp; Settings</SectionTitle>
          <SectionDesc>
            Prompt is required: the more context you give, the more accurately
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
            <UploadZone
              label="Pose Reference"
              hint="optional: a photo of the pose you want; the model copies it"
              value={settings.poseReferenceUrl ?? null}
              onChange={(v) => S("poseReferenceUrl", v)}
              compact
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
                { value: "custom", label: "Upload your own…" },
              ]}
            />
            {settings.background === "custom" && (
              <UploadZone
                label="Background Image"
                hint="your own scene: the model is placed into it"
                value={settings.backgroundImageUrl ?? null}
                onChange={(v) => S("backgroundImageUrl", v)}
                compact
              />
            )}
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
  const [bottomUrl, setBottomUrl] = useState(null);
  const [mannUrl, setMannUrl] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [modelUrl, setModelUrl] = useState(null);
  const [modelGender, setModelGender] = useState(null);
  const [settings, setSettings] = useState({
    poseReferenceUrl: null,
    expression: "natural",
    background: "clean-white",
    cameraAngle: "front",
  });
  const [result, setResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  const [resultWarning, setResultWarning] = useState(null);
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
        // e.g. pose/background or the paired bottom couldn't be applied.
        setResultWarning(statusFetcher.data.warning ?? null);
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
        bottom_image_url: isOutfitType(productType) ? bottomUrl : null,
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
        {resultWarning && <ErrBanner msg={resultWarning} onDismiss={() => setResultWarning(null)} />}
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
            modelGender={modelGender}
            bottomUrl={bottomUrl}
            onBottomChange={setBottomUrl}
          />
          <StepNav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={!productType || (isOutfitType(productType) && !bottomUrl)}
          />
        </Card>
      )}

      {step === 3 && (
        <Card>
          <SectionTitle>Details &amp; Settings</SectionTitle>
          <div className="cr-settings-grid">
            <UploadZone
              label="Pose Reference"
              hint="optional: a photo of the pose you want; the model copies it"
              value={settings.poseReferenceUrl ?? null}
              onChange={(v) => S("poseReferenceUrl", v)}
              compact
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
                { value: "custom", label: "Upload your own…" },
              ]}
            />
            {settings.background === "custom" && (
              <UploadZone
                label="Background Image"
                hint="your own scene: the model is placed into it"
                value={settings.backgroundImageUrl ?? null}
                onChange={(v) => S("backgroundImageUrl", v)}
                compact
              />
            )}
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
    poseReferenceUrl: null,
    background: "clean-white",
    styling: "editorial",
  });
  const [result, setResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  const [resultWarning, setResultWarning] = useState(null);
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
        // e.g. pose/background or the paired bottom couldn't be applied.
        setResultWarning(statusFetcher.data.warning ?? null);
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
        {resultWarning && <ErrBanner msg={resultWarning} onDismiss={() => setResultWarning(null)} />}
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
            note="Clean product-only shot on a plain white or transparent background, with the whole item in frame (handle, clasp, strap, chain, pendant). No model, no props, nothing covering it: the result can only be as accurate as this photo."
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
              label="Background"
              value={settings.background}
              onChange={(v) => S("background", v)}
              options={[
                { value: "clean-white", label: "Clean White" },
                { value: "solid-light-grey", label: "Light Grey" },
                { value: "lifestyle-indoor", label: "Lifestyle Indoor" },
                { value: "luxury-studio", label: "Luxury Studio" },
                { value: "custom", label: "Upload your own…" },
              ]}
            />
            {settings.background === "custom" && (
              <UploadZone
                label="Background Image"
                hint="your own scene: the model is placed into it"
                value={settings.backgroundImageUrl ?? null}
                onChange={(v) => S("backgroundImageUrl", v)}
                compact
              />
            )}
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

// ── Shopify product auto-fill (infographic fields) ───────────────────────────

// Turns real Shopify product details into the paragraph the infographic
// key-point extractor reads — title, description, options, type and tags.
function productToDescription(p) {
  const parts = [];
  parts.push(`${p.title}${p.vendor ? ` by ${p.vendor}` : ""}.`);
  if (p.description?.trim()) parts.push(p.description.trim());
  if (p.options?.length) {
    parts.push(p.options.map((o) => `${o.name}: ${o.values.join(", ")}`).join(". ") + ".");
  }
  if (p.productType) parts.push(`Category: ${p.productType}.`);
  if (p.tags?.length) parts.push(`Tags: ${p.tags.slice(0, 10).join(", ")}.`);
  return parts.join("\n").slice(0, 1500);
}

function ShopifyProductAutofill({ onFill, onPickImage, selectedImageUrl }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null); // full product details once loaded
  const [loadingId, setLoadingId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (picked) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/studio-products?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Couldn't load products");
        if (!cancelled) { setResults(data.products ?? []); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, picked]);

  const pick = async (item) => {
    setLoadingId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/studio-products?id=${encodeURIComponent(item.id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.product) throw new Error(data.error || "Couldn't load product details");
      setPicked(data.product);
      onFill(data.product, productToDescription(data.product));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingId(null);
    }
  };

  if (picked) {
    return (
      <div className="cr-pf-picked">
        <div className="cr-pf-head">
          <span className="cr-pf-thumb">{picked.images[0] ? <img src={picked.images[0].url} alt="" /> : null}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="cr-pf-title">{picked.title}</div>
            <div className="cr-pf-meta">
              Fields filled from Shopify{picked.vendor ? ` · ${picked.vendor}` : ""}{picked.productType ? ` · ${picked.productType}` : ""}
            </div>
          </div>
          <button type="button" className="cr-pf-link" onClick={() => onFill(picked, productToDescription(picked))}>Refill</button>
          <button type="button" className="cr-pf-link" onClick={() => { setPicked(null); onFill(null, null); }}>Change</button>
        </div>
        {onPickImage && picked.images.length > 0 && (
          <div>
            <p className="cr-pf-meta" style={{ margin: "10px 0 6px" }}>Use a product photo for the infographic:</p>
            <div className="cr-pf-images">
              {picked.images.map((img) => (
                <button key={img.url} type="button" className={`cr-pf-img ${selectedImageUrl === img.url ? "on" : ""}`}
                  aria-pressed={selectedImageUrl === img.url} aria-label={img.alt || "Product photo"} onClick={() => onPickImage(img.url)}>
                  <img src={img.url} alt="" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <input
        type="search"
        className="cr-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your Shopify products…"
        aria-label="Search Shopify products"
        style={{ marginBottom: "6px" }}
      />
      <div className="cr-pf-list" aria-busy={searching}>
        {error && <div className="cr-pf-empty" style={{ color: "#B91C1C" }}>{error}</div>}
        {!error && searching && results.length === 0 && <div className="cr-pf-empty">Loading products…</div>}
        {!error && !searching && results.length === 0 && <div className="cr-pf-empty">No products match “{query}”.</div>}
        {results.map((p) => (
          <button key={p.id} type="button" className="cr-pf-row" disabled={!!loadingId} onClick={() => pick(p)}>
            <span className="cr-pf-thumb">{p.image ? <img src={p.image} alt="" /> : null}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="cr-pf-title">{p.title}</span>
              {p.vendor && <span className="cr-pf-meta">{p.vendor}</span>}
            </span>
            {loadingId === p.id ? <Spin size={14} /> : <span className="cr-pf-fill">Fill</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

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
                  {igArchetype.category ? ` (${igArchetype.category})` : ""}:
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
                  . Already auto-retried once server-side; consider
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
                      title={`${label}: ${fmt(g.created_at)}`}
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
            Pick one of your Shopify products and its title, description,
            options, type and tags are filled in below automatically: edit
            anything before generating. Picking a product is optional; the
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

          <div style={{ marginBottom: "18px" }}>
            <FieldLabel hint="optional: fills the description from the product's real details">
              Fill from a Shopify product
            </FieldLabel>
            <ShopifyProductAutofill
              selectedImageUrl={igImageUrl}
              onPickImage={setIgImageUrl}
              onFill={(product, text) => {
                if (!product) {
                  setIgProductId(null);
                  return;
                }
                setIgDesc(text);
                // Synced products also get RAG grounding on the PHP side.
                const synced = products.find((p) => String(p.shopify_product_id) === product.numericId);
                setIgProductId(synced?.id ?? null);
              }}
            />
          </div>

          <SectionTitle>Describe Your Product</SectionTitle>
          <SectionDesc>
            {igProductId
              ? "Optional: add any extra notes AI should consider alongside the selected product's real facts."
              : "Write a short paragraph about the product. AI will extract 3–4 short highlights, no full sentences, and overlay them as bold badges on the infographic."}
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
            <em>&ldquo;50m Water Resistant&rdquo;</em>: short phrases only,
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
            design layout suits it: no style or product-type picker needed.
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
            <FieldLabel hint="optional: upload an example infographic to replicate its exact design instead of AI auto-picking one">
              Match a Reference Design
            </FieldLabel>
            <UploadZone
              compact
              value={igReferenceUrl}
              onChange={setIgReferenceUrl}
              note="If set, this overrides auto-detection and disables Collage: the layout, palette, and label style are copied from this image."
            />
          </div>
          <div>
            <FieldLabel hint="optional: describe how you want the background/theme to look">
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

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW 6 — DUO & GROUP (2-4 people in one photo, each in their own outfit)
// ═══════════════════════════════════════════════════════════════════════════
// The try-on engine dresses one person per image, so each person is generated
// as a normal single try-on (one after another: the RunPod endpoint runs one
// worker), then PHP combines the dressed people into one photo in the chosen
// left-to-right order (api.studio-group → /studio/group/compose).

const GROUP_PRESETS = [
  { id: "couple", label: "Woman + man", slots: ["female", "male"] },
  { id: "two-women", label: "Two women", slots: ["female", "female"] },
  { id: "two-men", label: "Two men", slots: ["male", "male"] },
  { id: "unisex-duo", label: "Unisex duo", slots: ["any", "any"] },
  { id: "trio", label: "Group of 3", slots: ["any", "any", "any"] },
  { id: "four", label: "Group of 4", slots: ["any", "any", "any", "any"] },
];

const GROUP_POSITIONS = {
  2: ["Left", "Right"],
  3: ["Left", "Center", "Right"],
  4: ["Far left", "Center left", "Center right", "Far right"],
};

const GENDER_LABELS = { female: "Woman", male: "Man", any: "Person" };

const GROUP_ARRANGEMENTS = [
  { value: "side_by_side", label: "Side by side" },
  { value: "together", label: "Close together" },
  { value: "walking", label: "Walking" },
];

const GROUP_BACKGROUNDS = [
  { value: "clean-white", label: "Clean White" },
  { value: "solid-light-grey", label: "Light Grey" },
  { value: "gradient-soft", label: "Soft Gradient" },
  { value: "lifestyle-indoor", label: "Lifestyle Indoor" },
  { value: "lifestyle-outdoor", label: "Lifestyle Outdoor" },
  { value: "studio", label: "Studio Lighting" },
  { value: "custom", label: "Upload your own…" },
];

const emptyPerson = (gender) => ({
  gender, modelKey: null, modelUrl: null, modelGender: gender === "male" ? "male" : gender === "female" ? "female" : null,
  frontUrl: null, productType: null, wearType: "full", bottomUrl: null,
});

const personReady = (p) => !!p.modelKey && !!p.frontUrl && !!p.productType && (!isOutfitType(p.productType) || !!p.bottomUrl);

async function groupPost(body) {
  const res = await fetch("/api/studio-group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.session_id) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Polls one session until it finishes; resolves with its status payload. */
async function waitForSession(sessionId, maxMs = 8 * 60 * 1000) {
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    let data = null;
    try { data = await groupPost({ _action: "status", session_id: sessionId }); } catch { data = null; } // transient: keep polling
    if (data?.status === "completed") return data;
    if (data?.status === "failed") throw new Error(data.error || "Generation failed.");
    if (Date.now() - started > maxMs) throw new Error("This is taking too long. Please try again.");
  }
}

function GroupFigures({ slots, active, done, onPick }) {
  return (
    <div className="cr-grp-figures" role="tablist" aria-label="People, left to right">
      {slots.map((g, i) => (
        <button key={i} type="button" role="tab" aria-selected={active === i}
          className={`cr-grp-figure${active === i ? " is-on" : ""}${done[i] ? " is-done" : ""}`} onClick={() => onPick(i)}>
          <svg viewBox="0 0 40 52" width="30" height="39" aria-hidden="true">
            <circle cx="20" cy="12" r="7" fill="currentColor" />
            <path d={g === "female" ? "M6 52c1-16 6-30 14-30s13 14 14 30z" : "M8 52V30c0-5 5-8 12-8s12 3 12 8v22z"} fill="currentColor" />
          </svg>
          <span className="cr-grp-figure-pos">{GROUP_POSITIONS[slots.length][i]}</span>
          <span className="cr-grp-figure-who">{done[i] ? "Ready" : GENDER_LABELS[g]}</span>
        </button>
      ))}
    </div>
  );
}

const equalSplits = (n) => Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);

/** The group photo with draggable dividers marking where each person stands. */
function GroupSplitter({ src, splits, onChange, positions }) {
  const boxRef = useRef(null);
  const [dragging, setDragging] = useState(null);

  const move = (e) => {
    if (dragging === null || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    const lo = (dragging === 0 ? 0 : splits[dragging - 1]) + 0.08;
    const hi = (dragging === splits.length - 1 ? 1 : splits[dragging + 1]) - 0.08;
    onChange(splits.map((v, i) => (i === dragging ? Math.min(hi, Math.max(lo, f)) : v)));
  };
  const nudge = (i, d) => {
    const lo = (i === 0 ? 0 : splits[i - 1]) + 0.08;
    const hi = (i === splits.length - 1 ? 1 : splits[i + 1]) - 0.08;
    onChange(splits.map((v, j) => (j === i ? Math.min(hi, Math.max(lo, v + d)) : v)));
  };
  const edges = [0, ...splits, 1];

  return (
    <div
      ref={boxRef}
      className="cr-split"
      onPointerMove={move}
      onPointerUp={() => setDragging(null)}
      onPointerLeave={() => setDragging(null)}
    >
      <img src={src} alt="The group, with dividers between people" draggable={false} />
      {positions.map((label, i) => (
        <span key={label} className="cr-split-label" style={{ left: `${((edges[i] + edges[i + 1]) / 2) * 100}%` }}>{label}</span>
      ))}
      {splits.map((f, i) => (
        <button
          key={i}
          type="button"
          className={`cr-split-line${dragging === i ? " is-drag" : ""}`}
          style={{ left: `${f * 100}%` }}
          aria-label={`Divider between ${positions[i]} and ${positions[i + 1]}`}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setDragging(i); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); nudge(i, -0.01); }
            if (e.key === "ArrowRight") { e.preventDefault(); nudge(i, 0.01); }
          }}
        >
          <span className="cr-split-grip" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="m9 6-6 6 6 6M15 6l6 6-6 6" /></svg>
          </span>
        </button>
      ))}
    </div>
  );
}

function WorkflowGroup({ models }) {
  const wfId = "group";
  const [step, setStep] = useState(0);
  const [presetId, setPresetId] = useState("couple");
  const preset = GROUP_PRESETS.find((p) => p.id === presetId) ?? GROUP_PRESETS[0];
  const [people, setPeople] = useState(() => preset.slots.map(emptyPerson));
  const [active, setActive] = useState(0);
  // "models": each person from their own model photo; "photo": one photo with everyone.
  const [source, setSource] = useState("models");
  const [groupPhoto, setGroupPhoto] = useState(null);
  const [splits, setSplits] = useState(() => equalSplits(preset.slots.length));
  const [splitting, setSplitting] = useState(false);
  const [scene, setScene] = useState({ background: "clean-white", backgroundImageUrl: null, arrangement: "side_by_side", size: "landscape" });
  const [progress, setProgress] = useState(null); // [{ label, state }] while generating
  const [result, setResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState(null);

  const choosePreset = (id) => {
    const p = GROUP_PRESETS.find((x) => x.id === id);
    setPresetId(id);
    // Keep what's already filled in where the slot still exists.
    setPeople((prev) => p.slots.map((g, i) => (prev[i] ? { ...prev[i], gender: g } : emptyPerson(g))));
    setSplits(equalSplits(p.slots.length));
    setActive(0);
  };

  // One photo: cut it into one image per person, each used as that person's model.
  const splitPhoto = async () => {
    setError(null);
    setSplitting(true);
    try {
      const res = await groupPost({ _action: "split", image_url: groupPhoto, splits });
      if (!Array.isArray(res.people) || res.people.length !== people.length) throw new Error(res.error || "Couldn't separate the people.");
      setPeople((prev) => prev.map((p, i) => ({
        ...p,
        modelKey: "__custom__",
        modelUrl: res.people[i].url,
        modelGender: p.gender === "male" ? "male" : "female",
      })));
      setActive(0);
      setStep(1);
    } catch (e) {
      setError(e.message || "Couldn't separate the people.");
    } finally {
      setSplitting(false);
    }
  };
  const update = (i, patch) => setPeople((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const swap = () => { setPeople((prev) => [...prev].reverse()); setActive(0); };
  const photoMode = source === "photo";
  const ready = people.map(personReady);
  const allReady = ready.every(Boolean);
  const positions = GROUP_POSITIONS[people.length];
  const slotsByPerson = people.map((p) => p.gender);

  const generate = async () => {
    setError(null);
    const labels = people.map((p, i) => `${positions[i]} · ${GENDER_LABELS[p.gender]}`);
    const finalLabel = photoMode ? "Putting everyone back into your photo" : "Combining into one photo";
    const steps = [...labels.map((l) => ({ label: `Dressing ${l}`, state: "waiting" })), { label: finalLabel, state: "waiting" }];
    setProgress(steps);
    const mark = (i, state) => setProgress((prev) => prev.map((s, j) => (j === i ? { ...s, state } : s)));
    try {
      const memberIds = [];
      // One person at a time: the try-on endpoint runs a single worker.
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        mark(i, "running");
        const cat = PRODUCT_CATS.find((c) => c.id === p.productType);
        const start = await groupPost({
          _action: "generate",
          workflow_type: "model-generation",
          front_image_url: p.frontUrl,
          bottom_image_url: isOutfitType(p.productType) ? p.bottomUrl : null,
          model_key: p.modelKey !== "__custom__" ? p.modelKey : null,
          model_image_url: p.modelKey === "__custom__" ? p.modelUrl : null,
          model_gender: p.modelGender,
          garment_type: cat?.garmentType ?? p.wearType ?? "full",
          product_type: p.productType,
          clothing_prompt: buildProductPrompt(p.productType, p.wearType) || null,
        });
        if (!start.session_id) throw new Error(start.error || "Couldn't start the try-on.");
        await waitForSession(start.session_id);
        memberIds.push(start.session_id);
        mark(i, "done");
      }
      const last = people.length;
      mark(last, "running");
      if (photoMode) {
        // Pure image work on the server: the result comes straight back.
        const stitched = await groupPost({ _action: "stitch", image_url: groupPhoto, splits, member_session_ids: memberIds });
        if (!stitched.result_image) throw new Error(stitched.error || "Couldn't put everyone back into the photo.");
        mark(last, "done");
        setResult(stitched.result_image);
        setSessionId(stitched.session_id);
        setProgress(null);
        return;
      }
      const compose = await groupPost({
        _action: "compose",
        member_session_ids: memberIds,
        background: scene.background,
        background_image_url: scene.background === "custom" ? scene.backgroundImageUrl : null,
        arrangement: scene.arrangement,
        size: scene.size,
      });
      if (!compose.session_id) throw new Error(compose.error || "Couldn't combine the photo.");
      const done = await waitForSession(compose.session_id, 6 * 60 * 1000);
      mark(last, "done");
      setResult(done.result_image);
      setSessionId(compose.session_id);
      setProgress(null);
    } catch (e) {
      setProgress(null);
      setError(e.message || "Generation failed. Please try again.");
      setStep(photoMode ? 1 : 2);
    }
  };

  if (result)
    return (
      <div>
        <Card>
          <OutputScreen
            result={result}
            sessionId={sessionId}
            wfId={wfId}
            onRegenerate={() => { setResult(null); setSessionId(null); setStep(photoMode ? 1 : 2); }}
          />
        </Card>
      </div>
    );

  if (progress)
    return (
      <Card>
        <div className="cr-grp-progress">
          <h3 className="cr-gen-title">Creating your {people.length === 2 ? "duo" : "group"} photo…</h3>
          <p className="cr-gen-sub">Each person is dressed one at a time, then combined. Keep this tab open.</p>
          <ul className="cr-grp-steps">
            {progress.map((s) => (
              <li key={s.label} className={`cr-grp-step is-${s.state}`}>
                <span className="cr-grp-step-mark" aria-hidden="true">
                  {s.state === "done" ? <FsIcon name="check" size={13} strokeWidth={3} /> : s.state === "running" ? <Spin size={14} /> : null}
                </span>
                <span>{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    );

  const person = people[active];

  return (
    <div>
      {error && <ErrBanner msg={error} onDismiss={() => setError(null)} />}

      {step === 0 && (
        <Card>
          <SectionTitle>Who&apos;s in the photo?</SectionTitle>
          <SectionDesc>Pick the group. You choose each person&apos;s outfit next, by position from left to right.</SectionDesc>
          <div className="cr-grp-sources" role="radiogroup" aria-label="Where the people come from">
            {[
              ["models", "Separate model photos", "Pick a model for each person; they're combined into one photo."],
              ["photo", "One photo with everyone", "Upload a photo of the group; each person gets their own outfit."],
            ].map(([v, label, sub]) => (
              <button key={v} type="button" role="radio" aria-checked={source === v}
                className={`cr-grp-source${source === v ? " is-on" : ""}`} onClick={() => setSource(v)}>
                <span className="cr-grp-preset-label">{label}</span>
                <span className="cr-grp-preset-sub">{sub}</span>
              </button>
            ))}
          </div>
          <div className="cr-grp-presets" role="radiogroup" aria-label="Group type">
            {GROUP_PRESETS.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={presetId === p.id}
                className={`cr-grp-preset${presetId === p.id ? " is-on" : ""}`} onClick={() => choosePreset(p.id)}>
                <span className="cr-grp-preset-icons" aria-hidden="true">
                  {p.slots.map((g, i) => (
                    <svg key={i} viewBox="0 0 40 52" width="16" height="21"><circle cx="20" cy="12" r="7" fill="currentColor" /><path d={g === "female" ? "M6 52c1-16 6-30 14-30s13 14 14 30z" : "M8 52V30c0-5 5-8 12-8s12 3 12 8v22z"} fill="currentColor" /></svg>
                  ))}
                </span>
                <span className="cr-grp-preset-label">{p.label}</span>
                <span className="cr-grp-preset-sub">{p.slots.length} people</span>
              </button>
            ))}
          </div>
          {photoMode && (
            <div style={{ marginTop: 14 }}>
              <UploadZone
                label="Group photo"
                required
                hint="everyone standing side by side, full body"
                value={groupPhoto}
                onChange={(url) => { setGroupPhoto(url); setSplits(equalSplits(people.length)); }}
              />
              {groupPhoto && (
                <>
                  <FieldLabel hint="drag the white lines so each section holds one person">Mark where each person stands</FieldLabel>
                  <GroupSplitter src={groupPhoto} splits={splits} onChange={setSplits} positions={positions} />
                </>
              )}
            </div>
          )}
          <StepNav
            onNext={photoMode ? splitPhoto : () => setStep(1)}
            nextLabel={photoMode ? (splitting ? "Separating…" : "Continue") : "Continue"}
            nextDisabled={photoMode && (!groupPhoto || splitting)}
          />
        </Card>
      )}

      {step === 1 && (
        <Card>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <SectionTitle>Dress each person</SectionTitle>
              <SectionDesc>Select a position, then choose that person&apos;s model and what they wear.</SectionDesc>
            </div>
            {people.length === 2 && !photoMode && (
              <button type="button" className="cr-btn cr-btn-outline" style={{ padding: "5px 10px", fontSize: 12 }} onClick={swap}>Swap left and right</button>
            )}
          </div>
          <GroupFigures slots={slotsByPerson} active={active} done={ready} onPick={setActive} />

          <div key={`person-${active}-${presetId}`} className="cr-grp-person">
            <p className="cr-grp-person-head">{positions[active]} · {GENDER_LABELS[person.gender]}</p>
            {photoMode ? (
              <div className="cr-grp-crop">
                {person.modelUrl && <img src={person.modelUrl} alt={`${positions[active]} person`} />}
                <span>This person, cut from your photo. If the cut is wrong, go Back and move the dividers.</span>
              </div>
            ) : (
              <>
                <FieldLabel required>Model</FieldLabel>
                <ModelSelector
                  models={models}
                  selectedKey={person.modelKey}
                  onSelect={(k, u, g) => update(active, { modelKey: k, modelUrl: u, modelGender: g ?? person.modelGender })}
                />
              </>
            )}
            <UploadZone
              label="What they wear (product photo)"
              required
              value={person.frontUrl}
              onChange={(url) => update(active, { frontUrl: url })}
            />
            <TypeShotStep
              productType={person.productType}
              wearType={person.wearType}
              onTypeChange={(v) => update(active, { productType: v })}
              onWearChange={(v) => update(active, { wearType: v })}
              modelGender={person.gender === "any" ? person.modelGender : person.gender}
              bottomUrl={person.bottomUrl}
              onBottomChange={(v) => update(active, { bottomUrl: v })}
            />
          </div>

          <StepNav
            onBack={() => setStep(0)}
            onNext={() => {
              const next = ready.findIndex((r) => !r);
              if (next !== -1) { setActive(next); return; }
              if (photoMode) generate(); else setStep(2);
            }}
            nextLabel={allReady ? (photoMode ? `Generate ${people.length === 2 ? "duo" : "group"} photo` : "Continue") : `Next: ${positions[ready.findIndex((r) => !r)] ?? ""}`}
            isGenerate={allReady && photoMode}
            nextDisabled={!ready[active]}
          />
        </Card>
      )}

      {step === 2 && (
        <Card>
          <SectionTitle>Scene</SectionTitle>
          <SectionDesc>Where the {people.length === 2 ? "two of them stand" : "group stands"} and how the photo is framed.</SectionDesc>
          <div className="cr-settings-grid">
            <CrSelect label="Arrangement" value={scene.arrangement} onChange={(v) => setScene((s) => ({ ...s, arrangement: v }))} options={GROUP_ARRANGEMENTS} />
            <CrSelect label="Image shape" value={scene.size} onChange={(v) => setScene((s) => ({ ...s, size: v }))}
              options={[{ value: "landscape", label: "Landscape (best for groups)" }, { value: "portrait", label: "Portrait" }, { value: "square", label: "Square" }]} />
            <CrSelect label="Background" value={scene.background} onChange={(v) => setScene((s) => ({ ...s, background: v }))} options={GROUP_BACKGROUNDS} />
            {scene.background === "custom" && (
              <UploadZone label="Background Image" hint="your own scene; the group is placed into it" value={scene.backgroundImageUrl}
                onChange={(v) => setScene((s) => ({ ...s, backgroundImageUrl: v }))} compact />
            )}
          </div>
          <div className="cr-grp-summary">
            {people.map((p, i) => (
              <span key={i} className="cr-grp-chip">
                {p.frontUrl && <img src={p.frontUrl} alt="" />}
                {positions[i]}: {catName(p.productType)}
              </span>
            ))}
          </div>
          <StepNav
            onBack={() => setStep(1)}
            onNext={generate}
            nextLabel={`Generate ${people.length === 2 ? "duo" : "group"} photo`}
            isGenerate
            nextDisabled={!allReady || (scene.background === "custom" && !scene.backgroundImageUrl)}
          />
        </Card>
      )}
    </div>
  );
}

function catName(productType) {
  return PRODUCT_CATS.find((c) => c.id === productType)?.label ?? "Outfit";
}

function WorkflowSelector({ onSelect }) {
  return (
    <div>
      <div className="cr-sel-hero">
        <p className="cr-sel-label">Create new asset</p>
        <h2 className="cr-sel-title">What would you like to make?</h2>
        <p className="cr-sel-sub">
          Pick the workflow that matches the photo you have: we&apos;ll guide
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
      <PageTour id={TOURS.studioCreate.id} steps={TOURS.studioCreate.steps} />
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
          {phase === "workflow" && wfType === "group" && GROUP_WORKFLOW_ENABLED && (
            <WorkflowGroup models={models} />
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

