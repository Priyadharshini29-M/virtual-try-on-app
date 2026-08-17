<?php
header('Content-Type: application/json');
try {
    require_once __DIR__ . '/config/AppConfig.php';
    require_once __DIR__ . '/db/Database.php';
    $pdo = \TryFit\Db\Database::getInstance();

    // Check table exists and current rows
    $rows = $pdo->query("SELECT * FROM merchant_settings")->fetchAll();
    $result = ['existing_rows' => $rows];

    // Try inserting without IGNORE to expose the real error
    $defaults = json_encode(\TryFit\AppConfig::WIDGET_DEFAULTS, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $result['defaults_json_valid'] = json_last_error() === JSON_ERROR_NONE;
    $result['defaults_json'] = substr($defaults, 0, 100);

    $pdo->prepare(
        'INSERT INTO merchant_settings (merchant_id, widget_config) VALUES (?, ?)'
    )->execute([1, $defaults]);

    $result['insert'] = 'OK';
    $result['new_rows'] = $pdo->query("SELECT * FROM merchant_settings")->fetchAll();
} catch (\Throwable $e) {
    $result['error'] = $e->getMessage();
    $result['code']  = $e->getCode();
}
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
