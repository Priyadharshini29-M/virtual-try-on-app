<?php
/**
 * Add merchants.locale + locale_detected_country for multi-language support.
 *
 * Access: https://tryonapp.digifyce.com/migrate_add_locale.php?key=migrate2025
 * DELETE this file from the server after running.
 */

// Force errors into the JSON response so a bad DSN / missing .env doesn't
// come back as a silent blank 500. Removed once the migration lands.
ini_set('display_errors', '0');
error_reporting(E_ALL);

if (($_GET['key'] ?? '') !== 'migrate2025') {
    http_response_code(403);
    exit(json_encode(['error' => 'Forbidden']));
}

header('Content-Type: application/json');

// Top-level catch-all. Without this, an uncaught Throwable (parse error in a
// required file, PDO connect failure, class-not-found) becomes a blank 500
// with display_errors off — which is what you were seeing.
set_exception_handler(function (\Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'error' => 'uncaught exception',
        'class' => get_class($e),
        'message' => $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine(),
    ], JSON_PRETTY_PRINT);
    exit;
});

// Load .env — same parser as router.php. This file is a standalone entry
// point (never goes through router.php), so without this AppConfig::dbHost()
// etc. all resolve to '' and Database::getInstance() throws immediately
// (uncaught PDOException -> blank 500, display_errors is off on this host).
$envFile = __DIR__ . '/.env';
if (is_file($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (strpos($line, '=') !== false) {
            [$k, $v] = explode('=', $line, 2);
            $k = trim($k);
            $v = trim($v);
            if (!isset($_ENV[$k]) && getenv($k) === false) {
                putenv("{$k}={$v}");
                $_ENV[$k] = $v;
            }
        }
    }
}

require_once __DIR__ . '/config/AppConfig.php';
require_once __DIR__ . '/db/Database.php';

// Preflight: if the env wasn't loaded or doesn't carry DB creds, say so
// clearly rather than letting PDO throw a cryptic DSN error.
if (\TryFit\AppConfig::dbHost() === '' || \TryFit\AppConfig::dbName() === '') {
    http_response_code(500);
    echo json_encode([
        'error' => 'DB credentials not available',
        'env_file_present' => is_file($envFile),
        'db_host_empty' => \TryFit\AppConfig::dbHost() === '',
        'db_name_empty' => \TryFit\AppConfig::dbName() === '',
        'db_user_empty' => \TryFit\AppConfig::dbUser() === '',
        'hint' => 'Check that /.env sits next to migrate_add_locale.php and defines DB_HOST, DB_NAME, DB_USER, DB_PASS.',
    ], JSON_PRETTY_PRINT);
    exit;
}

$pdo = \TryFit\Db\Database::getInstance();
$log = [];

function runSQL(\PDO $pdo, string $label, string $sql, array &$log): void {
    try {
        $affected = $pdo->exec($sql);
        $log[] = ['ok' => true, 'step' => $label, 'affected' => $affected];
    } catch (\Throwable $e) {
        $code = (int)$e->getCode();
        // 1060 = Duplicate column, 1061 = Duplicate key — already done
        if (in_array($code, [1060, 1061, 1091, 1050], true)) {
            $log[] = ['ok' => true, 'step' => $label, 'note' => 'already done — skipped'];
        } else {
            $log[] = ['ok' => false, 'step' => $label, 'error' => $e->getMessage(), 'sqlcode' => $code];
        }
    }
}

runSQL(
    $pdo,
    'merchants: add locale',
    "ALTER TABLE merchants
     ADD COLUMN locale VARCHAR(5) NOT NULL DEFAULT 'en'
     AFTER shopify_domain",
    $log
);

runSQL(
    $pdo,
    'merchants: add locale_detected_country',
    "ALTER TABLE merchants
     ADD COLUMN locale_detected_country VARCHAR(2) NULL
     AFTER locale",
    $log
);

runSQL(
    $pdo,
    'merchants: index on locale',
    "CREATE INDEX idx_merchants_locale ON merchants(locale)",
    $log
);

echo json_encode(['migration' => 'add_locale', 'steps' => $log], JSON_PRETTY_PRINT);
