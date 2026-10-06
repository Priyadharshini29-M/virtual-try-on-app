<?php
/**
 * Backend diagnostics — finds why router.php returns HTTP 500.
 * Access: https://tryonapp.digifyce.com/diag.php?key=migrate2025
 * DELETE this file from the server once the backend is healthy.
 *
 * Reports: PHP version, every file router.php require_once's (and whether it
 * exists on this server), the result of loading them one by one, and the
 * tail of the PHP error log.
 */
if (($_GET['key'] ?? '') !== 'migrate2025') {
    http_response_code(403);
    exit('Forbidden');
}

header('Content-Type: text/plain; charset=utf-8');
ini_set('display_errors', '1');
error_reporting(E_ALL);

echo "PHP " . PHP_VERSION . "\n";
echo "Dir " . __DIR__ . "\n\n";

// 1. Which files does router.php need, and are they on the server?
$router = @file_get_contents(__DIR__ . '/router.php');
if ($router === false) {
    exit("router.php NOT FOUND\n");
}
preg_match_all("#require_once\s+__DIR__\s*\.\s*'([^']+)'#", $router, $m);
$files = $m[1];

echo "== Files required by router.php (" . count($files) . ") ==\n";
$missing = [];
foreach ($files as $rel) {
    $ok = is_file(__DIR__ . $rel);
    if (!$ok) {
        $missing[] = $rel;
    }
    echo ($ok ? "  ok       " : "  MISSING  ") . $rel . "\n";
}
echo "\n" . (count($missing) ? count($missing) . " MISSING — upload these files:\n  " . implode("\n  ", $missing) : "All required files are present.") . "\n\n";

// 2. Load them in order and stop at the first one that fails.
echo "== Loading files in order ==\n";
$loaded = 0;
foreach ($files as $rel) {
    if (!is_file(__DIR__ . $rel)) {
        echo "  skip (missing) $rel\n";
        continue;
    }
    try {
        require_once __DIR__ . $rel;
        $loaded++;
    } catch (\Throwable $e) {
        echo "  FAILED  $rel\n    " . get_class($e) . ': ' . $e->getMessage() . "\n    at " . $e->getFile() . ':' . $e->getLine() . "\n";
        break;
    }
}
echo "  loaded $loaded file(s)\n\n";

// 3. Recent PHP errors.
$log = ini_get('error_log');
echo "== PHP error log: " . ($log ?: '(not set)') . " ==\n";
if ($log && is_readable($log)) {
    $lines = @file($log, FILE_IGNORE_NEW_LINES) ?: [];
    echo implode("\n", array_slice($lines, -40)) . "\n";
} else {
    $fallback = __DIR__ . '/error_log';
    if (is_readable($fallback)) {
        $lines = @file($fallback, FILE_IGNORE_NEW_LINES) ?: [];
        echo "(from ./error_log)\n" . implode("\n", array_slice($lines, -40)) . "\n";
    } else {
        echo "(not readable — check your hosting panel's error log)\n";
    }
}
