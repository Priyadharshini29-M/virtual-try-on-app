<?php

declare(strict_types=1);

require_once __DIR__ . '/src/Config.php';
require_once __DIR__ . '/src/ImageUtils.php';
require_once __DIR__ . '/src/TryOnDiffusionClient.php';

use VTON\Config;
use VTON\ImageUtils;
use VTON\TryOnDiffusionClient;

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$path = rtrim($path ?? '/', '/');
$basePath = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
if ($basePath === '/') {
    $basePath = '';
}
if ($basePath !== '' && str_starts_with($path, $basePath)) {
    $path = substr($path, strlen($basePath));
    $path = $path === '' ? '/' : $path;
}
if ($path === '') {
    $path = '/';
}

if ($path === '/health') {
    respondJson(['status' => 'healthy']);
}

if ($path === '/process') {
    handleProcess();
}

if ($path === '/api/process') {
    handleApiProcess();
}

if ($path !== '/') {
    http_response_code(404);
    echo 'Not Found';
    exit;
}

renderPage();

function handleProcess(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'GET') {
        $result = processUrlRequest();
        respondJson($result['body'], $result['status']);
    }

    if ($method === 'POST') {
        $wantsHtml = wantsHtml();
        $result = processUploadRequest();

        if ($wantsHtml) {
            renderPage($result);
            return;
        }

        respondJson($result['body'], $result['status']);
    }

    respondJson(['error' => 'Method not allowed'], 405);
}

function handleApiProcess(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'GET') {
        $result = processUrlRequest();
        respondJson($result['body'], $result['status']);
    }

    if ($method === 'POST') {
        $result = processUploadRequest();
        respondJson($result['body'], $result['status']);
    }

    respondJson(['error' => 'Method not allowed'], 405);
}

function processUrlRequest(): array
{
    $clothingUrl = trim((string)($_GET['clothing_image'] ?? ''));
    $avatarUrl = trim((string)($_GET['avatar_image'] ?? ''));

    if ($clothingUrl === '' || $avatarUrl === '') {
        return [
            'status' => 400,
            'body' => ['error' => 'clothing_image and avatar_image are required'],
        ];
    }

    $payload = buildPayloadFromUrls($clothingUrl, $avatarUrl);

    if (isset($payload['error'])) {
        return [
            'status' => 400,
            'body' => ['error' => $payload['error']],
        ];
    }

    return callTryOnApi($payload['params'], $payload['temp_files']);
}

function processUploadRequest(): array
{
    if (empty($_FILES['clothing_image']['tmp_name']) || empty($_FILES['avatar_image']['tmp_name'])) {
        return [
            'status' => 400,
            'body' => ['error' => 'clothing_image and avatar_image are required'],
        ];
    }

    $tempFiles = [];
    $clothingPath = trackJpeg($_FILES['clothing_image']['tmp_name'], $tempFiles);
    $avatarPath = trackJpeg($_FILES['avatar_image']['tmp_name'], $tempFiles);

    $backgroundPath = null;
    if (!empty($_FILES['background_image']['tmp_name'])) {
        $backgroundPath = trackJpeg($_FILES['background_image']['tmp_name'], $tempFiles);
    }

    $params = buildParams(
        $clothingPath,
        $avatarPath,
        $backgroundPath,
        $_POST['clothing_prompt'] ?? null,
        $_POST['avatar_prompt'] ?? null,
        $_POST['avatar_sex'] ?? null,
        $_POST['background_prompt'] ?? null,
        isset($_POST['seed']) ? (int)$_POST['seed'] : -1
    );

    return callTryOnApi($params, $tempFiles);
}

function buildPayloadFromUrls(string $clothingUrl, string $avatarUrl): array
{
    $tempFiles = [];

    $clothingPath = downloadToTemp($clothingUrl);
    if ($clothingPath === null) {
        return ['error' => 'Failed to download clothing_image'];
    }
    $tempFiles[] = $clothingPath;

    $avatarPath = downloadToTemp($avatarUrl);
    if ($avatarPath === null) {
        cleanupTempFiles($tempFiles);
        return ['error' => 'Failed to download avatar_image'];
    }
    $tempFiles[] = $avatarPath;

    $clothingPath = trackJpeg($clothingPath, $tempFiles);
    $avatarPath = trackJpeg($avatarPath, $tempFiles);

    $backgroundPath = null;
    if (!empty($_GET['background_image'])) {
        $bgPath = downloadToTemp((string)$_GET['background_image']);
        if ($bgPath === null) {
            cleanupTempFiles($tempFiles);
            return ['error' => 'Failed to download background_image'];
        }
        $tempFiles[] = $bgPath;
        $backgroundPath = trackJpeg($bgPath, $tempFiles);
    }

    $params = buildParams(
        $clothingPath,
        $avatarPath,
        $backgroundPath,
        $_GET['clothing_prompt'] ?? null,
        $_GET['avatar_prompt'] ?? null,
        $_GET['avatar_sex'] ?? null,
        $_GET['background_prompt'] ?? null,
        isset($_GET['seed']) ? (int)$_GET['seed'] : -1
    );

    return [
        'params' => $params,
        'temp_files' => $tempFiles,
    ];
}

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
    $client = new TryOnDiffusionClient(Config::apiUrl(), Config::apiKey());
    $result = $client->tryOnFile($params);

    cleanupTempFiles($tempFiles);

    if ($result['status_code'] !== 200 || $result['image_bytes'] === null) {
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
        return [
            'status' => 500,
            'body' => ['error' => 'Failed to save result image'],
        ];
    }

    $url = baseUrl() . basePath() . '/results/' . $filename;

    return [
        'status' => 200,
        'body' => [
            'result_image' => $url,
            'seed' => $result['seed'],
        ],
        'html' => [
            'result_image' => $url,
            'seed' => $result['seed'],
        ],
    ];
}

function downloadToTemp(string $url): ?string
{
    $tempPath = tempnam(sys_get_temp_dir(), 'vton_');
    if ($tempPath === false) {
        return null;
    }

    $fp = fopen($tempPath, 'wb');
    if ($fp === false) {
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
        return null;
    }

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
    if ($value === null) {
        return null;
    }

    $trimmed = trim($value);
    return $trimmed === '' ? null : $trimmed;
}

function wantsHtml(): bool
{
    if (isset($_POST['format']) && $_POST['format'] === 'html') {
        return true;
    }

    $accept = $_SERVER['HTTP_ACCEPT'] ?? '';
    return str_contains($accept, 'text/html');
}

function respondJson(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
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

function renderPage(?array $result = null): void
{
    $resultImage = $result['body']['result_image'] ?? null;
    $seed = $result['body']['seed'] ?? null;
    $error = $result['body']['error'] ?? null;
    $statusCode = $result['body']['status_code'] ?? null;

    $html = '<!doctype html>';
    $html .= '<html lang="en">';
    $html .= '<head>';
    $html .= '<meta charset="utf-8" />';
    $html .= '<meta name="viewport" content="width=device-width, initial-scale=1" />';
    $html .= '<title>Virtual Try-On </title>';
    $cssHref = basePath() . '/assets/style.css';
    $html .= '<link rel="stylesheet" href="' . htmlspecialchars($cssHref) . '" />';
    $html .= '</head>';
    $html .= '<body>';
    $html .= '<div class="container">';
    $html .= '<div class="header">';
    $html .= '<img src="https://digifyce.com/static/img/wlogo.png" alt="Digifyce" />';
    $html .= '<h1>Virtual Try-On </h1>';
    $html .= '</div>';

    $formAction = basePath() . '/process';
    $html .= '<form class="grid" action="' . htmlspecialchars($formAction) . '" method="post" enctype="multipart/form-data">';
    $html .= '<input type="hidden" name="format" value="html" />';

    $html .= '<div class="card">';
    $html .= '<h2>Product Images</h2>';
    $html .= '<div class="label">Clothing Image</div>';
    $html .= '<input type="file" name="clothing_image" accept="image/*" required />';
    $html .= '<div class="label">Clothing Prompt</div>';
    $html .= '<textarea name="clothing_prompt" placeholder="a sheer blue sleeveless mini dress"></textarea>';
    $html .= '</div>';

    $html .= '<div class="card">';
    $html .= '<h2>Your Image</h2>';
    $html .= '<div class="label">Avatar Image</div>';
    $html .= '<input type="file" name="avatar_image" accept="image/*" required />';
    $html .= '<div class="label">Avatar Prompt</div>';
    $html .= '<textarea name="avatar_prompt" placeholder="a beautiful blond girl with long hair"></textarea>';
    $html .= '<div class="label">Avatar Sex</div>';
    $html .= '<select name="avatar_sex">';
    $html .= '<option value="">Auto</option>';
    $html .= '<option value="male">Male</option>';
    $html .= '<option value="female">Female</option>';
    $html .= '</select>';
    $html .= '</div>';

    $html .= '<div class="card">';
    $html .= '<h2>Background</h2>';
    $html .= '<div class="label">Background Image (optional)</div>';
    $html .= '<input type="file" name="background_image" accept="image/*" />';
    $html .= '<div class="label">Background Prompt</div>';
    $html .= '<textarea name="background_prompt" placeholder="in an autumn park"></textarea>';
    $html .= '</div>';

    $html .= '<div class="card">';
    $html .= '<h2>Generation</h2>';
    $html .= '<div class="label">Seed</div>';
    $html .= '<input type="number" name="seed" value="-1" />';
    $html .= '<button class="button" type="submit">Generate Try-On</button>';
    $html .= '</div>';

    $html .= '</form>';

    $html .= '<div class="card result">';
    $html .= '<h2>Result</h2>';

    if ($error !== null) {
        $message = $error;
        if ($statusCode !== null) {
            $message .= ' (HTTP ' . $statusCode . ')';
        }
        $html .= '<div class="alert">' . htmlspecialchars($message) . '</div>';
    }

    if ($resultImage !== null) {
        $html .= '<img src="' . htmlspecialchars($resultImage) . '" alt="Generated" />';
        if ($seed !== null) {
            $html .= '<p class="footer">Seed: ' . htmlspecialchars((string)$seed) . '</p>';
        }
    } else {
        $html .= '<p class="footer">Upload images and generate a result.</p>';
    }

    $html .= '</div>';
    $html .= '<p class="footer">API endpoints: /health, /process (UI), /api/process (JSON)</p>';
    $html .= '</div>';
    $html .= '</body>';
    $html .= '</html>';

    echo $html;
    exit;
}
