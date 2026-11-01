-- Captured leads for the Analytics module's "Captured leads" panel.
-- One row per shopper who left an email or phone to unlock their try-on.

CREATE TABLE IF NOT EXISTS leads (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id     INT UNSIGNED NOT NULL,
  email           VARCHAR(255) NULL,
  phone           VARCHAR(50)  NULL,
  consent_marketing TINYINT(1) NOT NULL DEFAULT 0,
  shopify_product_id BIGINT UNSIGNED NULL,
  session_id      CHAR(36) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_leads_merchant FOREIGN KEY (merchant_id)
    REFERENCES merchants(id) ON DELETE CASCADE,
  INDEX idx_leads_merchant (merchant_id, created_at),
  INDEX idx_leads_email    (email),
  INDEX idx_leads_phone    (phone)
) ENGINE=InnoDB CHARACTER SET utf8mb4;
