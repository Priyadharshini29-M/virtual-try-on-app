<?php
/**
 * Drops title and handle from products — collection_title / collection_handle cover these.
 * Access: https://tryonapp.digifyce.com/migrate_drop_title_handle.php?key=migrate2025
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
        if (in_array($code, [1091, 1060, 1050], true)) {
            $log[] = ['ok' => true, 'step' => $label, 'note' => 'already done — skipped'];
        } else {
            $log[] = ['ok' => false, 'step' => $label, 'error' => $e->getMessage(), 'sqlcode' => $code];
        }
    }
}

runSQL($pdo, 'products: drop title',
    "ALTER TABLE products DROP COLUMN title", $log);

runSQL($pdo, 'products: drop handle',
    "ALTER TABLE products DROP COLUMN handle", $log);

$columns = $pdo->query("SHOW COLUMNS FROM products")->fetchAll(\PDO::FETCH_ASSOC);
$allOk   = !in_array(false, array_column($log, 'ok'), true);

echo json_encode([
    'all_ok'          => $allOk,
    'migrations'      => $log,
    'products_columns' => array_column($columns, 'Field'),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
