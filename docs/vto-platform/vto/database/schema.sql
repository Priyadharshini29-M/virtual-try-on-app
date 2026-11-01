-- ============================================================
--  Virtual Try-On (VTO) – third-party widget platform
--  MySQL 8.0+ / MariaDB 10.5+   charset utf8mb4
-- ============================================================
CREATE DATABASE IF NOT EXISTS vto_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vto_platform;

-- Admin users of the control panel
CREATE TABLE IF NOT EXISTS admins (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('super','manager','viewer') NOT NULL DEFAULT 'manager',
  last_login_at DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- One row per merchant website that embeds the widget (vilvah.com, nykaa.com, ajio.com ...)
CREATE TABLE IF NOT EXISTS sites (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,
  domain          VARCHAR(190) NOT NULL UNIQUE,          -- primary domain, e.g. www.vilvah.com
  allowed_origins TEXT NULL,                              -- extra origins, one per line (m.site.com, staging...)
  api_key         CHAR(40) NOT NULL UNIQUE,               -- public key used in the <script> tag
  start_url       VARCHAR(500) NULL,                      -- where the Scrapy scan starts
  fitfyce_shop    VARCHAR(190) NULL,                      -- FitFyce merchant whose Widget Settings style the button
  category        ENUM('apparel','eyewear','beauty','jewellery','footwear','other') NOT NULL DEFAULT 'apparel',
  status          ENUM('active','paused','pending') NOT NULL DEFAULT 'pending',
  plan_order      VARCHAR(40) NOT NULL DEFAULT 'scrapy,block,inspect',  -- fallback loop order
  enable_product_button TINYINT(1) NOT NULL DEFAULT 1,
  enable_image_icon     TINYINT(1) NOT NULL DEFAULT 1,
  enable_card_icon      TINYINT(1) NOT NULL DEFAULT 1,
  -- fallback design, used only when no FitFyce shop is linked (edited in the FitFyce app, not here)
  button_text     VARCHAR(60)  NOT NULL DEFAULT 'Virtual Try-On',
  button_color    VARCHAR(20)  NOT NULL DEFAULT '#111111',
  button_text_color VARCHAR(20) NOT NULL DEFAULT '#ffffff',
  product_url_pattern    VARCHAR(255) NULL,   -- optional regex, e.g. /p/|/product/
  collection_url_pattern VARCHAR(255) NULL,   -- optional regex, e.g. /c/|/collections/
  daily_tryon_limit INT UNSIGNED NOT NULL DEFAULT 5000,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Selectors discovered by any of the 3 plans (or entered manually)
-- page_type + target identify WHERE a button is injected.
CREATE TABLE IF NOT EXISTS selectors (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  site_id     INT UNSIGNED NOT NULL,
  page_type   ENUM('product','collection') NOT NULL,
  target      ENUM(
                'add_to_cart',     -- product page: button injected next to this
                'product_image',   -- product page: main image (icon overlay)
                'product_title',   -- product page: fallback anchor
                'card',            -- collection page: repeated product card
                'card_image',      -- collection page: image inside the card (icon overlay)
                'card_link'        -- collection page: link to the product inside the card
              ) NOT NULL,
  selector    VARCHAR(600) NOT NULL,
  source      ENUM('scrapy','block','inspect','manual') NOT NULL,
  confidence  DECIMAL(4,3) NOT NULL DEFAULT 0.500,
  hits        INT UNSIGNED NOT NULL DEFAULT 0,       -- times it matched on a live page
  misses      INT UNSIGNED NOT NULL DEFAULT 0,       -- times it was tried and matched nothing
  status      ENUM('active','pending','disabled') NOT NULL DEFAULT 'active',
  sample_url  VARCHAR(500) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sel (site_id, page_type, target, selector(255)),
  KEY idx_site_page (site_id, page_type, status),
  CONSTRAINT fk_sel_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Scrapy scan jobs (queued from admin, picked up by scraper/worker.py)
CREATE TABLE IF NOT EXISTS scans (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  site_id     INT UNSIGNED NOT NULL,
  start_url   VARCHAR(500) NOT NULL,
  status      ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
  pages_crawled INT UNSIGNED NOT NULL DEFAULT 0,
  selectors_found INT UNSIGNED NOT NULL DEFAULT 0,
  log         MEDIUMTEXT NULL,
  requested_by INT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at  DATETIME NULL,
  finished_at DATETIME NULL,
  KEY idx_status (status),
  CONSTRAINT fk_scan_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Every try-on request made by a shopper
CREATE TABLE IF NOT EXISTS tryon_sessions (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  site_id       INT UNSIGNED NOT NULL,
  visitor_id    CHAR(36) NULL,
  product_url   VARCHAR(700) NULL,
  product_title VARCHAR(300) NULL,
  product_image VARCHAR(700) NOT NULL,
  user_image    VARCHAR(255) NOT NULL,     -- stored path (uploads/user/...)
  result_image  VARCHAR(255) NULL,         -- stored path (uploads/result/...)
  provider      VARCHAR(40) NOT NULL,
  credits_charged INT UNSIGNED NOT NULL DEFAULT 0,   -- debited from the linked FitFyce wallet
  status        ENUM('processing','done','failed') NOT NULL DEFAULT 'processing',
  error         VARCHAR(500) NULL,
  duration_ms   INT UNSIGNED NULL,
  trigger_from  ENUM('product_button','image_icon','card_icon') NULL,
  plan_used     ENUM('scrapy','block','inspect','manual') NULL,
  ip_hash       CHAR(64) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_site_date (site_id, created_at),
  CONSTRAINT fk_try_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Widget telemetry: which plan injected, failures, clicks
CREATE TABLE IF NOT EXISTS events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  site_id     INT UNSIGNED NOT NULL,
  type        ENUM('load','inject_ok','inject_fail','plan_fallback','click','tryon_ok','tryon_fail') NOT NULL,
  plan        ENUM('scrapy','block','inspect','manual','none') NULL,
  page_type   ENUM('product','collection','unknown') NULL,
  url         VARCHAR(700) NULL,
  meta        JSON NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_site_type_date (site_id, type, created_at),
  CONSTRAINT fk_evt_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---- Platform admin: FitFyce stores + wallets (see migrations/002) ----
CREATE TABLE IF NOT EXISTS stores (
  id                   INT UNSIGNED NOT NULL PRIMARY KEY,      -- FitFyce merchants.id
  shop_domain          VARCHAR(190) NOT NULL UNIQUE,
  is_active            TINYINT(1)   NOT NULL DEFAULT 1,
  app_enabled          TINYINT(1)   NOT NULL DEFAULT 1,
  shopify_plan         VARCHAR(60)  NULL,
  theme_name           VARCHAR(190) NULL,
  wallet_credits       INT          NOT NULL DEFAULT 0,
  wallet_total_debited INT UNSIGNED NOT NULL DEFAULT 0,
  credits_purchased    INT UNSIGNED NOT NULL DEFAULT 0,
  payments_captured    INT UNSIGNED NOT NULL DEFAULT 0,
  revenue_minor        BIGINT UNSIGNED NOT NULL DEFAULT 0,      -- paise
  installed_at         DATETIME     NULL,
  last_login_at        DATETIME     NULL,
  last_event           VARCHAR(40)  NULL,                       -- login / install / uninstall / wallet / sync …
  synced_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_active (is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id              BIGINT UNSIGNED NOT NULL PRIMARY KEY,        -- FitFyce credit_transactions.id
  store_id        INT UNSIGNED NOT NULL,
  delta           INT          NOT NULL,
  reason          VARCHAR(30)  NOT NULL,
  reference_type  VARCHAR(32)  NULL,
  reference_id    VARCHAR(100) NULL,
  balance_after   INT          NOT NULL,
  note            VARCHAR(255) NULL,
  created_at      DATETIME     NOT NULL,
  KEY idx_store (store_id, id),
  CONSTRAINT fk_ledger_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- last wallet rules read from / saved to FitFyce (packs + costs)
CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key  VARCHAR(64)  NOT NULL PRIMARY KEY,
  value_json   LONGTEXT     NOT NULL,
  updated_by   VARCHAR(190) NULL,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Simple API rate limiting bucket
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     VARCHAR(120) PRIMARY KEY,
  hits       INT UNSIGNED NOT NULL DEFAULT 0,
  window_start DATETIME NOT NULL
) ENGINE=InnoDB;

-- Create the first admin with:  php backend/cli/create_admin.php "Name" email@domain.com 'StrongPassword'
