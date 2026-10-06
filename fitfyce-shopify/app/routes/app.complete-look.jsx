/**
 * app.complete-look.jsx — Complete Your Look module admin page.
 * Merchant manually picks which other products to show as "styling ideas"
 * alongside a given product. No automatic matching.
 */
import { useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchant } from "../lib/merchant.server";
import phpApiClient from "../lib/php-api.server";
import { PHP_API_URL } from "../lib/env.server";
import { FsPage, FsCard, FsButton } from "../components/fs-ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const [pairingsRes, productsRes] = await Promise.all([api.getCompleteLook(), api.getProducts()]);

  return {
    enabled: pairingsRes.ok ? Boolean(pairingsRes.data?.enabled) : false,
    pairings: pairingsRes.ok ? (pairingsRes.data?.pairings ?? {}) : {},
    products: productsRes.ok && Array.isArray(productsRes.data) ? productsRes.data : [],
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const body = await request.json();

  if (body._action === "toggle_enabled") {
    const res = await api.setCompleteLookEnabled(Boolean(body.enabled));
    return { ok: res.ok, error: res.error };
  }
  if (body._action === "set_pairings") {
    const res = await api.setCompleteLookPairings(body.shopifyProductId, body.pairedIds);
    return { ok: res.ok, error: res.error };
  }
  return { ok: false, error: "Unknown action" };
};

function productLabel(p) {
  return p.title ?? p.collection_title ?? `Product #${p.shopify_product_id}`;
}

function PairingEditor({ product, allProducts, initialPairedIds, onCancel, onSaved }) {
  const fetcher = useFetcher();
  const [selected, setSelected] = useState(new Set(initialPairedIds));
  const others = useMemo(() => allProducts.filter((p) => p.shopify_product_id !== product.shopify_product_id), [allProducts, product]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 12) next.add(id);
      return next;
    });
  };

  const save = () => {
    fetcher.submit(
      { _action: "set_pairings", shopifyProductId: product.shopify_product_id, pairedIds: Array.from(selected) },
      { method: "POST", encType: "application/json" },
    );
  };

  if (fetcher.state === "idle" && fetcher.data?.ok) onSaved();

  return (
    <FsCard title={`Styling ideas for "${productLabel(product)}"`} subtitle="Pick up to 12 products to show alongside this one.">
      <div className="fs-pick-grid">
        {others.map((p) => (
          <button
            key={p.shopify_product_id}
            type="button"
            className={`fs-pick${selected.has(p.shopify_product_id) ? " is-on" : ""}`}
            onClick={() => toggle(p.shopify_product_id)}
            aria-pressed={selected.has(p.shopify_product_id)}
            title={productLabel(p)}
          >
            {p.image_url ? <img src={p.image_url} alt={productLabel(p)} /> : <span className="fs-sr">{productLabel(p)}</span>}
            {selected.has(p.shopify_product_id) && <span className="fs-pick-check">{Array.from(selected).indexOf(p.shopify_product_id) + 1}</span>}
          </button>
        ))}
      </div>
      <p className="fs-help" style={{ marginTop: 10 }}>{selected.size} of 12 selected</p>
      {fetcher.data?.error && <p className="fs-help" style={{ color: "var(--fs-warning-ink)" }}>{fetcher.data.error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--fs-border)" }}>
        <FsButton variant="ghost" onClick={onCancel}>Cancel</FsButton>
        <FsButton onClick={save} disabled={fetcher.state !== "idle"} style={{ marginLeft: "auto" }}>
          {fetcher.state !== "idle" ? "Saving…" : "Save"}
        </FsButton>
      </div>
    </FsCard>
  );
}

export default function CompleteLookPage() {
  const { enabled: initialEnabled, pairings, products } = useLoaderData();
  const toggleFetcher = useFetcher();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [editingProduct, setEditingProduct] = useState(null);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    toggleFetcher.submit({ _action: "toggle_enabled", enabled: next }, { method: "POST", encType: "application/json" });
  };

  return (
    <FsPage>
      <div className="fs-page-head">
        <div style={{ flex: 1 }}>
          <h1 className="fs-h1">Complete Your Look</h1>
          <p className="fs-sub">A "styling ideas" rail on the product page, showing other products you pick — no automatic matching.</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-label="Enable Complete Your Look" className="fs-switch" onClick={toggle}>
          <span />
        </button>
      </div>

      {editingProduct ? (
        <PairingEditor
          product={editingProduct}
          allProducts={products}
          initialPairedIds={pairings[editingProduct.shopify_product_id] ?? []}
          onCancel={() => setEditingProduct(null)}
          onSaved={() => { setEditingProduct(null); window.location.reload(); }}
        />
      ) : (
        <FsCard title="Products">
          <div className="fs-table-wrap">
            <table className="fs-table">
              <thead><tr><th>Product</th><th>Styling ideas</th><th /></tr></thead>
              <tbody>
                {products.map((p) => {
                  const count = (pairings[p.shopify_product_id] ?? []).length;
                  return (
                    <tr key={p.shopify_product_id}>
                      <td>{productLabel(p)}</td>
                      <td>{count > 0 ? `${count} product${count === 1 ? "" : "s"}` : <span style={{ color: "var(--fs-muted)" }}>None set</span>}</td>
                      <td><FsButton variant="ghost" size="sm" onClick={() => setEditingProduct(p)}>{count > 0 ? "Edit" : "+ Add"}</FsButton></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </FsCard>
      )}
    </FsPage>
  );
}
