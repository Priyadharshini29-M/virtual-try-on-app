
-- ===== 001_merchants.sql =====
USE tryfit_db;
CREATE DATABASE IF NOT EXISTS tryfit_db CHARACTER SET utf8mb4;

CREATE TABLE merchants (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shopify_domain       VARCHAR(255) NOT NULL UNIQUE,
  shopify_store_id     VARCHAR(100) NOT NULL UNIQUE,
  access_token         TEXT NOT NULL,
  plan                 ENUM('free','starter','growth','scale') NOT NULL DEFAULT 'free',
  api_key              VARCHAR(64) NOT NULL UNIQUE,
  api_secret           VARCHAR(64) NOT NULL,
  tryon_count_month    INT UNSIGNED NOT NULL DEFAULT 0,
  billing_cycle_start  DATE,
  is_active            TINYINT(1) NOT NULL DEFAULT 1,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_api_key (api_key),
  INDEX idx_domain  (shopify_domain)
) ENGINE=InnoDB CHARACTER SET utf8mb4;

CREATE TABLE merchant_settings (
  id                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id              INT UNSIGNED NOT NULL,
  button_text              VARCHAR(100) NOT NULL DEFAULT 'Try On This Look',
  button_color             VARCHAR(7)   NOT NULL DEFAULT '#1B3A6B',
  button_text_color        VARCHAR(7)   NOT NULL DEFAULT '#FFFFFF',
  button_position          ENUM('below_images','below_atc','floating') NOT NULL DEFAULT 'below_images',
  widget_language          ENUM('en','ta','hi') NOT NULL DEFAULT 'en',
  show_watermark           TINYINT(1) NOT NULL DEFAULT 1,
  share_whatsapp_enabled   TINYINT(1) NOT NULL DEFAULT 1,
  save_image_enabled       TINYINT(1) NOT NULL DEFAULT 1,
  privacy_notice_shown     TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_ms_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_merchant_settings (merchant_id)
) ENGINE=InnoDB CHARACTER SET utf8mb4;


-- ===== 002_products.sql =====
USE tryfit_db;

CREATE TABLE products (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id          INT UNSIGNED NOT NULL,
  shopify_product_id   BIGINT UNSIGNED NOT NULL,
  shopify_product_gid  VARCHAR(100) NOT NULL,
  title                VARCHAR(500) NOT NULL,
  handle               VARCHAR(500) NOT NULL,
  is_tryon_enabled     TINYINT(1) NOT NULL DEFAULT 1,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_p_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_merchant_product (merchant_id, shopify_product_id),
  INDEX idx_enabled (merchant_id, is_tryon_enabled)
) ENGINE=InnoDB CHARACTER SET utf8mb4;

CREATE TABLE variant_image_mappings (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id            INT UNSIGNED NOT NULL,
  shopify_variant_id    BIGINT UNSIGNED NOT NULL,
  shopify_variant_gid   VARCHAR(100) NOT NULL,
  variant_title         VARCHAR(255),
  tryon_image_url       TEXT NOT NULL,
  image_type            ENUM('flat_lay','ghost_mannequin','on_model') NOT NULL DEFAULT 'flat_lay',
  avatar_sex            ENUM('male','female') DEFAULT NULL,
  clothing_prompt       VARCHAR(500) DEFAULT NULL,
  is_approved           TINYINT(1) NOT NULL DEFAULT 1,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vim_product FOREIGN KEY (product_id)
    REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uq_variant (product_id, shopify_variant_id)
) ENGINE=InnoDB CHARACTER SET utf8mb4;


-- ===== 003_sessions.sql =====
USE tryfit_db;


CREATE TABLE tryon_sessions (
  id                   CHAR(36) PRIMARY KEY,
  merchant_id          INT UNSIGNED NOT NULL,
  product_id           INT UNSIGNED NOT NULL,
  variant_id           INT UNSIGNED DEFAULT NULL,
  status               ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  result_image_url     TEXT DEFAULT NULL,
  result_seed          INT DEFAULT NULL,
  result_expires_at    DATETIME DEFAULT NULL,
  error_message        VARCHAR(500) DEFAULT NULL,
  api_request_at       DATETIME DEFAULT NULL,
  api_response_at      DATETIME DEFAULT NULL,
  api_latency_ms       INT UNSIGNED DEFAULT NULL,
  action_add_to_cart   TINYINT(1) NOT NULL DEFAULT 0,
  action_buy_now       TINYINT(1) NOT NULL DEFAULT 0,
  action_save_image    TINYINT(1) NOT NULL DEFAULT 0,
  action_share_wa      TINYINT(1) NOT NULL DEFAULT 0,
  device_type          ENUM('mobile','tablet','desktop') DEFAULT NULL,
  country_code         CHAR(2) DEFAULT NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ts_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  CONSTRAINT fk_ts_product FOREIGN KEY (product_id)
    REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_merchant_date (merchant_id, created_at),
  INDEX idx_status (status)
) ENGINE=InnoDB CHARACTER SET utf8mb4;

CREATE TABLE tryon_conversions (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tryon_session_id    CHAR(36) NOT NULL,
  merchant_id         INT UNSIGNED NOT NULL,
  shopify_order_id    BIGINT UNSIGNED NOT NULL,
  shopify_order_gid   VARCHAR(100),
  order_value_inr     DECIMAL(10,2),
  attributed_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tc_session  FOREIGN KEY (tryon_session_id)
    REFERENCES tryon_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_tc_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_order_session (shopify_order_id, tryon_session_id)
) ENGINE=InnoDB CHARACTER SET utf8mb4;


-- ===== 004_analytics.sql =====
USE tryfit_db;

CREATE TABLE analytics_daily (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id         INT UNSIGNED NOT NULL,
  date                DATE NOT NULL,
  tryon_initiated     INT UNSIGNED NOT NULL DEFAULT 0,
  tryon_completed     INT UNSIGNED NOT NULL DEFAULT 0,
  tryon_failed        INT UNSIGNED NOT NULL DEFAULT 0,
  add_to_cart_count   INT UNSIGNED NOT NULL DEFAULT 0,
  buy_now_count       INT UNSIGNED NOT NULL DEFAULT 0,
  save_count          INT UNSIGNED NOT NULL DEFAULT 0,
  share_wa_count      INT UNSIGNED NOT NULL DEFAULT 0,
  order_count         INT UNSIGNED NOT NULL DEFAULT 0,
  revenue_inr         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  avg_latency_ms      INT UNSIGNED DEFAULT NULL,
  computed_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                      ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ad_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_merchant_date (merchant_id, date),
  INDEX idx_date (date)
) ENGINE=InnoDB CHARACTER SET utf8mb4;


-- ===== 005_plan_limits.sql =====
USE tryfit_db;

CREATE TABLE plan_limits (
  plan                  ENUM('free','starter','growth','scale') PRIMARY KEY,
  monthly_tryon_limit   INT UNSIGNED NOT NULL,
  max_products          INT UNSIGNED NOT NULL,
  analytics_enabled     TINYINT(1) NOT NULL DEFAULT 0,
  custom_api_enabled    TINYINT(1) NOT NULL DEFAULT 0,
  branding_removable    TINYINT(1) NOT NULL DEFAULT 0,
  share_enabled         TINYINT(1) NOT NULL DEFAULT 1,
  price_inr_monthly     INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB CHARACTER SET utf8mb4;

INSERT INTO plan_limits VALUES
  ('free',      50,    1,    0, 0, 0, 1,    0),
  ('starter',   500,   0,    0, 0, 1, 1,  999),
  ('growth',    3000,  0,    1, 0, 1, 1, 2499),
  ('scale',     0,     0,    1, 1, 1, 1, 5999);


-- ===== 006_rebrand_plans.sql =====
USE tryfit_db;
-- Rename and update plan structure
-- Migration: 006_rebrand_plans.sql

-- 1. Update merchants table to accept new plan names
ALTER TABLE merchants MODIFY COLUMN plan ENUM('free', 'starter', 'growth', 'scale', 'basic', 'pro', 'premium') NOT NULL DEFAULT 'free';

-- 2. Map existing merchants to new plans
UPDATE merchants SET plan = 'basic' WHERE plan IN ('free', 'starter');
UPDATE merchants SET plan = 'pro' WHERE plan = 'growth';
UPDATE merchants SET plan = 'premium' WHERE plan = 'scale';

-- 3. Finalize enum in merchants (remove old values)
ALTER TABLE merchants MODIFY COLUMN plan ENUM('basic', 'pro', 'premium') NOT NULL DEFAULT 'basic';

-- 4. Update plan_limits table
DELETE FROM plan_limits;
ALTER TABLE plan_limits MODIFY COLUMN plan ENUM('basic', 'pro', 'premium') NOT NULL;

-- 5. Insert new 3-tier limits
-- (plan, monthly_tryon_limit, max_products, analytics_enabled, custom_api_enabled, branding_removable, share_enabled, price_inr_monthly)
INSERT INTO plan_limits VALUES
  ('basic',   100,    1,   0, 0, 0, 1, 0),
  ('pro',     2000,   0,   1, 0, 1, 1, 1499),
  ('premium', 10000,  0,   1, 1, 1, 1, 3999);


-- ===== 007_shop_meta.sql =====
USE tryfit_db;
-- Add Shopify plan and installed theme metadata to merchants
ALTER TABLE merchants
    ADD COLUMN shopify_plan         VARCHAR(100) NULL AFTER plan,
    ADD COLUMN installed_theme_name VARCHAR(255) NULL AFTER shopify_plan,
    ADD COLUMN installed_theme_id   BIGINT UNSIGNED NULL AFTER installed_theme_name;

-- Shopify collections (synced from Shopify API)
CREATE TABLE IF NOT EXISTS collections (
    id                      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    merchant_id             INT UNSIGNED NOT NULL,
    shopify_collection_id   BIGINT UNSIGNED NOT NULL,
    shopify_collection_gid  VARCHAR(100) NOT NULL,
    title                   VARCHAR(500) NOT NULL,
    handle                  VARCHAR(500) NOT NULL,
    products_count          INT UNSIGNED NOT NULL DEFAULT 0,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_merchant_collection (merchant_id, shopify_collection_id),
    CONSTRAINT fk_collections_merchant FOREIGN KEY (merchant_id)
        REFERENCES merchants(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4;

-- Product ↔ collection membership (many-to-many)
CREATE TABLE IF NOT EXISTS product_collection_map (
    product_id    INT UNSIGNED NOT NULL,
    collection_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (product_id, collection_id),
    CONSTRAINT fk_pcm_product    FOREIGN KEY (product_id)    REFERENCES products(id)    ON DELETE CASCADE,
    CONSTRAINT fk_pcm_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4;


-- ===== 008_merchant_settings_v2.sql =====
USE tryfit_db;
-- Expand merchant_settings to match the widget configuration UI
-- Run after 007_shop_meta.sql

-- Allow any IETF language tag (not just en/ta/hi)
ALTER TABLE merchant_settings
    MODIFY COLUMN widget_language VARCHAR(10) NOT NULL DEFAULT 'en';

-- Add all new configuration columns
ALTER TABLE merchant_settings
    ADD COLUMN widget_subtitle       VARCHAR(200)   NULL                        AFTER button_text,
    ADD COLUMN button_border_radius  INT UNSIGNED   NOT NULL DEFAULT 8           AFTER button_text_color,
    ADD COLUMN hover_bg_color        VARCHAR(7)     NOT NULL DEFAULT '#F3F4F6'   AFTER button_border_radius,
    ADD COLUMN button_width          INT UNSIGNED   NOT NULL DEFAULT 0           AFTER hover_bg_color,
    ADD COLUMN button_height         INT UNSIGNED   NOT NULL DEFAULT 0           AFTER button_width,
    ADD COLUMN button_padding_top    INT UNSIGNED   NOT NULL DEFAULT 10          AFTER button_height,
    ADD COLUMN button_padding_right  INT UNSIGNED   NOT NULL DEFAULT 24          AFTER button_padding_top,
    ADD COLUMN button_padding_bottom INT UNSIGNED   NOT NULL DEFAULT 10          AFTER button_padding_right,
    ADD COLUMN button_padding_left   INT UNSIGNED   NOT NULL DEFAULT 24          AFTER button_padding_bottom,
    ADD COLUMN button_margin_top     INT UNSIGNED   NOT NULL DEFAULT 0           AFTER button_padding_left,
    ADD COLUMN button_margin_right   INT UNSIGNED   NOT NULL DEFAULT 0           AFTER button_margin_top,
    ADD COLUMN button_margin_bottom  INT UNSIGNED   NOT NULL DEFAULT 0           AFTER button_margin_right,
    ADD COLUMN button_margin_left    INT UNSIGNED   NOT NULL DEFAULT 0           AFTER button_margin_bottom,
    ADD COLUMN title_font_size       INT UNSIGNED   NOT NULL DEFAULT 20          AFTER button_margin_left,
    ADD COLUMN subtitle_font_size    INT UNSIGNED   NOT NULL DEFAULT 14          AFTER title_font_size,
    ADD COLUMN title_font_weight     VARCHAR(10)    NOT NULL DEFAULT '600'       AFTER subtitle_font_size,
    ADD COLUMN title_font_family     VARCHAR(100)   NOT NULL DEFAULT 'Inter, sans-serif' AFTER title_font_weight,
    ADD COLUMN subtitle_font_family  VARCHAR(100)   NOT NULL DEFAULT 'Inter, sans-serif' AFTER title_font_family,
    ADD COLUMN button_icon           VARCHAR(30)    NOT NULL DEFAULT 'eye'       AFTER subtitle_font_family,
    ADD COLUMN icon_color            VARCHAR(7)     NOT NULL DEFAULT '#FFFFFF'   AFTER button_icon,
    ADD COLUMN main_icon_bg_color    VARCHAR(20)    NOT NULL DEFAULT 'transparent' AFTER icon_color,
    ADD COLUMN coll_icon_bg_color    VARCHAR(20)    NOT NULL DEFAULT 'transparent' AFTER main_icon_bg_color,
    ADD COLUMN icon_size             INT UNSIGNED   NOT NULL DEFAULT 16          AFTER coll_icon_bg_color,
    ADD COLUMN icon_radius           INT UNSIGNED   NOT NULL DEFAULT 4           AFTER icon_size,
    ADD COLUMN icon_shape            VARCHAR(20)    NOT NULL DEFAULT 'square'    AFTER icon_radius,
    ADD COLUMN icon_opacity          INT UNSIGNED   NOT NULL DEFAULT 100         AFTER icon_shape,
    ADD COLUMN show_on_collection    TINYINT(1)     NOT NULL DEFAULT 1           AFTER icon_opacity,
    ADD COLUMN collection_position   ENUM('top_left','top_right','bottom_left','bottom_right')
                                                    NOT NULL DEFAULT 'top_right' AFTER show_on_collection,
    ADD COLUMN created_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN updated_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;


-- ===== 009_variant_mappings_merchant_id.sql =====
USE tryfit_db;
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


-- ===== 010_webhook_logs.sql =====
USE tryfit_db;
-- Migration: Webhook Logs Table
CREATE TABLE IF NOT EXISTS webhook_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    merchant_id INT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    direction ENUM('incoming', 'outgoing') NOT NULL,
    payload JSON NOT NULL,
    headers JSON,
    response_status INT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (merchant_id),
    INDEX (event_type),
    INDEX (created_at)
);


-- ===== 011_analytics_product_fields.sql =====
USE tryfit_db;
-- Migration 011: Add missing product columns + analytics webhook dedup table

ALTER TABLE `products`
  ADD COLUMN IF NOT EXISTS `title`     VARCHAR(500) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `handle`    VARCHAR(500) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `image_url` TEXT         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `price`     DECIMAL(10,2) NOT NULL DEFAULT 0.00;

CREATE TABLE IF NOT EXISTS `analytics_webhook_events` (
  `id`               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `webhook_event_id` VARCHAR(100)    NOT NULL,
  `merchant_id`      INT UNSIGNED    NOT NULL,
  `event_type`       VARCHAR(64)     NOT NULL,
  `processed_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_webhook_event` (`webhook_event_id`),
  INDEX `idx_merchant_event` (`merchant_id`, `event_type`)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- ===== 012_garment_type.sql =====
USE tryfit_db;
-- Migration 012: add garment_type to variant_image_mappings
-- Values: 'top'    = upper-body garment (shirt, kurti, jacket, etc.)
--         'bottom' = lower-body garment (pants, skirt, etc.)
--         'full'   = full-body outfit (saree, dress, jumpsuit, etc.)
-- Default 'top' — most clothing tried on is upper-body wear.

ALTER TABLE `variant_image_mappings`
  ADD COLUMN `garment_type` ENUM('top','bottom','full') NOT NULL DEFAULT 'top'
  AFTER `image_type`;


-- ===== 013_missing_columns.sql =====
USE tryfit_db;
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


-- ===== 014_product_rag_facts.sql =====
USE tryfit_db;
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


-- ===== synthetic test data (no real merchants / customers) =====
USE tryfit_db;
INSERT INTO merchants (shopify_domain, shopify_store_id, access_token, plan, api_key, api_secret, tryon_count_month, billing_cycle_start, is_active)
VALUES
 ('perf-test.myshopify.com',  'perf-store-1', 'not-a-real-token', 'premium', 'tf_perf_test_key_0001',  'perf-secret-1', 0,  CURDATE(), 1),
 ('perf-quota.myshopify.com', 'perf-store-2', 'not-a-real-token', 'basic',   'tf_perf_quota_key_0002', 'perf-secret-2', 95, CURDATE(), 1);
INSERT IGNORE INTO merchant_settings (merchant_id) SELECT id FROM merchants;
