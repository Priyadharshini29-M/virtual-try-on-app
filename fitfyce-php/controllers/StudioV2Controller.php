<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\AssetRepo;
use TryFit\Db\GenerationRepo;
use TryFit\Db\InfographicGenRepo;
use TryFit\Db\MerchantRepo;
use TryFit\Db\SavedModelRepo;
use VTON\FashnClient;
use VTON\ImageUtils;
use VTON\OpenAIClient;

/**
 * StudioV2Controller — single-flow AI Studio pipeline.
 *
 * Flow: merchant uploads a product image, selects a saved model (or uploads
 * a new one), enters a required prompt describing the garment/creative
 * direction, FASHN.ai generates the dressed model, and on completion this
 * controller automatically chains an OpenAI marketing-infographic batch
 * (5 fixed styles) using the FASHN result as the visual reference.
 *
 * Deliberately namespaced under /studio-v2/* so the existing /studio/*
 * (GarmentStudioController, 14-slot model registry) routes are left
 * untouched.
 *
 * Routes (see router.php):
 *   POST   /studio-v2/models                    → uploadSavedModel()
 *   GET    /studio-v2/models                     → listSavedModels()
 *   DELETE /studio-v2/models                     → deleteSavedModel()
 *   POST   /studio-v2/generate                    → generate()
 *   GET    /studio-v2/generate-status             → checkGenerationStatus()
 *   POST   /studio-v2/regenerate-infographics      → regenerateInfographics()
 *   DELETE /studio-v2/generation                   → deleteGeneration()
 *   GET    /studio-v2/generations                  → listGenerations()
 *   GET    /studio-v2/generation                   → getGeneration()
 *   GET    /studio-v2/assets                       → listAssets()
 */
class StudioV2Controller
{
    // ── Saved Models ──────────────────────────────────────────────────────────

    public function uploadSavedModel(): void
    {
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }

        $payload  = json_decode((string) file_get_contents('php://input'), true);
        $imageUrl = trim((string) ($payload['image_url'] ?? ''));
        if ($imageUrl === '') {
            respondJson(['error' => 'image_url is required'], 400);
            return;
        }

        $merchantId = (int) $merchant['id'];
        $destUrl    = $this->persistPermanentImage($imageUrl, AppConfig::libraryDir(), 'model');
        if ($destUrl === null) {
            respondJson(['error' => 'Failed to save model image'], 500);
            return;
        }

        $repo      = new SavedModelRepo();
        $modelId   = $repo->create($merchantId, $destUrl['url']);
        $thumbUrl  = $this->makeAndSaveThumbnail($destUrl['path'], AppConfig::libraryDir(), 'model');

        (new AssetRepo())->record($merchantId, $destUrl['url'], $thumbUrl, 'saved_model', $modelId);

        respondJson(['ok' => true, 'id' => $modelId, 'image_url' => $destUrl['url'], 'created_at' => date('Y-m-d H:i:s')]);
    }

    public function listSavedModels(): void
    {
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }
        $models = (new SavedModelRepo())->listByMerchant((int) $merchant['id']);
        respondJson(['models' => $models]);
    }

    public function deleteSavedModel(): void
    {
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }

        $payload = json_decode((string) file_get_contents('php://input'), true);
        $id      = trim((string) ($payload['saved_model_id'] ?? ''));
        if ($id === '') {
            respondJson(['error' => 'saved_model_id is required'], 400);
            return;
        }

        $merchantId = (int) $merchant['id'];
        $repo   = new SavedModelRepo();
        $model  = $repo->findById($id);
        if ($model === null || (int) $model['merchant_id'] !== $merchantId) {
            respondJson(['error' => 'Saved model not found'], 404);
            return;
        }

        $this->unlinkLocalAsset($model['image_url']);
        $repo->delete($id, $merchantId);
        (new AssetRepo())->deleteBySource('saved_model', $id);

        respondJson(['ok' => true, 'id' => $id]);
    }

    // ── Generation pipeline ───────────────────────────────────────────────────

    public function generate(): void
    {
        @set_time_limit(180);

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

        $productImageUrl = trim((string) ($payload['product_image_url'] ?? ''));
        $prompt           = trim((string) ($payload['prompt'] ?? ''));
        $savedModelId     = trim((string) ($payload['saved_model_id'] ?? ''));
        $modelImageUrl    = trim((string) ($payload['model_image_url'] ?? ''));
        $garmentType      = trim((string) ($payload['garment_type'] ?? ''));

        if ($productImageUrl === '') {
            respondJson(['error' => 'product_image_url is required'], 400);
            return;
        }
        $promptLen = mb_strlen($prompt);
        if ($promptLen < 10 || $promptLen > 500) {
            respondJson(['error' => 'prompt must be between 10 and 500 characters'], 400);
            return;
        }

        $merchantId = (int) $merchant['id'];
        $resolvedModelUrl = null;

        if ($savedModelId !== '') {
            $savedModel = (new SavedModelRepo())->findById($savedModelId);
            if ($savedModel === null || (int) $savedModel['merchant_id'] !== $merchantId) {
                respondJson(['error' => 'saved_model_id not found'], 404);
                return;
            }
            $resolvedModelUrl = (string) $savedModel['image_url'];
        } elseif ($modelImageUrl !== '') {
            $resolvedModelUrl = $modelImageUrl;
        } else {
            respondJson(['error' => 'Either saved_model_id or model_image_url is required'], 400);
            return;
        }

        if (AppConfig::fashnApiKey() === '') {
            respondJson(['error' => 'Try-on service is not configured. Add FASHN_API_KEY to .env.'], 503);
            return;
        }

        $repo          = new GenerationRepo();
        $generationId  = $repo->create([
            'merchant_id'        => $merchantId,
            'product_id'         => isset($payload['product_id']) ? (int) $payload['product_id'] : null,
            'shopify_variant_id' => isset($payload['shopify_variant_id']) ? (int) $payload['shopify_variant_id'] : null,
            'product_image_url'  => $productImageUrl,
            'saved_model_id'     => $savedModelId !== '' ? $savedModelId : null,
            'model_image_url'    => $resolvedModelUrl,
            'prompt'             => $prompt,
        ]);
        $repo->updateStatus($generationId, 'processing', ['api_request_at' => date('Y-m-d H:i:s')]);

        $tempFiles = [];
        try {
            $productPath = $this->urlToTempFile($productImageUrl, $tempFiles);
            $modelPath   = $this->urlToTempFile($resolvedModelUrl, $tempFiles);
            if ($productPath === null || $modelPath === null) {
                throw new \RuntimeException('Failed to load product or model image');
            }

            $productPath = ImageUtils::ensureJpeg($productPath);
            $tempFiles[] = $productPath;
            $productPath = ImageUtils::ensureMinimumSize($productPath, 768, 1024, $tempFiles);

            $modelPath = ImageUtils::ensureJpeg($modelPath);
            $tempFiles[] = $modelPath;
            $modelPath = ImageUtils::ensureMinimumSize($modelPath, 768, 1024, $tempFiles);

            require_once dirname(__DIR__) . '/src/FashnClient.php';
            $fashnClient = new FashnClient(AppConfig::fashnApiKey(), 'quality');
            $result = $fashnClient->submitRun([
                'model_image'        => ImageUtils::fileToBase64Uri($modelPath),
                'garment_image'      => ImageUtils::fileToBase64Uri($productPath),
                'category'           => $this->resolveCategory($garmentType, $prompt),
                'garment_photo_type' => 'auto',
                'seed'               => -1,
            ]);
        } catch (\Throwable $e) {
            $this->cleanupTempFiles($tempFiles);
            writeLog('ERROR', 'StudioV2Controller generation exception', ['message' => $e->getMessage()]);
            $repo->updateStatus($generationId, 'failed', ['error_message' => $e->getMessage()]);
            respondJson(['error' => 'Generation failed: ' . $e->getMessage(), 'generation_id' => $generationId], 500);
            return;
        }
        $this->cleanupTempFiles($tempFiles);

        if ($result['status_code'] !== 200 || empty($result['prediction_id'])) {
            $rawError = $result['error_details'] ?? 'Try-on API request failed';
            $repo->updateStatus($generationId, 'failed', ['error_message' => $rawError]);
            respondJson(['error' => $rawError, 'generation_id' => $generationId], 400);
            return;
        }

        $repo->updateStatus($generationId, 'processing', ['fashn_prediction_id' => $result['prediction_id']]);

        respondJson(['generation_id' => $generationId, 'status' => 'processing']);
    }

    /**
     * GET /studio-v2/generate-status?generation_id=...
     *
     * Polled by the client. Checks FASHN exactly once per call. On FASHN
     * completion, immediately (synchronously) chains the 5-style OpenAI
     * marketing-infographic batch before responding 'completed', so the
     * client's existing poll loop drives both pipeline stages.
     */
    public function checkGenerationStatus(): void
    {
        @set_time_limit(150);

        $generationId = trim((string) ($_GET['generation_id'] ?? ''));
        if ($generationId === '') {
            respondJson(['error' => 'generation_id is required'], 400);
            return;
        }

        $repo = new GenerationRepo();
        $row  = $repo->findById($generationId);
        if ($row === null) {
            respondJson(['error' => 'Generation not found'], 404);
            return;
        }

        if ($row['status'] === 'completed') {
            respondJson([
                'status'         => 'completed',
                'generation_id'  => $generationId,
                'result_image'   => $row['result_image_url'],
                'infographics'   => (new InfographicGenRepo())->listByGeneration($generationId),
            ]);
            return;
        }
        if ($row['status'] === 'failed') {
            respondJson(['status' => 'failed', 'generation_id' => $generationId, 'error' => $row['error_message']]);
            return;
        }

        $predictionId = trim((string) ($row['fashn_prediction_id'] ?? ''));
        if ($predictionId === '') {
            respondJson(['status' => 'processing', 'generation_id' => $generationId]);
            return;
        }

        $requestedAt = strtotime((string) ($row['api_request_at'] ?? ''));
        if ($requestedAt !== false && (time() - $requestedAt) > 180) {
            $repo->updateStatus($generationId, 'failed', ['error_message' => 'Generation timed out. Please try again.']);
            respondJson(['status' => 'failed', 'generation_id' => $generationId, 'error' => 'Generation timed out. Please try again.']);
            return;
        }

        require_once dirname(__DIR__) . '/src/FashnClient.php';
        $fashnClient = new FashnClient(AppConfig::fashnApiKey());
        $check       = $fashnClient->checkStatus($predictionId);

        if ($check['job_status'] === 'processing' || $check['job_status'] === 'error') {
            respondJson(['status' => 'processing', 'generation_id' => $generationId]);
            return;
        }

        if ($check['job_status'] === 'failed') {
            $rawError = $check['error_details'] ?? 'Try-on API request failed';
            $repo->updateStatus($generationId, 'failed', [
                'error_message'   => $rawError,
                'api_response_at' => date('Y-m-d H:i:s'),
            ]);
            respondJson(['status' => 'failed', 'generation_id' => $generationId, 'error' => $rawError]);
            return;
        }

        // FASHN completed — save the dressed-model result, then chain OpenAI.
        $generationsDir = AppConfig::generationsDir();
        if (!is_dir($generationsDir)) {
            @mkdir($generationsDir, 0755, true);
        }
        $filename   = 'model_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.jpg';
        $outputPath = $generationsDir . DIRECTORY_SEPARATOR . $filename;

        if (!ImageUtils::saveImageBytes($check['image_bytes'], $outputPath)) {
            $repo->updateStatus($generationId, 'failed', ['error_message' => 'Failed to save result image']);
            respondJson(['status' => 'failed', 'generation_id' => $generationId, 'error' => 'Failed to save result image']);
            return;
        }

        $resultUrl  = baseUrl() . basePath() . '/generations/' . $filename;
        $merchantId = (int) $row['merchant_id'];
        $latencyMs  = $requestedAt !== false ? (int) ((time() - $requestedAt) * 1000) : null;

        $repo->updateStatus($generationId, 'completed', [
            'result_image_url' => $resultUrl,
            'api_response_at'  => date('Y-m-d H:i:s'),
            'api_latency_ms'   => $latencyMs,
        ]);

        $assetRepo = new AssetRepo();
        $modelThumbUrl = $this->makeAndSaveThumbnail($outputPath, $generationsDir, 'model');
        $assetRepo->record($merchantId, $resultUrl, $modelThumbUrl, 'generation', $generationId);

        $infographics = $this->runInfographicBatch($generationId, $merchantId, $outputPath, (string) $row['prompt'], $assetRepo);

        respondJson([
            'status'        => 'completed',
            'generation_id' => $generationId,
            'result_image'  => $resultUrl,
            'infographics'  => $infographics,
        ]);
    }

    public function regenerateInfographics(): void
    {
        @set_time_limit(150);

        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }

        $payload      = json_decode((string) file_get_contents('php://input'), true);
        $generationId = trim((string) ($payload['generation_id'] ?? ''));
        if ($generationId === '') {
            respondJson(['error' => 'generation_id is required'], 400);
            return;
        }

        $repo = new GenerationRepo();
        $row  = $repo->findById($generationId);
        if ($row === null || (int) $row['merchant_id'] !== (int) $merchant['id']) {
            respondJson(['error' => 'Generation not found'], 404);
            return;
        }
        if ($row['status'] !== 'completed' || empty($row['result_image_url'])) {
            respondJson(['error' => 'Generation has no result image to regenerate creatives from'], 400);
            return;
        }

        $tempFiles = [];
        $localResultPath = $this->urlToTempFile((string) $row['result_image_url'], $tempFiles);
        if ($localResultPath === null) {
            respondJson(['error' => 'Could not load the generated model image'], 500);
            return;
        }

        // Remove the old creatives (files + rows + assets) before regenerating.
        $oldRows = (new InfographicGenRepo())->deleteByGeneration($generationId);
        foreach ($oldRows as $old) {
            if (!empty($old['image_url'])) {
                $this->unlinkLocalAsset((string) $old['image_url']);
            }
            (new AssetRepo())->deleteBySource('infographic', $old['id']);
        }

        $assetRepo    = new AssetRepo();
        $infographics = $this->runInfographicBatch($generationId, (int) $merchant['id'], $localResultPath, (string) $row['prompt'], $assetRepo);
        $this->cleanupTempFiles($tempFiles);

        respondJson(['ok' => true, 'generation_id' => $generationId, 'infographics' => $infographics]);
    }

    public function deleteGeneration(): void
    {
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }

        $payload      = json_decode((string) file_get_contents('php://input'), true);
        $generationId = trim((string) ($payload['generation_id'] ?? ''));
        if ($generationId === '') {
            respondJson(['error' => 'generation_id is required'], 400);
            return;
        }

        $merchantId = (int) $merchant['id'];
        $repo = new GenerationRepo();
        $row  = $repo->findById($generationId);
        if ($row === null || (int) $row['merchant_id'] !== $merchantId) {
            respondJson(['error' => 'Generation not found'], 404);
            return;
        }

        $infoRepo = new InfographicGenRepo();
        $assetRepo = new AssetRepo();
        $infoRows = $infoRepo->deleteByGeneration($generationId);
        foreach ($infoRows as $info) {
            if (!empty($info['image_url'])) {
                $this->unlinkLocalAsset((string) $info['image_url']);
            }
            $assetRepo->deleteBySource('infographic', $info['id']);
        }

        if (!empty($row['result_image_url'])) {
            $this->unlinkLocalAsset((string) $row['result_image_url']);
        }
        $assetRepo->deleteBySource('generation', $generationId);
        $repo->delete($generationId, $merchantId);

        respondJson(['ok' => true, 'generation_id' => $generationId]);
    }

    public function listGenerations(): void
    {
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }
        $limit  = min(50, max(1, (int) ($_GET['limit'] ?? 20)));
        $offset = max(0, (int) ($_GET['offset'] ?? 0));
        $rows   = (new GenerationRepo())->listByMerchant((int) $merchant['id'], $limit, $offset);

        $infoRepo = new InfographicGenRepo();
        foreach ($rows as &$row) {
            $row['infographics'] = $row['status'] === 'completed' ? $infoRepo->listByGeneration($row['id']) : [];
        }
        unset($row);

        respondJson(['generations' => $rows]);
    }

    public function getGeneration(): void
    {
        $generationId = trim((string) ($_GET['generation_id'] ?? ''));
        if ($generationId === '') {
            respondJson(['error' => 'generation_id is required'], 400);
            return;
        }
        $row = (new GenerationRepo())->findById($generationId);
        if ($row === null) {
            respondJson(['error' => 'Generation not found'], 404);
            return;
        }
        $row['infographics'] = (new InfographicGenRepo())->listByGeneration($generationId);
        respondJson($row);
    }

    // ── Asset Library ─────────────────────────────────────────────────────────

    public function listAssets(): void
    {
        $merchant = $this->resolveMerchant();
        if ($merchant === null) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }
        $limit  = min(200, max(1, (int) ($_GET['limit'] ?? 100)));
        $offset = max(0, (int) ($_GET['offset'] ?? 0));
        $assets = (new AssetRepo())->listByMerchant((int) $merchant['id'], $limit, $offset);
        respondJson(['assets' => $assets]);
    }

    // ── Private: OpenAI infographic batch ────────────────────────────────────

    /**
     * Runs the 5-style OpenAI marketing-infographic batch against a local
     * reference JPEG, saving each result as a 1080x1080 PNG under
     * generations/, recording infographics + assets rows, and returning the
     * final infographics list for this generation.
     */
    private function runInfographicBatch(string $generationId, int $merchantId, string $referenceImagePath, string $prompt, AssetRepo $assetRepo): array
    {
        $infoRepo   = new InfographicGenRepo();
        $styleKeys  = OpenAIClient::marketingStyleKeys();
        $rowIds     = $infoRepo->createBatch($generationId, $merchantId, $styleKeys);

        if (AppConfig::openAiApiKey() === '') {
            foreach ($rowIds as $rowId) {
                $infoRepo->markFailed($rowId, 'OpenAI service is not configured. Add OPENAI_API_KEY to .env.');
            }
            return $infoRepo->listByGeneration($generationId);
        }

        $openai = new OpenAIClient(AppConfig::openAiApiKey());
        $results = $openai->generateMarketingInfographics($referenceImagePath, '', $prompt);

        $completedStyles = [];
        $generationsDir  = AppConfig::generationsDir();

        foreach ($results as $r) {
            $styleKey = $r['style_key'];
            $completedStyles[$styleKey] = true;

            $pngBytes = ImageUtils::padToSquare($r['image_bytes'], 1080);
            $filename = 'infographic_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '_' . $styleKey . '.png';
            $outPath  = $generationsDir . DIRECTORY_SEPARATOR . $filename;

            if (!ImageUtils::saveImageBytes($pngBytes, $outPath)) {
                $infoRepo->markFailed($rowIds[$styleKey], 'Failed to save infographic image');
                continue;
            }

            $url = baseUrl() . basePath() . '/generations/' . $filename;
            $infoRepo->markCompleted($rowIds[$styleKey], $url);

            $thumbUrl = $this->makeAndSaveThumbnail($outPath, $generationsDir, 'infographic');
            $assetRepo->record($merchantId, $url, $thumbUrl, 'infographic', $rowIds[$styleKey]);
        }

        foreach ($styleKeys as $styleKey) {
            if (!isset($completedStyles[$styleKey])) {
                $infoRepo->markFailed($rowIds[$styleKey], 'Creative generation failed for this style');
            }
        }

        return $infoRepo->listByGeneration($generationId);
    }

    // ── Private: garment-type inference (mirrors GarmentStudioController) ────

    /**
     * Resolves the Fashn category ('tops' | 'bottoms' | 'one-pieces').
     * Prefers the merchant's explicit garment_type selection (from the
     * Product Type step); falls back to keyword-inference from the prompt
     * when no garment_type was provided.
     */
    private function resolveCategory(string $garmentType, string $prompt): string
    {
        $fashnCategory = match ($garmentType) {
            'bottom' => 'bottoms',
            'full'   => 'one-pieces',
            'top'    => 'tops',
            default  => null,
        };
        return $fashnCategory ?? $this->inferCategory($prompt);
    }

    private function inferCategory(string $prompt): string
    {
        $p = strtolower($prompt);
        if (preg_match('/\b(saree|sari|lehenga|jumpsuit|dungaree|romper|dress|gown|overall|abaya|pantsuit|playsuit|salwar\s*kameez|anarkali)\b/', $p)) {
            return 'one-pieces';
        }
        if (preg_match('/\b(pant|pants|jeans|trouser|trousers|shorts|skirt|legging|leggings|palaz|palazzo|dhoti|lungi|salwar|churidar)\b/', $p)) {
            return 'bottoms';
        }
        return 'tops';
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

    // ── Private: image download/persistence helpers ──────────────────────────

    /**
     * Downloads $imageUrl (a temp/library/generations/results/models URL, or
     * a remote https:// URL) into a fresh temp file. Mirrors
     * GarmentStudioController::inputToTempFile()'s local-vs-remote resolution.
     */
    private function urlToTempFile(string $input, array &$tempFiles): ?string
    {
        $tempPath = tempnam(sys_get_temp_dir(), 'studiov2_');
        if ($tempPath === false) return null;
        $tempFiles[] = $tempPath;

        if (str_starts_with($input, 'data:image')) {
            $commaPos = strpos($input, ',');
            if ($commaPos === false) return null;
            $bytes = base64_decode(substr($input, $commaPos + 1), true);
            if ($bytes === false || $bytes === '') return null;
            return file_put_contents($tempPath, $bytes) !== false ? $tempPath : null;
        }

        if (str_starts_with($input, '//')) $input = 'https:' . $input;

        $localFile = $this->resolveLocalPath($input);
        if ($localFile !== null) {
            return @copy($localFile, $tempPath) ? $tempPath : null;
        }

        $fp = fopen($tempPath, 'wb');
        if ($fp === false) return null;

        $ch = curl_init($input);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_FILE           => $fp,
            CURLOPT_USERAGENT      => 'TryFit-StudioV2/1.0',
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);
        curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        fclose($fp);

        if ($status >= 200 && $status < 300) return $tempPath;
        @unlink($tempPath);
        return null;
    }

    /** Resolves a same-host URL (/temp/, /library/, /generations/, /results/, /models/{gender}/) to a local file path, or null if remote/not found. */
    private function resolveLocalPath(string $url): ?string
    {
        $parsedUrl = parse_url($url);
        if (!isset($parsedUrl['path'])) return null;

        $requestHost = isset($parsedUrl['host']) ? strtolower($parsedUrl['host']) : '';
        $myHost      = isset($_SERVER['HTTP_HOST']) ? strtolower(explode(':', $_SERVER['HTTP_HOST'])[0]) : 'localhost';
        $baseUrlHost = strtolower((string) (parse_url(baseUrl(), PHP_URL_HOST) ?? ''));
        $isLocal     = $requestHost === '' || $requestHost === $myHost || $requestHost === $baseUrlHost || $requestHost === '127.0.0.1';
        if (!$isLocal) return null;

        $urlPath  = $parsedUrl['path'];
        $basePath = basePath();
        if ($basePath !== '' && str_starts_with($urlPath, $basePath)) {
            $urlPath = substr($urlPath, strlen($basePath));
        }

        $root = dirname(__DIR__);
        $map  = [
            '#^/temp/([^/]+)$#'        => fn($m) => $root . '/temp/' . explode('?', $m[1])[0],
            '#^/library/([^/]+)$#'     => fn($m) => $root . '/library/' . explode('?', $m[1])[0],
            '#^/generations/([^/]+)$#' => fn($m) => $root . '/generations/' . explode('?', $m[1])[0],
            '#^/results/([^/]+)$#'     => fn($m) => $root . '/results/' . explode('?', $m[1])[0],
            '#^/models/([^/]+)/([^/]+)$#' => fn($m) => $root . '/models/' . $m[1] . '/' . explode('?', $m[2])[0],
        ];
        foreach ($map as $pattern => $resolver) {
            if (preg_match($pattern, $urlPath, $m)) {
                $candidate = $resolver($m);
                return is_file($candidate) ? $candidate : null;
            }
        }
        return null;
    }

    /** Deletes the local file backing a stored permanent URL, if it resolves to one. */
    private function unlinkLocalAsset(string $url): void
    {
        $path = $this->resolveLocalPath($url);
        if ($path !== null && is_file($path)) {
            @unlink($path);
        }
    }

    /**
     * Downloads $imageUrl and saves it permanently (as JPEG) under $destDir,
     * returning ['url' => public URL, 'path' => local path] or null on failure.
     */
    private function persistPermanentImage(string $imageUrl, string $destDir, string $prefix): ?array
    {
        if (!is_dir($destDir) && !@mkdir($destDir, 0755, true)) {
            return null;
        }

        $tempFiles = [];
        $tempPath  = $this->urlToTempFile($imageUrl, $tempFiles);
        if ($tempPath === null) {
            $this->cleanupTempFiles($tempFiles);
            return null;
        }

        $filename = $prefix . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.jpg';
        $destPath = $destDir . DIRECTORY_SEPARATOR . $filename;

        $imgResource = @imagecreatefromstring((string) file_get_contents($tempPath));
        if ($imgResource !== false) {
            $saved = @imagejpeg($imgResource, $destPath, 90);
            imagedestroy($imgResource);
        } else {
            $saved = @copy($tempPath, $destPath);
        }
        $this->cleanupTempFiles($tempFiles);

        if (!$saved) return null;

        $dirName = basename($destDir);
        return ['url' => baseUrl() . basePath() . '/' . $dirName . '/' . $filename, 'path' => $destPath];
    }

    private function makeAndSaveThumbnail(string $sourcePath, string $dir, string $prefix): ?string
    {
        $thumbFilename = 'thumb_' . $prefix . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.jpg';
        $thumbPath     = $dir . DIRECTORY_SEPARATOR . $thumbFilename;
        if (!ImageUtils::makeThumbnail($sourcePath, $thumbPath, 320)) {
            return null;
        }
        $dirName = basename($dir);
        return baseUrl() . basePath() . '/' . $dirName . '/' . $thumbFilename;
    }

    private function cleanupTempFiles(array $files): void
    {
        foreach ($files as $file) {
            if (is_string($file) && is_file($file)) @unlink($file);
        }
    }
}
