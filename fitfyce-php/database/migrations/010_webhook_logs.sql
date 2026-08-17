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
