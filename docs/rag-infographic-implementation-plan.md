# RAG + Vector DB for Infographic Generation — Implementation Plan

**Status:** Proposed · **Date:** 2026-07-13 · **Owner:** FitFyce backend/AI

---

## 1. Problem & Goal

### Today
The Marketing Infographic pipeline (`InfographicController`) is a two-step flow:

1. **Extract** — `gpt-4o-mini` pulls 3–5 key-point phrases from *whatever description text the merchant pastes into the wizard*.
2. **Compose** — `gpt-image-1` renders the infographic from the source photo + key points + style guide.

The quality ceiling is Step 1's input: if the merchant pastes a thin description, the key points are generic ("High quality", "Comfortable fit") and the infographic looks like a template, not their product.

### Goal
Ground Step 1 in the merchant's **real data** using Retrieval-Augmented Generation:

- Shopify product data (title, description/body_html, tags, product type, vendor, variants, metafields)
- Brand settings (voice, colors, tagline — already stored per merchant)
- Optionally later: reviews, FAQ pages, size guides, past high-performing infographic copy

All of that gets **embedded once** into a vector store. At generation time we **retrieve** the chunks most relevant to the selected product, hand them to the LLM as context, and get back:

1. **Specific, factual, on-brand key points** ("GOTS-certified organic cotton", "Machine washable at 30°C", "Handloom Kanchipuram silk") instead of filler, and
2. **An auto-generated image prompt** — today the wizard makes the merchant hand-type a "Custom Background / Theme" description (`custom_style_prompt`). That field is replaced by an AI prompt-generation step: the LLM writes the background/theme/palette prompt from the retrieved product facts, brand profile, and chosen style, and the merchant just reviews/edits it before generating (see §6.2 and §7).

The image-composition model (`gpt-image-1`) stays exactly as it is — RAG only upgrades what goes *into* it.

---

## 2. Architecture Decision: Which Vector DB

Constraints that drive this choice:

- Backend is **plain PHP, no Composer** — every external service is called via raw cURL (see `FashnClient`, `OpenAIClient`). Any vector DB must be reachable over **REST** or live inside MySQL.
- Data is **small per merchant**: a catalog of even 5,000 products chunked 3–4 ways is ~20k vectors per merchant. This is trivially small by vector-DB standards.
- Multi-tenant: every query must filter by `merchant_id`.

### Recommendation: two phases behind one interface

| | Phase 1 (ship first) | Phase 2 (only if needed) |
|---|---|---|
| Store | **MySQL** — embeddings as JSON column, cosine similarity computed in PHP | **Qdrant** (self-hosted Docker, REST API) |
| New infra | None | One Docker container |
| Query speed | Fine up to ~50k chunks per merchant (brute-force scan of that merchant's rows only) | Sub-ms ANN at any scale |
| Tenancy | `WHERE merchant_id = ?` | Payload filter on `merchant_id` |
| Effort | ~1 day | ~1 day swap later |

Both sit behind a single PHP interface (`VectorStoreInterface`), so Phase 2 is a drop-in swap, not a rewrite. **Do not** start with Pinecone (recurring cost, external dependency for tiny data) or pgvector (you're on MySQL, not Postgres). If your MySQL host ever offers MySQL 9's native `VECTOR` type, that's another cheap upgrade path inside the same interface.

### Embeddings
**OpenAI `text-embedding-3-small`** (1536 dims). Reasons: you already have the OpenAI key + client plumbing; it costs $0.02 per 1M tokens (a full 5,000-product catalog embeds for well under $0.10); quality is more than enough for product-catalog retrieval.

---

## 3. Target Architecture

```
                        ┌─────────────── INGESTION (async, cron + webhook) ───────────────┐
Shopify product data ──▶ RagIngestor ──▶ chunker ──▶ OpenAIClient::embed ──▶ VectorStore  │
Brand settings ────────▶ (strip HTML,    (~300 tok,   (text-embedding-      (MySQL JSON,  │
                         hash-skip        title-       3-small, batched)     merchant-     │
                         unchanged)       prefixed)                          scoped)       │
                        └──────────────────────────────────────────────────────────────────┘

                        ┌─────────────── GENERATION (sync, per request) ──────────────────┐
Wizard: product picked ─▶ RagRetriever ──▶ top-K chunks ──▶ gpt-4o-mini ──▶ grounded key   │
+ optional free text     (embed query,     + brand ctx      "extract from    points + copy │
                          cosine top-K,                      CONTEXT only"                 │
                          merchant filter)                        │                        │
                                                                  ▼                        │
                                              gpt-image-1 composes infographic (UNCHANGED) │
                        └──────────────────────────────────────────────────────────────────┘
```

---

## 4. Database Schema (Phase 1 store)

One migration, two tables:

```sql
-- One row per ingested source object (a product, the brand profile, a page…)
CREATE TABLE rag_documents (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id   BIGINT UNSIGNED NOT NULL,
  source_type   VARCHAR(32)  NOT NULL,           -- 'product' | 'brand' | 'page' | 'review'
  source_id     VARCHAR(64)  NOT NULL,           -- shopify product id, etc.
  title         VARCHAR(512) NOT NULL DEFAULT '',
  content_hash  CHAR(40)     NOT NULL,           -- sha1 of normalized text → skip re-embed if unchanged
  chunk_count   INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source (merchant_id, source_type, source_id),
  KEY idx_merchant (merchant_id)
);

-- One row per embedded chunk
CREATE TABLE rag_chunks (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id   BIGINT UNSIGNED NOT NULL,
  merchant_id   BIGINT UNSIGNED NOT NULL,        -- denormalized for the hot query path
  chunk_index   INT UNSIGNED NOT NULL,
  chunk_text    TEXT NOT NULL,
  embedding     JSON NOT NULL,                   -- 1536 floats
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_merchant (merchant_id),
  KEY idx_document (document_id),
  CONSTRAINT fk_rag_chunk_doc FOREIGN KEY (document_id)
    REFERENCES rag_documents(id) ON DELETE CASCADE
);
```

Retrieval in Phase 1 = `SELECT id, chunk_text, embedding FROM rag_chunks WHERE merchant_id = ?`, then cosine similarity in PHP and take top-K. At 1536 floats × a few thousand chunks this is tens of milliseconds — cache the decoded vectors in APCu later if it ever shows up in profiles.

---

## 5. New PHP Components

All follow the existing house style: plain classes, cURL, no dependencies.

### 5.1 `src/VectorStoreInterface.php` + `db/MySqlVectorStore.php`
```
interface VectorStoreInterface {
    upsertDocument(int $merchantId, string $sourceType, string $sourceId,
                   string $title, string $contentHash, array $chunks /* [text, embedding][] */): void;
    query(int $merchantId, array $queryEmbedding, int $topK = 8,
          ?string $sourceType = null): array;   // [{chunk_text, title, source_type, source_id, score}]
    deleteDocument(int $merchantId, string $sourceType, string $sourceId): void;
    hasIndex(int $merchantId): bool;
    getContentHash(int $merchantId, string $sourceType, string $sourceId): ?string;
}
```
`MySqlVectorStore` implements it with PDO (reuse `Database::getInstance()`). A future `QdrantVectorStore` implements the same interface over REST.

### 5.2 `OpenAIClient` — add embeddings
Add to the existing client (same cURL pattern as its chat calls):
```
public function embedTexts(array $texts): array   // POST /v1/embeddings, model text-embedding-3-small
                                                   // batch up to ~100 texts per call
```

### 5.3 `src/RagIngestor.php`
Responsibilities:
- **Fetch**: product rows via existing repos (`ProductRepo` / `ProductSummaryRepo`) or the Shopify Admin API through the Remix proxy — whichever already holds full descriptions. If descriptions aren't synced yet, extend the existing product sync to store `body_html`, `tags`, `product_type`, `vendor`.
- **Normalize**: strip HTML (`strip_tags` + whitespace collapse), decode entities.
- **Chunk**: split on paragraphs/sentences into ~300-token (~1,200-char) chunks with ~50-token overlap. **Prefix every chunk with the product title** ("Kanchipuram Silk Saree — Care: dry clean only…") so retrieval works even when a chunk alone lacks the product name.
- **Skip unchanged**: sha1 the normalized text; if it matches `rag_documents.content_hash`, skip embedding (this makes re-runs nearly free).
- **Embed + upsert** in batches.
- Also ingest one `brand` document per merchant from widget/brand settings (tagline, tone, key selling angles).

### 5.4 `src/RagRetriever.php`
- `retrieve(int $merchantId, string $query, int $topK = 8, ?string $productId = null): array`
- Embed the query (product title + merchant's free-text description if any).
- If a `productId` is given, fetch that product's own chunks **first** (they're the primary source), then top-K semantic neighbors for supporting/brand context.
- Return chunks with source labels, deduped, capped at ~2,500 tokens of context.

### 5.5 `controllers/RagController.php` + routes
```
'POST /rag/index'    → full (re)index for the shop      (called from admin UI / cron)
'POST /rag/index-product' → single product upsert       (called from product-update webhook)
'GET  /rag/status'   → { indexed_documents, chunks, last_indexed_at }
'POST /rag/search'   → debug endpoint: query → top-K chunks with scores
```
Auth: same `shop` param + `MerchantRepo` check as `InfographicController::authMerchant()` (extract that into a shared trait/helper rather than copy #4).

### 5.6 `InfographicController` changes (small, additive)
- `extract` and `create` accept new optional fields: `product_id`, `use_rag` (default `true` when an index exists).
- New private step before `extractKeyPoints`: if RAG is available, call `RagRetriever`, then use a **new grounded extraction prompt** (see §6.1) instead of the current one.
- **Fallback is mandatory**: no index / retrieval error / empty results → current behavior, untouched. RAG must never break an existing merchant's flow.
- Response additionally returns `sources: [{title, source_type}]` so the UI can show *where* each fact came from.

### 5.7 Prompt generation endpoint — replaces the hand-typed "Custom Background / Theme" field
New route:
```
'POST /infographic/generate-prompt' → [{ prompt, mood_label }] × 3 suggestions
```
Input: `product_id` (or free-text description), `style`, `product_category`, optional `occasion` hint ("Diwali sale", "summer drop").
Flow: `RagRetriever` pulls the product + brand chunks → `gpt-4o-mini` writes **2–3 candidate background/theme prompts** in exactly the vocabulary `generateInfographicImage()` expects for `custom_style_prompt` (palette, background scenario, texture, mood — *not* label layout, which the style guide already owns). See §6.2 for the prompt.
The wizard shows the candidates as pickable cards; the selected one lands in the existing (still-editable) textarea and flows through the current `custom_style_prompt` plumbing **unchanged** — zero changes to `generateInfographicImage()` or the style guides.
Fallback: no index → generate from the free-text description + style alone (still better than an empty box).

### 5.8 Cron + webhook
- `cron/reindex_rag.php` — nightly loop over active merchants; hash-skip makes this cheap.
- Hook into the existing Shopify webhook route (`api.webhook.jsx`) for `products/update` / `products/delete` → proxy to `/rag/index-product` / delete. This keeps the index fresh without merchants thinking about it.

---

## 6. Prompt Design

### 6.1 Grounded key-point extraction

The core quality win. Replace the free-form extraction with:

```
You are extracting marketing key points for a product infographic.

CONTEXT (the only source of truth — do not invent facts not present here):
[1] (product) Kanchipuram Silk Saree — Handwoven pure mulberry silk, 750g, zari border…
[2] (product) …care: dry clean only, comes with matching blouse piece…
[3] (brand)  FitFyce Silks — heritage handloom, "woven stories" tone, premium positioning…

MERCHANT NOTES (optional, secondary): "{free-text description from the wizard}"

Task: Return JSON: { "key_points": [3-5 phrases, ≤6 words each, each traceable to the
CONTEXT], "headline": "≤8 words in the brand tone", "unsupported": [any merchant-note
claims NOT found in context] }.
Prefer specific, verifiable facts (materials, certifications, measurements, care,
origin) over generic praise. Never output a fact absent from the CONTEXT.
```

Notes:
- `response_format: json_object` on the chat call for reliable parsing.
- The `unsupported` array is a cheap hallucination guard — surface it in the UI as "we couldn't verify these claims".
- Brand chunk feeds the headline tone; the image prompt already handles visual style.

### 6.2 Image-prompt generation (replaces the hand-typed background/theme box)

`custom_style_prompt` is injected verbatim into the gpt-image-1 composition prompt, so the generator must speak that prompt's language — mood, palette, background scenario, texture — and stay out of what the style guides already control (label treatment, layout):

```
You write background/theme direction for an AI product-infographic composer.

PRODUCT FACTS (from CONTEXT): Kanchipuram silk saree, deep maroon with gold zari,
heritage handloom, festive/wedding wear…
BRAND: premium positioning, "woven stories" tone, palette leans jewel tones.
CHOSEN STYLE: luxury  ·  CATEGORY: clothing  ·  OCCASION: Diwali sale (optional)

Task: Return JSON: { "suggestions": [3 items of { "prompt": "<2-3 sentences describing
ONLY the background scene, color palette, texture and mood — suited to THIS product's
colors and the brand's positioning>", "mood_label": "<2-4 word name, e.g. 'Festive
Gold Dusk'>" }] }.
Rules: never describe text labels, badges, connector lines, or layout (the composer
controls those). Never contradict the chosen style's mood. Palettes must complement
the product's actual colors from the facts. Make the 3 suggestions genuinely
different from each other.
```

Notes:
- The 3 suggestions map 1:1 to pickable cards in the wizard; picking one fills the existing editable textarea, so the merchant keeps full override control.
- Because output flows through the untouched `custom_style_prompt` path, this feature is independently shippable — it works even before the key-point RAG path lands (Phase 2), just with weaker grounding.
- `occasion` is a plain optional text input ("Diwali", "Summer clearance") — one word from the merchant replaces the two sentences they used to have to compose.

---

## 7. Frontend Changes (Remix — Marketing Infographic workflow)

In `app.studio.create.jsx` (`WorkflowInfographic`) + `php-api.server.js`:

1. **Product picker step** — replace/augment the free-text description box with a searchable product dropdown (products already sync via `ProductRepo`). Free text remains as optional "extra notes".
2. **Fact review step** — after extraction, show the grounded key points as **editable checkboxes with their source labels** ("from product description", "from brand profile"). Merchant unticks/edits, then hits Generate. This step already half-exists (extract → generate are separate endpoints), so it's a UI change, not a flow change.
3. **AI theme prompt instead of the "Custom Background / Theme" textarea** — add a "✨ Suggest themes" button (plus optional one-word `occasion` input) calling `/infographic/generate-prompt`; render the 3 suggestions as pickable mood cards ("Festive Gold Dusk", …). Picking one fills the existing textarea, which stays visible and editable as the escape hatch. State plumbing (`infoCustomStyle` / `igCustomStyle` → `custom_style_prompt`) is unchanged.
4. **Index status banner** — on the Studio dashboard: "Product knowledge index: 214 products · last updated 2h ago · [Re-index]" calling `/rag/status` and `/rag/index`.
5. `php-api.server.js` — add `ragIndex(shop)`, `ragStatus(shop)`, `ragSearch(shop, q)`, `infographicGeneratePrompt(shop, body)` passthroughs, same pattern as existing methods.

---

## 8. Delivery Phases

| Phase | Scope | Est. | Exit criteria |
|---|---|---|---|
| **0. Foundation** | Migration (2 tables), `OpenAIClient::embedTexts`, `VectorStoreInterface` + `MySqlVectorStore` | 0.5–1 day | Unit-level script embeds and stores 10 chunks, cosine query returns sane ranking |
| **1. Ingestion** | `RagIngestor`, `RagController`, routes, `/rag/index` + `/rag/status` + `/rag/search` | 1–2 days | Full catalog of a dev store indexed; `/rag/search?q=silk saree care` returns the right chunks |
| **2. Grounded generation** | `InfographicController` RAG path + grounded extraction prompt + `/infographic/generate-prompt` endpoint + fallbacks | 1–1.5 days | Same product generates measurably more specific key points with RAG on vs. off; RAG-off path byte-identical to today; prompt endpoint returns 3 distinct usable theme prompts |
| **3. UI** | Product picker, fact-review checkboxes with sources, theme-suggestion cards replacing the hand-typed background box, index status banner | 1–2 days | Merchant can pick a product, review facts, pick a suggested theme, generate — no hand-written description or theme prompt needed |
| **4. Freshness** | Nightly cron + `products/update` webhook hook-in | 0.5 day | Editing a product in Shopify updates its chunks within the webhook round-trip |
| **5. (Optional) Scale** | `QdrantVectorStore` behind the same interface | 1 day | Only if a merchant's chunk count makes Phase 1 queries slow (>50k chunks) |

Total to a shippable grounded pipeline: **~4–6 working days** (Phases 0–4).

---

## 9. Costs (OpenAI, per merchant)

| Operation | Model | Approx. cost |
|---|---|---|
| Index 1,000 products (~1M tokens) | text-embedding-3-small | ~$0.02 one-time |
| Nightly re-index (hash-skipped) | — | ~$0 unless products changed |
| Per generation: 1 query embed + 1 grounded extraction | embedding + gpt-4o-mini | < $0.01 |
| Image composition | gpt-image-1 | unchanged (dominates cost already) |

RAG adds effectively nothing to per-image cost; the image model remains >99% of spend.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Shopify `body_html` is messy HTML / empty | Strip + normalize in ingestor; skip products with <50 chars of text (they get the fallback path) |
| Hallucinated "facts" on the infographic | Context-only prompt + `unsupported` guard + human fact-review step before generation |
| Stale index after product edits | Webhook-driven single-product upsert + nightly hash-skipped cron |
| Brute-force scan too slow for a huge catalog | Per-merchant row filter keeps scans small; APCu vector cache; Qdrant swap is pre-designed (Phase 5) |
| Request timeouts (extraction now does retrieve + LLM) | Retrieval is local MySQL + one embed call (~300ms total); stays far inside the existing 200s budget |
| Multi-language catalogs (e.g., Tamil product names) | text-embedding-3-small is multilingual; keep chunks title-prefixed so language mixing per chunk stays low |
| Copy-pasted auth/helpers proliferating | Extract `authMerchant`/`readJson` into a shared controller helper while adding `RagController` |

---

## 11. Verification Plan

1. **Retrieval sanity** — `/rag/search` debug endpoint on a dev store: 10 hand-written queries, assert the expected product appears in top-3.
2. **A/B eyeball** — generate infographics for 5 real products with `use_rag` on vs. off; key points must contain product-specific facts (material, care, origin) in the RAG version.
3. **Fallback** — delete a merchant's index rows, run the wizard: behavior must match current production exactly.
4. **Tenancy** — index two merchants, query as merchant A with merchant B's product title: zero cross-tenant chunks may return.
5. **Freshness** — edit a product description in Shopify admin, regenerate: new fact appears in retrieval.
6. **Theme prompts** — `/infographic/generate-prompt` for 5 products across styles: all 3 suggestions must describe only background/palette/mood (no label/layout language), be visibly distinct, and produce a coherent image when passed through unmodified as `custom_style_prompt`.

---

## 12. Out of Scope (this iteration)

- Reviews/UGC ingestion (needs a review-app integration — schema already supports `source_type='review'`).
- RAG for the try-on prompts or other Studio workflows (same retriever is reusable later).
- Semantic caching of generated infographics.
- Any change to `gpt-image-1` composition, styles, or the collage flow.
