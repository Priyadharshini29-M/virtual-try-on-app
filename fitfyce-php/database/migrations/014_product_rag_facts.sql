-- Migration 014: product fact columns for RAG grounding + vector index tracking
--
-- vendor/product_type/tags/description_html are already fetched from Shopify's
-- Admin GraphQL in the Remix app (app.products.jsx) but were never persisted —
-- they are the actual factual source RagIngestor embeds for grounded infographic
-- generation. Safe to re-run: guarded by IF NOT EXISTS (MariaDB 10.4+).

-- ── products ──────────────────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS vendor           VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS product_type     VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tags             TEXT         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS description_html LONGTEXT     DEFAULT NULL;

-- ── vector_index_status ──────────────────────────────────────────────────────
-- One row per embedded source object. content_hash lets RagIngestor skip
-- re-embedding unchanged text (sha1 of the normalized chunk text).
CREATE TABLE IF NOT EXISTS vector_index_status (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id   INT UNSIGNED NOT NULL,
  collection    VARCHAR(64)  NOT NULL DEFAULT 'fitfyce_knowledge',
  source_type   VARCHAR(32)  NOT NULL,          -- 'product' (only source type in v1)
  source_id     VARCHAR(64)  NOT NULL,          -- products.id
  content_hash  CHAR(40)     NOT NULL,
  chunk_count   INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vector_source (collection, merchant_id, source_type, source_id),
  KEY idx_vector_merchant (merchant_id)
) ENGINE=InnoDB CHARACTER SET utf8mb4;
