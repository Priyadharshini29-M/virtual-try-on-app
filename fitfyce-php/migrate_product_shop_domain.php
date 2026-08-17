<?php
/**
 * Adds shopify_domain to products table and backfills from merchants.
 * Access: https://tryonapp.digifyce.com/migrate_product_shop_domain.php?key=migrate2025
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
        if (in_array($code, [1060, 1091, 1050], true)) {
            $log[] = ['ok' => true, 'step' => $label, 'note' => 'already exists — skipped'];
        } else {
            $log[] = ['ok' => false, 'step' => $label, 'error' => $e->getMessage(), 'sqlcode' => $code];
        }
    }
}

runSQL($pdo, 'products: add shopify_domain',
    "ALTER TABLE products
     ADD COLUMN shopify_domain VARCHAR(255) DEFAULT NULL AFTER merchant_id", $log);

runSQL($pdo, 'products: backfill shopify_domain from merchants',
    "UPDATE products p
     JOIN merchants m ON m.id = p.merchant_id
     SET p.shopify_domain = m.shopify_domain
     WHERE p.shopify_domain IS NULL", $log);

$columns = $pdo->query("SHOW COLUMNS FROM products")->fetchAll(\PDO::FETCH_ASSOC);
$allOk   = !in_array(false, array_column($log, 'ok'), true);

echo json_encode([
    'all_ok'          => $allOk,
    'migrations'      => $log,
    'products_columns' => array_column($columns, 'Field'),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
