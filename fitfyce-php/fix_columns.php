<?php
/**
 * One-time column fix for variant_image_mappings.
 * Upload to server, visit once, then DELETE this file.
 * Access: https://tryonapp.digifyce.com/fix_columns.php?key=fix2025
 */
if (($_GET['key'] ?? '') !== 'fix2025') {
    http_response_code(403);
    exit('Forbidden');
}

header('Content-Type: application/json');

// Load .env
$envFile = __DIR__ . '/.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$k, $v] = explode('=', $line, 2);
        putenv(trim($k) . '=' . trim($v));
    }
}

try {
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4',
        getenv('DB_HOST') ?: 'localhost',
        getenv('DB_NAME') ?: ''
    );
    $pdo = new PDO($dsn, getenv('DB_USER'), getenv('DB_PASS'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
} catch (Throwable $e) {
    exit(json_encode(['ok' => false, 'error' => 'DB connect failed: ' . $e->getMessage()]));
}

$results = [];

$alters = [
    'garment_type'     => "ALTER TABLE variant_image_mappings ADD COLUMN IF NOT EXISTS garment_type ENUM('top','bottom','full') NOT NULL DEFAULT 'top'",
    'avatar_sex'       => "ALTER TABLE variant_image_mappings ADD COLUMN IF NOT EXISTS avatar_sex ENUM('male','female') DEFAULT NULL",
    'clothing_prompt'  => "ALTER TABLE variant_image_mappings ADD COLUMN IF NOT EXISTS clothing_prompt VARCHAR(200) DEFAULT NULL",
    'is_approved'      => "ALTER TABLE variant_image_mappings ADD COLUMN IF NOT EXISTS is_approved TINYINT(1) NOT NULL DEFAULT 1",
    'show_watermark'   => "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS show_watermark TINYINT(1) NOT NULL DEFAULT 1",
    'share_whatsapp'   => "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS share_whatsapp_enabled TINYINT(1) NOT NULL DEFAULT 1",
    'save_image'       => "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS save_image_enabled TINYINT(1) NOT NULL DEFAULT 1",
    'privacy_notice'   => "ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS privacy_notice_shown TINYINT(1) NOT NULL DEFAULT 1",
];

foreach ($alters as $col => $sql) {
    try {
        $pdo->exec($sql);
        $results[$col] = 'ok';
    } catch (Throwable $e) {
        $code = $e instanceof PDOException ? (int)($e->errorInfo[1] ?? 0) : 0;
        // 1060 = column already exists — that's fine
        $results[$col] = ($code === 1060) ? 'already exists' : 'ERROR: ' . $e->getMessage();
    }
}

// Verify variant_image_mappings columns now exist
$cols = $pdo->query("SHOW COLUMNS FROM variant_image_mappings")->fetchAll(PDO::FETCH_COLUMN);

echo json_encode([
    'ok'      => !str_contains(implode('|', $results), 'ERROR'),
    'results' => $results,
    'variant_image_mappings_columns' => $cols,
], JSON_PRETTY_PRINT);
