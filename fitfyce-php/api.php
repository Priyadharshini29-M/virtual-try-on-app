<?php
declare(strict_types=1);
ini_set('display_errors', '1');
error_reporting(E_ALL);
$routerPath = __DIR__ . '/router.php';
if (file_exists($routerPath)) { require_once $routerPath; }

$startTime = microtime(true);

/* =========================
   CORS
========================= */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/shared/helpers.php';
require_once __DIR__ . '/src/Config.php';
require_once __DIR__ . '/src/ImageUtils.php';
require_once __DIR__ . '/src/TryOnDiffusionClient.php';

use VTON\Config;
use VTON\ImageUtils;
use VTON\TryOnDiffusionClient;

/* =========================
   Request Validation
========================= */
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method !== 'POST') {
    writeLog('ERROR', 'Method not allowed', ['method' => $method]);
    respondJson(['error' => 'Method not allowed'], 405);
}

$rawInput = (string)file_get_contents('php://input');
$payload = json_decode($rawInput, true);

if (!is_array($payload)) {
    writeLog('ERROR', 'Invalid JSON body', ['raw_input' => $rawInput]);
    respondJson(['error' => 'Invalid JSON body'], 400);
}

writeLog('INFO', 'Incoming request', [
    'ip' => $_SERVER['REMOTE_ADDR'] ?? null,
    'payload' => $payload
]);

$clothingUrl = normalizeText($payload['clothing_image'] ?? null);
$avatarUrl = normalizeText($payload['avatar_image'] ?? null);
$backgroundUrl = normalizeText($payload['background_image'] ?? null);

if ($clothingUrl === null || $avatarUrl === null) {
    writeLog('ERROR', 'Missing required images');
    respondJson(['error' => 'clothing_image and avatar_image are required'], 400);
}

/* =========================
   Download Images
========================= */
$tempFiles = [];

$clothingPath = downloadToTemp($clothingUrl);
if ($clothingPath === null) {
    respondJson(['error' => 'Failed to download clothing_image'], 400);
}
$tempFiles[] = $clothingPath;

$avatarPath = downloadToTemp($avatarUrl);
if ($avatarPath === null) {
    cleanupTempFiles($tempFiles);
    respondJson(['error' => 'Failed to download avatar_image'], 400);
}
$tempFiles[] = $avatarPath;

$clothingPath = trackJpeg($clothingPath, $tempFiles);
$avatarPath = trackJpeg($avatarPath, $tempFiles);

$backgroundPath = null;
if ($backgroundUrl !== null) {
    $bgPath = downloadToTemp($backgroundUrl);
    if ($bgPath === null) {
        cleanupTempFiles($tempFiles);
        respondJson(['error' => 'Failed to download background_image'], 400);
    }
    $tempFiles[] = $bgPath;
    $backgroundPath = trackJpeg($bgPath, $tempFiles);
}

/* =========================
   API Call
========================= */
$params = buildParams(
    $clothingPath,
    $avatarPath,
    $backgroundPath,
    $payload['clothing_prompt'] ?? null,
    $payload['avatar_prompt'] ?? null,
    $payload['avatar_sex'] ?? null,
    $payload['background_prompt'] ?? null,
    isset($payload['seed']) ? (int)$payload['seed'] : -1
);

$result = callTryOnApi($params, $tempFiles);

$executionTime = round(microtime(true) - $startTime, 3);
writeLog('INFO', 'Request completed', [
    'execution_time_sec' => $executionTime,
    'status' => $result['status']
]);

respondJson($result['body'], $result['status']);

/* =====================================================
   Core Functions
===================================================== */

function buildParams(
    string $clothingPath,
    string $avatarPath,
    ?string $backgroundPath,
    ?string $clothingPrompt,
    ?string $avatarPrompt,
    ?string $avatarSex,
    ?string $backgroundPrompt,
    int $seed
): array {
    return [
        'clothing_image_path' => $clothingPath,
        'avatar_image_path' => $avatarPath,
        'background_image_path' => $backgroundPath,
        'clothing_prompt' => normalizeText($clothingPrompt),
        'avatar_prompt' => normalizeText($avatarPrompt),
        'avatar_sex' => in_array($avatarSex, ['male', 'female'], true) ? $avatarSex : null,
        'background_prompt' => normalizeText($backgroundPrompt),
        'seed' => $seed,
    ];
}

function callTryOnApi(array $params, array $tempFiles = []): array
{
    writeLog('INFO', 'Calling TryOn API', ['params' => $params]);

    $client = new TryOnDiffusionClient(Config::apiUrl(), Config::apiKey());
    $result = $client->tryOnFile($params);

    cleanupTempFiles($tempFiles);

    writeLog('INFO', 'API response', [
        'status_code' => $result['status_code'],
        'has_image' => $result['image_bytes'] !== null
    ]);

    if ($result['status_code'] !== 200 || $result['image_bytes'] === null) {
        writeLog('ERROR', 'TryOn API failed', [
            'status_code' => $result['status_code'],
            'error_details' => $result['error_details'] ?? null
        ]);

        return [
            'status' => 400,
            'body' => [
                'error' => $result['error_details'] ?? 'API request failed',
                'status_code' => $result['status_code'],
            ],
        ];
    }

    $filename = 'tryon_result_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.jpg';
    $outputPath = Config::resultsDir() . DIRECTORY_SEPARATOR . $filename;

    if (!ImageUtils::saveImageBytes($result['image_bytes'], $outputPath)) {
        writeLog('ERROR', 'Failed to save result image', ['path' => $outputPath]);
        return [
            'status' => 500,
            'body' => ['error' => 'Failed to save result image'],
        ];
    }

    writeLog('INFO', 'Result image saved', ['path' => $outputPath]);

    $url = baseUrl() . basePath() . '/results/' . $filename;

    return [
        'status' => 200,
        'body' => [
            'result_image' => $url,
            'seed' => $result['seed'],
        ],
    ];
}

function downloadToTemp(string $url): ?string
{
    $tempPath = tempnam(sys_get_temp_dir(), 'vton_');
    if ($tempPath === false) {
        writeLog('ERROR', 'Temp file creation failed');
        return null;
    }

    $fp = fopen($tempPath, 'wb');
    if ($fp === false) {
        writeLog('ERROR', 'Failed to open temp file');
        return null;
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_FILE => $fp,
        CURLOPT_USERAGENT => 'VTON-PHP/1.0',
    ]);

    curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    fclose($fp);

    if ($status < 200 || $status >= 300) {
        @unlink($tempPath);
        writeLog('ERROR', 'Download failed', [
            'url' => $url,
            'status' => $status
        ]);
        return null;
    }

    writeLog('INFO', 'Image downloaded', [
        'url' => $url,
        'temp_path' => $tempPath
    ]);

    return $tempPath;
}

function trackJpeg(string $path, array &$tempFiles): string
{
    $jpegPath = ImageUtils::ensureJpeg($path);
    if ($jpegPath !== $path) {
        $tempFiles[] = $jpegPath;
    }
    return $jpegPath;
}

function cleanupTempFiles(array $files): void
{
    foreach ($files as $file) {
        if (is_string($file) && is_file($file)) {
            @unlink($file);
        }
    }
}

function normalizeText(?string $value): ?string
{
    if ($value === null) return null;
    $trimmed = trim($value);
    return $trimmed === '' ? null : $trimmed;
}

function respondJson(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

/* =========================
   Logger
========================= */
function writeLog(string $level, string $message, array $context = []): void
{
    $logDir = __DIR__ . '/logs';
    if (!is_dir($logDir)) {
        mkdir($logDir, 0755, true);
    }

    $logFile = $logDir . '/app.log';

    $timestamp = date('Y-m-d H:i:s');
    $contextStr = !empty($context) ? json_encode($context, JSON_UNESCAPED_SLASHES) : '';

    $line = "[{$timestamp}] [{$level}] {$message} {$contextStr}" . PHP_EOL;

    file_put_contents($logFile, $line, FILE_APPEND);
}

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

function basePath(): string
{
    $basePath = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return $basePath === '/' ? '' : $basePath;
}