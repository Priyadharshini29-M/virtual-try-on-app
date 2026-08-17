<?php
/**
 * Creates collections and product_collection_map tables.
 * Access: https://tryonapp.digifyce.com/migrate_collections.php?key=migrate2025
 * DELETE after running.
 */
if (($_GET['key'] ?? '') !== 'migrate2025') {
    http_response_code(403);
    exit(json_encode(['error' => 'Forbidden']));
}

header('Content-Type: application/json');

require_once __DIR__ . '/config/AppConfig.php';
require_once __DIR__ . '/db/Database.php';

$pdo = \TryFit\Db\Database::getInstance();
$log = [];

function runSQL(\PDO $pdo, string $label, string $sql, array &$log): void {
    try {
        $affected = $pdo->exec($sql);
        $log[] = ['ok' => true, 'step' => $label, 'affected' => $affected];
    } catch (\Throwable $e) {
        $code = (int)$e->getCode();
        if (in_array($code, [1050, 1060, 1061], true)) {
            $log[] = ['ok' => true, 'step' => $label, 'note' => 'already exists — skipped'];
        } else {
            $log[] = ['ok' => false, 'step' => $label, 'error' => $e->getMessage(), 'sqlcode' => $code];
        }
    }
}

runSQL($pdo, 'create collections',
    "CREATE TABLE IF NOT EXISTS collections (
        id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        merchant_id             INT NOT NULL,
        shopify_collection_id   BIGINT UNSIGNED NOT NULL,
        shopify_collection_gid  VARCHAR(255) NOT NULL,
        title                   VARCHAR(255) NOT NULL,
        handle                  VARCHAR(255) NOT NULL,
        products_count          INT UNSIGNED NOT NULL DEFAULT 0,
        created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_merchant_collection (merchant_id, shopify_collection_id),
        INDEX idx_col_merchant (merchant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci", $log);

runSQL($pdo, 'create product_collection_map',
    "CREATE TABLE IF NOT EXISTS product_collection_map (
        product_id    INT UNSIGNED NOT NULL,
        collection_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (product_id, collection_id),
        INDEX idx_pcm_collection (collection_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci", $log);

$tables = $pdo->query("SHOW TABLES")->fetchAll(\PDO::FETCH_COLUMN);
$allOk  = !in_array(false, array_column($log, 'ok'), true);

echo json_encode([
    'all_ok'     => $allOk,
    'migrations' => $log,
    'all_tables' => $tables,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
