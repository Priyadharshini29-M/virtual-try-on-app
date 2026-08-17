<?php
/**
 * Products table cleanup migration.
 * - Drops redundant columns (shopify_domain, shopify_store_id, collection_id,
 *   collection_title, collection_handle) — all derivable from merchant_id FK.
 * - Adds shopify_variants JSON column to cache per-product variant data.
 *
 * Access: https://tryonapp.digifyce.com/migrate_products.php?key=migrate2025
 * DELETE this file from the server after running.
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
        // 1091 = Can't DROP column (doesn't exist) — already cleaned up
        if (in_array($code, [1091, 1060, 1061, 1050], true)) {
            $log[] = ['ok' => true, 'step' => $label, 'note' => 'already done — skipped'];
        } else {
            $log[] = ['ok' => false, 'step' => $label, 'error' => $e->getMessage(), 'sqlcode' => $code];
        }
    }
}

// ── Drop redundant columns ────────────────────────────────────────────────────
runSQL($pdo, 'products: drop shopify_domain',
    "ALTER TABLE products DROP COLUMN shopify_domain", $log);

runSQL($pdo, 'products: drop shopify_store_id',
    "ALTER TABLE products DROP COLUMN shopify_store_id", $log);

runSQL($pdo, 'products: drop collection_id',
    "ALTER TABLE products DROP COLUMN collection_id", $log);

runSQL($pdo, 'products: drop collection_title',
    "ALTER TABLE products DROP COLUMN collection_title", $log);

runSQL($pdo, 'products: drop collection_handle',
    "ALTER TABLE products DROP COLUMN collection_handle", $log);

// ── Add shopify_variants JSON column ─────────────────────────────────────────
runSQL($pdo, 'products: add shopify_variants',
    "ALTER TABLE products ADD COLUMN shopify_variants JSON DEFAULT NULL AFTER handle", $log);

// ── Show final schema ─────────────────────────────────────────────────────────
$columns = $pdo->query("SHOW COLUMNS FROM products")->fetchAll();

$allOk = !in_array(false, array_column($log, 'ok'), true);

echo json_encode([
    'all_ok'     => $allOk,
    'migrations' => $log,
    'products_columns' => array_map(fn($c) => [
        'field'   => $c['Field'],
        'type'    => $c['Type'],
        'null'    => $c['Null'],
        'default' => $c['Default'],
    ], $columns),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
