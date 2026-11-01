<?php

declare(strict_types=1);

/**
 * Standalone virtual try-on API endpoint.
 *
 * ENGINE: RunPod Serverless "FASHN VTON 1.5" (src/RunpodVtonClient.php) —
 * a self-hosted model on RunPod's own GPUs, unrelated to Fashn.ai's hosted
 * API. Submits to the RunPod runsync endpoint; on a cold worker that
 * returns IN_QUEUE/IN_PROGRESS before the job finishes, so the client polls
 * /status/{id} until COMPLETED, then the result image is decoded here.
 * This is the only engine — Fashn.ai has been fully retired from this app.
 *
 * ── Request ─────────────────────────────────────────────────────────────
 * POST multipart/form-data:
 *   model_image         (file, required)  — photo of the person
 *   garment_image       (file, required)  — photo of the garment/tee to try on
 *   category            (optional)   — 'tops' | 'bottoms' | 'one-pieces' | 'saree' (default 'tops')
 *   garment_photo_type  (optional)   — 'model' | 'flat-lay' (default 'model')
 *   prompt              (optional)   — free-text hint, default ''
 *   num_samples         (optional)   — default 1
 *   num_timesteps       (optional)   — default 30
 *   guidance_scale      (optional)   — default 1.5
 *   segmentation_free   (optional)   — default true
 *   seed                (optional)   — default 42
 *
 * Example:
 *   curl -X POST https://your-host/standalone-tryon.php \
 *     -F "model_image=@person.jpg" \
 *     -F "garment_image=@tee.jpg"
 *
 * ── Response ────────────────────────────────────────────────────────────
 * 200 JSON: { "result_image": "data:image/jpeg;base64,...", "result_url": "https://.../results/xxx.jpg" }
 * 4xx/5xx JSON: { "error": "..." }
 *
 * ── Config ──────────────────────────────────────────────────────────────
 * Reads RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID
 * from a .env file next to this script (same simple
 * parser used elsewhere in this project), or from real server environment
 * variables — set whichever you prefer.
 *   RUNPOD_API_KEY      required — https://runpod.io
 *   RUNPOD_ENDPOINT_ID  required — your serverless endpoint id
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respond(array $data, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(['error' => 'Only POST is supported'], 405);
}

// ── Load .env (same directory) if present ──────────────────────────────────
$envFile = __DIR__ . '/.env';
if (is_file($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
            continue;
        }
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v);
        if (getenv($k) === false) {
            putenv("{$k}={$v}");
            $_ENV[$k] = $v;
        }
    }
}

// ── RUNPOD ─────────────────────────
require_once __DIR__ . '/src/RunpodVtonClient.php';
use VTON\RunpodVtonClient;
$runpodApiKey     = (string)(getenv('RUNPOD_API_KEY') ?: '');
$runpodEndpointId = (string)(getenv('RUNPOD_ENDPOINT_ID') ?: '');
if ($runpodApiKey === '' || $runpodEndpointId === '') {
    respond(['error' => 'Server not configured: set RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID in .env or as environment variables'], 500);
}


// RunPod generation (incl. cold worker queue time) can take up to ~2 minutes.
@set_time_limit(150);

// ── Helpers ──────────────────────────────────────────────────────────────

function uploadError(?array $file): ?string
{
    if (!is_array($file)) {
        return 'file is required';
    }
    $code = $file['error'] ?? UPLOAD_ERR_NO_FILE;
    return match ($code) {
        UPLOAD_ERR_OK => is_uploaded_file($file['tmp_name'] ?? '') ? null : 'file upload failed',
        UPLOAD_ERR_NO_FILE => 'file is required',
        UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'file is too large',
        default => 'file upload failed (error code ' . $code . ')',
    };
}

function fileToBase64Uri(string $tmpPath): ?string
{
    $bytes = @file_get_contents($tmpPath);
    if ($bytes === false || $bytes === '') {
        return null;
    }
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime  = $finfo->buffer($bytes) ?: 'image/jpeg';
    if (!str_starts_with($mime, 'image/')) {
        return null;
    }
    return 'data:' . $mime . ';base64,' . base64_encode($bytes);
}

// ── Read uploaded files ──────────────────────────────────────────────────
$modelFile   = $_FILES['model_image']   ?? null;
$garmentFile = $_FILES['garment_image'] ?? null;

$modelErr = uploadError($modelFile);
if ($modelErr !== null) {
    respond(['error' => "model_image: {$modelErr}"], 400);
}
$garmentErr = uploadError($garmentFile);
if ($garmentErr !== null) {
    respond(['error' => "garment_image: {$garmentErr}"], 400);
}

$category = trim((string)($_POST['category'] ?? 'auto'));
if (!in_array($category, ['auto', 'tops', 'bottoms', 'one-pieces', 'saree'], true)) {
    $category = 'auto';
}
$photoType = trim((string)($_POST['garment_photo_type'] ?? ''));
if (!in_array($photoType, ['auto', 'flat-lay', 'model'], true)) {
    $photoType = '';
}
$seed             = ($_POST['seed'] ?? '') !== '' ? (int)$_POST['seed'] : -1;
$prompt           = trim((string)($_POST['prompt'] ?? ''));
$numSamples       = max(1, min(4, (int)($_POST['num_samples'] ?? 1)));
$numTimesteps     = max(1, min(100, (int)($_POST['num_timesteps'] ?? 30)));
$guidanceScale    = (float)($_POST['guidance_scale'] ?? 1.5);
$segmentationFree = !isset($_POST['segmentation_free']) || $_POST['segmentation_free'] !== '0';

$modelUri   = fileToBase64Uri($modelFile['tmp_name']);
$garmentUri = fileToBase64Uri($garmentFile['tmp_name']);

if ($modelUri === null) {
    respond(['error' => 'model_image could not be read as an image'], 400);
}
if ($garmentUri === null) {
    respond(['error' => 'garment_image could not be read as an image'], 400);
}

// ── Run the try-on (submit + poll until complete) ───────────────────────

// ── RUNPOD ─────────────────────────
$client = new RunpodVtonClient($runpodApiKey, $runpodEndpointId);
$params = [
    'person_image'      => $modelUri,
    'garment_image'     => $garmentUri,
    // RunPod's handler has no 'auto' category — default to 'tops'.
    'category'          => $category !== 'auto' ? $category : 'tops',
    'garment_photo_type' => $photoType !== '' && $photoType !== 'auto' ? $photoType : 'model',
    'prompt'            => $prompt,
    'num_samples'       => $numSamples,
    'num_timesteps'     => $numTimesteps,
    'guidance_scale'    => $guidanceScale,
    'segmentation_free' => $segmentationFree,
];
if ($seed >= 0) {
    $params['seed'] = $seed;
}
$runpodResult = $client->tryOn($params);
$result = [
    'status_code'   => $runpodResult['status_code'],
    'image_bytes'   => ($runpodResult['status_code'] === 200 && !empty($runpodResult['images']))
        ? base64_decode($runpodResult['images'][0])
        : null,
    'error_details' => $runpodResult['error_details'],
];


if ($result['status_code'] !== 200 || $result['image_bytes'] === null) {
    $statusCode = match ($result['status_code']) {
        429 => 503,
        408 => 504,
        default => 400,
    };
    respond([
        'error'       => $result['error_details'] ?? 'Try-on generation failed',
        'status_code' => $result['status_code'],
    ], $statusCode);
}

// ── Save result + respond ────────────────────────────────────────────────
$resultsDir = __DIR__ . '/results';
if (!is_dir($resultsDir)) {
    @mkdir($resultsDir, 0755, true);
}
$filename   = 'tryon_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.jpg';
$outputPath = $resultsDir . DIRECTORY_SEPARATOR . $filename;
file_put_contents($outputPath, $result['image_bytes']);

$scheme    = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host      = $_SERVER['HTTP_HOST'] ?? 'localhost';
$dir       = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
$resultUrl = "{$scheme}://{$host}{$dir}/results/{$filename}";

respond([
    'result_image' => 'data:image/jpeg;base64,' . base64_encode($result['image_bytes']),
    'result_url'   => $resultUrl,
]);
