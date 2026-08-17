-- Adds columns required by the current ProductRepo and WidgetSettingsRepo that
-- were missing from the production DB (schema snapshot from 2026-05-05).
--
-- Run once on production. Safe to re-run: each ADD COLUMN is guarded by IF NOT EXISTS (MariaDB 10.4+).

-- ── products ──────────────────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS collection_products LONGTEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shopify_variants    LONGTEXT DEFAULT NULL;

-- title was NOT NULL with no default; syncProduct() does not supply it for
-- toggle-only calls, so relax the constraint to allow NULL.
ALTER TABLE products
  MODIFY COLUMN title VARCHAR(500) DEFAULT NULL;

-- ── merchant_settings ─────────────────────────────────────────────────────────
ALTER TABLE merchant_settings
  ADD COLUMN IF NOT EXISTS products_json    LONGTEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS enabled_products LONGTEXT DEFAULT NULL;
