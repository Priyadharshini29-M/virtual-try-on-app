<?php
header('Content-Type: application/json');
try {
    require_once __DIR__ . '/config/AppConfig.php';
    require_once __DIR__ . '/db/Database.php';
    $pdo = \TryFit\Db\Database::getInstance();

    $result = [];

    // Which database are we actually connected to?
    $result['connected_db'] = $pdo->query("SELECT DATABASE()")->fetchColumn();
    $result['db_host']      = \TryFit\AppConfig::dbHost();
    $result['db_name']      = \TryFit\AppConfig::dbName();

    // All merchants
    $result['merchants'] = $pdo->query("SELECT id, shopify_domain, api_key FROM merchants ORDER BY id")->fetchAll();

    // All merchant_settings rows (full widget_config)
    $result['merchant_settings'] = $pdo->query("SELECT id, merchant_id, widget_config FROM merchant_settings ORDER BY id")->fetchAll();

    // Do a live write + read for merchant_id = 4
    $pdo->prepare("INSERT INTO merchant_settings (merchant_id, widget_config) VALUES (4, ?) ON DUPLICATE KEY UPDATE widget_config = VALUES(widget_config)")
        ->execute([json_encode(['test_write' => true, 'ts' => time()])]);

    $result['rows_after_write'] = $pdo->query("SELECT id, merchant_id, widget_config FROM merchant_settings WHERE merchant_id = 4")->fetchAll();
    $result['affected_rows_merchant4'] = (int)$pdo->query("SELECT COUNT(*) FROM merchant_settings WHERE merchant_id = 4")->fetchColumn();

} catch (\Throwable $e) {
    $result['error'] = $e->getMessage();
}
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
