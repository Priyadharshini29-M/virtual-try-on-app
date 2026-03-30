<?php

declare(strict_types=1);

// Load .env
$envFile = dirname(__DIR__) . '/.env';
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
            putenv("{$k}={$v}");
            $_ENV[$k] = $v;
        }
    }
}

$ttlHours = (int)(getenv('RESULTS_TTL_HOURS') ?: 24);
$baseDir  = dirname(__DIR__);
$logDir   = $baseDir . '/logs';
$logFile  = $logDir . '/cleanup.log';

if (!is_dir($logDir)) {
    @mkdir($logDir, 0755, true);
}

function cronLog(string $message): void
{
    global $logFile;
    $line = '[' . date('Y-m-d H:i:s') . '] ' . $message . PHP_EOL;
    file_put_contents($logFile, $line, FILE_APPEND);
    echo $line;
}

cronLog("Cleanup started. TTL={$ttlHours}h");

/* ── 1. Delete old result files ───────────────────────────────── */
$resultsDir = $baseDir . '/results';
$cutoffTs   = time() - ($ttlHours * 3600);
$deleted    = 0;

if (is_dir($resultsDir)) {
    foreach (glob($resultsDir . '/*.jpg') ?: [] as $file) {
        if (is_file($file) && filemtime($file) < $cutoffTs) {
            @unlink($file);
            $deleted++;
        }
    }
}

cronLog("Deleted {$deleted} expired result file(s).");

/* ── 2. Delete expired temp files (via .meta JSON) ─────────────── */
$tempDir = $baseDir . '/temp';
$metaDir = $tempDir . '/.meta';
$deletedTemp = 0;

if (is_dir($metaDir)) {
    foreach (glob($metaDir . '/*.json') ?: [] as $metaFile) {
        $meta = json_decode((string)file_get_contents($metaFile), true);
        if (!is_array($meta)) {
            continue;
        }

        $expiresAt = (int)($meta['expires_at'] ?? 0);
        if ($expiresAt > 0 && $expiresAt < time()) {
            $uuid    = $meta['uuid'] ?? '';
            $imgFile = $tempDir . '/' . $uuid . '.jpg';

            if ($uuid !== '' && is_file($imgFile)) {
                @unlink($imgFile);
                $deletedTemp++;
            }
            @unlink($metaFile);
        }
    }
}

cronLog("Deleted {$deletedTemp} expired temp file(s).");

/* ── 3. Nullify expired result URLs in DB ─────────────────────── */
try {
    $host = getenv('DB_HOST') ?: 'localhost';
    $name = getenv('DB_NAME') ?: '';
    $user = getenv('DB_USER') ?: '';
    $pass = getenv('DB_PASS') ?: '';

    if ($name !== '') {
        $pdo = new PDO(
            "mysql:host={$host};dbname={$name};charset=utf8mb4",
            $user,
            $pass,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );

        $stmt = $pdo->prepare(
            'UPDATE tryon_sessions
             SET result_image_url = NULL
             WHERE result_expires_at < NOW()
               AND result_image_url IS NOT NULL'
        );
        $stmt->execute();
        $rows = $stmt->rowCount();
        cronLog("Nullified {$rows} expired result_image_url row(s) in DB.");
    } else {
        cronLog('DB_NAME not set — skipping DB cleanup.');
    }
} catch (\Throwable $e) {
    cronLog('DB cleanup error: ' . $e->getMessage());
}

cronLog('Cleanup finished.');

/*
 * Recommended crontab entry:
 * 0 * * * * php /path/to/fitfyce-php/cron/cleanup_results.php >> /dev/null 2>&1
 */
