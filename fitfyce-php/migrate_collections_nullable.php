<?php
/**
 * Makes shopify_collection_gid nullable so product sync can upsert collections
 * without always having the GID.
 * Access: https://tryonapp.digifyce.com/migrate_collections_nullable.php?key=migrate2025
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
        $log[] = ['ok' => false, 'step' => $label, 'error' => $e->getMessage(), 'sqlcode' => (int)$e->getCode()];
    }
}

runSQL($pdo, 'collections: make shopify_collection_gid nullable',
    "ALTER TABLE collections MODIFY COLUMN shopify_collection_gid VARCHAR(255) DEFAULT NULL", $log);

$allOk = !in_array(false, array_column($log, 'ok'), true);
echo json_encode(['all_ok' => $allOk, 'migrations' => $log], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
