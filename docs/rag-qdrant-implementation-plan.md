# RAG + Qdrant — Implementation Plan (all FitFyce use cases)

**Status:** Proposed · **Date:** 2026-08-03 · **Owner:** FitFyce backend/AI

---

## 0. Relationship to the existing infographic RAG plan

[`docs/rag-infographic-implementation-plan.md`](./rag-infographic-implementation-plan.md) already designs a RAG pipeline for the Marketing Infographic wizard (`VectorStoreInterface`, `RagIngestor`, `RagRetriever`, `RagController`), and deliberately **starts on MySQL** (embeddings as a JSON column, cosine similarity in PHP), deferring a `QdrantVectorStore` to an optional "Phase 5 — only if needed."

That call was correct **for a single use case with small per-merchant data**. It stops being correct once you're serving four use cases that all want the same retrieval primitive:

| | Docs assistant | Product search | Studio prompts | Analytics NL |
|---|---|---|---|---|
| Scope | Global (all merchants) | Per-merchant, thousands of products | Per-merchant | Per-merchant |
| Query pattern | Cosine top-K | Cosine top-K + payload filters (`garment_type`, `is_tryon_enabled`) | Cosine top-K + filters | Cosine top-K + date-range filter |
| Growth | Slow (you write the docs) | Scales with every merchant's catalog | Scales with every generation | Scales daily forever |

Running four MySQL brute-force scanners (one per feature, each reinventing filtering) is more total work than standing up one Qdrant instance behind the `VectorStoreInterface` the other doc already defined. **Decision: implement `QdrantVectorStore` now, as the only vector store.** The other doc's `MySqlVectorStore` phase is superseded — same interface, different backend — so nothing in its ingestion/retrieval/prompt design (§5–§7 of that doc) changes, it just points at Qdrant instead of MySQL from day one. Section 6 below shows the concrete swap.

---

## 1. Why Qdrant fits this stack

Constraints (same as the other doc): backend is **plain PHP, no Composer**, everything is cURL (`FashnClient`, `OpenAIClient`, `TryOnDiffusionClient` are the existing pattern). Qdrant fits directly:

- Pure **REST API** (`POST /collections/{name}/points/search`, etc.) — no SDK, no dependency, matches the house style exactly.
- **Payload filtering** built in — every query can say "vectors near X, but only where `merchant_id = 42 AND is_tryon_enabled = 1`" in one call. This is what four separate MySQL scanners would each have to hand-roll.
- **Multiple collections in one instance** — one Qdrant deployment serves all four use cases (`fitfyce_docs`, `fitfyce_products`, `fitfyce_studio_prompts`, `fitfyce_analytics_summaries`), each with its own vector size/config.
- Free to start: **Qdrant Cloud** free tier (1GB, enough for tens of thousands of 1536-dim vectors) for MVP, or a single Docker container next to the PHP app if self-hosting is preferred later. Either way it's reached over HTTPS + API key, so the choice doesn't change any application code.

**Embeddings:** OpenAI `text-embedding-3-small` (1536 dims), same as the infographic plan — `OPENAI_API_KEY` is already configured in `AppConfig::openAiApiKey()`, and the model is cheap enough ($0.02/1M tokens) that cost is a non-issue across all four use cases combined (see §9).

---

## 2. Shared infrastructure (build once, reuse four times)

### 2.1 Config — `config/AppConfig.php` additions
```php
public static function qdrantUrl(): string
{
    return rtrim((string) (getenv('QDRANT_URL') ?: ''), '/');
}
public static function qdrantApiKey(): string
{
    return (string) (getenv('QDRANT_API_KEY') ?: '');
}
```
New `.env` entries: `QDRANT_URL`, `QDRANT_API_KEY`.

### 2.2 `src/QdrantClient.php` — thin cURL wrapper, same shape as `FashnClient`
```php
final class QdrantClient
{
    public function ensureCollection(string $name, int $vectorSize, string $distance = 'Cosine'): void;
    public function upsertPoints(string $collection, array $points): void;   // [{id, vector, payload}]
    public function search(string $collection, array $vector, int $topK, ?array $filter = null): array;
    public function deletePoints(string $collection, array $ids): void;
    public function deleteByFilter(string $collection, array $filter): void; // e.g. re-index a single product
}
```
All calls: `Authorization: <key>` header (or `api-key`), JSON body, cURL with a short timeout (Qdrant search is single-digit ms — a 5s timeout is generous).

### 2.3 `src/OpenAIClient.php` — add embeddings (identical to the infographic plan §5.2)
```php
public function embedTexts(array $texts): array // POST /v1/embeddings, text-embedding-3-small, batch ≤100
```
Reused verbatim by all four ingestors below — implement it once.

### 2.4 `src/VectorStoreInterface.php` + `db/QdrantVectorStore.php`
Same interface the infographic doc specified, implemented over `QdrantClient` instead of MySQL:
```php
interface VectorStoreInterface {
    upsertDocument(int $merchantId, string $sourceType, string $sourceId,
                   string $title, string $contentHash, array $chunks): void;
    query(int $merchantId, array $queryEmbedding, int $topK = 8,
          ?string $sourceType = null, array $extraFilter = []): array;
    deleteDocument(int $merchantId, string $sourceType, string $sourceId): void;
    hasIndex(int $merchantId): bool;
    getContentHash(int $merchantId, string $sourceType, string $sourceId): ?string;
}
```
`merchant_id` and `source_type` are always written into the Qdrant point's `payload` and always included in the filter on `query()` — **never rely on collection choice alone for tenant isolation**, always filter explicitly (defense in depth, and it's what lets one collection serve all merchants).

### 2.5 Content-hash tracking table (mirrors the other doc's `rag_documents`, generalized)
```sql
CREATE TABLE vector_index_status (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id   BIGINT UNSIGNED NULL,               -- NULL for global sources (help docs)
  collection    VARCHAR(64)  NOT NULL,               -- 'fitfyce_docs' | 'fitfyce_products' | ...
  source_type   VARCHAR(32)  NOT NULL,
  source_id     VARCHAR(64)  NOT NULL,
  content_hash  CHAR(40)     NOT NULL,
  chunk_count   INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source (collection, merchant_id, source_type, source_id),
  KEY idx_merchant (merchant_id)
);
```
Same purpose as before: sha1 the normalized text, skip re-embedding unchanged content, keep re-index runs nearly free.

### 2.6 Qdrant collections to create (one-time, via `ensureCollection`)

| Collection | Vector size | Used by |
|---|---|---|
| `fitfyce_docs` | 1536 | Use case A — support assistant |
| `fitfyce_products` | 1536 | Use case B — product/garment search |
| `fitfyce_studio_prompts` | 1536 | Use case C — Studio prompt assistant (supersedes the infographic doc's MySQL store) |
| `fitfyce_analytics_summaries` | 1536 | Use case D — analytics NL query |

---

## 3. Use case A — Merchant support/docs assistant

**Goal:** a chat widget in the Shopify admin (`app.jsx` nav → new `app.support.jsx`) that answers "how do I turn on the floating button?" or "why is my try-on failing?" by retrieving from real FitFyce help content, not the LLM's guess.

**Source content:** short markdown/FAQ pages you author once — e.g. `fitfyce-php/content/help/*.md` (widget setup, plans/billing, Studio usage, troubleshooting try-on failures). This is the one use case with no existing app data to embed; content has to be written.

**Ingestion (`src/HelpDocsIngestor.php`):**
- Read each `.md` file, split on `##` headings into chunks (~300–500 tokens), title-prefix each chunk with `"<page title> — <section heading>"`.
- Embed + upsert into `fitfyce_docs` with `merchant_id = null` (global — every shop shares the same help content) and payload `{title, section, url_anchor}`.
- No webhook needed — re-run `cron/reindex_help_docs.php` (or a manual `/support/reindex` call) whenever you edit a doc file.

**Retrieval + answer (`controllers/SupportController.php`):**
```
'POST /support/ask'     => ask(shop, question) → { answer, sources: [{title, url_anchor}] }
'POST /support/reindex' => reindex()  (admin/master-key only)
```
Flow: embed the question → `QdrantVectorStore::query(merchantId: null, ..., topK: 5)` on `fitfyce_docs` → `gpt-4o-mini` answers **using only the retrieved chunks**, same "context-only, no invented facts" prompt pattern as the infographic doc's §6.1 → return answer + the source page titles so the UI can link back ("See: Widget Setup → Button Position").
- **Escalation path:** if retrieval confidence is low (e.g. top score < a threshold) or the merchant explicitly asks, show a "Contact support" fallback instead of a low-confidence LLM guess.

**Frontend:** small chat panel component in `app.jsx` (persistent across admin pages, like an Intercom-style launcher) + `php-api.server.js` additions: `supportAsk(question)`.

---

## 4. Use case B — Product / garment semantic search

**Goal:** two consumers of the same index —
1. **Merchant admin** (`app.products.jsx`): natural-language search box — "earthy tone sarees", "cotton kurtas under collection X" — instead of only exact title/collection filtering.
2. **Storefront widget** (`tryon-widget.js`): "You might also like" — after a try-on, surface visually/semantically similar enabled products for cross-sell.

**Data gap to close first:** per `db/ProductRepo.php` and `db/AnalyticsRepo.php`, `products` already has (or migration 011 added) `title`, `image_url`, `price`; `variant_image_mappings` has `garment_type` and `clothing_prompt`. There's no `body_html`/`tags`/`product_type` yet — extend `ProductController::sync` the same way the infographic doc recommends (§5.3 there) to persist those from the Shopify Admin API payload, since richer text = better embeddings. If you don't want that scope now, ship v1 on `title + collection_title + garment_type + clothing_prompt` — still meaningfully better than exact-match search.

**Ingestion (`src/ProductIndexer.php`):**
- Triggered from `ProductController::sync` right after `ProductRepo::syncProduct` (per-product upsert), plus a nightly full resync cron for anything missed.
- Chunk text per product: one chunk (products are short) — `"{title} — {collection_title} — {garment_type} — {clothing_prompt}"`.
- Upsert into `fitfyce_products`, payload `{merchant_id, product_id, shopify_product_id, handle, collection_handle, garment_type, is_tryon_enabled, image_url}`.
- On product delete/disable: `deleteByFilter` (keeps disabled products out of "similar" results without a separate re-embed).

**Retrieval:**
```
'GET  /products/search'  => search(shop, q)              → merchant-admin NL search
'GET  /products/similar' => similar(shop, product_id)     → storefront cross-sell
```
- `search`: embed `q` → Qdrant query on `fitfyce_products` filtered to `merchant_id = <resolved shop>` → return matching products (join back to `ProductRepo` for full rows).
- `similar`: look up the *product's own* stored vector by id (no re-embedding needed) → query filtered to `merchant_id + is_tryon_enabled = 1 + shopify_product_id != self` → top 4–6.

**Frontend:**
- `app.products.jsx` — replace/augment the current filter bar with a search input calling `productsSearch(q)`.
- `tryon-widget.js` / `tryon-modal.css` — new "You might also like" strip in the try-on result modal, calling a lightweight public endpoint (same auth pattern as `GET /api/widget-settings`) since it's storefront-facing, not admin-authenticated.

---

## 5. Use case C — AI Studio prompt assistant

This is the natural extension of the **existing infographic plan**, now generalized across Studio: instead of only grounding infographic key-points/theme-prompts, also ground the `clothing_prompt` field merchants type when creating a variant mapping (`ProductRepo::saveVariantMapping`) or running Garment Studio / Studio v2 generations.

**What changes vs. the infographic doc:** nothing in its design (§5.3–§5.7, §6) — only its storage backend, per §0/§2.4 above. Concretely:
- `RagIngestor` writes to `fitfyce_studio_prompts` via `QdrantVectorStore` instead of `MySqlVectorStore`.
- **New source type** `'studio_prompt'`: every saved `variant_image_mappings.clothing_prompt` and every completed `garment_studio_sessions` / Studio v2 generation gets embedded too (not just product/brand text), payload `{merchant_id, garment_type, source: 'variant_mapping'|'studio_session', was_approved}`. This lets `RagRetriever` pull "prompts that worked well for this garment_type before" as extra context — e.g. suggesting `clothing_prompt` phrasing when a merchant is filling in a new saree variant, based on phrasing that led to `is_approved = 1` mappings previously.
- New lightweight endpoint reusing the same retriever:
```
'POST /studio/suggest-prompt' => suggestPrompt(shop, garment_type, draft_text?) → { suggestions: [string, string, string] }
```
Wired into `WorkflowFlatLayToModel` / `WorkflowGhostMannequinToModel` (`app.studio.create.jsx`) next to the existing prompt textarea, same "pickable suggestion, still editable" UX as the infographic theme cards.

Everything else — grounded key-point extraction, theme-prompt generation, fact-review UI, fallback-must-be-byte-identical rule — is exactly as specified in `rag-infographic-implementation-plan.md` §5–§7; this section only adds the `studio_prompt` source type and one endpoint.

---

## 6. Use case D — Analytics natural-language query

**Goal:** merchant types "how did try-on conversion do last week compared to the week before?" on the Analytics page and gets a grounded answer, without ever letting an LLM write or run SQL against merchant data (a real injection/data-leak risk with NL-to-SQL — deliberately avoided here).

**Approach:** RAG over **precomputed text summaries**, not raw rows. Structured metrics don't embed meaningfully as numbers, but a one-paragraph natural-language summary of a day's metrics does, and retrieval + LLM composition over those summaries is both safer and simpler than query generation.

**Ingestion (`cron/summarize_analytics.php`, nightly):**
- For each active merchant, pull yesterday's numbers via existing `AnalyticsRepo::getRange`, `getTopProducts`, `getDeviceSplit`.
- Generate one deterministic text summary (template, not LLM — keeps this cheap and hallucination-free at the source):
  > "Aug 2, 2026: 142 try-ons initiated, 119 completed (84% completion). Top product: Kanchipuram Silk Saree (31 try-ons, 9 buy-now clicks). Device split: 58% mobile, 12% tablet, 30% desktop. Add-to-cart actions: 27."
- Embed the summary, upsert into `fitfyce_analytics_summaries`, payload `{merchant_id, date, period: 'daily'}`. Also roll up a `'weekly'` summary every Monday for longer-range questions.

**Retrieval + answer (`controllers/AnalyticsAskController.php`):**
```
'POST /analytics/ask' => ask(shop, question) → { answer, based_on: [dates] }
```
Flow: embed the question → Qdrant query on `fitfyce_analytics_summaries` filtered to `merchant_id`, optionally date-range-filtered if the question names a period → `gpt-4o-mini` composes the answer **only from the retrieved summary text**, explicitly instructed to say "I don't have data for that period" rather than estimate. Response includes which dates it drew from, so the UI can show "Based on: Jul 27 – Aug 2" under the answer.

**Frontend:** a "Ask your analytics" input box on `app.analytics.jsx`, above or beside the existing charts — it answers in text, the charts stay as the source of truth for anything visual.

---

## 7. Summary of new PHP surface area

| File | Purpose |
|---|---|
| `src/QdrantClient.php` | REST wrapper (shared) |
| `src/OpenAIClient.php` (extend) | `embedTexts()` (shared) |
| `src/VectorStoreInterface.php` | Contract (shared) |
| `db/QdrantVectorStore.php` | Implementation (shared) |
| `src/HelpDocsIngestor.php` | Use case A |
| `controllers/SupportController.php` | Use case A |
| `src/ProductIndexer.php` | Use case B |
| (extend) `controllers/ProductDashboardController.php` or new `ProductSearchController.php` | Use case B |
| (extend) `src/RagIngestor.php` / `RagRetriever.php` / `RagController.php` from the infographic plan | Use case C — add `studio_prompt` source type + `/studio/suggest-prompt` |
| `cron/summarize_analytics.php` | Use case D |
| `controllers/AnalyticsAskController.php` | Use case D |
| `cron/reindex_help_docs.php`, `cron/reindex_products_nightly.php` | Freshness |

New `router.php` entries (same array-map style as existing routes):
```php
'POST /support/ask'            => [SupportController::class, 'ask'],
'POST /support/reindex'        => [SupportController::class, 'reindex'],
'GET  /products/search'        => [ProductSearchController::class, 'search'],
'GET  /products/similar'       => [ProductSearchController::class, 'similar'],
'POST /studio/suggest-prompt'  => [\TryFit\Controllers\GarmentStudioController::class, 'suggestPrompt'],
'POST /analytics/ask'          => [AnalyticsAskController::class, 'ask'],
```

`php-api.server.js` additions (same `request(method, path, body, timeout)` pattern already used for every other method):
```js
supportAsk: (question) => request('POST', '/support/ask', { question }),
productsSearch: (q) => request('GET', `/products/search?q=${encodeURIComponent(q)}`),
productsSimilar: (productId) => request('GET', `/products/similar?product_id=${productId}`),
studioSuggestPrompt: (data) => request('POST', '/studio/suggest-prompt', data),
analyticsAsk: (question) => request('POST', '/analytics/ask', { question }),
```

---

## 8. Deployment

**MVP:** Qdrant Cloud free tier (1 GB, no infra to run) — sign up, create a cluster, drop `QDRANT_URL`/`QDRANT_API_KEY` into `.env`. Good for low tens-of-thousands of vectors, comfortably covers Use cases A/C/D and mid-size catalogs for B.

**If/when you outgrow it:** self-hosted Qdrant via Docker next to the PHP app —
```yaml
qdrant:
  image: qdrant/qdrant:latest
  ports: ["6333:6333"]
  volumes: ["./qdrant_storage:/qdrant/storage"]
```
No application code changes — same REST URL shape, just point `QDRANT_URL` at the container.

One-time setup script (run once per environment): call `ensureCollection` for all four collections listed in §2.6.

---

## 9. Costs

| Item | Approx. cost |
|---|---|
| Qdrant Cloud (MVP tier) | Free up to 1GB |
| Embed 1,000 products | ~$0.02 one-time (text-embedding-3-small) |
| Nightly analytics summaries, 100 merchants × 1 paragraph | ~$0.001/night |
| Help docs (one-time, ~50 pages) | < $0.01 |
| Per chat/search/ask request (1 query embed + 1 gpt-4o-mini call) | < $0.01 |

Embeddings and retrieval are noise next to the existing Fashn/TryOnDiffusion/gpt-image-1 generation costs — this doesn't materially change your per-merchant unit economics.

---

## 10. Delivery phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Shared infra** | `QdrantClient`, `OpenAIClient::embedTexts`, `VectorStoreInterface` + `QdrantVectorStore`, 4 collections created, `vector_index_status` migration | A script embeds + upserts 10 test points into each collection and queries them back with correct filtering |
| **1. Use case B (product search)** | `ProductIndexer` wired into `ProductController::sync`, `/products/search`, `/products/similar`, admin search box | NL search on a dev store returns sane results; "similar products" excludes disabled/self |
| **2. Use case C (Studio prompts)** | Port infographic plan onto `QdrantVectorStore`, add `studio_prompt` source + `/studio/suggest-prompt` | Infographic RAG behaves identically to its own doc's verification plan, now on Qdrant; prompt suggestions appear in Studio wizards |
| **3. Use case D (analytics NL)** | `summarize_analytics.php` cron, `/analytics/ask`, UI box | Asking about last week returns numbers matching the existing charts exactly |
| **4. Use case A (support assistant)** | Author help content, `HelpDocsIngestor`, `/support/ask`, chat widget | 10 hand-written support questions answered correctly with source citations |
| **5. Freshness** | Webhook + nightly cron hooks for B/A; C and D already have cron | Editing a product or doc updates its index within one cron cycle / webhook round-trip |

Recommended order (B → C → D → A) ships the highest-leverage, lowest-authoring-effort features first; product search and Studio prompts reuse data you already have, while the support assistant is gated on writing the help content itself.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Cross-tenant data leak (merchant A sees merchant B's products/prompts/analytics) | Every query always includes an explicit `merchant_id` payload filter, never relies on collection separation alone; add a tenancy test per use case (§ borrowed from infographic doc's Verification Plan) |
| Analytics answers drifting from the real dashboard numbers | Summaries are template-generated from `AnalyticsRepo` directly (no LLM in the ingestion path), so the numbers in the index are exactly the numbers in the charts |
| Qdrant outage breaks core features | All four use cases are additive UI (chat box, search box, suggestion button) layered on existing flows — every retrieval call must fail soft (empty results → feature shows "unavailable", never blocks try-on/studio/checkout) |
| Stale product index after Shopify edits | Webhook-driven per-product upsert (`products/update`) + nightly hash-skipped resync, same pattern as the infographic doc §5.8 |
| Support answers hallucinating beyond the docs | Context-only prompt (§3) + low-confidence fallback to "Contact support" |

---

## 12. Out of scope (this iteration)

- Vector search over garment **images** (CLIP-style embeddings) for true visual similarity — current design is text-only (titles/prompts/metadata); image embeddings are a plausible v2 for use case B.
- Multi-language help docs (ship English first; `text-embedding-3-small` is multilingual so this is a content task, not an architecture change, later).
- Any NL-to-SQL — deliberately excluded from use case D for security reasons; if deeper ad-hoc analytics querying is needed later, that's a separate, carefully-scoped feature with a read-only query sandbox, not part of this RAG design.
