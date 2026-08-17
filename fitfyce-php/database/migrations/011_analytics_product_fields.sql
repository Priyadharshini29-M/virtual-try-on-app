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
