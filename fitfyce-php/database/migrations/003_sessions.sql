

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
