/**
 * app.size-chart.jsx — Size Chart module admin page.
 * Merchant builds one or more static size charts (unit + column/row table)
 * and assigns one chart per product. No measurement-based recommender —
 * that's a deliberately separate, bigger feature.
 */
import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchant } from "../lib/merchant.server";
import phpApiClient from "../lib/php-api.server";
import { PHP_API_URL } from "../lib/env.server";
import { FsPage, FsCard, FsButton, FsIcon } from "../components/fs-ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const [chartsRes, productsRes] = await Promise.all([api.getSizeCharts(), api.getProducts()]);

  return {
    enabled: chartsRes.ok ? Boolean(chartsRes.data?.enabled) : false,
    charts: chartsRes.ok ? (chartsRes.data?.charts ?? []) : [],
    assignments: chartsRes.ok ? (chartsRes.data?.assignments ?? {}) : {},
    products: productsRes.ok && Array.isArray(productsRes.data) ? productsRes.data : [],
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const body = await request.json();

  switch (body._action) {
    case "toggle_enabled": {
      const res = await api.setSizeChartEnabled(Boolean(body.enabled));
      return { ok: res.ok, error: res.error };
    }
    case "create_chart": {
      const res = await api.createSizeChart({ name: body.name, unit: body.unit, columns: body.columns, rows: body.rows });
      return { ok: res.ok, error: res.error, id: res.data?.id };
    }
    case "update_chart": {
      const res = await api.updateSizeChart({ id: body.id, name: body.name, unit: body.unit, columns: body.columns, rows: body.rows });
      return { ok: res.ok, error: res.error };
    }
    case "delete_chart": {
      const res = await api.deleteSizeChart(body.id);
      return { ok: res.ok, error: res.error };
    }
    case "assign_chart": {
      const res = body.chartId
        ? await api.assignSizeChart(body.shopifyProductId, body.chartId)
        : await api.unassignSizeChart(body.shopifyProductId);
      return { ok: res.ok, error: res.error };
    }
    default:
      return { ok: false, error: "Unknown action" };
  }
};

// ── Chart editor (create or edit) ───────────────────────────────────────────────

const EMPTY_RULE = { ageMin: "", ageMax: "", heightMin: "", heightMax: "", weightMin: "", weightMax: "" };

function emptyDraft() {
  return {
    name: "", unit: "in",
    columns: ["Size", "Bust", "Waist", "Hips"],
    rows: [["S", "", "", ""], ["M", "", "", ""], ["L", "", "", ""]],
    rules: [{ ...EMPTY_RULE }, { ...EMPTY_RULE }, { ...EMPTY_RULE }],
  };
}

/** Pads/fills rules to match rows.length, so charts saved before this feature (or missing a rule) don't break the editor. */
function normalizeDraft(chart) {
  const rows = chart.rows ?? [];
  const rules = rows.map((_, i) => ({ ...EMPTY_RULE, ...(chart.rules?.[i] ?? {}) }));
  return { ...chart, rules };
}

function ChartEditor({ initial, onCancel, onSaved }) {
  const fetcher = useFetcher();
  const [draft, setDraft] = useState(normalizeDraft(initial ?? emptyDraft()));
  const [showRules, setShowRules] = useState(Boolean(initial?.rules?.some((r) => r && Object.values(r).some((v) => v !== null && v !== ""))));
  const isEdit = Boolean(initial?.id);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onSaved();
  }, [fetcher.state, fetcher.data, onSaved]);

  const setCell = (r, c, val) => {
    const rows = draft.rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? val : cell)) : row));
    setDraft({ ...draft, rows });
  };
  const setColumnName = (c, val) => {
    const columns = draft.columns.map((col, ci) => (ci === c ? val : col));
    setDraft({ ...draft, columns });
  };
  const setRuleField = (r, field, val) => {
    const rules = draft.rules.map((rule, ri) => (ri === r ? { ...rule, [field]: val } : rule));
    setDraft({ ...draft, rules });
  };
  const addRow = () => setDraft({ ...draft, rows: [...draft.rows, draft.columns.map(() => "")], rules: [...draft.rules, { ...EMPTY_RULE }] });
  const removeRow = (r) => setDraft({ ...draft, rows: draft.rows.filter((_, ri) => ri !== r), rules: draft.rules.filter((_, ri) => ri !== r) });
  const addColumn = () => setDraft({ ...draft, columns: [...draft.columns, "Column"], rows: draft.rows.map((row) => [...row, ""]) });
  const removeColumn = (c) => setDraft({
    ...draft,
    columns: draft.columns.filter((_, ci) => ci !== c),
    rows: draft.rows.map((row) => row.filter((_, ci) => ci !== c)),
  });

  const canSave = draft.name.trim() !== "" && draft.columns.length > 0 && draft.rows.length > 0;

  const save = () => {
    // Rule fields are text inputs ("" when blank) — convert to numbers or
    // null before sending, and drop rules entirely if the quiz section was
    // never opened (an all-blank rules array is functionally the same as
    // none, but sending null-everywhere is cleaner for the backend to read).
    const toNum = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
    const rules = showRules
      ? draft.rules.map((r) => ({
          ageMin: toNum(r.ageMin), ageMax: toNum(r.ageMax),
          heightMin: toNum(r.heightMin), heightMax: toNum(r.heightMax),
          weightMin: toNum(r.weightMin), weightMax: toNum(r.weightMax),
        }))
      : [];

    fetcher.submit(
      { _action: isEdit ? "update_chart" : "create_chart", id: initial?.id, ...draft, rules },
      { method: "POST", encType: "application/json" },
    );
  };

  return (
    <FsCard title={isEdit ? "Edit chart" : "New size chart"}>
      <div className="fs-two-col">
        <div>
          <span className="fs-label">Chart name</span>
          <input className="fs-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Women's Tops" />
        </div>
        <div>
          <span className="fs-label">Unit</span>
          <div className="fs-seg">
            {["in", "cm"].map((u) => (
              <button key={u} type="button" className={draft.unit === u ? "is-on" : ""} onClick={() => setDraft({ ...draft, unit: u })}>{u}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="fs-table-wrap" style={{ marginTop: 16 }}>
        <table className="fs-table">
          <thead>
            <tr>
              {draft.columns.map((col, c) => (
                <th key={c}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      className="fs-input"
                      style={{ height: 30, fontSize: 12, fontWeight: 600 }}
                      value={col}
                      onChange={(e) => setColumnName(c, e.target.value)}
                    />
                    {draft.columns.length > 1 && (
                      <button type="button" className="fs-icon-btn" onClick={() => removeColumn(c)} aria-label={`Remove column ${col}`}>
                        <FsIcon name="x" size={14} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>
                    <input className="fs-input" style={{ height: 32 }} value={cell} onChange={(e) => setCell(r, c, e.target.value)} />
                  </td>
                ))}
                <td>
                  <button type="button" className="fs-icon-btn" onClick={() => removeRow(r)} aria-label={`Remove row ${r + 1}`}>
                    <FsIcon name="trash" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <FsButton variant="ghost" size="sm" onClick={addRow}>+ Row</FsButton>
        <FsButton variant="ghost" size="sm" onClick={addColumn}>+ Column</FsButton>
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--fs-border)" }}>
        <div className="fs-toggle-row" style={{ border: "none", padding: 0 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Size Assistant quiz</span>
            <p className="fs-help" style={{ marginTop: 2 }}>Let shoppers answer age/height/weight and get a recommended row from this chart. Leave a field blank for "no constraint" on that side.</p>
          </div>
          <button type="button" role="switch" aria-checked={showRules} aria-label="Enable Size Assistant quiz for this chart" className="fs-switch" onClick={() => setShowRules((v) => !v)}>
            <span />
          </button>
        </div>

        {showRules && (
          <div className="fs-table-wrap" style={{ marginTop: 14 }}>
            <table className="fs-table">
              <thead>
                <tr>
                  <th>Size</th>
                  <th>Age min</th><th>Age max</th>
                  <th>Height min (cm)</th><th>Height max (cm)</th>
                  <th>Weight min (kg)</th><th>Weight max (kg)</th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row, r) => (
                  <tr key={r}>
                    <td style={{ fontWeight: 600 }}>{row[0] || `Row ${r + 1}`}</td>
                    {["ageMin", "ageMax", "heightMin", "heightMax", "weightMin", "weightMax"].map((field) => (
                      <td key={field}>
                        <input
                          type="number"
                          className="fs-input"
                          style={{ height: 32, width: 84 }}
                          value={draft.rules[r]?.[field] ?? ""}
                          onChange={(e) => setRuleField(r, field, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {fetcher.data?.error && <p className="fs-help" style={{ color: "var(--fs-warning-ink)", marginTop: 10 }}>{fetcher.data.error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--fs-border)" }}>
        <FsButton variant="ghost" onClick={onCancel}>Cancel</FsButton>
        <FsButton onClick={save} disabled={!canSave || fetcher.state !== "idle"} style={{ marginLeft: "auto" }}>
          {fetcher.state !== "idle" ? "Saving…" : isEdit ? "Save changes" : "Create chart"}
        </FsButton>
      </div>
    </FsCard>
  );
}
ChartEditor.propTypes = { initial: PropTypes.object, onCancel: PropTypes.func.isRequired, onSaved: PropTypes.func.isRequired };

// ── Page ─────────────────────────────────────────────────────────────────────────

export default function SizeChartPage() {
  const { enabled: initialEnabled, charts, assignments, products } = useLoaderData();
  const toggleFetcher = useFetcher();
  const assignFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [editing, setEditing] = useState(null); // null | "new" | chart object

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    toggleFetcher.submit({ _action: "toggle_enabled", enabled: next }, { method: "POST", encType: "application/json" });
  };

  const assign = (shopifyProductId, chartId) => {
    assignFetcher.submit({ _action: "assign_chart", shopifyProductId, chartId }, { method: "POST", encType: "application/json" });
  };

  const remove = (id) => {
    if (!window.confirm("Delete this chart? Products using it will show no size chart until reassigned.")) return;
    deleteFetcher.submit({ _action: "delete_chart", id }, { method: "POST", encType: "application/json" });
  };

  return (
    <FsPage>
      <div className="fs-page-head">
        <div style={{ flex: 1 }}>
          <h1 className="fs-h1">Size Chart</h1>
          <p className="fs-sub">A static size chart shoppers can open from the product page. Build one or more charts, then assign a chart to each product.</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-label="Enable Size Chart" className="fs-switch" onClick={toggle}>
          <span />
        </button>
      </div>

      {editing && (
        <ChartEditor
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); window.location.reload(); }}
        />
      )}

      {!editing && (
        <FsCard title="Your charts" action={<FsButton size="sm" onClick={() => setEditing("new")}>+ New chart</FsButton>}>
          {charts.length === 0 ? (
            <p className="fs-help">No charts yet — create one to get started.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {charts.map((c) => (
                <div key={c.id} className="fs-toggle-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                    <p className="fs-help" style={{ marginTop: 2 }}>{c.columns.length} columns · {c.rows.length} sizes · {c.unit} · {c.assigned_count} product{c.assigned_count === 1 ? "" : "s"} assigned</p>
                  </div>
                  <FsButton variant="ghost" size="sm" onClick={() => setEditing(c)}>Edit</FsButton>
                  <FsButton variant="ghost" size="sm" onClick={() => remove(c.id)}>Delete</FsButton>
                </div>
              ))}
            </div>
          )}
        </FsCard>
      )}

      {!editing && (
        <FsCard title="Assign to products" subtitle="Pick which size chart shows on each product's page.">
          <div className="fs-table-wrap">
            <table className="fs-table">
              <thead><tr><th>Product</th><th>Size chart</th></tr></thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.shopify_product_id}>
                    <td>{p.title ?? p.collection_title ?? `Product #${p.shopify_product_id}`}</td>
                    <td>
                      <select
                        className="fs-select"
                        style={{ height: 34, maxWidth: 220 }}
                        value={assignments[p.shopify_product_id] ?? ""}
                        onChange={(e) => assign(p.shopify_product_id, e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">None</option>
                        {charts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FsCard>
      )}
    </FsPage>
  );
}
