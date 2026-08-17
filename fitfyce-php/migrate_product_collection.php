<?php
/**
 * Re-adds collection columns to the products table and backfills from collections.
 * Access: https://tryonapp.digifyce.com/migrate_product_collection.php?key=migrate2025
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
        if (in_array($code, [1060, 1061, 1050, 1091], true)) {
            $log[] = ['ok' => true, 'step' => $label, 'note' => 'already exists — skipped'];
        } else {
            $log[] = ['ok' => false, 'step' => $label, 'error' => $e->getMessage(), 'sqlcode' => $code];
        }
    }
}

// ── Add collection columns after handle ───────────────────────────────────────
runSQL($pdo, 'products: add collection_id',
    "ALTER TABLE products
     ADD COLUMN collection_id BIGINT UNSIGNED DEFAULT NULL AFTER handle", $log);

runSQL($pdo, 'products: add collection_title',
    "ALTER TABLE products
     ADD COLUMN collection_title VARCHAR(255) DEFAULT NULL AFTER collection_id", $log);

runSQL($pdo, 'products: add collection_handle',
    "ALTER TABLE products
     ADD COLUMN collection_handle VARCHAR(255) DEFAULT NULL AFTER collection_title", $log);

// ── Backfill from product_collection_map + collections ────────────────────────
runSQL($pdo, 'products: backfill collection info',
    "UPDATE products p
     JOIN product_collection_map pcm ON pcm.product_id = p.id
     JOIN collections c ON c.id = pcm.collection_id
     SET p.collection_id     = c.shopify_collection_id,
         p.collection_title  = c.title,
         p.collection_handle = c.handle
     WHERE p.collection_id IS NULL", $log);

// ── Show final columns ────────────────────────────────────────────────────────
$columns = $pdo->query("SHOW COLUMNS FROM products")->fetchAll(\PDO::FETCH_ASSOC);

$allOk = !in_array(false, array_column($log, 'ok'), true);

echo json_encode([
    'all_ok'          => $allOk,
    'migrations'      => $log,
    'products_columns' => array_column($columns, 'Field'),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
