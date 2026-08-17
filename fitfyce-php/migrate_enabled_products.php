<?php
/**
 * Adds enabled_products JSON column to merchant_settings and backfills it.
 * Access: https://tryonapp.digifyce.com/migrate_enabled_products.php?key=migrate2025
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
            $log[] = ['ok' => true, 'step' => $label, 'note' => 'already done — skipped'];
        } else {
            $log[] = ['ok' => false, 'step' => $label, 'error' => $e->getMessage(), 'sqlcode' => $code];
        }
    }
}

// ── Add enabled_products column to merchant_settings ─────────────────────────
runSQL($pdo, 'merchant_settings: add enabled_products',
    "ALTER TABLE merchant_settings
     ADD COLUMN enabled_products JSON DEFAULT NULL
     AFTER widget_config", $log);

// ── Backfill: populate enabled_products for each merchant ─────────────────────
$merchants = $pdo->query("SELECT DISTINCT merchant_id FROM merchant_settings")->fetchAll(\PDO::FETCH_COLUMN);

foreach ($merchants as $mid) {
    $mid = (int)$mid;
    $stmt = $pdo->prepare(
        'SELECT id AS product_id, shopify_product_id, shopify_product_gid, title, handle
         FROM products
         WHERE merchant_id = ? AND is_tryon_enabled = 1
         ORDER BY title ASC'
    );
    $stmt->execute([$mid]);
    $enabled = $stmt->fetchAll();

    $pdo->prepare(
        'UPDATE merchant_settings SET enabled_products = ? WHERE merchant_id = ?'
    )->execute([
        json_encode($enabled, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        $mid,
    ]);

    $log[] = ['ok' => true, 'step' => "backfill merchant_id={$mid}", 'enabled_count' => count($enabled)];
}

// ── Show result ───────────────────────────────────────────────────────────────
$rows = $pdo->query(
    "SELECT merchant_id, shopify_domain,
            JSON_LENGTH(enabled_products) AS enabled_count,
            enabled_products
     FROM merchant_settings
     ORDER BY merchant_id"
)->fetchAll();

$allOk = !in_array(false, array_column($log, 'ok'), true);

echo json_encode([
    'all_ok'     => $allOk,
    'migrations' => $log,
    'merchant_settings' => array_map(fn($r) => [
        'merchant_id'   => $r['merchant_id'],
        'shopify_domain'=> $r['shopify_domain'],
        'enabled_count' => $r['enabled_count'],
        'enabled_products' => json_decode($r['enabled_products'] ?? 'null'),
    ], $rows),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
