<?php
// SECURITY: Delete this file immediately after running.
declare(strict_types=1);

require_once __DIR__ . '/config/AppConfig.php';
require_once __DIR__ . '/db/Database.php';

header('Content-Type: application/json');

$results = [];

try {
    $db = TryFit\Db\Database::getInstance();

    // Add missing columns to products
    $db->exec("ALTER TABLE `products`
        ADD COLUMN IF NOT EXISTS `title`     VARCHAR(500) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS `handle`    VARCHAR(500) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS `image_url` TEXT         DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS `price`     DECIMAL(10,2) NOT NULL DEFAULT 0.00");
    $results[] = "products: columns added (title, handle, image_url, price)";

    // Create webhook dedup table
    $db->exec("CREATE TABLE IF NOT EXISTS `analytics_webhook_events` (
        `id`               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        `webhook_event_id` VARCHAR(100)    NOT NULL,
        `merchant_id`      INT UNSIGNED    NOT NULL,
        `event_type`       VARCHAR(64)     NOT NULL,
        `processed_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY `uq_webhook_event` (`webhook_event_id`),
        INDEX `idx_merchant_event` (`merchant_id`, `event_type`)
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $results[] = "analytics_webhook_events: table created";

    // Verify
    $cols    = $db->query("SHOW COLUMNS FROM products")->fetchAll(PDO::FETCH_COLUMN);
    $tables  = $db->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);

    $results[] = "products.title: "     . (in_array('title',     $cols)                         ? 'OK' : 'STILL MISSING');
    $results[] = "products.handle: "    . (in_array('handle',    $cols)                         ? 'OK' : 'STILL MISSING');
    $results[] = "products.image_url: " . (in_array('image_url', $cols)                         ? 'OK' : 'STILL MISSING');
    $results[] = "products.price: "     . (in_array('price',     $cols)                         ? 'OK' : 'STILL MISSING');
    $results[] = "analytics_webhook_events: " . (in_array('analytics_webhook_events', $tables)  ? 'OK' : 'STILL MISSING');

    echo json_encode(['status' => 'done', 'results' => $results], JSON_PRETTY_PRINT);

} catch (\Throwable $e) {
    echo json_encode(['status' => 'error', 'message' => $e->getMessage(), 'results' => $results], JSON_PRETTY_PRINT);
}
