<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\GarmentStudioRepo;
use TryFit\Db\MerchantRepo;
use VTON\ImageUtils;
use VTON\OpenAIClient;
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

        // Paired top + bottom outfit: the try-on engine dresses one garment
        // per pass, so the top wear (front image) goes first, and the
        // bottom is queued in outfit_pending for checkGenerationStatus() to
        // apply on top of that result as a second 'bottoms' pass.
        $bottomUrl = trim((string) ($payload['bottom_image_url'] ?? ''));
        $isOutfit  = $bottomUrl !== '' && !$isAccessory;
        // Every Studio try-on runs with segmentation ON (segmentation_free=false):
        // segmentation-free mode never removes the model's own clothes, so the
        // old outfit bleeds through (wrong colour, a longer original top left
        // untouched). Verified side by side on the live endpoint.
        if ($isOutfit) {
            $garmentType = 'top';
            $useFashn    = false;
        }

        // The RunPod try-on model only knows pre-stitched Western silhouettes
        // (tops/bottoms/one-pieces) — it has no concept of draping unstitched
        // fabric, so a flat saree/lehenga photo gets painted onto a generic
        // dress shape instead of an actual drape. Route these through
        // FlatLayConverter first to get a photorealistic worn reference.
        // Never for Fashn sarees: the image-edit model re-imagines the saree into a
        // generated "worn" photo (often losing the real colour, pattern or
        // drape), and tryon-max drapes the raw flat-lay photo correctly itself.
        $useFlatLayConversion = $garmentType === 'full'
            && $workflowType === 'flat-lay'
            && !$useFashn
            && AppConfig::useFlatLayConverter();
        $flatLayHint = $this->inferFlatLayGarmentHint($customPrompt);

        // Pose & Background from the wizard's settings step. The try-on engine
        // always keeps the model photo's own pose and background, so these are
        // applied afterwards by an image-edit pass on the finished result.
        // Accessories only get the background — re-posing could move the item.
        // "Upload your own…" background: the merchant's photo is sent to the
        // edit as a second image, which only the OpenAI engine supports.
        $bgImageUrl = ($payload['background'] ?? '') === 'custom'
            ? trim((string) ($payload['background_image_url'] ?? ''))
            : '';
        // Pose comes from a reference photo the merchant uploads (never for
        // accessories — re-posing could move the item off its placement).
        $poseRefUrl = $isAccessory ? '' : trim((string) ($payload['pose_reference_url'] ?? ''));
        if (($bgImageUrl !== '' || $poseRefUrl !== '') && AppConfig::openAiApiKey() === '') {
            writeLog('WARNING', 'GarmentStudioController: pose reference / custom background need OPENAI_API_KEY', []);
            $bgImageUrl = '';
            $poseRefUrl = '';
        }
        $postEditPrompt = $this->buildPoseBackgroundPrompt(
            $poseRefUrl !== '',
            (string) ($payload['background'] ?? ''),
            $bgImageUrl !== ''
        );
        if ($postEditPrompt !== null && $bgImageUrl === '' && $poseRefUrl === '' && !AppConfig::useFlatLayConverter() && AppConfig::openAiApiKey() === '') {
            writeLog('WARNING', 'GarmentStudioController: pose/background requested but no image-edit engine is configured (RUNPOD_IMAGE_EDIT_ENDPOINT_ID / OPENAI_API_KEY)', []);
            $postEditPrompt = null;
        }
        // Stored as JSON so the custom background travels with the instruction.
        $postEdit = $postEditPrompt !== null
            ? json_encode(['prompt' => $postEditPrompt, 'pose_url' => $poseRefUrl ?: null, 'background_url' => $bgImageUrl ?: null])
            : null;

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
            'garment_type'       => $isOutfit ? 'outfit' : $garmentType,
            'clothing_prompt'    => $customPrompt ?: null,
            'outfit_pending'     => $isOutfit
                ? json_encode(['url' => $bottomUrl, 'photo_type' => $garmentPhotoType === 'flat-lay' ? 'flat-lay' : 'model'])
                : null,
            'post_edit_prompt'   => $postEdit,
        ]);
        $repo->updateStatus($sessionId, 'processing', ['api_request_at' => date('Y-m-d H:i:s')]);

        try {
            $result = $this->prepareAndSubmit(
                $frontUrl, $backUrl, $detail1, $detail2, $detail3,
                $modelImagePath, $garmentType, $garmentPhotoType, $tempFiles,
                $useFlatLayConversion, $flatLayHint, $useFashn, $accessoryPrompt,
                false
            );

            // RunPod's single worker (workersMax pinned to 1 for cost control)
            // can still be finishing a prior job when this one arrives — most
            // likely here because the flat-lay path's extra RunPod image-edit conversion
            // step keeps the worker occupied longer than other workflows.
            // That's a transient condition, not a real outage, so retry once
            // after a short wait instead of failing the merchant's request outright.
            if ($result['status_code'] === 429) {
                sleep(5);
                $result = $this->prepareAndSubmit(
                    $frontUrl, $backUrl, $detail1, $detail2, $detail3,
                    $modelImagePath, $garmentType, $garmentPhotoType, $tempFiles,
                    $useFlatLayConversion, $flatLayHint, $useFashn, $accessoryPrompt,
                    false
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
            'garment_type' => $isOutfit ? 'outfit' : $garmentType,
            'stage'        => $isOutfit ? 'top' : null,
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
        // An OpenAI pose/background edit is running inside an earlier poll
        // request (it keeps going even after that request's client gave up).
        // Report progress; if it never finishes, hand back the un-edited
        // try-on that was stored in result_image_url when the edit started.
        // Pose/background edits and group photos run as OpenAI background jobs.
        if (str_starts_with($predictionId, self::OPENAI_BG_PREFIX)) {
            $this->resolveOpenAiBackgroundJob($repo, $row, $sessionId, substr($predictionId, strlen(self::OPENAI_BG_PREFIX)));
            return;
        }

        if ($predictionId === self::OPENAI_EDIT_RUNNING) {
            $startedAt = strtotime((string) ($row['api_request_at'] ?? ''));
            if ($startedAt !== false && (time() - $startedAt) > 300 && empty($row['result_image_url'])) {
                $repo->updateStatus($sessionId, 'failed', ['error_message' => 'Combining the photo took too long. Please try again.']);
                respondJson(['status' => 'failed', 'session_id' => $sessionId, 'error' => 'Combining the photo took too long. Please try again.']);
                return;
            }
            if ($startedAt !== false && (time() - $startedAt) > 300 && !empty($row['result_image_url'])) {
                $repo->updateStatus($sessionId, 'completed', ['api_response_at' => date('Y-m-d H:i:s')]);
                respondJson([
                    'status'       => 'completed',
                    'session_id'   => $sessionId,
                    'result_image' => $row['result_image_url'],
                    'warning'      => 'The pose/background edit took too long. Showing the try-on result as is.',
                ]);
                return;
            }
            respondJson(['status' => 'processing', 'session_id' => $sessionId, 'stage' => 'pose_background']);
            return;
        }

        // The pose/background edit gets 5 minutes: the image-edit worker
        // scales to zero and its cold start alone can take a few minutes.
        $isEditJob   = str_starts_with($predictionId, self::EDIT_JOB_PREFIX);
        $requestedAt = strtotime((string) ($row['api_request_at'] ?? ''));
        if ($requestedAt !== false && (time() - $requestedAt) > ($isEditJob ? 300 : 180)) {
            $repo->updateStatus($sessionId, 'failed', ['error_message' => 'Generation timed out. Please try again.']);
            respondJson(['status' => 'failed', 'session_id' => $sessionId, 'error' => 'Generation timed out. Please try again.']);
            return;
        }

        // Engine (Fashn for sarees, RunPod otherwise) is read from the ID prefix.
        // Pose/background edits run on the image-edit endpoint instead.
        $check = $isEditJob
            ? (new RunpodVtonClient(AppConfig::runpodApiKey(), AppConfig::runpodImageEditEndpointId()))
                ->checkStatus(substr($predictionId, strlen(self::EDIT_JOB_PREFIX)))
            : SareeRouting::checkStatus($predictionId);

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

        // Paired outfit: that was the top-wear pass — now dress the bottom onto it.
        $warning = null;
        $pending = !empty($row['outfit_pending']) ? json_decode((string) $row['outfit_pending'], true) : null;
        if (is_array($pending) && !empty($pending['url'])) {
            $second = $this->submitOutfitBottomPass($outputPath, (string) $pending['url'], (string) ($pending['photo_type'] ?? 'model'));
            if ($second['status_code'] === 200 && !empty($second['prediction_id'])) {
                $repo->updateStatus($sessionId, 'processing', [
                    'fashn_prediction_id' => $second['prediction_id'],
                    'outfit_pending'      => null,
                    'api_request_at'      => date('Y-m-d H:i:s'),
                ]);
                respondJson(['status' => 'processing', 'session_id' => $sessionId, 'stage' => 'bottom']);
                return;
            }
            // Bottom pass couldn't be submitted — keep the top-wear result rather than
            // throwing away a finished generation.
            writeLog('WARNING', 'GarmentStudioController: outfit bottom pass failed', [
                'session_id'    => $sessionId,
                'status_code'   => $second['status_code'],
                'error_details' => $second['error_details'] ?? null,
            ]);
            $warning = 'The bottom wear could not be applied. Showing the top-wear result only. Please try again.';
        }

        // Pose / background: re-pose and re-backdrop the finished try-on.
        $postEdit = $this->decodePostEdit($row['post_edit_prompt'] ?? null);
        if ($warning === null && $postEdit !== null && ($postEdit['background_url'] !== null || $postEdit['pose_url'] !== null || !AppConfig::useFlatLayConverter())) {
            // Responds "processing" and ends the request when the job starts.
            $this->startOpenAiPoseBackgroundEdit($repo, $sessionId, $outputPath, $filename, $postEdit['prompt'], $postEdit['pose_url'], $postEdit['background_url']);
            $warning = 'The pose/background could not be applied. Showing the try-on result as is.';
        } elseif ($warning === null && $postEdit !== null) {
            $edit = $this->submitPoseBackgroundEdit($outputPath, $postEdit['prompt']);
            if ($edit['status_code'] === 200 && !empty($edit['prediction_id'])) {
                $repo->updateStatus($sessionId, 'processing', [
                    'fashn_prediction_id' => self::EDIT_JOB_PREFIX . $edit['prediction_id'],
                    'post_edit_prompt'    => null,
                    'api_request_at'      => date('Y-m-d H:i:s'),
                ]);
                respondJson(['status' => 'processing', 'session_id' => $sessionId, 'stage' => 'pose_background']);
                return;
            }
            writeLog('WARNING', 'GarmentStudioController: pose/background edit failed', [
                'session_id'    => $sessionId,
                'status_code'   => $edit['status_code'],
                'error_details' => $edit['error_details'] ?? null,
            ]);
            $warning = 'The pose/background could not be applied. Showing the try-on result as is.';
        }

        // Final image only — intermediate passes are fed back to the engines as is.
        ImageUtils::upscaleForDisplay($outputPath);

        $resultUrl = baseUrl() . basePath() . '/results/' . $filename;
        $latencyMs = $requestedAt !== false ? (int) ((time() - $requestedAt) * 1000) : null;

        $repo->updateStatus($sessionId, 'completed', [
            'result_image_url' => $resultUrl,
            'api_response_at'  => date('Y-m-d H:i:s'),
            'api_latency_ms'   => $latencyMs,
        ]);

        respondJson(array_filter([
            'status'       => 'completed',
            'session_id'   => $sessionId,
            'result_image' => $resultUrl,
            'warning'      => $warning,
        ], fn($v) => $v !== null));
    }

    /** Prefix on fashn_prediction_id marking a job on the image-edit endpoint. */
    private const EDIT_JOB_PREFIX = 'edit:';

    /** fashn_prediction_id while an OpenAI pose/background edit runs in a poll request. */
    private const OPENAI_EDIT_RUNNING = 'openai-edit:running';

    /** Prefix on fashn_prediction_id for an OpenAI background image job. */
    private const OPENAI_BG_PREFIX = 'oaibg:';

    private const BACKGROUND_PROMPTS = [
        'solid-light-grey'  => 'a seamless solid light grey studio backdrop',
        'gradient-soft'     => 'a soft, smooth pastel gradient studio backdrop',
        'lifestyle-indoor'  => 'a bright, modern indoor living space, softly out of focus',
        'lifestyle-outdoor' => 'a sunny outdoor city street, softly out of focus',
        'studio'            => 'a professional photo studio with softbox lighting and a neutral backdrop',
        'luxury-studio'     => 'an elegant luxury boutique studio with warm lighting',
    ];

    /**
     * Image-edit instruction for the wizard's Pose Reference & Background
     * settings, or null when nothing needs changing (no reference photo and
     * "Clean White", the default, keep the try-on as it is). Images are sent
     * in the order try-on, pose reference, background — the prompt names each
     * by that position.
     */
    private function buildPoseBackgroundPrompt(bool $hasPoseRef, string $background, bool $customBackground = false): ?string
    {
        $bgImageNo = $hasPoseRef ? 'third' : 'second';
        $bgPrompt  = $customBackground
            ? "the scene from the {$bgImageNo} image (keep that scene, its lighting and perspective; place the person naturally in it at a realistic scale, standing on its ground with matching shadows)"
            : (self::BACKGROUND_PROMPTS[$background] ?? null);
        if (!$hasPoseRef && $bgPrompt === null) {
            return null;
        }

        $steps = ['Edit the person in the first image.'];
        if ($hasPoseRef) {
            $steps[] = 'Re-pose them to match the body pose in the second image exactly: the same stance, arm, hand, leg and head positions.'
                . ' Copy only the pose from the second image: never its person, face, clothes or background.';
        }
        if ($bgPrompt !== null) {
            $steps[] = "Replace the background with {$bgPrompt}.";
        }

        return implode(' ', $steps) .
            ' Keep the exact same person: same face, hair, skin tone and body shape.' .
            ' Keep every piece of clothing exactly the same: same garment, cut, fit, length and every visible piece (for example matching pants or a dupatta).' .
            // The edit model tends to re-grade the garment to suit the new scene
            // (olive turning lime under warm light) and to smooth fine weaves:
            // spell out that the clothes are fixed and the scene must adapt.
            ' The garment colour must stay exactly as in the first image: do not tint, warm, cool, brighten, saturate or recolour it, and do not apply colour grading or a filter to the person.' .
            ' Keep the fabric texture and fine details exactly: weave, checks, prints, embroidery, borders and sheen.' .
            ' Match the background lighting to the person, never the person to the background.' .
            ' Full body visible from head to toe. Photorealistic fashion catalogue photo, neutral true-to-life colours.';
    }

    /**
     * Sends $payload as the complete HTTP response and closes the connection
     * while this PHP process keeps running (LiteSpeed / PHP-FPM). Anything
     * echoed afterwards goes nowhere, so the caller's final respondJson() is
     * harmless.
     */
    private function sendResponseAndContinue(array $payload): void
    {
        $body = (string) json_encode($payload);
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        http_response_code(200);
        header('Content-Type: application/json');
        header('Content-Length: ' . strlen($body));
        header('Connection: close');
        echo $body;

        if (function_exists('litespeed_finish_request')) {
            litespeed_finish_request();
        } elseif (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        } else {
            flush();
        }
    }

    /**
     * post_edit_prompt holds JSON {prompt, background_url}; older rows hold
     * the bare prompt string. Returns null when there is nothing to edit.
     *
     * @return array{prompt:string, pose_url:?string, background_url:?string}|null
     */
    private function decodePostEdit(?string $raw): ?array
    {
        if ($raw === null || trim($raw) === '') {
            return null;
        }
        $data = json_decode($raw, true);
        if (is_array($data) && !empty($data['prompt'])) {
            return [
                'prompt'         => (string) $data['prompt'],
                'pose_url'       => !empty($data['pose_url']) ? (string) $data['pose_url'] : null,
                'background_url' => !empty($data['background_url']) ? (string) $data['background_url'] : null,
            ];
        }
        return ['prompt' => $raw, 'pose_url' => null, 'background_url' => null];
    }

    /**
     * Starts the pose/background edit as an OpenAI background job: used when
     * no RunPod image-edit endpoint is configured, and always for a pose
     * reference or an uploaded background (multi-image). The un-edited try-on
     * is stored as the fallback result. On success this answers the poll with
     * "processing" and ends the request (respondJson exits); it only returns
     * when the job couldn't be started.
     */
    private function startOpenAiPoseBackgroundEdit(GarmentStudioRepo $repo, string $sessionId, string $outputPath, string $filename, string $prompt, ?string $poseUrl = null, ?string $backgroundUrl = null): void
    {
        $tempFiles = [];
        try {
            // Order matters — buildPoseBackgroundPrompt() refers to images by position.
            $images = [$outputPath];
            foreach (['pose reference' => $poseUrl, 'background' => $backgroundUrl] as $what => $url) {
                if ($url === null) {
                    continue;
                }
                $path = $this->inputToTempFile($url, $tempFiles);
                if ($path === null) {
                    throw new \RuntimeException("Failed to load the uploaded {$what} image");
                }
                $images[] = $this->trackJpeg($path, $tempFiles);
            }
            $jobId = (new OpenAIClient(AppConfig::openAiApiKey()))->startBackgroundImage($images, $prompt, '1024x1536');
        } catch (\Throwable $e) {
            writeLog('WARNING', 'GarmentStudioController: OpenAI pose/background edit could not start', [
                'session_id' => $sessionId,
                'error'      => $e->getMessage(),
            ]);
            return;
        } finally {
            $this->cleanupTempFiles($tempFiles);
        }

        $repo->updateStatus($sessionId, 'processing', [
            'fashn_prediction_id' => self::OPENAI_BG_PREFIX . $jobId,
            'post_edit_prompt'    => null,
            'result_image_url'    => baseUrl() . basePath() . '/results/' . $filename,
            'api_request_at'      => date('Y-m-d H:i:s'),
        ]);
        respondJson(['status' => 'processing', 'session_id' => $sessionId, 'stage' => 'pose_background']);
    }

    /**
     * Status check of an OpenAI background job (pose/background edit or group
     * photo). Saves the image when it's done. A failed or stalled edit hands
     * back the stored fallback (the un-edited try-on) when there is one.
     */
    private function resolveOpenAiBackgroundJob(GarmentStudioRepo $repo, array $row, string $sessionId, string $jobId): void
    {
        $isGroup  = ($row['garment_type'] ?? '') === 'group';
        $fallback = (string) ($row['result_image_url'] ?? '');
        $started  = strtotime((string) ($row['api_request_at'] ?? ''));
        $check    = (new OpenAIClient(AppConfig::openAiApiKey()))->checkBackgroundImage($jobId);

        if ($check['status'] === 'processing' || $check['status'] === 'error') {
            if ($started === false || time() - $started < 600) {
                respondJson(['status' => 'processing', 'session_id' => $sessionId, 'stage' => $isGroup ? 'compose' : 'pose_background']);
                return;
            }
            $check = ['status' => 'failed', 'bytes' => null, 'error' => 'timed out after 10 minutes'];
        }

        if ($check['status'] === 'completed') {
            $resultsDir = AppConfig::resultsDir();
            if (!is_dir($resultsDir)) {
                @mkdir($resultsDir, 0755, true);
            }
            $filename   = ($isGroup ? 'studio_group_' : 'studio_') . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.jpg';
            $outputPath = $resultsDir . DIRECTORY_SEPARATOR . $filename;
            if (ImageUtils::saveImageBytes((string) $check['bytes'], $outputPath)) {
                ImageUtils::upscaleForDisplay($outputPath);
                $url = baseUrl() . basePath() . '/results/' . $filename;
                $repo->updateStatus($sessionId, 'completed', ['result_image_url' => $url, 'api_response_at' => date('Y-m-d H:i:s')]);
                respondJson(['status' => 'completed', 'session_id' => $sessionId, 'result_image' => $url]);
                return;
            }
            $check['error'] = 'Failed to save the image';
        }

        writeLog('WARNING', 'GarmentStudioController: OpenAI background job failed', [
            'session_id' => $sessionId,
            'error'      => $check['error'],
        ]);
        if ($fallback !== '' && !$isGroup) {
            $repo->updateStatus($sessionId, 'completed', ['api_response_at' => date('Y-m-d H:i:s')]);
            respondJson([
                'status'       => 'completed',
                'session_id'   => $sessionId,
                'result_image' => $fallback,
                'warning'      => 'The pose/background could not be applied. Showing the try-on result as is.',
            ]);
            return;
        }
        $msg = 'Combining the people into one photo failed. Please try again.';
        $repo->updateStatus($sessionId, 'failed', ['error_message' => $msg]);
        respondJson(['status' => 'failed', 'session_id' => $sessionId, 'error' => $msg]);
    }

    /**
     * Submits the finished try-on to the image-edit endpoint with the
     * pose/background instruction (async — polled like any other job).
     *
     * @return array{status_code:int, prediction_id:?string, error_details:?string}
     */
    private function submitPoseBackgroundEdit(string $imagePath, string $prompt): array
    {
        try {
            $client = new RunpodVtonClient(AppConfig::runpodApiKey(), AppConfig::runpodImageEditEndpointId());
            return $client->submitEditRun([
                'image'  => ImageUtils::fileToBase64Uri($imagePath),
                'prompt' => $prompt,
            ]);
        } catch (\Throwable $e) {
            return ['status_code' => 500, 'prediction_id' => null, 'error_details' => $e->getMessage()];
        }
    }

    /**
     * Second pass of a paired top + bottom outfit: the finished top-wear
     * try-on becomes the person image and the bottom wear is applied as 'bottoms'.
     *
     * @return array{status_code:int, prediction_id:?string, error_details:?string}
     */
    private function submitOutfitBottomPass(string $personPath, string $bottomUrl, string $photoType): array
    {
        if (!AppConfig::useRunpod()) {
            return ['status_code' => 503, 'prediction_id' => null, 'error_details' => 'RunPod is not configured'];
        }

        $tempFiles = [];
        try {
            $bottomPath = $this->inputToTempFile($bottomUrl, $tempFiles);
            if ($bottomPath === null) {
                return ['status_code' => 400, 'prediction_id' => null, 'error_details' => 'Failed to load bottom_image_url'];
            }
            $bottomPath = $this->trackJpeg($bottomPath, $tempFiles);
            $bottomPath = ImageUtils::ensureMinimumSize($bottomPath, RunpodVtonClient::INPUT_MIN_WIDTH, RunpodVtonClient::INPUT_MIN_HEIGHT, $tempFiles);
            $personPath = ImageUtils::ensureMinimumSize($personPath, RunpodVtonClient::INPUT_MIN_WIDTH, RunpodVtonClient::INPUT_MIN_HEIGHT, $tempFiles);

            $client = new RunpodVtonClient(AppConfig::runpodApiKey(), AppConfig::runpodEndpointId());
            return $client->submitRun([
                'person_image'       => ImageUtils::fileToBase64Uri($personPath),
                'garment_image'      => ImageUtils::fileToBase64Uri($bottomPath),
                'category'           => 'bottoms',
                'garment_photo_type' => $photoType === 'flat-lay' ? 'flat-lay' : 'model',
            ] + RunpodVtonClient::qualityParams());
        } catch (\Throwable $e) {
            return ['status_code' => 500, 'prediction_id' => null, 'error_details' => $e->getMessage()];
        } finally {
            $this->cleanupTempFiles($tempFiles);
        }
    }

    /**
     * POST /studio/group/compose
     *
     * Body: { member_session_ids: [left … right], background?, background_image_url?,
     *         arrangement?: side_by_side|together|walking, size?: landscape|portrait|square }
     *
     * Duo & Group workflow. The try-on engine dresses one person per image, so
     * each person is generated first as a normal session; this combines those
     * finished people into ONE photo with gpt-image (multi-image edit), in the
     * merchant's left-to-right order. Returns a session_id straight away and
     * finishes the edit after the response; poll /studio/generate-status.
     */
    public function composeGroup(): void
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

        $ids = array_values(array_filter(array_map('strval', (array) ($payload['member_session_ids'] ?? []))));
        if (count($ids) < 2 || count($ids) > 4) {
            respondJson(['error' => 'Choose between 2 and 4 people.'], 400);
            return;
        }
        if (AppConfig::openAiApiKey() === '') {
            respondJson(['error' => 'Combining people into one photo needs OPENAI_API_KEY on the server.'], 503);
            return;
        }

        $repo  = new GarmentStudioRepo();
        $paths = [];
        foreach ($ids as $i => $id) {
            $row = $repo->findById($id);
            if ($row === null || (int) $row['merchant_id'] !== (int) $merchant['id']) {
                respondJson(['error' => 'Person ' . ($i + 1) . ' was not found.'], 404);
                return;
            }
            if ($row['status'] !== 'completed' || empty($row['result_image_url'])) {
                respondJson(['error' => 'Person ' . ($i + 1) . ' is not finished yet.'], 409);
                return;
            }
            $path = AppConfig::resultsDir() . DIRECTORY_SEPARATOR . basename((string) parse_url((string) $row['result_image_url'], PHP_URL_PATH));
            if (!is_file($path)) {
                respondJson(['error' => 'The image for person ' . ($i + 1) . ' is no longer available. Please generate again.'], 410);
                return;
            }
            $paths[] = $path;
        }

        $arrangement = in_array($payload['arrangement'] ?? '', ['side_by_side', 'together', 'walking'], true) ? $payload['arrangement'] : 'side_by_side';
        $size = match ($payload['size'] ?? 'landscape') {
            'portrait' => '1024x1536',
            'square'   => '1024x1024',
            default    => '1536x1024',
        };
        $bgUrl  = ($payload['background'] ?? '') === 'custom' ? trim((string) ($payload['background_image_url'] ?? '')) : '';
        $prompt = $this->buildGroupPrompt(count($ids), $arrangement, (string) ($payload['background'] ?? ''), $bgUrl !== '');

        $tempFiles = [];
        try {
            $images = $paths;
            if ($bgUrl !== '') {
                $bgPath = $this->inputToTempFile($bgUrl, $tempFiles);
                if ($bgPath === null) {
                    throw new \RuntimeException('Failed to load the uploaded background image');
                }
                $images[] = $this->trackJpeg($bgPath, $tempFiles);
            }
            // Background job: PHP only starts it; status polls collect the result.
            $jobId = (new OpenAIClient(AppConfig::openAiApiKey()))->startBackgroundImage($images, $prompt, $size);
        } catch (\Throwable $e) {
            writeLog('WARNING', 'GarmentStudioController: group compose could not start', ['error' => $e->getMessage()]);
            respondJson(['error' => 'Combining the people into one photo could not start. Please try again.'], 502);
            return;
        } finally {
            $this->cleanupTempFiles($tempFiles);
        }

        $first     = $repo->findById($ids[0]);
        $sessionId = $repo->create([
            'merchant_id'     => (int) $merchant['id'],
            'front_image_url' => (string) $first['result_image_url'],
            'back_image_url'  => '',
            'gender'          => 'female',
            'model_key'       => 'group',
            'garment_type'    => 'group',
            'clothing_prompt' => json_encode(['members' => $ids, 'arrangement' => $arrangement]),
        ]);
        $repo->updateStatus($sessionId, 'processing', [
            'fashn_prediction_id' => self::OPENAI_BG_PREFIX . $jobId,
            'api_request_at'      => date('Y-m-d H:i:s'),
        ]);
        $repo->markHidden($ids);

        respondJson(['session_id' => $sessionId, 'status' => 'processing']);
    }

    // ── Duo & Group from ONE photo ───────────────────────────────────────────

    /**
     * POST /studio/group/split
     * Body: { image_url, splits: [0.5] }  (divider positions, 0-1, left to right)
     *
     * Cuts one photo of several people into one portrait (2:3) image per
     * person, ready to dress as a normal custom-model try-on.
     */
    public function splitGroupPhoto(): void
    {
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }
        $payload = json_decode((string) file_get_contents('php://input'), true);
        $splits  = $this->cleanSplits($payload['splits'] ?? []);
        if (!is_array($payload) || $splits === null) {
            respondJson(['error' => 'Mark where each person stands (2 to 4 people).'], 400);
            return;
        }

        $tempFiles = [];
        $src = $this->loadGd((string) ($payload['image_url'] ?? ''), $tempFiles);
        if ($src === null) {
            $this->cleanupTempFiles($tempFiles);
            respondJson(['error' => 'Could not load the group photo.'], 400);
            return;
        }

        $tempDir = AppConfig::tempDir();
        if (!is_dir($tempDir)) {
            @mkdir($tempDir, 0755, true);
        }
        $people = [];
        foreach ($this->stripBoxes(imagesx($src), imagesy($src), $splits) as $i => $box) {
            $canvas   = $this->stripCanvas($src, $box);
            $filename = 'group_person_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '_' . $i . '.jpg';
            imagejpeg($canvas, $tempDir . DIRECTORY_SEPARATOR . $filename, 95);
            imagedestroy($canvas);
            $people[] = ['index' => $i, 'url' => baseUrl() . basePath() . '/temp/' . $filename];
        }
        imagedestroy($src);
        $this->cleanupTempFiles($tempFiles);
        respondJson(['people' => $people]);
    }

    /**
     * POST /studio/group/stitch
     * Body: { image_url, splits, member_session_ids: [left … right] }
     *
     * Pastes each dressed person back into the original photo at their strip,
     * with soft blended edges between strips. Pure image work (no AI), so it
     * finishes in the request and returns the finished group session.
     */
    public function stitchGroupPhoto(): void
    {
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }
        $payload = json_decode((string) file_get_contents('php://input'), true);
        $splits  = $this->cleanSplits($payload['splits'] ?? []);
        $ids     = array_values(array_filter(array_map('strval', (array) ($payload['member_session_ids'] ?? []))));
        if (!is_array($payload) || $splits === null || count($ids) !== count($splits) + 1) {
            respondJson(['error' => 'Each person needs a finished try-on.'], 400);
            return;
        }

        $repo  = new GarmentStudioRepo();
        $paths = [];
        foreach ($ids as $i => $id) {
            $row = $repo->findById($id);
            if ($row === null || (int) $row['merchant_id'] !== (int) $merchant['id'] || $row['status'] !== 'completed' || empty($row['result_image_url'])) {
                respondJson(['error' => 'Person ' . ($i + 1) . ' is not finished yet.'], 409);
                return;
            }
            $path = AppConfig::resultsDir() . DIRECTORY_SEPARATOR . basename((string) parse_url((string) $row['result_image_url'], PHP_URL_PATH));
            if (!is_file($path)) {
                respondJson(['error' => 'The image for person ' . ($i + 1) . ' is no longer available. Please generate again.'], 410);
                return;
            }
            $paths[] = $path;
        }

        $tempFiles = [];
        $src = $this->loadGd((string) ($payload['image_url'] ?? ''), $tempFiles);
        if ($src === null) {
            $this->cleanupTempFiles($tempFiles);
            respondJson(['error' => 'Could not load the group photo.'], 400);
            return;
        }
        $W = imagesx($src);
        $H = imagesy($src);

        // Each dressed image covers its whole padded canvas: scale it back to
        // the canvas size, so canvas x = ox + (photo x - ex0) for this person.
        $boxes    = $this->stripBoxes($W, $H, $splits);
        $canvases = [];
        foreach ($boxes as $i => $box) {
            $dressed = @imagecreatefromstring((string) file_get_contents($paths[$i]));
            if ($dressed === false) {
                $canvases[$i] = null;
                continue;
            }
            $canvas = imagecreatetruecolor($box['cw'], $box['ch']);
            imagecopyresampled($canvas, $dressed, 0, 0, 0, 0, $box['cw'], $box['ch'], imagesx($dressed), imagesy($dressed));
            imagedestroy($dressed);
            $canvases[$i] = $canvas;
            // This person's own strip.
            imagecopy($src, $canvas, $box['x0'], 0, $box['ox'] + ($box['x0'] - $box['ex0']), $box['oy'], $box['x1'] - $box['x0'], $H);
        }

        // Cross-fade every seam over the overlap both neighbours were dressed with.
        for ($i = 0; $i < count($boxes) - 1; $i++) {
            $left  = $canvases[$i];
            $right = $canvases[$i + 1];
            if ($left === null || $right === null) {
                continue;
            }
            $a    = $boxes[$i];
            $b    = $boxes[$i + 1];
            $seam = $a['x1'];
            $half = max(1, intdiv($a['margin'], 2));
            for ($col = max(0, $seam - $half); $col < min($W, $seam + $half); $col++) {
                $t = ($col - ($seam - $half) + 0.5) / (2 * $half); // 0 = all left, 1 = all right
                imagecopy($src, $left, $col, 0, $a['ox'] + ($col - $a['ex0']), $a['oy'], 1, $H);
                imagecopymerge($src, $right, $col, 0, $b['ox'] + ($col - $b['ex0']), $b['oy'], 1, $H, (int) round($t * 100));
            }
        }
        foreach ($canvases as $canvas) {
            if ($canvas !== null) {
                imagedestroy($canvas);
            }
        }

        $resultsDir = AppConfig::resultsDir();
        if (!is_dir($resultsDir)) {
            @mkdir($resultsDir, 0755, true);
        }
        $filename   = 'studio_group_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.jpg';
        $outputPath = $resultsDir . DIRECTORY_SEPARATOR . $filename;
        imagejpeg($src, $outputPath, 95);
        imagedestroy($src);
        $this->cleanupTempFiles($tempFiles);
        ImageUtils::upscaleForDisplay($outputPath);

        $url       = baseUrl() . basePath() . '/results/' . $filename;
        $first     = $repo->findById($ids[0]);
        $sessionId = $repo->create([
            'merchant_id'     => (int) $merchant['id'],
            'front_image_url' => (string) $first['result_image_url'],
            'back_image_url'  => '',
            'gender'          => 'female',
            'model_key'       => 'group',
            'garment_type'    => 'group',
            'clothing_prompt' => json_encode(['members' => $ids, 'mode' => 'one_photo']),
        ]);
        $repo->updateStatus($sessionId, 'completed', ['result_image_url' => $url, 'api_response_at' => date('Y-m-d H:i:s')]);
        $repo->markHidden($ids);

        respondJson(['session_id' => $sessionId, 'status' => 'completed', 'result_image' => $url]);
    }

    /** Divider positions as ascending fractions with sane gaps, or null if unusable. */
    private function cleanSplits(mixed $raw): ?array
    {
        if (!is_array($raw)) {
            return null;
        }
        $splits = array_map('floatval', array_values($raw));
        sort($splits);
        if (count($splits) < 1 || count($splits) > 3) {
            return null;
        }
        $prev = 0.0;
        foreach ($splits as $f) {
            if ($f - $prev < 0.08 || $f > 0.92) {
                return null;
            }
            $prev = $f;
        }
        return $splits;
    }

    /**
     * One box per person: the strip [x0, x1) of the source, plus the 2:3
     * canvas it's padded onto (cw x ch) and where the strip sits in it (ox, oy).
     */
    private function stripBoxes(int $W, int $H, array $splits): array
    {
        $edges  = array_merge([0], array_map(fn($f) => (int) round($f * $W), $splits), [$W]);
        // Each cut reaches a little into its neighbours so two dressed strips
        // overlap at every seam and can be cross-faded there.
        $margin = max(8, (int) round($W * 0.03));
        $boxes  = [];
        for ($i = 0; $i < count($edges) - 1; $i++) {
            $x0  = $edges[$i];
            $x1  = $edges[$i + 1];
            $ex0 = max(0, $x0 - $margin);
            $ex1 = min($W, $x1 + $margin);
            $sw  = $ex1 - $ex0;
            // Pad to the try-on engine's 2:3 portrait shape around the cut.
            if ($sw * 3 > $H * 2) {
                $cw = $sw;
                $ch = (int) ceil($sw * 1.5);
            } else {
                $ch = $H;
                $cw = (int) ceil($H * 2 / 3);
            }
            $boxes[] = [
                'x0' => $x0, 'x1' => $x1, 'ex0' => $ex0, 'ex1' => $ex1, 'margin' => $margin,
                'cw' => $cw, 'ch' => $ch, 'ox' => intdiv($cw - $sw, 2), 'oy' => intdiv($ch - $H, 2),
            ];
        }
        return $boxes;
    }

    /** The strip on a 2:3 canvas filled with the strip's own average edge colour. */
    private function stripCanvas(\GdImage $src, array $box)
    {
        $H  = imagesy($src);
        $sw = $box['ex1'] - $box['ex0'];
        $canvas = imagecreatetruecolor($box['cw'], $box['ch']);

        // Average colour of the strip's left/right edge columns (the backdrop).
        $r = $g = $b = $n = 0;
        foreach ([$box['ex0'], $box['ex1'] - 1] as $x) {
            for ($y = 0; $y < $H; $y += max(1, intdiv($H, 60))) {
                $c = imagecolorat($src, max(0, $x), $y);
                $r += ($c >> 16) & 0xFF;
                $g += ($c >> 8) & 0xFF;
                $b += $c & 0xFF;
                $n++;
            }
        }
        imagefill($canvas, 0, 0, imagecolorallocate($canvas, intdiv($r, max(1, $n)), intdiv($g, max(1, $n)), intdiv($b, max(1, $n))));
        imagecopy($canvas, $src, $box['ox'], $box['oy'], $box['ex0'], 0, $sw, $H);
        return $canvas;
    }

    /** Downloads/loads an image into GD (EXIF-rotated JPEG), or null. */
    private function loadGd(string $url, array &$tempFiles): ?\GdImage
    {
        if ($url === '' || !function_exists('imagecreatefromstring')) {
            return null;
        }
        @ini_set('memory_limit', '1024M');
        $path = $this->inputToTempFile($url, $tempFiles);
        if ($path === null) {
            return null;
        }
        $path = $this->trackJpeg($path, $tempFiles);
        $img  = @imagecreatefromstring((string) file_get_contents($path));
        return $img === false ? null : $img;
    }

    private const GROUP_POSITIONS = [
        2 => ['on the left', 'on the right'],
        3 => ['on the left', 'in the centre', 'on the right'],
        4 => ['on the far left', 'centre left', 'centre right', 'on the far right'],
    ];

    private const GROUP_ARRANGEMENTS = [
        'side_by_side' => 'standing side by side, facing the camera',
        'together'     => 'standing close together, turned slightly towards each other, relaxed and friendly',
        'walking'      => 'walking side by side towards the camera',
    ];

    /** Instruction for combining the dressed people; images are numbered left to right. */
    private function buildGroupPrompt(int $count, string $arrangement, string $background, bool $customBackground): string
    {
        $who = [];
        foreach (self::GROUP_POSITIONS[$count] as $i => $pos) {
            $who[] = 'image ' . ($i + 1) . ' is the person ' . $pos;
        }
        $bg = $customBackground
            ? 'the scene from the last image (keep that scene, its lighting and perspective)'
            : (self::BACKGROUND_PROMPTS[$background] ?? 'a seamless pure white studio backdrop');

        return "Create one photorealistic fashion catalogue photo of these {$count} people together, "
            . (self::GROUP_ARRANGEMENTS[$arrangement] ?? self::GROUP_ARRANGEMENTS['side_by_side']) . '. '
            . 'Left to right: ' . implode(', ', $who) . '. '
            . 'Each person must look exactly like their own image: same face, hair, skin tone, body shape and height, '
            . 'and exactly the same outfit (garment, colour, pattern, fabric, fit and length). '
            . 'Keep every garment colour exact (no tinting, colour grading or filters) and keep fabric texture, prints and embroidery unchanged. '
            . 'Never swap, mix or change clothes between people. '
            . "Background: {$bg}. "
            . 'Consistent natural lighting and shadows, realistic relative scale, everyone fully visible from head to toe, nobody cropped.';
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
        $limit  = min(200, max(1, (int) ($_GET['limit']  ?? 20)));
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
        ?string $accessoryPrompt = null,
        bool    $segmentationFree = false
    ): array {
        // ── Download & pre-process front image ───────────────────────────────
        $frontPath = $this->inputToTempFile($frontUrl, $tempFiles);
        if ($frontPath === null) {
            return ['status_code' => 400, 'prediction_id' => null,
                    'error_details' => 'Failed to load front_image_url'];
        }
        $frontPath = $this->trackJpeg($frontPath, $tempFiles);
        $frontPath = ImageUtils::ensureMinimumSize($frontPath, RunpodVtonClient::INPUT_MIN_WIDTH, RunpodVtonClient::INPUT_MIN_HEIGHT, $tempFiles);

        // ── Pre-process model image (portrait orientation preferred) ──────────
        $modelPath = $this->trackJpeg($modelImagePath, $tempFiles);
        $modelPath = ImageUtils::ensureMinimumSize($modelPath, RunpodVtonClient::INPUT_MIN_WIDTH, RunpodVtonClient::INPUT_MIN_HEIGHT, $tempFiles);

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
            // SareeRouting already tried RunPod (Fashn out of credits) and that failed too —
            // a second identical RunPod submit below would only repeat the failure.
            if (SareeRouting::isOutOfCredits((int) $fashnResult['status_code'], (string) ($fashnResult['error_details'] ?? ''))
                && AppConfig::useRunpod()) {
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
            ] + RunpodVtonClient::qualityParams());
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
            'segmentation_free'  => $segmentationFree,
        ] + RunpodVtonClient::qualityParams());
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
            $converter   = new \VTON\FlatLayConverter(AppConfig::runpodApiKey(), AppConfig::runpodImageEditEndpointId(), AppConfig::tempDir());
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
