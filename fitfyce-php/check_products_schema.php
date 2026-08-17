<?php
/**
 * Verifies products table schema — confirms migration status.
 * Access: https://tryonapp.digifyce.com/check_products_schema.php?key=migrate2025
 * DELETE after use.
 */
if (($_GET['key'] ?? '') !== 'migrate2025') {
    http_response_code(403);
    exit(json_encode(['error' => 'Forbidden']));
}

header('Content-Type: application/json');

require_once __DIR__ . '/config/AppConfig.php';
require_once __DIR__ . '/db/Database.php';

$pdo = \TryFit\Db\Database::getInstance();

$columns = $pdo->query("SHOW COLUMNS FROM products")->fetchAll(\PDO::FETCH_ASSOC);
$colNames = array_column($columns, 'Field');

$shouldBeGone = ['shopify_domain', 'shopify_store_id', 'collection_id', 'collection_title', 'collection_handle'];
$shouldExist  = ['shopify_variants'];

$checks = [];
foreach ($shouldBeGone as $col) {
    $checks["drop_{$col}"] = !in_array($col, $colNames) ? 'OK — dropped' : 'PENDING — still exists';
}
foreach ($shouldExist as $col) {
    $checks["add_{$col}"] = in_array($col, $colNames) ? 'OK — present' : 'PENDING — missing';
}

$allDone = !in_array(false, array_map(fn($v) => str_starts_with($v, 'OK'), array_values($checks)));

echo json_encode([
    'migration_complete' => $allDone,
    'checks'             => $checks,
    'current_columns'    => $colNames,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
