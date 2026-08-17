<?php
/**
 * Adds collection_products JSON column to products table.
 * Access: https://tryonapp.digifyce.com/migrate_collection_products.php?key=migrate2025
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

runSQL($pdo, 'products: add collection_products',
    "ALTER TABLE products
     ADD COLUMN collection_products JSON DEFAULT NULL
     AFTER collection_handle", $log);

$cols  = $pdo->query("SHOW COLUMNS FROM products")->fetchAll(\PDO::FETCH_COLUMN, 0);
$allOk = !in_array(false, array_column($log, 'ok'), true);

echo json_encode([
    'all_ok'          => $allOk,
    'migrations'      => $log,
    'products_columns' => $cols,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
