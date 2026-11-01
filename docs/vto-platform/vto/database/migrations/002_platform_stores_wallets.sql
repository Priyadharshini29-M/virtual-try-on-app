-- Platform admin: copy of every FitFyce store and its wallet, kept current by signed
-- pushes from FitFyce (backend/api/platform.php) plus the "Sync now" pull.
-- FitFyce stays the source of truth for balances; these tables are the admin's record.
USE vto_platform;

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

-- VTO try-ons billed to the linked FitFyce store
ALTER TABLE tryon_sessions ADD COLUMN credits_charged INT UNSIGNED NOT NULL DEFAULT 0 AFTER provider;
