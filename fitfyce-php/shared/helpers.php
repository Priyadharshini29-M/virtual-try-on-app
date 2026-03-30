<?php

declare(strict_types=1);

if (!function_exists('respondJson')) {
    function respondJson(array $data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit;
    }
}

if (!function_exists('writeLog')) {
    function writeLog(string $level, string $message, array $context = []): void
    {
        $logDir = __DIR__ . '/../logs';
        if (!is_dir($logDir)) {
            @mkdir($logDir, 0755, true);
        }

        $logFile = $logDir . '/app.log';

        $timestamp = date('Y-m-d H:i:s');
        $contextStr = !empty($context) ? json_encode($context, JSON_UNESCAPED_SLASHES) : '';

        $line = "[{$timestamp}] [{$level}] {$message} {$contextStr}" . PHP_EOL;

        file_put_contents($logFile, $line, FILE_APPEND);
    }
}

if (!function_exists('baseUrl')) {
    function baseUrl(): string
    {
        $https = $_SERVER['HTTPS'] ?? '';
        $proto = (!empty($https) && $https !== 'off') ? 'https' : 'http';

        if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
            $proto = $_SERVER['HTTP_X_FORWARDED_PROTO'];
        }

        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        return $proto . '://' . $host;
    }
}

if (!function_exists('basePath')) {
    function basePath(): string
    {
        $basePath = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
        return $basePath === '/' ? '' : $basePath;
    }
}
