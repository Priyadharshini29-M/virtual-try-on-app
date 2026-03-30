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
