import { useState, useRef, useEffect } from "react";
import { useLoaderData, useSubmit, useNavigate, useNavigation } from "react-router";
import { Page, Text, Button, Icon } from "@shopify/polaris";
import {
  SearchIcon,
  ProductIcon,
  CheckCircleIcon,
  MagicIcon,
  ChevronRightIcon,
  MenuHorizontalIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";

const COLLECTIONS_QUERY = `#graphql
  query GetCollectionsWithProducts($first: Int!) {
    collections(first: $first, query: "published_status:published") {
      edges {
        node {
          id
          title
          handle
          image { url altText }
          products(first: 50) {
            edges {
              node {
                id
                title
                handle
                status
                vendor
                productType
                tags
                featuredImage { url altText }
                priceRange {
                  minVariantPrice { amount currencyCode }
                  maxVariantPrice { amount currencyCode }
                }
              }
            }
          }
          metafield(namespace: "tryfit", key: "tryon_enabled") { value }
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
    admin.graphql(COLLECTIONS_QUERY, { variables: { first: 50 } }),
    phpApiClient(apiKey, process.env.PHP_API_URL ?? "").getProducts(),
  ]);

  const collectionsData = await collectionsRes.json();
  const phpList = phpRes.ok ? phpRes.data ?? [] : [];

  const phpMap = {};
  for (const p of phpList) {
    phpMap[String(p.shopify_product_id)] = p;
  }

  const rawCollections = (collectionsData.data?.collections?.edges ?? []).map(e => e.node);

  const collections = rawCollections
    .map(col => {
      const activeProducts = (col.products?.edges ?? [])
        .map(e => e.node)
        .filter(p => p.status === "ACTIVE")
        .map(p => {
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
          return {
            id: p.id,
            title: p.title,
            handle: p.handle,
            vendor: p.vendor ?? "",
            productType: p.productType ?? "",
            tags: p.tags ?? [],
            featuredImage: p.featuredImage,
            numericId,
            isTryonEnabled: phpRow ? Boolean(phpRow.is_tryon_enabled) : false,
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
    .filter(col => col.productCount > 0);

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
  const api = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");

  if (intent === "toggle_product") {
    const shopifyProductId = formData.get("shopify_product_id");
    const shopifyProductGid = formData.get("shopify_product_gid");
    const title = formData.get("title");
    const handle = formData.get("handle");
    const enabled = formData.get("enabled") === "true";

    await api.syncProduct({
      shopify_product_id: shopifyProductId,
      shopify_product_gid: shopifyProductGid,
      title,
      handle,
      is_tryon_enabled: enabled ? 1 : 0,
    });

    await admin.graphql(
      `#graphql
        mutation SetTryonMetafield($input: ProductInput!) {
          productUpdate(input: $input) { product { id } }
        }
      `,
      {
        variables: {
          input: {
            id: shopifyProductGid,
            metafields: [{
              namespace: "tryfit",
              key: "tryon_enabled",
              value: enabled ? "true" : "false",
              type: "single_line_text_field",
            }],
          },
        },
      }
    );

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
            metafields: [{
              namespace: "tryfit",
              key: "tryon_enabled",
              value: enabled ? "true" : "false",
              type: "single_line_text_field",
            }],
          },
        },
      }
    );

    // Bulk-update every product in the collection (PHP + Shopify metafield in parallel)
    await Promise.allSettled(
      products.map(p =>
        Promise.allSettled([
          api.syncProduct({
            shopify_product_id: p.numericId,
            shopify_product_gid: p.id,
            title: p.title,
            handle: p.handle,
            is_tryon_enabled: enabled ? 1 : 0,
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
                  metafields: [{
                    namespace: "tryfit",
                    key: "tryon_enabled",
                    value: enabled ? "true" : "false",
                    type: "single_line_text_field",
                  }],
                },
              },
            }
          ),
        ])
      )
    );

    return { ok: true };
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
      { variables: { id: collectionGid } }
    );

    return { ok: true };
  }

  return { ok: false };
}

// ─── Helper Components ────────────────────────────────────────────────────────

const CustomToggle = ({ checked, onChange, disabled }) => (
  <div
    onClick={() => !disabled && onChange()}
    style={{
      width: "44px",
      height: "24px",
      borderRadius: "12px",
      background: checked ? "var(--vto-primary)" : "#E2E8F0",
      position: "relative",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "background 0.3s ease",
      opacity: disabled ? 0.6 : 1,
      flexShrink: 0,
    }}
  >
    <div style={{
      width: "18px",
      height: "18px",
      borderRadius: "50%",
      background: "white",
      position: "absolute",
      top: "3px",
      left: checked ? "23px" : "3px",
      transition: "left 0.3s ease",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    }} />
  </div>
);

const menuItemStyle = {
  display: "block",
  width: "100%",
  padding: "10px 16px",
  background: "none",
  border: "none",
  textAlign: "left",
  cursor: "pointer",
  fontSize: "13px",
  color: "#1E293B",
  transition: "background 0.15s",
};

function CollectionDropdown({ collection, shop, submit, onClose }) {
  const ref = useRef(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [onClose]);

  function handleView() {
    window.open(`https://${shop}/collections/${collection.handle}`, "_blank");
    onClose();
  }

  function handleEdit() {
    window.open(`https://${shop}/admin/collections/${collection.numericId}`, "_blank");
    onClose();
  }

  function handleDeleteConfirm() {
    const fd = new FormData();
    fd.set("intent", "delete_collection");
    fd.set("collection_gid", collection.id);
    submit(fd, { method: "post" });
    onClose();
  }

  const baseDropdownStyle = {
    position: "absolute",
    right: 0,
    top: "calc(100% + 4px)",
    zIndex: 1000,
    background: "white",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
  };

  if (confirmDelete) {
    return (
      <div ref={ref} style={{ ...baseDropdownStyle, border: "1px solid #FCA5A5", padding: "16px", width: "220px" }}>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "#1E293B", marginBottom: "4px" }}>
          Delete &ldquo;{collection.title}&rdquo;?
        </div>
        <div style={{ fontSize: "12px", color: "#64748B", marginBottom: "12px" }}>
          Products will not be deleted.
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => setConfirmDelete(false)}
            style={{ flex: 1, padding: "7px", borderRadius: "6px", border: "1px solid var(--vto-border)", background: "white", cursor: "pointer", fontSize: "13px" }}
          >
            Cancel
          </button>
          <button
            onClick={handleDeleteConfirm}
            style={{ flex: 1, padding: "7px", borderRadius: "6px", border: "none", background: "#EF4444", color: "white", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ ...baseDropdownStyle, border: "1px solid var(--vto-border)", minWidth: "175px", overflow: "hidden" }}>
      <button
        style={menuItemStyle}
        onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
        onClick={handleView}
      >
        View on store
      </button>
      <button
        style={menuItemStyle}
        onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
        onClick={handleEdit}
      >
        Edit in admin
      </button>
      <div style={{ height: "1px", background: "var(--vto-border)", margin: "4px 0" }} />
      <button
        style={{ ...menuItemStyle, color: "#EF4444" }}
        onMouseEnter={e => (e.currentTarget.style.background = "#FFF5F5")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
        onClick={() => setConfirmDelete(true)}
      >
        Delete collection
      </button>
    </div>
  );
}

function CollectionRow({ collection, shop, submit, isSubmitting, navigate, openDropdown, setOpenDropdown }) {
  const [expanded, setExpanded] = useState(false);
  const isDropdownOpen = openDropdown === collection.id;
  const enabledCount = collection.products.filter(p => p.isTryonEnabled).length;

  function handleToggleCollection() {
    const fd = new FormData();
    fd.set("intent", "toggle_collection");
    fd.set("collection_gid", collection.id);
    fd.set("enabled", String(!collection.isTryonEnabled));
    fd.set(
      "products_json",
      JSON.stringify(
        collection.products.map(p => ({
          id: p.id,
          numericId: p.numericId,
          title: p.title,
          handle: p.handle,
        }))
      )
    );
    submit(fd, { method: "post" });
  }

  function handleToggleProduct(product) {
    const fd = new FormData();
    fd.set("intent", "toggle_product");
    fd.set("shopify_product_id", product.numericId);
    fd.set("shopify_product_gid", product.id);
    fd.set("title", product.title);
    fd.set("handle", product.handle);
    fd.set("enabled", String(!product.isTryonEnabled));
    submit(fd, { method: "post" });
  }

  return (
    <>
      <tr style={{ background: "white" }}>
        {/* Collection cell */}
        <td>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? "Collapse" : "Expand"}
              style={{
                width: "28px",
                height: "28px",
                background: expanded ? "var(--vto-primary-light)" : "#F8FAFC",
                border: `1px solid ${expanded ? "var(--vto-primary)" : "var(--vto-border)"}`,
                borderRadius: "6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: expanded ? "var(--vto-primary)" : "#64748B",
                transition: "all 0.2s",
              }}
            >
              <span style={{ display: "inline-block", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s", lineHeight: 1 }}>
                <Icon source={ChevronRightIcon} />
              </span>
            </button>

            {collection.image ? (
              <img
                src={collection.image.url}
                alt={collection.image.altText ?? collection.title}
                style={{ width: "44px", height: "44px", borderRadius: "8px", objectFit: "cover", flexShrink: 0, border: "1px solid var(--vto-border)" }}
              />
            ) : (
              <div style={{ width: "44px", height: "44px", borderRadius: "8px", background: "var(--vto-primary-light)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--vto-primary)", flexShrink: 0 }}>
                <Icon source={ProductIcon} />
              </div>
            )}

            <div>
              <div style={{ fontWeight: "600", color: "#1E293B", fontSize: "14px" }}>{collection.title}</div>
              <div style={{ fontSize: "12px", color: "#94A3B8", marginTop: "2px" }}>/{collection.handle}</div>
            </div>
          </div>
        </td>

        {/* Product count */}
        <td>
          <span style={{ fontWeight: "600", fontSize: "15px", color: "#1E293B" }}>{collection.productCount}</span>
          <span style={{ fontSize: "12px", color: "#64748B", marginLeft: "4px" }}>products</span>
        </td>

        {/* Try-on enabled count */}
        <td>
          <span style={{ fontWeight: "600", fontSize: "15px", color: enabledCount > 0 ? "#10B981" : "#64748B" }}>{enabledCount}</span>
          <span style={{ fontSize: "12px", color: "#64748B", marginLeft: "4px" }}>enabled</span>
        </td>

        {/* Try-on toggle */}
        <td>
          <CustomToggle
            checked={collection.isTryonEnabled}
            onChange={handleToggleCollection}
            disabled={isSubmitting}
          />
        </td>

        {/* Three-dot actions */}
        <td>
          <div style={{ position: "relative", display: "inline-block" }}>
            <button
              onClick={() => setOpenDropdown(isDropdownOpen ? null : collection.id)}
              style={{
                width: "32px",
                height: "32px",
                background: isDropdownOpen ? "#F1F5F9" : "none",
                border: "1px solid var(--vto-border)",
                borderRadius: "6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#64748B",
              }}
            >
              <Icon source={MenuHorizontalIcon} />
            </button>
            {isDropdownOpen && (
              <CollectionDropdown
                collection={collection}
                shop={shop}
                submit={submit}
                onClose={() => setOpenDropdown(null)}
              />
            )}
          </div>
        </td>
      </tr>

      {/* Nested products row */}
      {expanded && (
        <tr>
          <td colSpan={5} style={{ padding: 0 }}>
            <div style={{ borderTop: "2px solid var(--vto-primary-light)", background: "#F8FAFC" }}>
              {/* Header */}
              <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--vto-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--vto-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Products in {collection.title}
                  </span>
                  <span style={{ background: "var(--vto-primary-light)", color: "var(--vto-primary)", fontSize: "11px", fontWeight: "700", padding: "1px 8px", borderRadius: "10px" }}>
                    {collection.productCount}
                  </span>
                </div>
                {isSubmitting && (
                  <span style={{ fontSize: "11px", color: "#F97316", fontWeight: "600", display: "flex", alignItems: "center", gap: "5px" }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#F97316", display: "inline-block", animation: "pulse 1s infinite" }} />
                    Updating…
                  </span>
                )}
                {!isSubmitting && (
                  <span style={{ fontSize: "11px", color: "#64748B" }}>
                    Toggle collection above to enable/disable all at once
                  </span>
                )}
              </div>

              {/* Products table */}
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#F1F5F9" }}>
                    <th style={{ padding: "8px 20px", textAlign: "left", fontSize: "11px", color: "#64748B", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.04em" }}>Product</th>
                    <th style={{ padding: "8px 16px", textAlign: "left", fontSize: "11px", color: "#64748B", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.04em" }}>Vendor / Type</th>
                    <th style={{ padding: "8px 16px", textAlign: "left", fontSize: "11px", color: "#64748B", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.04em" }}>Preview</th>
                    <th style={{ padding: "8px 16px", textAlign: "left", fontSize: "11px", color: "#64748B", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.04em" }}>Try-On</th>
                    <th style={{ padding: "8px 16px", textAlign: "left", fontSize: "11px", color: "#64748B", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.04em" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {collection.products.map((product, i) => (
                    <tr key={product.id} style={{ borderTop: "1px solid var(--vto-border)", background: i % 2 === 0 ? "white" : "#FAFBFC" }}>
                      {/* Product */}
                      <td style={{ padding: "12px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {product.featuredImage ? (
                            <img
                              src={product.featuredImage.url}
                              alt={product.featuredImage.altText ?? product.title}
                              style={{ width: "44px", height: "44px", borderRadius: "6px", objectFit: "cover", flexShrink: 0, border: "1px solid var(--vto-border)" }}
                            />
                          ) : (
                            <div style={{ width: "44px", height: "44px", borderRadius: "6px", background: "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8", flexShrink: 0 }}>
                              <Icon source={ProductIcon} />
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: "600", fontSize: "13px", color: "#1E293B" }}>{product.title}</div>
                            <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>/{product.handle}</div>
                            {product.tags.length > 0 && (
                              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                                {product.tags.slice(0, 3).map(tag => (
                                  <span key={tag} style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "#F1F5F9", color: "#64748B", fontWeight: "500" }}>
                                    {tag}
                                  </span>
                                ))}
                                {product.tags.length > 3 && (
                                  <span style={{ fontSize: "10px", color: "#94A3B8" }}>+{product.tags.length - 3}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Vendor / Type */}
                      <td style={{ padding: "12px 16px" }}>
                        {product.vendor ? (
                          <div style={{ fontSize: "13px", fontWeight: "500", color: "#1E293B" }}>{product.vendor}</div>
                        ) : null}
                        {product.productType ? (
                          <div style={{ fontSize: "11px", color: "#64748B", marginTop: product.vendor ? "2px" : 0 }}>{product.productType}</div>
                        ) : null}
                        {!product.vendor && !product.productType && (
                          <span style={{ fontSize: "13px", color: "#CBD5E1" }}>—</span>
                        )}
                      </td>
                      {/* Preview */}
                      <td style={{ padding: "12px 16px" }}>
                        <button
                          onClick={() => window.open(`https://${shop}/products/${product.handle}`, "_blank")}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "6px 14px",
                            borderRadius: "6px",
                            border: "1px solid var(--vto-border)",
                            background: "white",
                            color: "#3B5BDB",
                            fontSize: "13px",
                            fontWeight: "600",
                            cursor: "pointer",
                            transition: "all 0.15s",
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "var(--vto-primary-light)"; e.currentTarget.style.borderColor = "var(--vto-primary)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.borderColor = "var(--vto-border)"; }}
                        >
                          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" fill="currentColor"/>
                            <path d="M10 3C5.5 3 1.73 5.61 0 9.5 1.73 13.39 5.5 16 10 16s8.27-2.61 10-6.5C18.27 5.61 14.5 3 10 3zm0 10.5a4 4 0 110-8 4 4 0 010 8z" fill="currentColor"/>
                          </svg>
                          Preview
                        </button>
                      </td>
                      {/* Try-On */}
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <CustomToggle
                            checked={product.isTryonEnabled}
                            onChange={() => handleToggleProduct(product)}
                            disabled={isSubmitting}
                          />
                          <span style={{ fontSize: "12px", color: product.isTryonEnabled ? "#10B981" : "#94A3B8", fontWeight: "600" }}>
                            {product.isTryonEnabled ? "On" : "Off"}
                          </span>
                        </div>
                      </td>
                      {/* Action */}
                      <td style={{ padding: "12px 16px" }}>
                        <Button
                          size="slim"
                          variant="primary"
                          onClick={() => navigate(`/app/variants?product_id=${product.numericId}&product_gid=${encodeURIComponent(product.id)}&title=${encodeURIComponent(product.title)}`)}
                        >
                          Map Variants
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function EnabledProductCard({ product, shop, submit, isSubmitting, navigate }) {
  const [showConfirm, setShowConfirm] = useState(false);

  function handleToggle(enabled) {
    const fd = new FormData();
    fd.set("intent", "toggle_product");
    fd.set("shopify_product_id", product.numericId);
    fd.set("shopify_product_gid", product.id);
    fd.set("title", product.title);
    fd.set("handle", product.handle);
    fd.set("enabled", String(enabled));
    submit(fd, { method: "post" });
    setShowConfirm(false);
  }

  return (
    <div className="vto-card" style={{ padding: "0", overflow: "hidden", display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <div style={{ position: "relative", aspectRatio: "1/1", background: "#F1F5F9" }}>
        {product.featuredImage ? (
          <img src={product.featuredImage.url} alt={product.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#CBD5E1" }}>
            <Icon source={ProductIcon} size="large" />
          </div>
        )}
        <div style={{ position: "absolute", top: "12px", right: "12px", display: "flex", gap: "6px" }}>
          <div style={{ 
            background: "#10B981", 
            color: "white", 
            fontSize: "10px", 
            fontWeight: "700", 
            padding: "4px 10px", 
            borderRadius: "20px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
          }}>
            TRY-ON ACTIVE
          </div>
        </div>
      </div>

      <div style={{ padding: "16px", flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ fontWeight: "600", fontSize: "14px", color: "#1E293B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {product.title}
        </div>
        <div style={{ fontSize: "12px", color: "#64748B" }}>
          {product.vendor || "No Vendor"} • {product.productType || "Standard"}
        </div>
        <div style={{ marginTop: "8px", fontWeight: "700", color: "var(--vto-primary)", fontSize: "15px" }}>
          {product.price} {product.currency}
        </div>

        <div style={{ marginTop: "auto", paddingTop: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
          <Button
            size="slim"
            onClick={() => window.open(`https://${shop}/products/${product.handle}`, "_blank")}
          >
            Preview
          </Button>
          <Button
            size="slim"
            variant="primary"
            onClick={() => navigate(`/app/variants?product_id=${product.numericId}&product_gid=${encodeURIComponent(product.id)}&title=${encodeURIComponent(product.title)}`)}
          >
            Edit
          </Button>
          
          <button
            onClick={() => setShowConfirm(true)}
            style={{
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "6px",
              border: "1px solid #FCA5A5",
              background: "#FEF2F2",
              color: "#EF4444",
              cursor: "pointer",
              transition: "all 0.2s",
              marginLeft: "auto"
            }}
            title="Delete Try-On"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2m-6 9l4 4m0-4l-4 4"/></svg>
          </button>
        </div>
      </div>

      {showConfirm && (
        <div style={{
          position: "absolute",
          inset: 0,
          background: "rgba(255, 255, 255, 0.96)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          textAlign: "center",
          zIndex: 100,
          backdropFilter: "blur(2px)"
        }}>
          <div style={{ color: "#EF4444", marginBottom: "12px" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          </div>
          <Text variant="bodyMd" fontWeight="bold">Delete Try-On?</Text>
          <p style={{ fontSize: "13px", color: "#64748B", marginTop: "4px" }}>
            This will disable the try-on button for this product.
          </p>
          <div style={{ marginTop: "20px", display: "flex", gap: "10px", width: "100%" }}>
            <button
              onClick={() => setShowConfirm(false)}
              style={{ flex: 1, padding: "8px", borderRadius: "6px", border: "1px solid var(--vto-border)", background: "white", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}
            >
              Cancel
            </button>
            <button
              onClick={() => handleToggle(false)}
              style={{ flex: 1, padding: "8px", borderRadius: "6px", border: "none", background: "#EF4444", color: "white", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10;

export default function Products() {
  const { collections, shop, stats } = useLoaderData();
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [searchQuery, setSearchQuery] = useState("");
  const [enabledSearchQuery, setEnabledSearchQuery] = useState("");
  const [openDropdown, setOpenDropdown] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  const filtered = collections.filter(c =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const start = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginated = filtered.slice(start, start + ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const allEnabledProducts = Array.from(
    new Map(
      collections.flatMap(c => c.products).filter(p => p.isTryonEnabled).map(p => [p.id, p])
    ).values()
  );

  const filteredEnabledProducts = allEnabledProducts.filter(p =>
    p.title.toLowerCase().includes(enabledSearchQuery.toLowerCase())
  );

  return (
    <Page fullWidth>
      {/* Header */}
      <div className="vto-header" style={{ marginBottom: "24px" }}>
        <div>
          <h1 className="vto-title">Product Catalog</h1>
          <p className="vto-subtitle">Manage AI try-on availability across your live collections.</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="vto-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "32px" }}>
        <div className="vto-card" style={{ display: "flex", alignItems: "center", padding: "20px" }}>
          <div className="vto-stat-icon-wrapper vto-stat-icon-blue">
            <Icon source={ProductIcon} />
          </div>
          <div>
            <div className="vto-kpi-label">Live Collections</div>
            <div className="vto-kpi-value" style={{ fontSize: "24px", color: "#1E293B" }}>{stats.totalCollections}</div>
          </div>
        </div>

        <div className="vto-card" style={{ display: "flex", alignItems: "center", padding: "20px" }}>
          <div className="vto-stat-icon-wrapper vto-stat-icon-green">
            <Icon source={CheckCircleIcon} />
          </div>
          <div>
            <div className="vto-kpi-label">Try-On Enabled</div>
            <div className="vto-kpi-value" style={{ fontSize: "24px", color: "#1E293B" }}>{stats.tryonEnabledCount}</div>
          </div>
        </div>

        <div className="vto-card" style={{ display: "flex", alignItems: "center", padding: "20px" }}>
          <div className="vto-stat-icon-wrapper vto-stat-icon-purple">
            <Icon source={MagicIcon} />
          </div>
          <div>
            <div className="vto-kpi-label">Active Products</div>
            <div className="vto-kpi-value" style={{ fontSize: "24px", color: "#1E293B" }}>{stats.totalProducts}</div>
          </div>
        </div>
      </div>

      {/* Collections Table */}
      <div className="vto-card" style={{ padding: "0" }}>
        <div style={{ padding: "20px", borderBottom: "1px solid var(--vto-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#1E293B", margin: 0 }}>Live Collections</h2>
            <p style={{ fontSize: "13px", color: "#64748B", margin: "3px 0 0" }}>
              {filtered.length} published collection{filtered.length !== 1 ? "s" : ""} with active products
            </p>
          </div>
          <div className="vto-search-wrapper" style={{ width: "280px" }}>
            <div className="vto-search-icon"><Icon source={SearchIcon} /></div>
            <input
              type="text"
              className="vto-search-input"
              placeholder="Search collections..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: "60px 24px", textAlign: "center" }}>
            <div style={{ color: "#CBD5E1", marginBottom: "12px" }}><Icon source={ProductIcon} /></div>
            <div style={{ fontWeight: "600", color: "#1E293B", marginBottom: "4px" }}>No collections found</div>
            <div style={{ fontSize: "13px", color: "#64748B" }}>
              {searchQuery
                ? `No collections match "${searchQuery}".`
                : "No published collections with active products were found in your store."}
            </div>
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="vto-table">
                <thead>
                  <tr>
                    <th>Collection</th>
                    <th>Products</th>
                    <th>Try-On Enabled</th>
                    <th>Try-On Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(collection => (
                    <CollectionRow
                      key={collection.id}
                      collection={collection}
                      shop={shop}
                      submit={submit}
                      isSubmitting={isSubmitting}
                      navigate={navigate}
                      openDropdown={openDropdown}
                      setOpenDropdown={setOpenDropdown}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ padding: "16px 20px", borderTop: "1px solid var(--vto-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text variant="bodySm" tone="subdued">
                  Showing {start + 1}–{Math.min(start + ITEMS_PER_PAGE, filtered.length)} of {filtered.length} collections
                </Text>
                <div className="vto-pagination">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                    <button
                      key={page}
                      className={`vto-page-btn${page === currentPage ? " active" : ""}`}
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Enabled Products Cards Section */}
      <div style={{ marginTop: "48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "24px" }}>
          <div>
            <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#1E293B", margin: 0 }}>Try-On Enabled Products</h2>
            <p style={{ fontSize: "14px", color: "#64748B", marginTop: "4px" }}>
              Quickly manage products with virtual try-on active
            </p>
          </div>
          <div className="vto-search-wrapper" style={{ width: "320px" }}>
            <div className="vto-search-icon"><Icon source={SearchIcon} /></div>
            <input
              type="text"
              className="vto-search-input"
              placeholder="Search enabled products..."
              value={enabledSearchQuery}
              onChange={e => setEnabledSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {filteredEnabledProducts.length === 0 ? (
          <div className="vto-card" style={{ padding: "80px 24px", textAlign: "center" }}>
            <div style={{ color: "#CBD5E1", marginBottom: "16px" }}>
              <Icon source={CheckCircleIcon} size="large" />
            </div>
            <Text variant="headingMd">No enabled products found</Text>
            <p style={{ fontSize: "14px", color: "#64748B", marginTop: "8px" }}>
              {enabledSearchQuery 
                ? `No active products match "${enabledSearchQuery}"`
                : "Enable try-on for products in the collections table above to see them here."}
            </p>
          </div>
        ) : (
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", 
            gap: "24px" 
          }}>
            {filteredEnabledProducts.map(product => (
              <EnabledProductCard
                key={product.id}
                product={product}
                shop={shop}
                submit={submit}
                isSubmitting={isSubmitting}
                navigate={navigate}
              />
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
