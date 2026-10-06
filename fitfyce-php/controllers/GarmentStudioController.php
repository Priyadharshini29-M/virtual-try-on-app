<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\GarmentStudioRepo;
use TryFit\Db\MerchantRepo;
use VTON\ImageUtils;
use VTON\RunpodVtonClient;
use VTON\SareeRouting;

/**
 * GarmentStudioController — merchant-facing multi-image try-on generation.
 *
 * Accepts front + back garment images (required) plus up to 3 optional detail
 * images, then generates a photorealistic product image using a pre-stored
 * model image selected by the merchant from the 14-model registry.
 *
 * Model images must be placed at:
 *   {php_root}/models/{gender}/{model_key}.jpg
 *
 * Routes (see router.php):
 *   POST /studio/generate       → generate()
 *   GET  /studio/models         → getModels()
 *   GET  /studio/session        → getSession()
 *   GET  /studio/sessions       → listSessions()
 *   POST /studio/save-gallery   → saveGallery()
 */
class GarmentStudioController
{
    // ── Model registry ─────────────────────────────────────────────────────────

    private const MODELS = [
        // Female
        'female_child_5_8'    => ['label' => 'Female Child (5–8 yrs)',     'gender' => 'female', 'fashn_category_hint' => 'kid'],
        'female_child_9_12'   => ['label' => 'Female Child (9–12 yrs)',    'gender' => 'female', 'fashn_category_hint' => 'kid'],
        'female_teen_13_17'   => ['label' => 'Female Teen (13–17 yrs)',    'gender' => 'female', 'fashn_category_hint' => 'teen'],
        'female_young_adult'  => ['label' => 'Female Young Adult (18–25)', 'gender' => 'female', 'fashn_category_hint' => 'adult'],
        'female_adult'        => ['label' => 'Female Adult (26–35)',       'gender' => 'female', 'fashn_category_hint' => 'adult'],
        'female_mature_adult' => ['label' => 'Female Mature (36–50)',      'gender' => 'female', 'fashn_category_hint' => 'adult'],
        'female_plus_size'    => ['label' => 'Female Plus Size',           'gender' => 'female', 'fashn_category_hint' => 'adult'],
        // Male
        'male_child_5_8'      => ['label' => 'Male Child (5–8 yrs)',       'gender' => 'male',   'fashn_category_hint' => 'kid'],
        'male_child_9_12'     => ['label' => 'Male Child (9–12 yrs)',      'gender' => 'male',   'fashn_category_hint' => 'kid'],
        'male_teen_13_17'     => ['label' => 'Male Teen (13–17 yrs)',      'gender' => 'male',   'fashn_category_hint' => 'teen'],
        'male_young_adult'    => ['label' => 'Male Young Adult (18–25)',   'gender' => 'male',   'fashn_category_hint' => 'adult'],
        'male_adult'          => ['label' => 'Male Adult (26–35)',         'gender' => 'male',   'fashn_category_hint' => 'adult'],
        'male_mature_adult'   => ['label' => 'Male Mature (36–50)',        'gender' => 'male',   'fashn_category_hint' => 'adult'],
        'male_plus_size'      => ['label' => 'Male Plus Size',             'gender' => 'male',   'fashn_category_hint' => 'adult'],
    ];

    // ── Public actions ─────────────────────────────────────────────────────────

    public function generate(): void
    {
        @set_time_limit(120);

        // Auth
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }

        $payload = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($payload)) {
            respondJson(['error' => 'Invalid JSON body'], 400);
            return;
        }

        // Required fields
        $frontUrl      = trim((string) ($payload['front_image_url'] ?? ''));
        $backUrl       = trim((string) ($payload['back_image_url']  ?? ''));
        $modelKey      = trim((string) ($payload['model_key']       ?? ''));
        $modelImageUrl = trim((string) ($payload['model_image_url'] ?? ''));

        if ($frontUrl === '') {
            respondJson(['error' => 'front_image_url is required'], 400);
            return;
        }
        // back_image_url is optional — single-image workflows (flat-lay,
        // mannequin, accessories) only ever supply a front photo. Compositing
        // it against a duplicate of the front image would feed the try-on
        // model a labelled, shrunk collage instead of the clean garment photo.

        // model_key selects one of the 14 built-in registry models; a merchant
        // can instead pass model_image_url for any photo directly — unlimited,
        // not constrained by the registry's fixed 7-per-gender slots.
        $modelInfo = self::MODELS[$modelKey] ?? null;
        if ($modelInfo === null && $modelImageUrl === '') {
            respondJson([
                'error'      => 'Either model_key or model_image_url is required',
                'valid_keys' => array_keys(self::MODELS),
            ], 400);
            return;
        }

        $gender = $modelInfo['gender']
            ?? (in_array($payload['model_gender'] ?? null, ['male', 'female'], true) ? $payload['model_gender'] : 'female');
        $modelLabel  = $modelInfo['label'] ?? 'Custom Model';
        $detail1     = trim((string) ($payload['detail_image_1_url'] ?? '')) ?: null;
        $detail2     = trim((string) ($payload['detail_image_2_url'] ?? '')) ?: null;
        $detail3     = trim((string) ($payload['detail_image_3_url'] ?? '')) ?: null;
        $garmentType = $this->resolveGarmentType($payload);
        $customPrompt = trim((string) ($payload['clothing_prompt'] ?? ''));

        // Tell RunPod's model how to interpret the garment reference image.
        // This matters most for 'flat-lay' — an unworn, flat-photographed
        // garment (e.g. a saree laid on a table) needs the model to infer
        // draping itself; without this hint it tends to fall back to a
        // generic silhouette instead of the actual garment shape (e.g.
        // rendering a saree as a plain dress).
        $workflowType = trim((string) ($payload['workflow_type'] ?? ''));

        // Sarees go to the hosted Fashn.ai API; everything else to RunPod.
        // The wizard's explicit product type decides when present (so a gown
        // whose notes mention "saree-style" isn't misrouted); free-text
        // keyword matching is the fallback for callers that don't send it.
        // Accessories (watch, necklace…) go through SareeRouting::submitAccessory(),
        // which rides them on the same FASHN VTON RunPod endpoint as a 'tops'
        // garment_image plus an explicit placement prompt. Never through Fashn.
        // A product title that says saree always counts, whatever type was picked.
        $productType  = trim((string) ($payload['product_type'] ?? ''));
        $productTitle = (string) ($payload['product_title'] ?? '');
        $isAccessory  = $workflowType === 'accessories';
        $useFashn     = !$isAccessory && (
            SareeRouting::shouldUseFashn($productType, $productTitle)
            || ($productType === '' && SareeRouting::shouldUseFashn($customPrompt))
        );
        $accessoryPrompt = $isAccessory
            ? SareeRouting::buildAccessoryPrompt(
                (string) ($payload['accessory_category'] ?? ''),
                (string) ($payload['accessory_placement'] ?? '')
            )
            : null;

        $garmentPhotoType = match ($workflowType) {
            'flat-lay' => 'flat-lay',
            default    => 'auto',
        };

        // The RunPod try-on model only knows pre-stitched Western silhouettes
        // (tops/bottoms/one-pieces) — it has no concept of draping unstitched
        // fabric, so a flat saree/lehenga photo gets painted onto a generic
        // dress shape instead of an actual drape. Route these through
        // FlatLayConverter first to get a photorealistic worn reference.
        // Never for Fashn sarees: FLUX Kontext re-imagines the saree into a
        // generated "worn" photo (often losing the real colour, pattern or
        // drape), and tryon-max drapes the raw flat-lay photo correctly itself.
        $useFlatLayConversion = $garmentType === 'full'
            && $workflowType === 'flat-lay'
            && !$useFashn
            && AppConfig::useFlatLayConverter();
        $flatLayHint = $this->inferFlatLayGarmentHint($customPrompt);

        $tempFiles = [];

        // Resolve model image: a registry model_key must exist on server as a
        // file; an ad-hoc model_image_url is downloaded like any other input.
        if ($modelInfo !== null) {
            $modelImagePath = $this->resolveModelImagePath($modelKey, $gender);
            if ($modelImagePath === null) {
                $modelsDir = $this->modelsBaseDir() . "/{$gender}/{$modelKey}.jpg";
                respondJson([
                    'error'           => "Model image for '{$modelKey}' not found. Upload a JPEG to: {$modelsDir}",
                    'model_key'       => $modelKey,
                    'model_label'     => $modelLabel,
                    'expected_path'   => $modelsDir,
                ], 422);
                return;
            }
        } else {
            $modelImagePath = $this->inputToTempFile($modelImageUrl, $tempFiles);
            if ($modelImagePath === null) {
                respondJson(['error' => 'Failed to load model_image_url'], 400);
                return;
            }
        }

        // Create DB session
        $repo      = new GarmentStudioRepo();
        $sessionId = $repo->create([
            'merchant_id'        => (int) $merchant['id'],
            'product_id'         => isset($payload['product_id'])         ? (int) $payload['product_id']         : null,
            'shopify_variant_id' => isset($payload['shopify_variant_id']) ? (int) $payload['shopify_variant_id'] : null,
            'front_image_url'    => $frontUrl,
            'back_image_url'     => $backUrl,
            'detail_image_1_url' => $detail1,
            'detail_image_2_url' => $detail2,
            'detail_image_3_url' => $detail3,
            'gender'             => $gender,
            'model_key'          => $modelKey,
            'garment_type'       => $garmentType,
            'clothing_prompt'    => $customPrompt ?: null,
        ]);
        $repo->updateStatus($sessionId, 'processing', ['api_request_at' => date('Y-m-d H:i:s')]);

        try {
            $result = $this->prepareAndSubmit(
                $frontUrl, $backUrl, $detail1, $detail2, $detail3,
                $modelImagePath, $garmentType, $garmentPhotoType, $tempFiles,
                $useFlatLayConversion, $flatLayHint, $useFashn, $accessoryPrompt
            );

            // RunPod's single worker (workersMax pinned to 1 for cost control)
            // can still be finishing a prior job when this one arrives — most
            // likely here because the flat-lay path's extra FAL.ai conversion
            // step keeps the worker occupied longer than other workflows.
            // That's a transient condition, not a real outage, so retry once
            // after a short wait instead of failing the merchant's request outright.
            if ($result['status_code'] === 429) {
                sleep(5);
                $result = $this->prepareAndSubmit(
                    $frontUrl, $backUrl, $detail1, $detail2, $detail3,
                    $modelImagePath, $garmentType, $garmentPhotoType, $tempFiles,
                    $useFlatLayConversion, $flatLayHint, $useFashn, $accessoryPrompt
                );
            }
        } catch (\Throwable $e) {
            $this->cleanupTempFiles($tempFiles);
            writeLog('ERROR', 'GarmentStudioController generation exception', [
                'message' => $e->getMessage(),
                'file'    => $e->getFile(),
                'line'    => $e->getLine(),
            ]);
            $repo->updateStatus($sessionId, 'failed', ['error_message' => $e->getMessage()]);
            respondJson(['error' => 'Generation failed: ' . $e->getMessage(), 'session_id' => $sessionId], 500);
            return;
        }

        $this->cleanupTempFiles($tempFiles);

        if ($result['status_code'] !== 200 || empty($result['prediction_id'])) {
            $rawError = $result['error_details'] ?? 'Try-on API request failed';
            writeLog('WARNING', 'GarmentStudioController: submission failure', [
                'status_code'   => $result['status_code'],
                'error_details' => $rawError,
                'model_key'     => $modelKey,
            ]);
            $repo->updateStatus($sessionId, 'failed', ['error_message' => $rawError]);
            $httpStatus = match (true) {
                $result['status_code'] === 429 => 503,
                $result['status_code'] === 503 => 503,
                default                        => 400,
            };
            respondJson([
                'error'      => $this->userFriendlyError($result['status_code'], $rawError, $useFashn),
                'session_id' => $sessionId,
                'raw_error'  => $rawError,
            ], $httpStatus);
            return;
        }

        // Submission succeeded — the actual generation is still running on
        // RunPod's side. Store the job ID and return immediately; the
        // client polls /studio/generate-status until it completes or fails.
        $repo->updateStatus($sessionId, 'processing', ['fashn_prediction_id' => $result['prediction_id']]);

        respondJson([
            'session_id'   => $sessionId,
            'status'       => 'processing',
            'model_key'    => $modelKey,
            'model_label'  => $modelLabel,
            'garment_type' => $garmentType,
        ]);
    }

    /**
     * GET /studio/generate-status?session_id=...
     *
     * Polled by the client every few seconds after generate() returns
     * 'processing'. Checks RunPod exactly once per call (no internal retry
     * loop) so this request always completes quickly regardless of host
     * timeout limits. Idempotent once resolved — a session already
     * completed/failed just returns its stored result without re-checking RunPod.
     */
    public function checkGenerationStatus(): void
    {
        $sessionId = trim((string) ($_GET['session_id'] ?? ''));
        if ($sessionId === '') {
            respondJson(['error' => 'session_id is required'], 400);
            return;
        }

        $repo = new GarmentStudioRepo();
        $row  = $repo->findById($sessionId);
        if ($row === null) {
            respondJson(['error' => 'Session not found'], 404);
            return;
        }

        if ($row['status'] === 'completed') {
            respondJson(['status' => 'completed', 'session_id' => $sessionId, 'result_image' => $row['result_image_url']]);
            return;
        }
        if ($row['status'] === 'failed') {
            respondJson(['status' => 'failed', 'session_id' => $sessionId, 'error' => $row['error_message'], 'raw_error' => $row['error_message']]);
            return;
        }

        $predictionId = trim((string) ($row['fashn_prediction_id'] ?? ''));
        if ($predictionId === '') {
            respondJson(['status' => 'processing', 'session_id' => $sessionId]);
            return;
        }

        // Give up after 3 minutes of processing — RunPod's own generation is
        // typically done in well under a minute; this guards against a
        // job that never resolves (e.g. stuck worker on RunPod's side).
        $requestedAt = strtotime((string) ($row['api_request_at'] ?? ''));
        if ($requestedAt !== false && (time() - $requestedAt) > 180) {
            $repo->updateStatus($sessionId, 'failed', ['error_message' => 'Generation timed out. Please try again.']);
            respondJson(['status' => 'failed', 'session_id' => $sessionId, 'error' => 'Generation timed out. Please try again.']);
            return;
        }

        // Engine (Fashn for sarees, RunPod otherwise) is read from the ID prefix.
        $check        = SareeRouting::checkStatus($predictionId);

        if ($check['job_status'] === 'processing' || $check['job_status'] === 'error') {
            respondJson(['status' => 'processing', 'session_id' => $sessionId]);
            return;
        }

        if ($check['job_status'] === 'failed') {
            $rawError = $check['error_details'] ?? 'Try-on API request failed';
            $repo->updateStatus($sessionId, 'failed', [
                'error_message'   => $rawError,
                'api_response_at' => date('Y-m-d H:i:s'),
            ]);
            respondJson([
                'status'     => 'failed',
                'session_id' => $sessionId,
                'error'      => $this->userFriendlyError(400, $rawError),
                'raw_error'  => $rawError,
            ]);
            return;
        }

        // Completed — save the result image and mark the session done.
        $resultsDir = AppConfig::resultsDir();
        if (!is_dir($resultsDir)) {
            @mkdir($resultsDir, 0755, true);
        }
        $filename   = 'studio_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.jpg';
        $outputPath = $resultsDir . DIRECTORY_SEPARATOR . $filename;

        if (!ImageUtils::saveImageBytes($check['image_bytes'], $outputPath)) {
            $repo->updateStatus($sessionId, 'failed', ['error_message' => 'Failed to save result image']);
            respondJson(['status' => 'failed', 'session_id' => $sessionId, 'error' => 'Failed to save result image']);
            return;
        }

        $resultUrl = baseUrl() . basePath() . '/results/' . $filename;
        $latencyMs = $requestedAt !== false ? (int) ((time() - $requestedAt) * 1000) : null;

        $repo->updateStatus($sessionId, 'completed', [
            'result_image_url' => $resultUrl,
            'api_response_at'  => date('Y-m-d H:i:s'),
            'api_latency_ms'   => $latencyMs,
        ]);

        respondJson(['status' => 'completed', 'session_id' => $sessionId, 'result_image' => $resultUrl]);
    }

    public function getModels(): void
    {
        $modelsDir = $this->modelsBaseDir();
        $list      = [];
        foreach (self::MODELS as $key => $info) {
            $relPath   = $info['gender'] . '/' . $key . '.jpg';
            $absPath   = $modelsDir . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relPath);
            $exists    = is_file($absPath);
            $list[$key] = [
                'key'          => $key,
                'label'        => $info['label'],
                'gender'       => $info['gender'],
                'image_exists' => $exists,
                'image_url'    => $exists ? (baseUrl() . basePath() . '/models/' . $relPath) : null,
                // Same photo can end up saved under more than one slot (e.g. a
                // merchant re-using one upload across brackets) — a content
                // hash lets the client dedupe those instead of comparing URLs,
                // which are always distinct per slot filename.
                'image_hash'   => $exists ? md5_file($absPath) : null,
            ];
        }
        respondJson(['models' => $list]);
    }

    public function getSession(): void
    {
        $sessionId = trim((string) ($_GET['session_id'] ?? ''));
        if ($sessionId === '') {
            respondJson(['error' => 'session_id is required'], 400);
            return;
        }
        $row = (new GarmentStudioRepo())->findById($sessionId);
        if ($row === null) {
            respondJson(['error' => 'Session not found'], 404);
            return;
        }
        respondJson($row);
    }

    public function listSessions(): void
    {
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }
        $limit  = min(50, max(1, (int) ($_GET['limit']  ?? 20)));
        $offset = max(0,          (int) ($_GET['offset'] ?? 0));
        $rows   = (new GarmentStudioRepo())->listByMerchant((int) $merchant['id'], $limit, $offset);
        respondJson(['sessions' => $rows]);
    }

    /**
     * GET /studio/setup-check
     * Returns the server-side readiness state for the Studio module.
     */
    public function setupCheck(): void
    {
        $modelsBase   = $this->modelsBaseDir();
        $baseExists   = is_dir($modelsBase);
        $baseWritable = $baseExists && is_writable($modelsBase);
        $gdAvailable  = function_exists('imagecreatefromstring');

        $uploaded = 0;
        foreach (self::MODELS as $key => $info) {
            $path = $modelsBase . DIRECTORY_SEPARATOR . $info['gender'] . DIRECTORY_SEPARATOR . $key . '.jpg';
            if (is_file($path)) $uploaded++;
        }

        $issues = [];
        if (!$baseExists) {
            $issues[] = 'models/ directory does not exist. Create it on the server: mkdir -p models && chmod 755 models';
        } elseif (!$baseWritable) {
            $issues[] = 'models/ directory exists but is not writable. Run: chmod -R 755 models/';
        }
        if (!$gdAvailable) {
            $issues[] = 'PHP GD extension is not loaded. JPEG conversion will use file-copy fallback (still works for JPEG uploads).';
        }

        respondJson([
            'ok'             => $baseExists && $baseWritable,
            'models_dir'     => $modelsBase,
            'dir_exists'     => $baseExists,
            'dir_writable'   => $baseWritable,
            'gd_available'   => $gdAvailable,
            'uploaded_count' => $uploaded,
            'total_models'   => count(self::MODELS),
            'issues'         => $issues,
        ]);
    }

    public function saveGallery(): void
    {
        $payload = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($payload) || empty($payload['session_id'])) {
            respondJson(['error' => 'session_id is required'], 400);
            return;
        }
        (new GarmentStudioRepo())->markSavedToGallery((string) $payload['session_id']);
        respondJson(['ok' => true]);
    }

    /**
     * POST /studio/set-model-image
     *
     * Body: { "model_key": "female_adult", "image_url": "https://..." }
     *
     * Downloads the image from image_url (a PHP temp or R2 URL) and saves it
     * permanently to models/{gender}/{model_key}.jpg so it appears in the
     * model grid and is used for future generations.
     */
    public function setModelImage(): void
    {
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }

        $payload = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($payload)) {
            respondJson(['error' => 'Invalid JSON body'], 400);
            return;
        }

        $modelKey = trim((string) ($payload['model_key'] ?? ''));
        $imageUrl = trim((string) ($payload['image_url']  ?? ''));

        if (!isset(self::MODELS[$modelKey])) {
            respondJson([
                'error'      => 'Invalid model_key',
                'valid_keys' => array_keys(self::MODELS),
            ], 400);
            return;
        }
        if ($imageUrl === '') {
            respondJson(['error' => 'image_url is required'], 400);
            return;
        }

        $gender    = self::MODELS[$modelKey]['gender'];
        $modelsBase = $this->modelsBaseDir();
        $modelsDir  = $modelsBase . DIRECTORY_SEPARATOR . $gender;

        // Ensure the base models/ directory exists
        if (!is_dir($modelsBase)) {
            if (!@mkdir($modelsBase, 0755, true)) {
                respondJson([
                    'error' => 'Cannot create models/ directory. Run on the server: mkdir -p '
                               . basename($modelsBase) . ' && chmod 755 ' . basename($modelsBase),
                ], 500);
                return;
            }
        }

        // Ensure the gender sub-directory exists
        if (!is_dir($modelsDir)) {
            if (!@mkdir($modelsDir, 0755, true)) {
                respondJson([
                    'error' => "Cannot create models/{$gender}/ directory. Run on the server: "
                               . "mkdir -p models/{$gender} && chmod 755 models/{$gender}",
                ], 500);
                return;
            }
        }

        // Verify the directory is actually writable
        if (!is_writable($modelsDir)) {
            respondJson([
                'error' => "Directory models/{$gender}/ exists but is not writable. "
                           . "Run on the server: chmod -R 755 models/",
            ], 500);
            return;
        }

        $destPath = $modelsDir . DIRECTORY_SEPARATOR . $modelKey . '.jpg';

        // Download the image from the provided URL
        $tempPath = tempnam(sys_get_temp_dir(), 'model_');
        if ($tempPath === false) {
            respondJson(['error' => 'Failed to create temp file'], 500);
            return;
        }

        if (str_starts_with($imageUrl, '//')) $imageUrl = 'https:' . $imageUrl;

        $localFile = null;
        $parsedUrl = parse_url($imageUrl);
        if (isset($parsedUrl['path'])) {
            $urlPath = $parsedUrl['path'];
            $isLocal = false;
            $requestHost = isset($parsedUrl['host']) ? strtolower($parsedUrl['host']) : '';
            $myHost = isset($_SERVER['HTTP_HOST']) ? strtolower(explode(':', $_SERVER['HTTP_HOST'])[0]) : 'localhost';
            $baseUrlHost = strtolower(parse_url(baseUrl(), PHP_URL_HOST) ?? '');
            
            if ($requestHost === '' || $requestHost === $myHost || $requestHost === $baseUrlHost || $requestHost === '127.0.0.1') {
                $isLocal = true;
            }
            
            if ($isLocal) {
                $basePath = basePath();
                if ($basePath !== '' && str_starts_with($urlPath, $basePath)) {
                    $urlPath = substr($urlPath, strlen($basePath));
                }
                if (preg_match('#^/temp/([^/]+)$#', $urlPath, $m)) {
                    $filename = explode('?', $m[1])[0];
                    $candidate = AppConfig::tempDir() . DIRECTORY_SEPARATOR . $filename;
                    if (is_file($candidate)) {
                        $localFile = $candidate;
                    }
                } elseif (preg_match('#^/models/([^/]+)/([^/]+)$#', $urlPath, $m)) {
                    $genderVal = $m[1];
                    $filename = explode('?', $m[2])[0];
                    $candidate = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'models' . DIRECTORY_SEPARATOR . $genderVal . DIRECTORY_SEPARATOR . $filename;
                    if (is_file($candidate)) {
                        $localFile = $candidate;
                    }
                }
            }
        }

        if ($localFile !== null) {
            if (!@copy($localFile, $tempPath)) {
                @unlink($tempPath);
                respondJson(['error' => 'Failed to copy local temp file'], 500);
                return;
            }
        } else {
            $fp = fopen($tempPath, 'wb');
            if ($fp === false) {
                @unlink($tempPath);
                respondJson(['error' => 'Failed to open temp file'], 500);
                return;
            }
            $ch = curl_init($imageUrl);
            curl_setopt_array($ch, [
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_TIMEOUT        => 30,
                CURLOPT_FILE           => $fp,
                CURLOPT_USERAGENT      => 'TryFit-Studio/1.0',
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => false,
            ]);
            curl_exec($ch);
            $httpStatus = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            fclose($fp);

            if ($httpStatus < 200 || $httpStatus >= 300) {
                @unlink($tempPath);
                respondJson(['error' => "Failed to download image (HTTP {$httpStatus})"], 400);
                return;
            }
        }

        // Convert to JPEG (handles PNG, WebP, etc.) and save permanently
        $imgResource = @imagecreatefromstring((string) file_get_contents($tempPath));
        if ($imgResource !== false) {
            $saved = @imagejpeg($imgResource, $destPath, 90);
            imagedestroy($imgResource);
            if (!$saved) {
                @unlink($tempPath);
                respondJson(['error' => 'Failed to save model image as JPEG'], 500);
                return;
            }
        } else {
            // GD unavailable or unrecognized format — copy as-is
            if (!@copy($tempPath, $destPath)) {
                @unlink($tempPath);
                respondJson(['error' => 'Failed to save model image'], 500);
                return;
            }
        }
        @unlink($tempPath);

        $permanentUrl = baseUrl() . basePath() . '/models/' . $gender . '/' . $modelKey . '.jpg';

        respondJson([
            'ok'          => true,
            'model_key'   => $modelKey,
            'model_label' => self::MODELS[$modelKey]['label'],
            'gender'      => $gender,
            'image_url'   => $permanentUrl,
        ]);
    }

    /**
     * DELETE /studio/model-image
     *
     * Body: { "model_key": "female_adult" }
     * Removes the stored model image so the card reverts to the silhouette placeholder.
     */
    public function deleteModelImage(): void
    {
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }

        $payload  = json_decode((string) file_get_contents('php://input'), true);
        $modelKey = trim((string) ($payload['model_key'] ?? ''));

        if (!isset(self::MODELS[$modelKey])) {
            respondJson(['error' => 'Invalid model_key'], 400);
            return;
        }

        $gender = self::MODELS[$modelKey]['gender'];
        $path   = $this->modelsBaseDir() . DIRECTORY_SEPARATOR . $gender . DIRECTORY_SEPARATOR . $modelKey . '.jpg';

        if (is_file($path)) @unlink($path);

        respondJson(['ok' => true, 'model_key' => $modelKey]);
    }

    // ── Private: generation pipeline ──────────────────────────────────────────

    /**
     * Image prep + RunPod submission — deliberately does NOT wait for the
     * result. A single blocking HTTP request risks exceeding the host's
     * connection timeout (generation can take 10-60s+, longer on a cold
     * worker; this host hard-kills requests around ~25s regardless of PHP's
     * own execution-time limit). The caller stores the returned prediction_id
     * and polls it via checkGenerationStatus() instead.
     *
     * Key improvement: all uploaded garment images (front + back + up to 3
     * details) are composited into a single multi-view reference sheet before
     * being sent to the try-on model. This gives it the full 360° context of
     * the garment in one pass, dramatically improving:
     *   • Back-design fidelity (back neckline, embroidery, pleats, closures)
     *   • Detail accuracy (collar, sleeves, embroidery motifs, pocket shape)
     *   • Colour and pattern consistency across the entire garment
     *
     * @return array{status_code:int, prediction_id:?string, error_details:?string}
     */
    private function prepareAndSubmit(
        string  $frontUrl,
        string  $backUrl,
        ?string $detail1,
        ?string $detail2,
        ?string $detail3,
        string  $modelImagePath,
        string  $garmentType,
        string  $garmentPhotoType,
        array   &$tempFiles,
        bool    $useFlatLayConversion = false,
        string  $flatLayHint = 'default',
        bool    $useFashn = false,
        ?string $accessoryPrompt = null
    ): array {
        // ── Download & pre-process front image ───────────────────────────────
        $frontPath = $this->inputToTempFile($frontUrl, $tempFiles);
        if ($frontPath === null) {
            return ['status_code' => 400, 'prediction_id' => null,
                    'error_details' => 'Failed to load front_image_url'];
        }
        $frontPath = $this->trackJpeg($frontPath, $tempFiles);
        $frontPath = ImageUtils::ensureMinimumSize($frontPath, 768, 1024, $tempFiles);

        // ── Pre-process model image (portrait orientation preferred) ──────────
        $modelPath = $this->trackJpeg($modelImagePath, $tempFiles);
        $modelPath = ImageUtils::ensureMinimumSize($modelPath, 768, 1024, $tempFiles);

        // Accessories: model photo + accessory photo + placement prompt to
        // SareeRouting::submitAccessory(). No garment compositing logic here.
        if ($accessoryPrompt !== null) {
            return SareeRouting::submitAccessory([
                'person_image'    => ImageUtils::fileToBase64Uri($modelPath),
                'accessory_image' => ImageUtils::fileToBase64Uri($frontPath),
                'prompt'          => $accessoryPrompt,
            ]);
        }

        if (!$useFashn && !AppConfig::useRunpod()) {
            return [
                'status_code'   => 503,
                'prediction_id' => null,
                'error_details' => 'Try-on service is not configured. Add RUNPOD_API_KEY/RUNPOD_ENDPOINT_ID to .env.',
            ];
        }

        // Fashn takes a single clean garment photo, so skip the multi-view
        // front+back+detail composite for sarees.
        $garmentPath = $this->resolveGarmentImagePath(
            $frontUrl, $frontPath,
            $useFashn ? '' : $backUrl,
            $useFashn ? null : $detail1, $useFashn ? null : $detail2, $useFashn ? null : $detail3,
            $useFlatLayConversion, $flatLayHint, $garmentPhotoType, $tempFiles
        );

        if ($useFashn) {
            $fashnResult = SareeRouting::submitFashn([
                'person_image'       => ImageUtils::fileToBase64Uri($modelPath),
                'garment_image'      => ImageUtils::fileToBase64Uri($garmentPath),
                'garment_photo_type' => $garmentPhotoType,
            ]);
            if ($fashnResult['status_code'] === 200 && !empty($fashnResult['prediction_id'])) {
                return $fashnResult;
            }

            // Fashn failed (commonly: out of credits/billing) — fall back to
            // RunPod rather than failing outright. Deliberate quality
            // tradeoff: RunPod can't drape a saree correctly (renders it as
            // a generic dress shape instead of an actual drape — see
            // SareeRouting::shouldUseFashn()'s docblock), but a rougher
            // result beats none while Fashn billing is being topped up.
            // Remove this fallback once Fashn is reliably funded again.
            writeLog('WARNING', 'GarmentStudioController: Fashn failed, falling back to RunPod for saree', [
                'fashn_status_code' => $fashnResult['status_code'],
                'fashn_error'       => $fashnResult['error_details'] ?? null,
            ]);
            if (!AppConfig::useRunpod()) {
                return $fashnResult;
            }
            $fallbackClient = new RunpodVtonClient(AppConfig::runpodApiKey(), AppConfig::runpodEndpointId());
            return $fallbackClient->submitRun([
                'person_image'       => ImageUtils::fileToBase64Uri($modelPath),
                'garment_image'      => ImageUtils::fileToBase64Uri($garmentPath),
                'category'           => 'one-pieces',
                'garment_photo_type' => $garmentPhotoType !== 'auto' ? $garmentPhotoType : 'model',
            ]);
        }

        // 'saree' is listed in this RunPod endpoint's sample UI but is not
        // actually implemented in the deployed pipeline — passing it crashes
        // the worker (FASHN_LABELS_TO_IDS lookup returns None). Confirmed via
        // a live error trace; do not use it. 'one-pieces' is the only working
        // category for full-body garments including sarees/lehengas.
        $category = match ($garmentType) {
            'bottom' => 'bottoms',
            'full'   => 'one-pieces',
            default  => 'tops',
        };

        $runpodClient = new RunpodVtonClient(AppConfig::runpodApiKey(), AppConfig::runpodEndpointId());
        return $runpodClient->submitRun([
            'person_image'       => ImageUtils::fileToBase64Uri($modelPath),
            'garment_image'      => ImageUtils::fileToBase64Uri($garmentPath),
            'category'           => $category,
            'garment_photo_type' => $garmentPhotoType !== 'auto' ? $garmentPhotoType : 'model',
        ]);
    }

    /**
     * Resolves the single garment reference image sent to the try-on model:
     * either a FlatLayConverter worn-reference (saree/lehenga flat-lay), or the
     * multi-view front+back+detail composite, or just the front photo alone.
     */
    private function resolveGarmentImagePath(
        string  $frontUrl,
        string  $frontPath,
        string  $backUrl,
        ?string $detail1,
        ?string $detail2,
        ?string $detail3,
        bool    $useFlatLayConversion,
        string  $flatLayHint,
        string  &$garmentPhotoType,
        array   &$tempFiles
    ): string {
        // ── Flat-lay → worn-reference conversion (saree/lehenga/unstitched) ───
        // The try-on model has no concept of draping unstitched fabric — it
        // just paints the flat photo's pattern onto a generic dress silhouette.
        // Convert to a photorealistic worn reference first so it gets an
        // actual drape to transfer instead of flat fabric.
        if ($useFlatLayConversion) {
            require_once dirname(__DIR__) . '/src/FlatLayConverter.php';
            $converter   = new \VTON\FlatLayConverter(AppConfig::falApiKey(), AppConfig::tempDir());
            $wornRefPath = $converter->getWornReference($frontUrl, $flatLayHint, $tempFiles);
            if ($wornRefPath !== null) {
                $garmentPhotoType = 'model';
                return $wornRefPath;
            }
            writeLog('WARNING', 'FlatLayConverter failed, falling back to raw flat-lay image', [
                'hint' => $flatLayHint,
            ]);
        }

        // ── Download & pre-process back image ──────────────────────────────────
        $backPath = null;
        if ($backUrl !== '') {
            $bp = $this->inputToTempFile($backUrl, $tempFiles);
            if ($bp !== null) {
                $backPath = $this->trackJpeg($bp, $tempFiles);
            }
        }

        // ── Download & pre-process detail images ───────────────────────────────
        $detailPaths = [];
        foreach (array_filter([$detail1, $detail2, $detail3]) as $url) {
            $dp = $this->inputToTempFile($url, $tempFiles);
            if ($dp !== null) {
                $detailPaths[] = $this->trackJpeg($dp, $tempFiles);
            }
        }

        // ── Build multi-view composite garment image ───────────────────────────
        // Stitch front (dominant) + back + details into one 1024×1024 reference
        // sheet so the AI model sees the complete garment in a single input.
        return $this->createGarmentComposite($frontPath, $backPath, $detailPaths, $tempFiles);
    }

    /**
     * Stitch all garment views into a single 1024×1024 reference sheet.
     *
     * Layout:
     *   Left 60 %  → Front view (full height, dominant reference)
     *   Right 40 % → Back view  (top portion)
     *                Detail grid (bottom portion, equal columns)
     *
     * Each image is scaled to fit (contain + centre) its allocated cell so
     * proportions are preserved and no image is cropped.
     *
     * Falls back to front-only path when GD is unavailable.
     */
    private function createGarmentComposite(
        string  $frontPath,
        ?string $backPath,
        array   $detailPaths,
        array   &$tempFiles
    ): string {
        if (!function_exists('imagecreatetruecolor')) {
            return $frontPath;
        }

        $hasBack    = $backPath !== null && is_file($backPath);
        $dCount     = count($detailPaths);
        $hasDetails = $dCount > 0;

        // If only front image — skip compositing, return as-is
        if (!$hasBack && !$hasDetails) {
            return $frontPath;
        }

        $canvasW = 1024;
        $canvasH = 1024;

        $canvas = imagecreatetruecolor($canvasW, $canvasH);
        if ($canvas === false) return $frontPath;

        $white = imagecolorallocate($canvas, 255, 255, 255);
        $div   = imagecolorallocate($canvas, 210, 210, 210);
        imagefill($canvas, 0, 0, $white);

        // Front occupies the left 60%
        $frontW = (int) round($canvasW * 0.60);
        $this->pasteImageFit($canvas, $frontPath, 0, 0, $frontW, $canvasH);
        imagestring($canvas, 1, 6, 4, 'FRONT', $div);

        // Vertical divider
        imageline($canvas, $frontW, 0, $frontW, $canvasH, $div);

        $rightX = $frontW;
        $rightW = $canvasW - $frontW;

        if ($hasBack && $hasDetails) {
            // Back: top 55% of the right panel
            $backH   = (int) round($canvasH * 0.55);
            $detailH = $canvasH - $backH;

            $this->pasteImageFit($canvas, $backPath, $rightX, 0, $rightW, $backH);
            imagestring($canvas, 1, $rightX + 4, 4, 'BACK', $div);
            imageline($canvas, $rightX, $backH, $canvasW, $backH, $div);

            // Detail images: equal columns in the bottom portion
            $cellW = (int) floor($rightW / $dCount);
            foreach ($detailPaths as $i => $dp) {
                $cellX = $rightX + ($i * $cellW);
                $this->pasteImageFit($canvas, $dp, $cellX, $backH, $cellW, $detailH);
                imagestring($canvas, 1, $cellX + 4, $backH + 3, 'DETAIL ' . ($i + 1), $div);
                if ($i > 0) {
                    imageline($canvas, $cellX, $backH, $cellX, $canvasH, $div);
                }
            }
        } elseif ($hasBack) {
            // Back fills the entire right panel
            $this->pasteImageFit($canvas, $backPath, $rightX, 0, $rightW, $canvasH);
            imagestring($canvas, 1, $rightX + 4, 4, 'BACK', $div);
        } else {
            // Details only (no back) — stack vertically in right panel
            $cellH = (int) floor($canvasH / $dCount);
            foreach ($detailPaths as $i => $dp) {
                $cellY = $i * $cellH;
                $this->pasteImageFit($canvas, $dp, $rightX, $cellY, $rightW, $cellH);
                imagestring($canvas, 1, $rightX + 4, $cellY + 3, 'DETAIL ' . ($i + 1), $div);
                if ($i > 0) {
                    imageline($canvas, $rightX, $cellY, $canvasW, $cellY, $div);
                }
            }
        }

        // Save composite to temp file
        $base    = tempnam(sys_get_temp_dir(), 'comp_');
        $outPath = $base . '.jpg';
        $tempFiles[] = $base;
        $tempFiles[] = $outPath;

        if (!@imagejpeg($canvas, $outPath, 95)) {
            imagedestroy($canvas);
            return $frontPath;
        }
        imagedestroy($canvas);

        return is_file($outPath) ? $outPath : $frontPath;
    }

    /**
     * Paste $srcPath into a cell on $canvas, scaling to fit (contain) and
     * centring so no part of the source image is cropped or distorted.
     */
    private function pasteImageFit(
        $canvas,
        string $srcPath,
        int    $dstX,
        int    $dstY,
        int    $dstW,
        int    $dstH
    ): void {
        if (!is_file($srcPath) || $dstW <= 0 || $dstH <= 0) return;

        $data = @file_get_contents($srcPath);
        if ($data === false) return;

        $src = @imagecreatefromstring($data);
        if ($src === false) return;

        $srcW = imagesx($src);
        $srcH = imagesy($src);

        if ($srcW <= 0 || $srcH <= 0) { imagedestroy($src); return; }

        // Scale to fit inside the cell, preserving aspect ratio
        $scale = min($dstW / $srcW, $dstH / $srcH);
        $newW  = (int) round($srcW * $scale);
        $newH  = (int) round($srcH * $scale);

        // Centre within the cell
        $offX = $dstX + (int) floor(($dstW - $newW) / 2);
        $offY = $dstY + (int) floor(($dstH - $newH) / 2);

        imagecopyresampled($canvas, $src, $offX, $offY, 0, 0, $newW, $newH, $srcW, $srcH);
        imagedestroy($src);
    }

    // ── Private: garment type resolution ─────────────────────────────────────

    private function resolveGarmentType(array $payload): string
    {
        $explicit = strtolower(trim((string) ($payload['garment_type'] ?? '')));
        if (in_array($explicit, ['top', 'bottom', 'full'], true)) {
            return $explicit;
        }
        return $this->inferFromPrompt(trim((string) ($payload['clothing_prompt'] ?? '')));
    }

    private function inferFromPrompt(string $prompt): string
    {
        if ($prompt === '') return 'top';
        $p = strtolower($prompt);
        if (preg_match('/\b(saree|sari|lehenga|jumpsuit|dungaree|romper|dress|gown|overall|abaya|pantsuit|playsuit|salwar\s*kameez|anarkali)\b/', $p)) {
            return 'full';
        }
        if (preg_match('/\b(pant|pants|jeans|trouser|trousers|shorts|skirt|legging|leggings|palaz|palazzo|dhoti|lungi|salwar|churidar)\b/', $p)) {
            return 'bottom';
        }
        return 'top';
    }

    /** Maps a clothing prompt to a FlatLayConverter garment hint key. */
    private function inferFlatLayGarmentHint(string $prompt): string
    {
        if ($prompt === '') return 'default';
        $p = strtolower($prompt);
        if (preg_match('/\b(saree|sari)\b/', $p)) return 'saree';
        if (preg_match('/\blehenga\b/', $p))      return 'lehenga';
        return 'default';
    }

    // ── Private: model image resolution ───────────────────────────────────────

    private function resolveModelImagePath(string $modelKey, string $gender): ?string
    {
        $path = $this->modelsBaseDir()
            . DIRECTORY_SEPARATOR . $gender
            . DIRECTORY_SEPARATOR . $modelKey . '.jpg';
        return is_file($path) ? $path : null;
    }

    private function modelsBaseDir(): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'models';
    }

    // ── Private: merchant auth ────────────────────────────────────────────────

    private function resolveMerchant(): ?array
    {
        $shop = trim((string) ($_GET['shop'] ?? ''));
        if ($shop === '') return null;
        $mRepo    = new MerchantRepo();
        $merchant = $mRepo->findByDomain($shop) ?? $mRepo->findByDomainLike($shop);
        if ($merchant === null || (int) $merchant['is_active'] !== 1) return null;
        return $merchant;
    }

    // ── Private: image handling ───────────────────────────────────────────────

    private function inputToTempFile(string $input, array &$tempFiles): ?string
    {
        $tempPath = tempnam(sys_get_temp_dir(), 'studio_');
        if ($tempPath === false) return null;
        $tempFiles[] = $tempPath;

        // Base64 data URI
        if (str_starts_with($input, 'data:image')) {
            $commaPos = strpos($input, ',');
            if ($commaPos === false) return null;
            $bytes = base64_decode(substr($input, $commaPos + 1), true);
            if ($bytes === false || $bytes === '') return null;
            return file_put_contents($tempPath, $bytes) !== false ? $tempPath : null;
        }

        // Protocol-relative URL
        if (str_starts_with($input, '//')) $input = 'https:' . $input;

        $localFile = null;
        $parsedUrl = parse_url($input);
        if (isset($parsedUrl['path'])) {
            $urlPath = $parsedUrl['path'];
            $isLocal = false;
            $requestHost = isset($parsedUrl['host']) ? strtolower($parsedUrl['host']) : '';
            $myHost = isset($_SERVER['HTTP_HOST']) ? strtolower(explode(':', $_SERVER['HTTP_HOST'])[0]) : 'localhost';
            $baseUrlHost = strtolower(parse_url(baseUrl(), PHP_URL_HOST) ?? '');
            
            if ($requestHost === '' || $requestHost === $myHost || $requestHost === $baseUrlHost || $requestHost === '127.0.0.1') {
                $isLocal = true;
            }
            
            if ($isLocal) {
                $basePath = basePath();
                if ($basePath !== '' && str_starts_with($urlPath, $basePath)) {
                    $urlPath = substr($urlPath, strlen($basePath));
                }
                if (preg_match('#^/temp/([^/]+)$#', $urlPath, $m)) {
                    $filename = explode('?', $m[1])[0];
                    $candidate = AppConfig::tempDir() . DIRECTORY_SEPARATOR . $filename;
                    if (is_file($candidate)) {
                        $localFile = $candidate;
                    }
                } elseif (preg_match('#^/models/([^/]+)/([^/]+)$#', $urlPath, $m)) {
                    $genderVal = $m[1];
                    $filename = explode('?', $m[2])[0];
                    $candidate = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'models' . DIRECTORY_SEPARATOR . $genderVal . DIRECTORY_SEPARATOR . $filename;
                    if (is_file($candidate)) {
                        $localFile = $candidate;
                    }
                }
            }
        }

        if ($localFile !== null) {
            if (@copy($localFile, $tempPath)) {
                return $tempPath;
            }
            return null;
        }

        $fp = fopen($tempPath, 'wb');
        if ($fp === false) return null;

        $ch = curl_init($input);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_FILE           => $fp,
            CURLOPT_USERAGENT      => 'TryFit-Studio/1.0',
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);
        curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        fclose($fp);

        if ($status >= 200 && $status < 300) {
            return $tempPath;
        }

        @unlink($tempPath);
        return null;
    }

    private function trackJpeg(string $path, array &$tempFiles): string
    {
        $jpegPath = ImageUtils::ensureJpeg($path);
        if ($jpegPath !== $path) $tempFiles[] = $jpegPath;
        return $jpegPath;
    }

    private function cleanupTempFiles(array $files): void
    {
        foreach ($files as $file) {
            if (is_string($file) && is_file($file)) @unlink($file);
        }
    }

    private function userFriendlyError(int $statusCode, string $rawError, bool $isFashn = false): string
    {
        if ($statusCode === 503)                             return $rawError; // config errors — pass through as-is
        // Fashn.ai's plan-level concurrency limit (commonly 1 in-flight
        // prediction) rejects a new saree submission with 429 while an
        // earlier one is still running — that can take up to ~75s to clear,
        // not a brief blip, so say so instead of the generic RunPod message.
        if ($statusCode === 429 && $isFashn)                 return 'Another saree generation is still processing on your account. Please wait about a minute and try again.';
        if ($statusCode === 429)                             return 'Service temporarily unavailable. Please try again later.';
        if ($statusCode === 0)                               return 'Request timed out. Please try again.';
        if ($statusCode === 401 || $statusCode === 403)      return 'Try-on service configuration error. Please contact support.';
        if (str_contains($rawError, 'image_too_small'))      return 'Garment image is too small. Please use a higher-resolution photo.';
        if (str_contains($rawError, 'File size exceeds'))    return 'Image is too large. Please use a smaller photo.';
        return 'Generation failed. Please try again.';
    }
}
