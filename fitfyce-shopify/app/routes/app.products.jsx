import { useState, useRef, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import {
  useLoaderData,
  useSubmit,
  useNavigate,
  useNavigation,
  useActionData,
} from "react-router";
import { useCelebrate } from "../components/AppShell";
import { FsPage, FsCard, FsButton, FsPill, FsEmpty, FsIcon } from "../components/fs-ui";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";

const COLLECTIONS_QUERY = `#graphql
  query GetCollectionsWithProducts($first: Int!) {
    collections(first: $first, query: "published_status:published") {
      edges {
        node {
          id
          title
          handle
          image { url altText }
          products(first: 100) {
            edges {
              node {
                id
                title
                handle
                status
                vendor
                productType
                tags
                featuredImage { url altText width height }
                priceRange {
                  minVariantPrice { amount currencyCode }
                  maxVariantPrice { amount currencyCode }
                }
                metafield(namespace: "tryfit", key: "tryon_enabled") { value }
              }
            }
          }
          metafield(namespace: "tryfit", key: "tryon_enabled") { value }
        }
      }
    }
  }
`;

const PRODUCT_VARIANTS_QUERY = `#graphql
  query GetProductVariants($id: ID!) {
    product(id: $id) {
      descriptionHtml
      variants(first: 100) {
        edges {
          node {
            id
            title
            price
            sku
            image { url altText }
            selectedOptions { name value }
          }
        }
      }
    }
  }
`;

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const shop = session.shop;

  const [collectionsRes, phpRes] = await Promise.all([
    admin.graphql(COLLECTIONS_QUERY, { variables: { first: 30 } }),
    phpApiClient(apiKey, PHP_API_URL, shop).getProducts(),
  ]);

  const collectionsData = await collectionsRes.json();
  const phpList = phpRes.ok && Array.isArray(phpRes.data) ? phpRes.data : [];

  const phpMap = {};
  for (const p of phpList) {
    phpMap[String(p.shopify_product_id)] = p;
  }

  const rawCollections = (collectionsData.data?.collections?.edges ?? []).map(
    (e) => e.node,
  );

  const collections = rawCollections
    .map((col) => {
      const activeProducts = (col.products?.edges ?? [])
        .map((e) => e.node)
        .filter((p) => p.status === "ACTIVE")
        .map((p) => {
          const numericId = p.id.replace("gid://shopify/Product/", "");
          const phpRow = phpMap[numericId] ?? null;
          const minAmt = p.priceRange?.minVariantPrice?.amount ?? null;
          const maxAmt = p.priceRange?.maxVariantPrice?.amount ?? null;
          const currency = p.priceRange?.minVariantPrice?.currencyCode ?? "USD";
          const priceDisplay =
            minAmt === null
              ? null
              : minAmt === maxAmt || maxAmt === null
                ? minAmt
                : `${minAmt} – ${maxAmt}`;
          // Shopify metafield is the authoritative source — it's updated in the
          // same action mutation so it's always consistent on loader revalidation.
          // PHP is used as fallback only if the metafield hasn't been set yet.
          const shopifyEnabled = p.metafield?.value === "true";
          const phpEnabled = phpRow ? phpRow.is_tryon_enabled == 1 : false;
          return {
            id: p.id,
            title: p.title,
            handle: p.handle,
            vendor: p.vendor ?? "",
            productType: p.productType ?? "",
            tags: p.tags ?? [],
            featuredImage: p.featuredImage,
            numericId,
            isTryonEnabled: p.metafield !== null ? shopifyEnabled : phpEnabled,
            price: priceDisplay,
            currency,
          };
        });

      return {
        id: col.id,
        title: col.title,
        handle: col.handle,
        image: col.image,
        numericId: col.id.replace("gid://shopify/Collection/", ""),
        isTryonEnabled: col.metafield?.value === "true",
        products: activeProducts,
        productCount: activeProducts.length,
      };
    })
    .filter((col) => col.productCount > 0);

  const allProductIds = new Set();
  let tryonEnabledCount = 0;
  for (const col of collections) {
    for (const p of col.products) {
      allProductIds.add(p.id);
      if (p.isTryonEnabled) tryonEnabledCount++;
    }
  }

  return {
    collections,
    shop,
    stats: {
      totalCollections: collections.length,
      totalProducts: allProductIds.size,
      tryonEnabledCount,
    },
  };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);

  if (intent === "toggle_product") {
    const shopifyProductId = formData.get("shopify_product_id");
    const shopifyProductGid = formData.get("shopify_product_gid");
    const enabled = formData.get("enabled") === "true";
    const productHandle = formData.get("handle") || null;
    const collectionId = formData.get("collection_id") || null;
    const collectionTitle = formData.get("collection_title") || null;
    const collectionHandle = formData.get("collection_handle") || null;
    const collectionProductsRaw = formData.get("collection_products");
    const collectionProducts = collectionProductsRaw
      ? JSON.parse(collectionProductsRaw)
      : null;

    // Product facts for RAG grounding (see docs/rag-qdrant-implementation-plan.md).
    // vendor/product_type/tags are already known client-side from the collections
    // loader query; description_html isn't loaded there (would bloat the bulk
    // page-load query), so it's fetched here alongside variants instead.
    const vendor = formData.get("vendor") || null;
    const productType = formData.get("product_type") || null;
    const tagsRaw = formData.get("tags");
    const tags = tagsRaw ? JSON.parse(tagsRaw) : [];

    // Fetch variants + description for this product directly (kept out of the
    // page-load query to reduce cost)
    const varRes = await admin.graphql(PRODUCT_VARIANTS_QUERY, {
      variables: { id: shopifyProductGid },
    });
    const varData = await varRes.json();
    const shopifyVariants = (varData.data?.product?.variants?.edges ?? []).map(
      (e) => ({
        id: e.node.id,
        shopify_variant_id: e.node.id.replace(
          "gid://shopify/ProductVariant/",
          "",
        ),
        title: e.node.title,
        price: e.node.price,
        sku: e.node.sku ?? null,
        image_url: e.node.image?.url ?? null,
        options: e.node.selectedOptions ?? [],
      }),
    );
    const descriptionHtml = varData.data?.product?.descriptionHtml ?? null;

    const phpResult = await api.syncProduct({
      shopify_product_id: shopifyProductId,
      shopify_product_gid: shopifyProductGid,
      handle: productHandle,
      collection_id: collectionId,
      collection_title: collectionTitle,
      collection_handle: collectionHandle,
      collection_products: collectionProducts,
      shopify_variants: shopifyVariants,
      is_tryon_enabled: enabled ? 1 : 0,
      vendor,
      product_type: productType,
      tags,
      description_html: descriptionHtml,
    });

    if (!phpResult.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: phpResult.error ?? "PHP sync failed" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    const metafieldRes = await admin.graphql(
      `#graphql
        mutation SetTryonMetafield($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id }
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          input: {
            id: shopifyProductGid,
            metafields: [
              {
                namespace: "tryfit",
                key: "tryon_enabled",
                value: enabled ? "true" : "false",
                type: "single_line_text_field",
              },
            ],
          },
        },
      },
    );

    const metafieldData = await metafieldRes.json();
    const metafieldErrors = metafieldData.data?.productUpdate?.userErrors ?? [];
    if (metafieldErrors.length > 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Metafield update failed: ${metafieldErrors[0].message}`,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    return { ok: true };
  }

  if (intent === "toggle_collection") {
    const collectionGid = formData.get("collection_gid");
    const enabled = formData.get("enabled") === "true";
    const productsJson = formData.get("products_json");
    const products = productsJson ? JSON.parse(productsJson) : [];

    // Update collection metafield
    await admin.graphql(
      `#graphql
        mutation SetCollectionTryonMetafield($input: CollectionInput!) {
          collectionUpdate(input: $input) { collection { id } }
        }
      `,
      {
        variables: {
          input: {
            id: collectionGid,
            metafields: [
              {
                namespace: "tryfit",
                key: "tryon_enabled",
                value: enabled ? "true" : "false",
                type: "single_line_text_field",
              },
            ],
          },
        },
      },
    );

    // Bulk-update every product in the collection (PHP + Shopify metafield in parallel)
    const collectionId = formData.get("collection_id") || null;
    const collectionTitle = formData.get("collection_title") || null;
    const collectionHandle = formData.get("collection_handle") || null;

    const collectionProductsRaw = formData.get("collection_products");
    const collectionProducts = collectionProductsRaw
      ? JSON.parse(collectionProductsRaw)
      : null;

    await Promise.allSettled(
      products.map((p) =>
        Promise.allSettled([
          api.syncProduct({
            shopify_product_id: p.numericId,
            shopify_product_gid: p.id,
            handle: p.handle || null,
            collection_id: collectionId,
            collection_title: collectionTitle,
            collection_handle: collectionHandle,
            collection_products: collectionProducts,
            shopify_variants: null,
            is_tryon_enabled: enabled ? 1 : 0,
            // vendor/product_type/tags only — description_html is skipped here to
            // avoid an N+1 GraphQL call per product on a bulk collection toggle;
            // it backfills the next time each product is toggled individually.
            vendor: p.vendor || null,
            product_type: p.productType || null,
            tags: p.tags || [],
          }),
          admin.graphql(
            `#graphql
              mutation SetProductTryonMetafield($input: ProductInput!) {
                productUpdate(input: $input) { product { id } }
              }
            `,
            {
              variables: {
                input: {
                  id: p.id,
                  metafields: [
                    {
                      namespace: "tryfit",
                      key: "tryon_enabled",
                      value: enabled ? "true" : "false",
                      type: "single_line_text_field",
                    },
                  ],
                },
              },
            },
          ),
        ]),
      ),
    );

    return { ok: true };
  }

  if (intent === "bulk_toggle_products") {
    // Bulk enable/disable from the product grid's selection bar — same writes as
    // a single toggle_product (PHP sync + Shopify metafield), one per product.
    const enabled = formData.get("enabled") === "true";
    const productsJson = formData.get("products_json");
    const products = productsJson ? JSON.parse(productsJson) : [];

    // Each PHP sync rebuilds the merchant's products JSON on one shared row, so
    // firing every product at once makes them block each other and time out.
    // Work through the list a few at a time, with one retry per product.
    const syncOne = async (p) => {
      const payload = {
        shopify_product_id: p.numericId,
        shopify_product_gid: p.id,
        handle: p.handle || null,
        // Keep the product's collection link (PHP overwrites these columns).
        collection_id: p.collectionId || null,
        collection_title: p.collectionTitle || null,
        collection_handle: p.collectionHandle || null,
        is_tryon_enabled: enabled ? 1 : 0,
        vendor: p.vendor || null,
        product_type: p.productType || null,
        tags: p.tags || [],
      };
      let phpRes = await api.syncProduct(payload, 30_000);
      if (!phpRes.ok) phpRes = await api.syncProduct(payload, 30_000);
      if (!phpRes.ok) throw new Error(phpRes.error ?? "PHP sync failed");
      await admin.graphql(
          `#graphql
            mutation SetProductTryonMetafield($input: ProductInput!) {
              productUpdate(input: $input) { product { id } }
            }
          `,
          {
            variables: {
              input: {
                id: p.id,
                metafields: [
                  {
                    namespace: "tryfit",
                    key: "tryon_enabled",
                    value: enabled ? "true" : "false",
                    type: "single_line_text_field",
                  },
                ],
              },
            },
          },
        );
    };

    const BATCH = 3;
    const failedIds = [];
    let firstError = null;
    for (let i = 0; i < products.length; i += BATCH) {
      const batch = products.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(syncOne));
      results.forEach((r, j) => {
        if (r.status === "rejected") {
          failedIds.push(batch[j].id);
          firstError = firstError ?? (r.reason?.message ?? String(r.reason));
          console.error("[products] bulk toggle failed for", batch[j].id, r.reason?.message ?? r.reason);
        }
      });
    }

    const failed = failedIds.length;
    return { ok: failed === 0, bulk: true, enabled, updated: products.length - failed, failed, failedIds, error: firstError };
  }

  if (intent === "delete_collection") {
    const collectionGid = formData.get("collection_gid");

    await admin.graphql(
      `#graphql
        mutation DeleteCollection($id: ID!) {
          collectionDelete(input: { id: $id }) {
            deletedCollectionId
            userErrors { field message }
          }
        }
      `,
      { variables: { id: collectionGid } },
    );

    return { ok: true };
  }

  return { ok: false };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(price, currency) {
  if (price === null || price === undefined || price === "") return "—";
  const fmt = (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    try {
      return n.toLocaleString(undefined, { style: "currency", currency: currency || "USD", minimumFractionDigits: 2 });
    } catch {
      return `${n.toFixed(2)} ${currency ?? ""}`.trim();
    }
  };
  const parts = String(price).split("–").map((s) => s.trim());
  return parts.length === 2 ? `${fmt(parts[0])} – ${fmt(parts[1])}` : fmt(parts[0]);
}

function collectionPayload(products, overrideId, overrideEnabled) {
  return JSON.stringify(
    products.map((p) => ({
      shopify_product_id: p.numericId,
      shopify_product_gid: p.id,
      title: p.title,
      handle: p.handle,
      vendor: p.vendor ?? null,
      product_type: p.productType ?? null,
      featured_image: p.featuredImage?.url ?? null,
      price: p.price ?? null,
      currency: p.currency ?? null,
      is_tryon_enabled: p.id === overrideId ? (overrideEnabled ? 1 : 0) : (p.isTryonEnabled ? 1 : 0),
    })),
  );
}

const variantsUrl = (p) =>
  `/app/variants?product_id=${p.numericId}&product_gid=${encodeURIComponent(p.id)}&title=${encodeURIComponent(p.title)}`;

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="fs-switch" onClick={onChange} disabled={disabled}>
      <span />
    </button>
  );
}

Switch.propTypes = { checked: PropTypes.bool, onChange: PropTypes.func, disabled: PropTypes.bool, label: PropTypes.string };

function Menu({ label, items }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setConfirm(null); } };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" style={{ width: 28, padding: 0 }} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <FsIcon name="dots" size={14} filled />
      </button>
      {open && (
        <div className="fs-menu" role="menu">
          {confirm ? (
            <div style={{ padding: 14, width: 230 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{confirm.confirmTitle}</div>
              <div style={{ fontSize: 12, color: "var(--fs-muted)", margin: "4px 0 12px" }}>{confirm.confirmText}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <FsButton variant="ghost" size="sm" style={{ flex: 1 }} onClick={() => setConfirm(null)}>Cancel</FsButton>
                <button type="button" className="fs-btn fs-btn--sm fs-btn--danger" style={{ flex: 1 }} onClick={() => { confirm.onSelect(); setOpen(false); setConfirm(null); }}>{confirm.confirmCta}</button>
              </div>
            </div>
          ) : (
            items.map((it, i) =>
              it.divider ? <div key={`d${i}`} className="fs-menu-divider" /> : (
                <button key={it.label} type="button" role="menuitem" className={`fs-menu-item${it.danger ? " is-danger" : ""}`}
                  onClick={() => { if (it.confirmTitle) setConfirm(it); else { it.onSelect(); setOpen(false); } }}>
                  {it.label}
                </button>
              ),
            )
          )}
        </div>
      )}
    </div>
  );
}

Menu.propTypes = { label: PropTypes.string, items: PropTypes.array.isRequired };

// ─── Collections ──────────────────────────────────────────────────────────────

function CollectionRow({ collection, shop, submit, isSubmitting, onViewProducts }) {
  const enabledCount = collection.products.filter((p) => p.isTryonEnabled).length;
  const pct = collection.productCount ? Math.round((enabledCount / collection.productCount) * 100) : 0;

  function handleToggleCollection() {
    const fd = new FormData();
    fd.set("intent", "toggle_collection");
    fd.set("collection_gid", collection.id);
    fd.set("collection_id", collection.numericId);
    fd.set("collection_title", collection.title);
    fd.set("collection_handle", collection.handle);
    fd.set("collection_products", collectionPayload(collection.products));
    fd.set("enabled", String(!collection.isTryonEnabled));
    fd.set(
      "products_json",
      JSON.stringify(
        collection.products.map((p) => ({
          id: p.id,
          numericId: p.numericId,
          handle: p.handle,
          vendor: p.vendor,
          productType: p.productType,
          tags: p.tags,
        })),
      ),
    );
    submit(fd, { method: "post" });
  }

  function handleDelete() {
    const fd = new FormData();
    fd.set("intent", "delete_collection");
    fd.set("collection_gid", collection.id);
    submit(fd, { method: "post" });
  }

  return (
    <tr>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span className="fs-thumb" style={{ width: 30, height: 30, borderRadius: 6 }}>
            {collection.image ? <img src={collection.image.url} alt="" /> : <FsIcon name="grid" size={13} />}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{collection.title}</div>
            <div style={{ fontSize: 11, color: "var(--fs-muted)", marginTop: 1 }}>/{collection.handle}</div>
          </div>
        </div>
      </td>
      <td className="fs-tabular">{collection.productCount} products</td>
      <td style={{ width: 200 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="fs-progress fs-progress--primary" style={{ height: 5, flex: 1 }}><span style={{ width: `${pct}%` }} /></div>
          <span className="fs-tabular" style={{ fontSize: 11, color: "#4B5563", width: 48 }}>{enabledCount} of {collection.productCount}</span>
        </div>
      </td>
      <td>
        <FsButton variant="plain" size="sm" onClick={() => onViewProducts(collection.id)}>View products</FsButton>
      </td>
      <td className="num">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: collection.isTryonEnabled ? "var(--fs-success-ink)" : "var(--fs-muted)", width: 18 }}>{collection.isTryonEnabled ? "On" : "Off"}</span>
          <Switch checked={collection.isTryonEnabled} onChange={handleToggleCollection} disabled={isSubmitting} label={`Try-on for ${collection.title} collection`} />
          <Menu
            label={`More actions for ${collection.title}`}
            items={[
              { label: "View on store", onSelect: () => window.open(`https://${shop}/collections/${collection.handle}`, "_blank") },
              { label: "Edit in Shopify admin", onSelect: () => window.open(`https://${shop}/admin/collections/${collection.numericId}`, "_blank") },
              { divider: true },
              { label: "Delete collection", danger: true, confirmTitle: `Delete “${collection.title}”?`, confirmText: "The collection is removed from Shopify. Products are not deleted.", confirmCta: "Delete", onSelect: handleDelete },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}

CollectionRow.propTypes = {
  collection: PropTypes.object.isRequired,
  shop: PropTypes.string,
  submit: PropTypes.func,
  isSubmitting: PropTypes.bool,
  onViewProducts: PropTypes.func,
};

// ─── Product row ──────────────────────────────────────────────────────────────

function ProductRow({ product, shop, selected, onSelect, onToggle, isSubmitting, pendingEnabled }) {
  const navigate = useNavigate();
  const enabled = pendingEnabled ?? product.isTryonEnabled;

  return (
    <tr className={selected ? "is-selected" : undefined}>
      <td style={{ width: 36 }}>
        <button type="button" className={`fs-check${selected ? " is-on" : ""}`} aria-pressed={selected} aria-label={`Select ${product.title}`} onClick={onSelect}>
          {selected && <FsIcon name="check" size={13} strokeWidth={3.2} />}
        </button>
      </td>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="fs-thumb" style={{ width: 40, height: 40, borderRadius: 8 }}>
            {product.featuredImage?.url ? <img src={product.featuredImage.url} alt="" /> : <FsIcon name="image" size={16} />}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }} title={product.title}>{product.title}</div>
            {product.vendor && <div style={{ fontSize: 12, color: "var(--fs-muted)", marginTop: 2 }}>{product.vendor}</div>}
          </div>
        </div>
      </td>
      <td>
        {enabled ? (
          <span className="fs-pill fs-product-status is-on"><span className="fs-dot" />Try-on active</span>
        ) : (
          <span className="fs-pill fs-product-status">Off</span>
        )}
      </td>
      <td className="fs-tabular">{formatPrice(product.price, product.currency)}</td>
      <td className="num">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" aria-label={`Preview ${product.title} on store`} onClick={() => window.open(`https://${shop}/products/${product.handle}`, "_blank")}>
            <FsIcon name="eye" size={14} />
          </button>
          <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" aria-label={`Edit variants for ${product.title}`} onClick={() => navigate(variantsUrl(product))}>
            <FsIcon name="pencil" size={14} />
          </button>
          <Switch checked={enabled} onChange={onToggle} disabled={isSubmitting} label={`Try-on for ${product.title}`} />
          <Menu
            label={`More actions for ${product.title}`}
            items={[
              { label: "Edit in Shopify admin", onSelect: () => window.open(`https://${shop}/admin/products/${product.numericId}`, "_blank") },
              { label: "Create AI model photo", onSelect: () => navigate("/app/studio/create") },
              ...(enabled
                ? [{ divider: true }, { label: "Turn off try-on", danger: true, confirmTitle: "Turn off try-on?", confirmText: "Shoppers won't see the try-on button on this product.", confirmCta: "Turn off", onSelect: onToggle }]
                : []),
            ]}
          />
        </div>
      </td>
    </tr>
  );
}

ProductRow.propTypes = {
  product: PropTypes.object.isRequired,
  shop: PropTypes.string,
  selected: PropTypes.bool,
  onSelect: PropTypes.func,
  onToggle: PropTypes.func,
  isSubmitting: PropTypes.bool,
  pendingEnabled: PropTypes.bool,
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const COLLECTIONS_PER_PAGE = 8;
const PRODUCTS_PER_PAGE = 20;

export default function Products() {
  const { collections, shop } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const actionData = useActionData();
  const celebrate = useCelebrate();
  const isSubmitting = navigation.state === "submitting";

  const [collectionQuery, setCollectionQuery] = useState("");
  const [collectionPage, setCollectionPage] = useState(1);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [shown, setShown] = useState(PRODUCTS_PER_PAGE);
  const [selected, setSelected] = useState(() => new Set());
  const gridRef = useRef(null);
  const lastEnable = useRef(null);

  // Unique products, each remembering the first collection it belongs to
  // (that collection is sent as context on toggle, as before).
  const allProducts = useMemo(() => {
    const map = new Map();
    for (const c of collections) {
      for (const p of c.products) {
        if (!map.has(p.id)) map.set(p.id, { ...p, collection: c, collectionIds: [c.id] });
        else map.get(p.id).collectionIds.push(c.id);
      }
    }
    return Array.from(map.values());
  }, [collections]);

  const total = allProducts.length;
  const enabledCount = allProducts.filter((p) => p.isTryonEnabled).length;

  // Optimistic state for the single product currently being saved
  const pending = navigation.formData?.get("intent") === "toggle_product"
    ? { id: navigation.formData.get("shopify_product_gid"), enabled: navigation.formData.get("enabled") === "true" }
    : null;

  useEffect(() => {
    if (!actionData?.ok || !lastEnable.current) return;
    const n = lastEnable.current;
    lastEnable.current = null;
    celebrate({ title: "Try-on is live", body: n === 1 ? "Shoppers can now try this product on." : `${n} products are now try-on ready.` });
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (actionData?.bulk) setSelected(new Set());
  }, [actionData]);

  const filteredCollections = collections.filter((c) => c.title.toLowerCase().includes(collectionQuery.toLowerCase()));
  const collectionPages = Math.max(1, Math.ceil(filteredCollections.length / COLLECTIONS_PER_PAGE));
  const colPage = Math.min(collectionPage, collectionPages);
  const pagedCollections = filteredCollections.slice((colPage - 1) * COLLECTIONS_PER_PAGE, colPage * COLLECTIONS_PER_PAGE);

  const filteredProducts = allProducts.filter((p) => {
    if (collectionFilter !== "all" && !p.collectionIds.includes(collectionFilter)) return false;
    if (status === "active" && !p.isTryonEnabled) return false;
    if (status === "off" && p.isTryonEnabled) return false;
    const q = query.trim().toLowerCase();
    return !q || p.title.toLowerCase().includes(q) || (p.vendor ?? "").toLowerCase().includes(q);
  });
  const visibleProducts = filteredProducts.slice(0, shown);

  function toggleProduct(product) {
    const newEnabled = !product.isTryonEnabled;
    const c = product.collection;
    const fd = new FormData();
    fd.set("intent", "toggle_product");
    fd.set("shopify_product_id", product.numericId);
    fd.set("shopify_product_gid", product.id);
    fd.set("handle", product.handle);
    fd.set("collection_id", c.numericId);
    fd.set("collection_title", c.title);
    fd.set("collection_handle", c.handle);
    fd.set("collection_products", collectionPayload(c.products, product.id, newEnabled));
    fd.set("enabled", String(newEnabled));
    fd.set("vendor", product.vendor || "");
    fd.set("product_type", product.productType || "");
    fd.set("tags", JSON.stringify(product.tags || []));
    lastEnable.current = newEnabled ? 1 : null;
    submit(fd, { method: "post" });
  }

  function bulkToggle(enabled) {
    const chosen = allProducts.filter((p) => selected.has(p.id) && p.isTryonEnabled !== enabled);
    if (!chosen.length) { setSelected(new Set()); return; }
    const fd = new FormData();
    fd.set("intent", "bulk_toggle_products");
    fd.set("enabled", String(enabled));
    fd.set("products_json", JSON.stringify(chosen.map((p) => ({
      id: p.id, numericId: p.numericId, handle: p.handle, vendor: p.vendor, productType: p.productType, tags: p.tags,
      collectionId: p.collection?.numericId, collectionTitle: p.collection?.title, collectionHandle: p.collection?.handle,
    }))));
    lastEnable.current = enabled ? chosen.length : null;
    submit(fd, { method: "post" });
  }

  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allVisibleSelected = visibleProducts.length > 0 && visibleProducts.every((p) => selected.has(p.id));
  const selectAllVisible = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allVisibleSelected) visibleProducts.forEach((p) => next.delete(p.id));
    else visibleProducts.forEach((p) => next.add(p.id));
    return next;
  });

  const viewCollectionProducts = (id) => {
    setCollectionFilter(id);
    setStatus("all");
    setShown(PRODUCTS_PER_PAGE);
    gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const chips = [
    ["all", "All", total],
    ["active", "Try-on active", enabledCount],
    ["off", "Not enabled", total - enabledCount],
  ];

  return (
    <FsPage
      title="Products"
      subtitle="Choose which products show the try-on button in your store."
      actions={<a className="fs-btn fs-btn--ghost" href={`https://${shop}`} target="_blank" rel="noopener noreferrer"><FsIcon name="store" size={16} />View store</a>}
    >
      {actionData && actionData.ok === false && actionData.bulk && (
        <div className="fs-banner fs-banner--warning" role="alert"><FsIcon name="info" size={16} /><span>{actionData.updated} updated, {actionData.failed} couldn&apos;t be saved. Try those again.</span></div>
      )}

      {total === 0 ? (
        <FsCard>
          <FsEmpty icon="box" text="No active products in published collections yet. Add products to a collection in Shopify to get started." cta="Open Shopify products" onClick={() => window.open(`https://${shop}/admin/products`, "_blank")} />
        </FsCard>
      ) : (
        <>
          {/* Collections */}
          <FsCard style={{ padding: 0, gap: 0, overflow: "visible" }}>
            <div className="fs-card-head" style={{ padding: "20px 24px", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <h3 className="fs-h3">Collections</h3>
                <p className="fs-card-sub">Switch on a whole collection at once — every product in it gets try-on.</p>
              </div>
              <label className="fs-search">
                <FsIcon name="search" size={16} />
                <input type="search" placeholder="Search collections" aria-label="Search collections" value={collectionQuery} onChange={(e) => { setCollectionQuery(e.target.value); setCollectionPage(1); }} />
              </label>
            </div>
            {filteredCollections.length === 0 ? (
              <FsEmpty icon="search" text={`No collections match “${collectionQuery}”.`} cta="Clear search" onClick={() => setCollectionQuery("")} />
            ) : (
              <>
                <div className="fs-table-wrap" style={{ overflow: "visible" }}>
                  <table className="fs-table">
                    <thead><tr><th>Collection</th><th>Products</th><th>Try-on coverage</th><th /><th className="num">Try-on</th></tr></thead>
                    <tbody>
                      {pagedCollections.map((collection) => (
                        <CollectionRow key={collection.id} collection={collection} shop={shop} submit={submit} isSubmitting={isSubmitting} onViewProducts={viewCollectionProducts} />
                      ))}
                    </tbody>
                  </table>
                </div>
                {collectionPages > 1 && (
                  <div className="fs-pager">
                    <span className="fs-tabular">Showing {(colPage - 1) * COLLECTIONS_PER_PAGE + 1}–{Math.min(colPage * COLLECTIONS_PER_PAGE, filteredCollections.length)} of {filteredCollections.length}</span>
                    <nav aria-label="Collections pagination" style={{ display: "flex", gap: 6 }}>
                      {Array.from({ length: collectionPages }, (_, i) => i + 1).map((n) => (
                        <button key={n} type="button" className={`fs-page-btn${n === colPage ? " is-on" : ""}`} aria-current={n === colPage ? "page" : undefined} onClick={() => setCollectionPage(n)}>{n}</button>
                      ))}
                    </nav>
                  </div>
                )}
              </>
            )}
          </FsCard>

          {/* Product grid */}
          <div ref={gridRef} style={{ display: "flex", flexDirection: "column", gap: 16, scrollMarginTop: 84 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label className="fs-search">
                <FsIcon name="search" size={16} />
                <input type="search" placeholder="Search products or vendors" aria-label="Search products" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PRODUCTS_PER_PAGE); }} />
              </label>
              <div role="group" aria-label="Filter products" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {chips.map(([v, l, n]) => (
                  <button key={v} type="button" className={`fs-chip${status === v ? " is-on" : ""}`} aria-pressed={status === v} onClick={() => { setStatus(v); setShown(PRODUCTS_PER_PAGE); }}>
                    {l} <small className="fs-tabular">{n}</small>
                  </button>
                ))}
              </div>
              <div style={{ flex: 1 }} />
              <select className="fs-select" style={{ width: 220 }} aria-label="Filter by collection" value={collectionFilter} onChange={(e) => { setCollectionFilter(e.target.value); setShown(PRODUCTS_PER_PAGE); }}>
                <option value="all">All collections</option>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>

            {selected.size > 0 && (
              <div className="fs-bulk-bar" role="region" aria-label="Bulk actions">
                <button type="button" className="fs-check is-on" aria-label={allVisibleSelected ? "Deselect all" : "Select all shown"} onClick={selectAllVisible}>
                  <FsIcon name={allVisibleSelected ? "check" : "plus"} size={12} strokeWidth={3.2} />
                </button>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{selected.size} selected</span>
                <div style={{ flex: 1 }} />
                <button type="button" className="fs-btn fs-btn--sm fs-btn--primary" disabled={isSubmitting} onClick={() => bulkToggle(true)}>Enable try-on</button>
                <button type="button" className="fs-btn fs-btn--sm" style={{ background: "#1F2937", color: "#FFFFFF", borderColor: "#374151" }} disabled={isSubmitting} onClick={() => bulkToggle(false)}>Disable try-on</button>
                <button type="button" className="fs-btn fs-btn--sm" style={{ background: "transparent", color: "#D1D5DB" }} onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            )}

            {filteredProducts.length === 0 ? (
              <FsCard>
                <FsEmpty icon="search" text="No products match these filters." cta="Clear filters" onClick={() => { setQuery(""); setStatus("all"); setCollectionFilter("all"); }} />
              </FsCard>
            ) : (
              <FsCard style={{ padding: 0, gap: 0 }}>
                <div className="fs-table-wrap">
                  <table className="fs-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <button type="button" className={`fs-check${allVisibleSelected ? " is-on" : ""}`} aria-label={allVisibleSelected ? "Deselect all" : "Select all shown"} onClick={selectAllVisible}>
                            {allVisibleSelected && <FsIcon name="check" size={12} strokeWidth={3.2} />}
                          </button>
                        </th>
                        <th>Product</th>
                        <th>Status</th>
                        <th>Price</th>
                        <th className="num">Try-on</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleProducts.map((product) => (
                        <ProductRow
                          key={product.id}
                          product={product}
                          shop={shop}
                          selected={selected.has(product.id)}
                          onSelect={() => toggleSelect(product.id)}
                          onToggle={() => toggleProduct(product)}
                          isSubmitting={isSubmitting}
                          pendingEnabled={pending?.id === product.id ? pending.enabled : undefined}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </FsCard>
            )}
            {filteredProducts.length > shown && (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <FsButton variant="ghost" onClick={() => setShown((s) => s + PRODUCTS_PER_PAGE)}>Show {Math.min(PRODUCTS_PER_PAGE, filteredProducts.length - shown)} more</FsButton>
              </div>
            )}
          </div>
        </>
      )}
    </FsPage>
  );
}
