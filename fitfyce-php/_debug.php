<?php
// Temporary diagnostic — DELETE after debugging is complete.
// Access: https://tryonapp.digifyce.com/_debug.php?key=debug2025

if (($_GET['key'] ?? '') !== 'debug2025') {
    http_response_code(403);
    exit('Forbidden');
}

header('Content-Type: application/json');

$result = [];

// ── 1. PHP version ─────────────────────────────────────────────────────────
$result['php_version'] = PHP_VERSION;

// ── 2. AppConfig load ──────────────────────────────────────────────────────
try {
    require_once __DIR__ . '/config/AppConfig.php';
    $result['appconfig'] = 'OK';
    $result['db_host']   = \TryFit\AppConfig::dbHost();
    $result['db_name']   = \TryFit\AppConfig::dbName();
    $result['db_user']   = \TryFit\AppConfig::dbUser();
} catch (\Throwable $e) {
    $result['appconfig'] = 'ERROR: ' . $e->getMessage();
}

// ── 3. Helpers ─────────────────────────────────────────────────────────────
try {
    require_once __DIR__ . '/shared/helpers.php';
    $result['helpers'] = 'OK';
} catch (\Throwable $e) {
    $result['helpers'] = 'ERROR: ' . $e->getMessage();
}

// ── 4. Database connection ─────────────────────────────────────────────────
try {
    require_once __DIR__ . '/db/Database.php';
    $pdo = \TryFit\Db\Database::getInstance();
    $result['db_connection'] = 'OK';
} catch (\Throwable $e) {
    $result['db_connection'] = 'ERROR: ' . $e->getMessage();
    echo json_encode($result, JSON_PRETTY_PRINT);
    exit;
}

// ── 5. Tables exist ────────────────────────────────────────────────────────
try {
    $tables = $pdo->query("SHOW TABLES")->fetchAll(\PDO::FETCH_COLUMN);
    $result['tables'] = $tables;
} catch (\Throwable $e) {
    $result['tables'] = 'ERROR: ' . $e->getMessage();
}

// ── 6. Merchants in DB ─────────────────────────────────────────────────────
try {
    $merchants = $pdo->query("SELECT id, shopify_domain, plan, api_key, is_active FROM merchants")->fetchAll();
    $result['merchants'] = $merchants;
} catch (\Throwable $e) {
    $result['merchants'] = 'ERROR: ' . $e->getMessage();
}

// ── 7. merchant_settings rows ──────────────────────────────────────────────
try {
    $settings = $pdo->query("SELECT merchant_id, LEFT(widget_config, 100) as widget_config_preview FROM merchant_settings")->fetchAll();
    $result['merchant_settings'] = $settings;
} catch (\Throwable $e) {
    $result['merchant_settings'] = 'ERROR: ' . $e->getMessage();
}

// ── 8. Test save for merchant_id = 1 ──────────────────────────────────────
try {
    require_once __DIR__ . '/db/MerchantRepo.php';
    require_once __DIR__ . '/db/WidgetSettingsRepo.php';
    $repo = new \TryFit\Db\WidgetSettingsRepo();
    $saved = $repo->patchButtonConfig(1, [
        'widget_title'    => '__debug_test__',
        'css'             => ['button_color' => '#AABBCC'],
    ]);
    $result['test_save_merchant_1'] = 'OK — widget_config updated';
} catch (\Throwable $e) {
    $result['test_save_merchant_1'] = 'ERROR: ' . $e->getMessage();
}

// ── 9. ApiKeyAuth test ─────────────────────────────────────────────────────
try {
    require_once __DIR__ . '/middleware/ApiKeyAuth.php';
    $result['apikey_master'] = \TryFit\AppConfig::masterApiKey();
} catch (\Throwable $e) {
    $result['apikey_load'] = 'ERROR: ' . $e->getMessage();
}

// ── 10. router.php file exists? ────────────────────────────────────────────
$result['router_php_exists'] = file_exists(__DIR__ . '/router.php') ? 'YES' : 'NO';
$result['api_php_exists']    = file_exists(__DIR__ . '/api.php')    ? 'YES' : 'NO';
$result['htaccess_exists']   = file_exists(__DIR__ . '/.htaccess')  ? 'YES' : 'NO';

echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
