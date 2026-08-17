-- Migration 012: add garment_type to variant_image_mappings
-- Values: 'top'    = upper-body garment (shirt, kurti, jacket, etc.)
--         'bottom' = lower-body garment (pants, skirt, etc.)
--         'full'   = full-body outfit (saree, dress, jumpsuit, etc.)
-- Default 'top' — most clothing tried on is upper-body wear.

ALTER TABLE `variant_image_mappings`
  ADD COLUMN `garment_type` ENUM('top','bottom','full') NOT NULL DEFAULT 'top'
  AFTER `image_type`;
