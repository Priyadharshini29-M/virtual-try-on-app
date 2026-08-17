<?php
header('Content-Type: application/json');
try {
    require_once __DIR__ . '/config/AppConfig.php';
    echo json_encode(['ok' => true, 'db_host' => \TryFit\AppConfig::dbHost(), 'master_key' => \TryFit\AppConfig::masterApiKey()]);
} catch (\Throwable $e) {
    echo json_encode(['ok' => false, 'error' => $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine()]);
}
