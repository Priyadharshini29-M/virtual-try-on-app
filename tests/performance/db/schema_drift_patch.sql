-- TEST-DB ONLY. The code (ProductRepo/AnalyticsRepo) reads columns that database/migrations/*.sql never create.
-- Mirrors the repo's own schema dump db/tryon_app.sql (products.collection_*). Idempotent.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS collection_id     BIGINT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS collection_title  VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS collection_handle VARCHAR(255) DEFAULT NULL;
