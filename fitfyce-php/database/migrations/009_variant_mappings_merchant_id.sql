-- Add merchant_id directly to variant_image_mappings so shop ownership
-- can be determined without joining through products.
-- Run after 008_merchant_settings_v2.sql

-- Step 1: add column (DEFAULT 0 temporarily to satisfy NOT NULL during backfill)
ALTER TABLE variant_image_mappings
    ADD COLUMN merchant_id INT UNSIGNED NOT NULL DEFAULT 0 AFTER id;

-- Step 2: backfill from products
UPDATE variant_image_mappings vim
INNER JOIN products p ON p.id = vim.product_id
SET vim.merchant_id = p.merchant_id;

-- Step 3: remove the temporary default, add FK and index
ALTER TABLE variant_image_mappings
    ALTER COLUMN merchant_id DROP DEFAULT,
    ADD CONSTRAINT fk_vim_merchant FOREIGN KEY (merchant_id)
        REFERENCES merchants(id) ON DELETE CASCADE,
    ADD INDEX idx_vim_merchant (merchant_id);
