<?php

declare(strict_types = 1)
;

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\MerchantRepo;
use TryFit\Middleware\PlanLimitCheck;
use VTON\ImageUtils;
use VTON\RunpodVtonClient;
use VTON\SareeRouting;

class TryOnController
{
    public function handle(): void
    {
        try {
            $this->submit();
        }
        catch (\Throwable $e) {
            writeLog('ERROR', 'TryOnController fatal', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);
            respondJson(['error' => 'Server error: ' . $e->getMessage()], 500);
        }
    }

    /**
     * GET /tryon-status?job_id=...&shop=...&session_id=...&seed=...
     *
     * Polled by the widget every few seconds after handle() returns
     * 'processing'. Checks RunPod exactly once per call (no internal retry
     * loop) so this request always completes in well under Shopify's App
     * Proxy timeout, regardless of how long the underlying generation takes —
     * that's the whole point of the submit/poll split. Stateless: all the
     * context needed to finish (shop, session_id, seed) is passed back by the
     * client each call rather than looked up from a DB row, so no schema
     * change was needed to add this.
     */
    public function status(): void
    {
        try {
            $this->pollStatus();
        }
        catch (\Throwable $e) {
            writeLog('ERROR', 'TryOnController status fatal', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);
            respondJson(['error' => 'Server error: ' . $e->getMessage()], 500);
        }
    }

    private function pollStatus(): void
    {
        $jobId = trim((string)($_GET['job_id'] ?? ''));
        if ($jobId === '') {
            respondJson(['error' => 'job_id is required'], 400);
            return;
        }

        $shop  = trim((string)($_GET['shop'] ?? ''));
        $mRepo = new MerchantRepo();
        $merchant = $shop !== '' ? ($mRepo->findByDomain($shop) ?? $mRepo->findByDomainLike($shop)) : null;

        $sessionId     = trim((string)($_GET['session_id'] ?? '')) ?: null;
        $seed          = isset($_GET['seed']) ? (int)$_GET['seed'] : -1;
        $sessionRepo   = new \TryFit\Db\SessionRepo();
        $analyticsRepo = new \TryFit\Db\AnalyticsRepo();

        // Engine (Fashn for sarees, RunPod otherwise) is read from the job ID prefix.
        $check = SareeRouting::checkStatus($jobId);

        if ($check['job_status'] === 'processing' || $check['job_status'] === 'error') {
            // 'error' is a transient network/HTTP hiccup checking status, not a
            // job failure — safe for the client to just poll again.
            respondJson(['status' => 'processing']);
            return;
        }

        if ($check['job_status'] === 'failed') {
            $rawError = $check['error_details'] ?? 'Try-on API request failed';
            writeLog('WARNING', 'Try-on API failed (async)', ['error_details' => $rawError, 'shop' => $shop]);
            if ($sessionId) {
                $sessionRepo->updateStatus($sessionId, 'failed', ['error_message' => $rawError]);
            }
            $this->logCompletion($analyticsRepo, 'tryon_failed', $merchant);
            // A saree photo Fashn can't find a body in (cropped, seated, face-only)
            // is fixable by the shopper — tell them how, instead of a generic error.
            $userError = SareeRouting::isFashnJob($jobId) && preg_match('/pose|body/i', $rawError)
                ? "We couldn't see your full body in that photo. Please upload a standing, front-facing photo that shows you from head to toe."
                : 'Try-on failed. Please try again.';
            respondJson(['status' => 'failed', 'error' => $userError, 'raw_error' => $rawError], 400);
            return;
        }

        // 'completed'
        $resultsDir = AppConfig::resultsDir();
        if (!is_dir($resultsDir)) {
            @mkdir($resultsDir, 0755, true);
        }
        $filename   = 'tryon_result_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.jpg';
        $outputPath = $resultsDir . DIRECTORY_SEPARATOR . $filename;

        if (!ImageUtils::saveImageBytes((string)$check['image_bytes'], $outputPath)) {
            if ($sessionId) {
                $sessionRepo->updateStatus($sessionId, 'failed', ['error_message' => 'Failed to save result image']);
            }
            respondJson(['status' => 'failed', 'error' => 'Failed to save result image'], 500);
            return;
        }

        $url = baseUrl() . basePath() . '/results/' . $filename;

        if ($sessionId) {
            $sessionRepo->updateStatus($sessionId, 'completed', [
                'result_image_url' => $url,
                'result_seed'      => $seed >= 0 ? $seed : null,
            ]);
        }

        if ($merchant) {
            try {
                $mRepo->incrementTryonCount((int)$merchant['id']);
            } catch (\Throwable $e) {
                error_log('[FitFyce] merchant count increment failed: ' . $e->getMessage());
            }
        }
        $this->logCompletion($analyticsRepo, 'tryon_completed', $merchant);

        respondJson(['status' => 'completed', 'result_image' => $url, 'seed' => $seed >= 0 ? $seed : null]);
    }

    private function submit(): void
    {
        // Submission itself (image prep + handing the job to RunPod) is fast —
        // the actual generation happens async, checked via status(). No long
        // set_time_limit needed here any more.
        @set_time_limit(30);

        // ── Merchant auth + plan enforcement ─────────────────────────────────────
        $shop  = trim((string)($_GET['shop'] ?? ''));
        if ($shop === '') {
            respondJson(['error' => 'shop parameter is required'], 400);
        }

        $mRepo    = new MerchantRepo();
        $merchant = $mRepo->findByDomain($shop) ?? $mRepo->findByDomainLike($shop);

        if ($merchant === null || (int)$merchant['is_active'] !== 1) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }

        // Auto-reset monthly count when the 30-day billing window has elapsed
        $billingStart = $merchant['billing_cycle_start'] ?? null;
        if ($billingStart !== null && strtotime('+30 days', (int)strtotime($billingStart)) <= time()) {
            $mRepo->resetMonthlyCount((int)$merchant['id']);
            $merchant['tryon_count_month']    = 0;
            $merchant['billing_cycle_start']  = date('Y-m-d');
        }

        PlanLimitCheck::handle($merchant);
        // ─────────────────────────────────────────────────────────────────────────

        $payload = json_decode((string)file_get_contents('php://input'), true);

        if (!is_array($payload)) {
            respondJson(['error' => 'Invalid JSON body'], 400);
        }

        $clothingInput = trim((string)($payload['clothing_image'] ?? ''));
        $avatarInput = trim((string)($payload['avatar_image'] ?? ''));
        $variantId = isset($payload['shopify_variant_id']) ? (int)$payload['shopify_variant_id'] : null;

        // Try to fetch mapping from DB if variantId is provided
        $mapping = null;
        if ($variantId !== null) {
            $repo = new \TryFit\Db\ProductRepo();
            $mapping = $repo->getMappingByVariantId($variantId);
        }

        // Use mapping values if available (Database mapping takes priority over storefront fallback)
        if ($mapping) {
            if (!empty($mapping['tryon_image_url'])) {
                $clothingInput = $mapping['tryon_image_url'];
            }
            if (!empty($mapping['clothing_prompt'])) {
                $payload['clothing_prompt'] = $mapping['clothing_prompt'];
            }
            if (!empty($mapping['avatar_sex'])) {
                $payload['avatar_sex'] = $mapping['avatar_sex'];
            }
        }

        if ($clothingInput === '' || $avatarInput === '') {
            respondJson(['error' => 'clothing_image and avatar_image are required'], 400);
        }

        // Sarees go to the hosted Fashn.ai API; everything else to RunPod.
        // Many saree listings don't say "saree" in the title ("Purple Kanjivaram
        // Silk"), so also check what we've synced about the product: its type,
        // tags, handle and collection. The Studio wizard has an explicit Saree
        // pick; the widget has to infer it.
        $productRow = null;
        $shopifyProductId = isset($payload['shopify_product_id']) ? (int)$payload['shopify_product_id'] : 0;
        if ($shopifyProductId > 0) {
            try {
                $productRow = (new \TryFit\Db\ProductRepo())->findByShopifyId((int)$merchant['id'], $shopifyProductId);
            } catch (\Throwable $e) {
                writeLog('WARNING', 'Product lookup for saree detection failed', ['message' => $e->getMessage()]);
            }
        }
        $useFashn = SareeRouting::shouldUseFashn(
            (string)($mapping['clothing_prompt'] ?? ($payload['clothing_prompt'] ?? '')),
            (string)($payload['product_title'] ?? ''),
            (string)($productRow['product_type'] ?? ''),
            (string)($productRow['tags'] ?? ''),
            (string)($productRow['handle'] ?? ''),
            (string)($productRow['collection_title'] ?? '')
        );
        writeLog('INFO', 'Try-on engine decision', [
            'engine'           => $useFashn ? 'fashn' : 'runpod',
            'fashn_configured' => AppConfig::useFashn(),
            'product_title'    => $payload['product_title'] ?? null,
            'product_type'     => $productRow['product_type'] ?? null,
            'tags'             => $productRow['tags'] ?? null,
            'handle'           => $productRow['handle'] ?? null,
            'collection'       => $productRow['collection_title'] ?? null,
            'variant_prompt'   => $mapping['clothing_prompt'] ?? null,
        ]);

        // ── RunPod (FASHN VTON 1.5) ────────────────────────────────────────────
        if (!$useFashn && !AppConfig::useRunpod()) {
            respondJson(['error' => 'Try-on service is not configured. Add RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID to .env.'], 503);
            return;
        }

        // Drives both the flat-lay pre-conversion gate below and the RunPod
        // 'category' param (tops/bottoms/one-pieces).
        $garmentType = $this->resolveGarmentType($mapping, $payload);

        $seed = isset($payload['seed']) ? (int)$payload['seed'] : -1;

        // 'flat_lay'        — garment photographed flat, unworn (e.g. folded saree)
        // 'ghost_mannequin' — invisible mannequin form shot
        // 'on_model'        — garment already worn by a model
        $imageType = strtolower((string)(is_array($mapping) ? ($mapping['image_type'] ?? 'flat_lay') : 'flat_lay'));

        // A flat, unworn saree/lehenga photo doesn't drape correctly when fed
        // straight into the try-on model. Route these through FlatLayConverter
        // first to get a photorealistic worn reference.
        $clothingPromptText = (string)($mapping['clothing_prompt'] ?? ($payload['clothing_prompt'] ?? ''));
        // Never for Fashn sarees: FLUX Kontext re-imagines the saree into a
        // generated "worn" photo (often losing the real colour, pattern or
        // drape), and tryon-max drapes the raw flat-lay photo correctly itself.
        $useFlatLayConversion = $garmentType === 'full'
            && $imageType === 'flat_lay'
            && !$useFashn
            && AppConfig::useFlatLayConverter();
        $flatLayHint = $this->inferFlatLayGarmentHint($clothingPromptText);

        $tempFiles = [];

        $clothingPath   = null;
        $gotWornReference = false;
        if ($useFlatLayConversion) {
            require_once dirname(__DIR__) . '/src/FlatLayConverter.php';
            $converter    = new \VTON\FlatLayConverter(AppConfig::falApiKey(), AppConfig::tempDir());
            $clothingPath = $converter->getWornReference($clothingInput, $flatLayHint, $tempFiles);
            if ($clothingPath === null) {
                writeLog('WARNING', 'FlatLayConverter failed, falling back to raw flat-lay image', [
                    'hint' => $flatLayHint,
                ]);
            } else {
                $gotWornReference = true;
            }
        }

        if ($clothingPath === null) {
            $clothingPath = $this->inputToTempFile($clothingInput, $tempFiles);
        }
        if ($clothingPath === null) {
            $this->cleanupTempFiles($tempFiles);
            respondJson(['error' => 'Failed to load clothing_image'], 400);
        }

        $avatarPath = $this->inputToTempFile($avatarInput, $tempFiles);
        if ($avatarPath === null) {
            $this->cleanupTempFiles($tempFiles);
            respondJson(['error' => 'Failed to load avatar_image'], 400);
        }

        $clothingPath = $this->trackJpeg($clothingPath, $tempFiles);
        $avatarPath   = $this->trackJpeg($avatarPath,  $tempFiles);

        // 768 px minimum gives the model enough pixel detail to preserve anatomy
        // and render garment texture accurately.  512 px is the hard API floor but
        // produces noticeably worse anatomy and fabric quality.
        $clothingPath = ImageUtils::ensureMinimumSize($clothingPath, 768, 768, $tempFiles);
        $avatarPath   = ImageUtils::ensureMinimumSize($avatarPath,   768, 768, $tempFiles);

        // RunPod's FASHN VTON 1.5 has no separate concept for ghost-mannequin —
        // only a worn reference ('model') vs an unworn/flat photo ('flat-lay').
        // Default to 'model' when unconfigured — most merchant product photos
        // show the garment worn, and that's RunPod's own built-in default too.
        // Only tell it 'flat-lay' when the mapping explicitly says the source
        // photo is flat/unworn and we didn't already convert it to a worn one.
        $mappingHasImageType = is_array($mapping) && !empty($mapping['image_type']);
        $garmentPhotoType = ($mappingHasImageType && !$gotWornReference && in_array($imageType, ['flat_lay', 'ghost_mannequin'], true))
            ? 'flat-lay'
            : 'model';
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

        $runpodParams = [
            'person_image'       => ImageUtils::fileToBase64Uri($avatarPath),
            'garment_image'      => ImageUtils::fileToBase64Uri($clothingPath),
            'category'           => $category,
            'garment_photo_type' => $garmentPhotoType,
        ];
        if ($clothingPromptText !== '') {
            $runpodParams['prompt'] = $clothingPromptText;
        }
        if ($seed >= 0) {
            $runpodParams['seed'] = $seed;
        }

        $sessionId = $payload['session_id'] ?? null;

        if ($useFashn) {
            $submitResult = SareeRouting::submitFashn($runpodParams);
        } else {
            $runpodClient = new RunpodVtonClient(AppConfig::runpodApiKey(), AppConfig::runpodEndpointId());
            $submitResult = $runpodClient->submitRun($runpodParams);
        }

        $this->cleanupTempFiles($tempFiles);

        if ($submitResult['status_code'] !== 200 || empty($submitResult['prediction_id'])) {
            $rawError = $submitResult['error_details'] ?? 'Try-on API request failed';

            writeLog('WARNING', 'Try-on API submit failed', [
                'status_code'   => $submitResult['status_code'],
                'error_details' => $rawError,
                'shop'          => $shop,
            ]);

            $sessionRepo = new \TryFit\Db\SessionRepo();
            $analyticsRepo = new \TryFit\Db\AnalyticsRepo();
            if ($sessionId) {
                $sessionRepo->updateStatus($sessionId, 'failed', ['error_message' => $rawError]);
            }
            $this->logCompletion($analyticsRepo, 'tryon_failed', $merchant);

            $userError = $submitResult['status_code'] === 429
                ? 'Service temporarily unavailable. Please try again later.'
                : 'Try-on failed. Please try again.';

            respondJson([
                'error'       => $userError,
                'status_code' => $submitResult['status_code'],
                'raw_error'   => $rawError,
            ], $submitResult['status_code'] === 429 ? 503 : 400);
            return;
        }

        // Submission succeeded — generation is still running on RunPod's side.
        // Return immediately; the client polls GET /tryon-status until it
        // completes or fails. This is what keeps every single request short
        // enough to never hit Shopify's App Proxy timeout, no matter how long
        // the actual generation takes.
        respondJson([
            'status' => 'processing',
            'job_id' => $submitResult['prediction_id'],
            'seed'   => $seed >= 0 ? $seed : null,
        ]);
    }

    private function logCompletion(\TryFit\Db\AnalyticsRepo $repo, string $column, ?array $merchant = null): void
    {
        if ($merchant === null) {
            $shop = trim((string)($_GET['shop'] ?? ''));
            if ($shop !== '') {
                $mRepo    = new MerchantRepo();
                $merchant = $mRepo->findByDomain($shop);
            }
        }
        if ($merchant) {
            $repo->upsertDaily((int)$merchant['id'], date('Y-m-d'), [$column => 1]);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Accepts either a base64 data URI or an https:// URL and writes the
     * image bytes to a temporary file.  Returns the temp file path or null.
     */
    private function inputToTempFile(string $input, array &$tempFiles): ?string
    {
        $tempPath = tempnam(sys_get_temp_dir(), 'vton_');
        if ($tempPath === false) {
            return null;
        }
        $tempFiles[] = $tempPath;

        // base64 data URI: data:image/jpeg;base64,<data>
        if (str_starts_with($input, 'data:image')) {
            $commaPos = strpos($input, ',');
            if ($commaPos === false) {
                return null;
            }
            $b64 = substr($input, $commaPos + 1);
            $bytes = base64_decode($b64, true);
            if ($bytes === false || $bytes === '') {
                return null;
            }
            if (file_put_contents($tempPath, $bytes) === false) {
                return null;
            }
            return $tempPath;
        }

        // Protocol-relative URL
        if (str_starts_with($input, '//')) {
            $input = 'https:' . $input;
        }

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

        // Remote URL — download via curl
        $fp = fopen($tempPath, 'wb');
        if ($fp === false) {
            return null;
        }
        $ch = curl_init($input);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_FILE => $fp,
            CURLOPT_USERAGENT => 'TryFit/1.0',
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
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

    private function trackJpeg(string $path, array &$tempFiles): string
    {
        $jpegPath = ImageUtils::ensureJpeg($path);
        if ($jpegPath !== $path) {
            $tempFiles[] = $jpegPath;
        }
        return $jpegPath;
    }

    private function cleanupTempFiles(array $files): void
    {
        foreach ($files as $file) {
            if (is_string($file) && is_file($file)) {
                @unlink($file);
            }
        }
    }

    private function normalizeText(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $trimmed = trim((string)$value);
        return $trimmed === '' ? null : $trimmed;
    }

    // ── Garment type resolution ───────────────────────────────────────────────

    /**
     * Returns 'top', 'bottom', or 'full'.
     * DB field takes priority; falls back to keyword detection from clothing_prompt.
     */
    private function resolveGarmentType(?array $mapping, array $payload): string
    {
        // Merchants using the plain widget button (no Garment Studio mapping)
        // never set clothing_prompt/garment_type — fall back to the Shopify
        // product's own title, a signal every merchant already sets for free
        // as part of normal store setup, not something this app requires.
        $prompt = $mapping['clothing_prompt']
            ?? ($payload['clothing_prompt'] ?? null)
            ?? ($payload['product_title'] ?? null);

        // Full-body garments (saree, lehenga, dress…) must always map to 'full'
        // regardless of what the merchant stored — this drives the flat-lay
        // pre-conversion gate below, not an upstream API parameter.
        if (!empty($prompt) && $this->inferGarmentTypeFromPrompt($prompt) === 'full') {
            return 'full';
        }

        if (!empty($mapping['garment_type'])) {
            $gt = strtolower((string)$mapping['garment_type']);
            if (in_array($gt, ['top', 'bottom', 'full'], true)) {
                return $gt;
            }
        }

        return $this->inferGarmentTypeFromPrompt($prompt);
    }

    /**
     * Maps a clothing prompt to a garment-type category.
     * Returns 'top', 'bottom', or 'full'.
     */
    private function inferGarmentTypeFromPrompt(?string $prompt): string
    {
        if (empty($prompt)) {
            return 'top'; // safe default — most try-on products are upper-body wear
        }
        $p = strtolower($prompt);

        // Full-body garments — replace entire outfit
        if (preg_match('/\b(saree|sari|lehenga|jumpsuit|dungaree|romper|dress|gown|overall|abaya|pantsuit|playsuit|salwar\s*kameez|anarkali)\b/', $p)) {
            return 'full';
        }

        // Bottom-wear
        if (preg_match('/\b(pant|pants|jeans|trouser|trousers|shorts|skirt|legging|leggings|palaz|palazzo|dhoti|lungi|salwar|churidar)\b/', $p)) {
            return 'bottom';
        }

        // Default: top (shirt, t-shirt, blouse, kurti, kurta, jacket, hoodie, etc.)
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

}
