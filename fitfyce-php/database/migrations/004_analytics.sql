
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
