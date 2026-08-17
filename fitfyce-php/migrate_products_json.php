<?php
/**
 * Adds products_json column to merchant_settings and backfills it.
 * Access: https://tryonapp.digifyce.com/migrate_products_json.php?key=migrate2025
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
        if (in_array($code, [1060, 1050, 1091], true)) {
            $log[] = ['ok' => true, 'step' => $label, 'note' => 'already exists — skipped'];
        } else {
            $log[] = ['ok' => false, 'step' => $label, 'error' => $e->getMessage(), 'sqlcode' => $code];
        }
    }
}

// Add products_json column
runSQL($pdo, 'merchant_settings: add products_json',
    "ALTER TABLE merchant_settings
     ADD COLUMN products_json JSON DEFAULT NULL AFTER enabled_products", $log);

// Backfill for all merchants
$merchants = $pdo->query("SELECT DISTINCT merchant_id FROM merchant_settings")->fetchAll(\PDO::FETCH_COLUMN);

foreach ($merchants as $mid) {
    $mid  = (int)$mid;
    $stmt = $pdo->prepare(
        'SELECT id AS product_id, shopify_product_id, shopify_product_gid,
                collection_id, collection_title, collection_handle, is_tryon_enabled
         FROM products
         WHERE merchant_id = ?
         ORDER BY collection_title ASC'
    );
    $stmt->execute([$mid]);
    $products = $stmt->fetchAll();

    $pdo->prepare(
        'UPDATE merchant_settings SET products_json = ? WHERE merchant_id = ?'
    )->execute([
        json_encode($products, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        $mid,
    ]);

    $log[] = ['ok' => true, 'step' => "backfill merchant_id={$mid}", 'products_count' => count($products)];
}

// Show result
$rows  = $pdo->query(
    "SELECT merchant_id, shopify_domain,
            JSON_LENGTH(products_json)      AS total_products,
            JSON_LENGTH(enabled_products)   AS enabled_products,
            products_json
     FROM merchant_settings ORDER BY merchant_id"
)->fetchAll();

$allOk = !in_array(false, array_column($log, 'ok'), true);

echo json_encode([
    'all_ok'            => $allOk,
    'migrations'        => $log,
    'merchant_settings' => array_map(fn($r) => [
        'merchant_id'      => $r['merchant_id'],
        'shopify_domain'   => $r['shopify_domain'],
        'total_products'   => $r['total_products'],
        'enabled_products' => $r['enabled_products'],
        'products_json'    => json_decode($r['products_json'] ?? 'null'),
    ], $rows),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
