import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { FsPage, FsCard, FsButton, FsPill, FsProgress, FsEmpty, FsIcon } from "../components/fs-ui";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";

const PRODUCT_QUERY = `#graphql
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      images(first: 20) {
        edges { node { id url altText } }
      }
      variants(first: 100) {
        edges {
          node { id title image { url } }
        }
      }
    }
  }
`;

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const apiKey  = await ensureMerchant(session);
  const url       = new URL(request.url);
  const productGid = url.searchParams.get("product_gid");
  const productId  = url.searchParams.get("product_id");

  if (!productGid || !productId) {
    return { product: null, variants: [], mappings: [], productImages: [], internalId: null, productId: null };
  }

  const gqlRes  = await admin.graphql(PRODUCT_QUERY, { variables: { id: productGid } });
  const gqlData = await gqlRes.json();
  const product = gqlData.data?.product ?? null;

  const variants      = (product?.variants?.edges ?? []).map((e) => e.node);
  const productImages = (product?.images?.edges   ?? []).map((e) => e.node);

  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  const syncRes  = await api.syncProduct({
    shopify_product_id:  productId,
    shopify_product_gid: productGid,
    title:               product?.title  ?? "",
    handle:              product?.handle ?? "",
    is_tryon_enabled: 1,
  });

  const sd = syncRes.data ?? {};
  const internalId = syncRes.ok
    ? (sd.id ?? sd.product_id ?? sd.internal_id ?? sd.data?.id ?? null)
    : null;

  const syncError = !syncRes.ok ? (syncRes.error ?? null) : null;

  const mappingsRes = internalId
    ? await api.getVariantMappings(internalId)
    : { ok: true, data: [] };
  const mappings = mappingsRes.ok ? (mappingsRes.data ?? []) : [];

  // Prefer the product_id that PHP itself stored inside an existing mapping —
  // this guarantees we send the correct PHP internal FK even when syncProduct
  // returns a different id field (e.g. the Shopify product ID).
  const existingMapping = mappings[0] ?? null;
  const resolvedProductId = existingMapping?.product_id ?? internalId;

  return { product, variants, mappings, productImages, internalId: resolvedProductId, productId, syncError };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const body = await request.json();
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  const phpPayload = {
    product_id:          body.product_id         ?? null,
    shopify_product_id:  body.shopify_product_id ?? null,
    shopify_product_gid: body.product_gid        ?? null,
    shopify_variant_id:  body.shopify_variant_id,
    shopify_variant_gid: body.shopify_variant_gid,
    variant_title:       body.variant_title      ?? null,
    tryon_image_url:     body.tryon_image_url,
    image_type:          body.image_type         ?? "flat_lay",
    garment_type:        body.garment_type       ?? "top",
    avatar_sex:          body.avatar_sex         ?? null,
    clothing_prompt:     body.clothing_prompt    ?? null,
  };

  // Always POST — PHP does ON DUPLICATE KEY UPDATE (upsert) on shopify_variant_id
  const res = await api.saveVariantMapping(phpPayload);

  if (!res.ok) {
    return { ok: false, error: res.error ?? "Save failed. Please try again.", variant_id: body.shopify_variant_id };
  }

  // After saving, re-fetch all mappings for this product and write to
  // the Shopify metafield so the storefront widget can read them.
  const { product_id, product_gid } = body;
  if (product_id && product_gid) {
    const mappingsRes = await api.getVariantMappings(product_id);
    if (mappingsRes.ok && Array.isArray(mappingsRes.data)) {
      const metaValue = {};
      for (const m of mappingsRes.data) {
        if (m.tryon_image_url) {
          metaValue[String(m.shopify_variant_id)] = {
            tryon_image_url:  m.tryon_image_url,
            image_type:       m.image_type      || "flat_lay",
            garment_type:     m.garment_type    || "top",
            avatar_sex:       m.avatar_sex      || null,
            clothing_prompt:  m.clothing_prompt || null,
          };
        }
      }
      await admin.graphql(
        `#graphql
          mutation SetVariantMappings($input: ProductInput!) {
            productUpdate(input: $input) { product { id } }
          }
        `,
        {
          variables: {
            input: {
              id: product_gid,
              metafields: [{
                namespace: "tryfit",
                key:       "variant_mappings",
                value:     JSON.stringify(metaValue),
                type:      "json",
              }],
            },
          },
        }
      );
    }
  }

  return { ok: true, error: null, variant_id: body.shopify_variant_id };
}

const IMAGE_TYPE_OPTIONS = [
  { label: "Flat lay",          value: "flat_lay",        hint: "Laid flat on a surface" },
  { label: "Ghost mannequin",   value: "ghost_mannequin", hint: "Invisible mannequin" },
  { label: "On model",          value: "on_model",        hint: "Worn by a person" },
];

const AVATAR_SEX_OPTIONS = [
  { label: "Auto-detect", value: ""       },
  { label: "Male",        value: "male"   },
  { label: "Female",      value: "female" },
];

const GARMENT_TYPE_OPTIONS = [
  { label: "Top wear",    value: "top",    hint: "Shirt, kurti, jacket…",      shape: "M8 3 3 6l2 5 3-1v6h8v-6l3 1 2-5-5-3a4 4 0 0 1-8 0z" },
  { label: "Bottom wear", value: "bottom", hint: "Pants, skirt, shorts…",      shape: "M7 3h10l1 18h-5l-1-10-1 10H6z" },
  { label: "Full body",   value: "full",   hint: "Saree, dress, jumpsuit…",    shape: "M9 3h6l1 5-2 2 5 11H5l5-11-2-2z" },
];

function VariantRow({ variant, mapping, productImages, internalProductId, productGid, shopifyProductId }) {
  const submit     = useSubmit();
  const navigation = useNavigation();
  const numericId  = variant.id.replace("gid://shopify/ProductVariant/", "");

  const [imageUrl,     setImageUrl]     = useState(mapping?.tryon_image_url ?? "");
  const [imageType,    setImageType]    = useState(mapping?.image_type      ?? "flat_lay");
  const [garmentType,  setGarmentType]  = useState(mapping?.garment_type    ?? "top");
  const [avatarSex,    setAvatarSex]    = useState(mapping?.avatar_sex      ?? "");
  const [prompt,       setPrompt]       = useState(mapping?.clothing_prompt ?? "");
  const [saved,      setSaved]      = useState(false);
  const [saveError,  setSaveError]  = useState(null);
  const [open,       setOpen]       = useState(!mapping?.tryon_image_url);

  const actionData = useActionData();

  // Synchronize state when mapping prop changes (or after successful save)
  useEffect(() => {
    setImageUrl(mapping?.tryon_image_url ?? "");
    setImageType(mapping?.image_type      ?? "flat_lay");
    setGarmentType(mapping?.garment_type  ?? "top");
    setAvatarSex(mapping?.avatar_sex      ?? "");
    setPrompt(mapping?.clothing_prompt ?? "");
  }, [mapping]);

  // Handle save response for THIS variant only
  useEffect(() => {
    if (!actionData || String(actionData.variant_id) !== numericId) return;
    if (actionData.ok) {
      setSaved(true);
      setSaveError(null);
      const timer = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(timer);
    } else {
      setSaveError(actionData.error ?? "Save failed. Please try again.");
    }
  }, [actionData, numericId]);

  const isMapped = Boolean(mapping?.tryon_image_url);
  // navigation.formData is null for JSON submissions; use navigation.json instead
  const isSaving = navigation.state === "submitting" &&
    String(navigation.json?.shopify_variant_id ?? navigation.formData?.get("shopify_variant_id")) === numericId;

  // Variant image first, then the product gallery (deduped)
  const pickable = [
    ...(variant.image?.url ? [{ url: variant.image.url, label: "Variant image" }] : []),
    ...productImages.map((img) => ({ url: img.url, label: img.altText || "Product image" })),
  ].filter((img, i, arr) => arr.findIndex((o) => o.url === img.url) === i);

  const handleSave = () => {
    if (!imageUrl.trim()) return;
    setSaved(false);
    setSaveError(null);
    // mapping.product_id = PHP's internal FK (most reliable source)
    // mapping.id / mapping_id / variant_id = existing record's PK for upsert
    const phpProductId   = mapping?.product_id ?? internalProductId;
    const existingId     = mapping?.id ?? mapping?.mapping_id ?? mapping?.variant_id ?? null;
    submit(
      {
        ...(existingId ? { mapping_id: existingId } : {}),
        product_id:          phpProductId,
        shopify_product_id:  shopifyProductId ?? null,
        product_gid:         productGid,
        shopify_variant_id:  numericId,
        shopify_variant_gid: variant.id,
        variant_title:       variant.title,
        tryon_image_url:     imageUrl.trim(),
        image_type:          imageType,
        garment_type:        garmentType,
        avatar_sex:          avatarSex || null,
        clothing_prompt:     prompt.trim() || null,
      },
      { method: "post", encType: "application/json" }
    );
  };

  const onPromptChange = (v) => {
    const trimmed = v.slice(0, 200);
    setPrompt(trimmed);
    // Auto-correct garment type when prompt mentions full-body garments
    const lower = trimmed.toLowerCase();
    if (/\b(saree|sari|lehenga|gown|dress|jumpsuit|anarkali|abaya|salwar\s*kameez)\b/.test(lower)) {
      setGarmentType("full");
    }
  };

  return (
    <section className="fs-card" style={{ padding: 0, gap: 0 }}>
      <button type="button" className="fs-variant-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="fs-thumb">{(imageUrl || variant.image?.url) ? <img src={imageUrl || variant.image.url} alt="" /> : <FsIcon name="image" size={16} />}</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{variant.title}</span>
          <span style={{ display: "block", fontSize: 12, color: "var(--fs-muted)", marginTop: 2 }}>
            {isMapped ? `${GARMENT_TYPE_OPTIONS.find((g) => g.value === (mapping?.garment_type ?? "top"))?.label ?? "Top wear"} · ${IMAGE_TYPE_OPTIONS.find((t) => t.value === (mapping?.image_type ?? "flat_lay"))?.label ?? "Flat lay"}` : "Needs a try-on image"}
          </span>
        </span>
        {isMapped ? <FsPill tone="success"><FsIcon name="check" size={12} strokeWidth={3} />Ready</FsPill> : <FsPill tone="warning">Not mapped</FsPill>}
        <FsIcon name="chevronRight" size={16} style={{ color: "#9CA3AF", transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
      </button>

      {open && (
        <div className="fs-variant-body">
          {saveError && (
            <div className="fs-banner fs-banner--critical" role="alert">
              <FsIcon name="info" size={16} /><span style={{ flex: 1 }}>{saveError}</span>
              <button type="button" className="fs-icon-btn" aria-label="Dismiss" onClick={() => setSaveError(null)}><FsIcon name="x" size={14} /></button>
            </div>
          )}

          <div>
            <span className="fs-label">Try-on image</span>
            {pickable.length > 0 && (
              <div className="fs-pick-grid" role="radiogroup" aria-label="Pick a try-on image">
                {pickable.map((img) => (
                  <button key={img.url} type="button" role="radio" aria-checked={imageUrl === img.url} aria-label={img.label}
                    className={`fs-pick${imageUrl === img.url ? " is-on" : ""}`} onClick={() => setImageUrl(img.url)}>
                    <img src={img.url} alt="" />
                    {imageUrl === img.url && <span className="fs-pick-check"><FsIcon name="check" size={12} strokeWidth={3.2} /></span>}
                  </button>
                ))}
              </div>
            )}
            <label className="fs-input-row" style={{ marginTop: 10 }}>
              <FsIcon name="link" size={16} />
              <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Or paste an image URL — https://…" aria-label="Try-on image URL" autoComplete="off" />
            </label>
          </div>

          <div>
            <span className="fs-label">Garment type</span>
            <div className="fs-option-grid" role="radiogroup" aria-label="Garment type">
              {GARMENT_TYPE_OPTIONS.map((g) => (
                <button key={g.value} type="button" role="radio" aria-checked={garmentType === g.value}
                  className={`fs-option${garmentType === g.value ? " is-on" : ""}`} onClick={() => setGarmentType(g.value)}>
                  <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d={g.shape} fill="currentColor" /></svg>
                  <span className="fs-option-title">{g.label}</span>
                  <span className="fs-option-hint">{g.hint}</span>
                </button>
              ))}
            </div>
            <p className="fs-help">Controls how the result is composited. Top wear keeps the shopper&apos;s original lower body.</p>
          </div>

          <div className="fs-two-col">
            <div>
              <span className="fs-label">Photo style</span>
              <div className="fs-seg" role="group" aria-label="Image type" style={{ display: "flex" }}>
                {IMAGE_TYPE_OPTIONS.map((t) => (
                  <button key={t.value} type="button" style={{ flex: 1 }} className={imageType === t.value ? "is-on" : ""} aria-pressed={imageType === t.value} onClick={() => setImageType(t.value)} title={t.hint}>{t.label}</button>
                ))}
              </div>
            </div>
            <div>
              <span className="fs-label">Model</span>
              <div className="fs-seg" role="group" aria-label="Avatar sex" style={{ display: "flex" }}>
                {AVATAR_SEX_OPTIONS.map((o) => (
                  <button key={o.value || "auto"} type="button" style={{ flex: 1 }} className={avatarSex === o.value ? "is-on" : ""} aria-pressed={avatarSex === o.value} onClick={() => setAvatarSex(o.value)}>{o.label}</button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <label className="fs-label" htmlFor={`prompt-${numericId}`}>Styling note <span style={{ fontWeight: 400, color: "var(--fs-muted)" }}>(optional)</span></label>
              <span className="fs-tabular" style={{ fontSize: 12, color: "var(--fs-muted)" }}>{prompt.length} / 200</span>
            </div>
            <textarea id={`prompt-${numericId}`} className="fs-textarea" rows={2} value={prompt} maxLength={200}
              onChange={(e) => onPromptChange(e.target.value)} placeholder="e.g. red cotton t-shirt with white logo" />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <FsButton onClick={handleSave} disabled={!imageUrl.trim() || !internalProductId || isSaving}>
              {isSaving ? "Saving…" : saved ? "Saved" : isMapped ? "Save changes" : "Save mapping"}
            </FsButton>
            {saved && <span style={{ fontSize: 13, color: "var(--fs-success-ink)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><FsIcon name="check" size={14} strokeWidth={3} />Live on your storefront</span>}
            {!internalProductId && <span style={{ fontSize: 12, color: "var(--fs-warning-ink)" }}>Product isn&apos;t synced yet — refresh to retry.</span>}
          </div>
        </div>
      )}
    </section>
  );
}

VariantRow.propTypes = {
  variant: PropTypes.object.isRequired,
  mapping: PropTypes.object,
  productImages: PropTypes.array,
  internalProductId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  productGid: PropTypes.string,
  shopifyProductId: PropTypes.string,
};

export default function Variants() {
  const { product, variants, mappings, productImages, internalId, productId, syncError } = useLoaderData();

  if (!product) {
    return (
      <FsPage title="Variant mapping">
        <FsCard>
          <FsEmpty icon="image" text="Choose a product first, then give each variant its try-on image." cta="Go to products" to="/app/products" />
        </FsCard>
      </FsPage>
    );
  }

  const mappingsByVariant = {};
  for (const m of mappings) {
    mappingsByVariant[String(m.shopify_variant_id)] = m;
  }
  const mappedCount = variants.filter((v) => mappingsByVariant[v.id.replace("gid://shopify/ProductVariant/", "")]?.tryon_image_url).length;
  const pct = variants.length ? Math.round((mappedCount / variants.length) * 100) : 0;

  return (
    <FsPage
      title={product.title}
      subtitle="Give each variant a try-on image so shoppers see the exact color and style they picked."
      actions={<FsButton to="/app/products" variant="ghost" icon="arrowLeft">Products</FsButton>}
    >
      {syncError && (
        <div className="fs-banner fs-banner--critical" role="alert"><FsIcon name="info" size={16} /><span>{syncError}</span></div>
      )}

      <FsCard>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="fs-tabular" style={{ fontSize: 16, fontWeight: 700 }}>{mappedCount} of {variants.length} variants ready</div>
            <p className="fs-card-sub">{mappedCount === variants.length ? "Every variant has a try-on image." : "Variants without an image fall back to the main product image."}</p>
          </div>
          <span className="fs-tabular" style={{ fontSize: 17, fontWeight: 700 }}>{pct}%</span>
        </div>
        <FsProgress value={pct} tone={pct === 100 ? "success" : "primary"} />
      </FsCard>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {variants.map((variant) => {
          const numericId = variant.id.replace("gid://shopify/ProductVariant/", "");
          return (
            <VariantRow
              key={variant.id}
              variant={variant}
              mapping={mappingsByVariant[numericId] ?? null}
              productImages={productImages}
              internalProductId={internalId}
              productGid={product.id}
              shopifyProductId={productId}
            />
          );
        })}
      </div>
    </FsPage>
  );
}
