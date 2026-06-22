<?php

declare(strict_types = 1)
;

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\MerchantRepo;
use TryFit\Middleware\PlanLimitCheck;
use VTON\Config;
use VTON\FashnClient;
use VTON\ImageUtils;
use VTON\TryOnDiffusionClient;

class TryOnController
{
    // Clothing prompt: drives garment rendering quality and fit accuracy
    // Clothing prompt — top/bottom wear.
    // Comma-separated visual descriptors work best for diffusion-based VTON models.
    private const DEFAULT_CLOTHING_PROMPT =
        'garment fitted naturally on body, correct shoulder and sleeve alignment, ' .
        'neckline aligned with neck, fabric folds and wrinkles at joints, ' .
        'exact color and pattern from product image, realistic fabric texture, ' .
        'clean garment edges, photorealistic, high fidelity, fashion photography';

    // Clothing prompt — full-body garments (saree, lehenga, gown, dress).
    // Describes the WORN visual state so the diffusion model renders it correctly.
    private const DEFAULT_CLOTHING_PROMPT_FULLBODY =
        'full-length garment worn from shoulders to feet, ' .
        'saree in traditional nivi drape style, ' .
        'accordion pleats tucked at front waist, pallu draped over left shoulder, ' .
        'fitted blouse on top, petticoat visible at hemline, ' .
        'natural silk folds and fabric flow, exact fabric color preserved, ' .
        'zari border along hem and pallu edge, gold embroidery motifs, ' .
        'photorealistic, traditional Indian fashion photography';

    // Avatar prompt — top/bottom wear: preserve lower body, only replace upper garment.
    private const DEFAULT_AVATAR_PROMPT =
        'PRESERVE EXACTLY: the person\'s face, eyes, nose, mouth, skin tone, hairstyle, ' .
        'hair color, body shape, body proportions, arm positions, hand shape, fingers, ' .
        'leg position, footwear, accessories, jewelry, and the full background scene. ' .
        'KEEP UNCHANGED: the original camera angle, framing, lighting direction, shadow placement, ' .
        'image composition, and all lower-body clothing (pants, skirt, shoes). ' .
        'DO NOT: regenerate the full body, alter the face, change the pose, ' .
        'add or remove limbs, crop the image, modify skin, or change background. ' .
        'Only the upper-body garment region should be replaced. Everything else must be pixel-identical.';

    // Avatar prompt — full-body garments: allow full outfit replacement.
    private const DEFAULT_AVATAR_PROMPT_FULLBODY =
        'PRESERVE EXACTLY: the person\'s face, eyes, nose, mouth, skin tone, hairstyle, ' .
        'hair color, body shape, body proportions, arm positions, hand shape, fingers, ' .
        'leg position, footwear, accessories, and jewelry. ' .
        'KEEP UNCHANGED: the original camera angle, framing, lighting direction, shadow placement, ' .
        'image composition, and the full background scene. ' .
        'DO NOT: alter the face, change the pose, add or remove limbs, crop the image, ' .
        'modify skin tone, or change background. ' .
        'Replace the ENTIRE outfit from shoulders to feet with the new garment.';

    public function handle(): void
    {
        try {
            $this->process();
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

    private function process(): void
    {
        // Allow up to 120 s — AI try-on APIs can take 60–90 s to respond.
        @set_time_limit(120);

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

        $tempFiles = [];

        $clothingPath = $this->inputToTempFile($clothingInput, $tempFiles);
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

        // Resolve garment type before prompt selection — Fashn.ai requires it as
        // a category parameter ('tops' | 'bottoms' | 'one-pieces').
        $garmentType = $this->resolveGarmentType($mapping, $payload);

        // Use per-product prompts from DB mapping or payload; fall back to quality defaults.
        // TryOnDiffusion has no separate negative_prompt field — embedding "Negative: ..."
        // inside clothing_prompt dilutes the positive description and worsens results.
        $clothingPrompt = $this->normalizeText($payload['clothing_prompt'] ?? null)
            ?? ($garmentType === 'full' ? self::DEFAULT_CLOTHING_PROMPT_FULLBODY : self::DEFAULT_CLOTHING_PROMPT);
        $avatarPrompt   = $this->normalizeText($payload['avatar_prompt'] ?? null)
            ?? ($garmentType === 'full' ? self::DEFAULT_AVATAR_PROMPT_FULLBODY : self::DEFAULT_AVATAR_PROMPT);

        $seed      = isset($payload['seed']) ? (int)$payload['seed'] : -1;
        $avatarSex = in_array($payload['avatar_sex'] ?? null, ['male', 'female'], true)
            ? $payload['avatar_sex']
            : (is_array($mapping) ? ($mapping['avatar_sex'] ?? null) : null);

        // ── Step 1: Flat-lay → Worn reference (saree / lehenga / full-body) ───
        // When the garment is full-body AND the product image is a flat-lay,
        // call FLUX Kontext Pro to generate a draped worn reference first.
        // TryOnDiffusion / Fashn then transfers that worn reference onto the
        // customer's photo — producing correct saree draping instead of a dress.
        $imageType = strtolower((string)(is_array($mapping) ? ($mapping['image_type'] ?? 'flat_lay') : 'flat_lay'));
        if ($garmentType === 'full' && $imageType === 'flat_lay' && AppConfig::useFlatLayConverter()) {
            require_once dirname(__DIR__) . '/src/FlatLayConverter.php';
            $garmentHint = $this->inferGarmentHint($mapping['clothing_prompt'] ?? ($payload['clothing_prompt'] ?? ''));
            $converter   = new \VTON\FlatLayConverter(AppConfig::falApiKey(), AppConfig::resultsDir());
            $wornPath    = $converter->getWornReference($clothingInput, $garmentHint, $tempFiles);
            if ($wornPath !== null) {
                // Swap the flat-lay path for the worn reference
                $clothingPath = $this->trackJpeg($wornPath, $tempFiles);
                $clothingPath = ImageUtils::ensureMinimumSize($clothingPath, 768, 768, $tempFiles);
                writeLog('INFO', 'TryOnController: using worn reference from FlatLayConverter', [
                    'garment_hint' => $garmentHint,
                ]);
            }
        }
        // ─────────────────────────────────────────────────────────────────────

        if (AppConfig::useFashn()) {
            // ── Fashn.ai path (IDM-VTON) ────────────────────────────────────────
            require_once dirname(__DIR__) . '/src/FashnClient.php';
            // Fashn uses base64 data URIs, proper human parsing, clothing masking,
            // and pose conditioning internally — no prompt tuning is needed.
            $fashnCategory = match ($garmentType) {
                'bottom' => 'bottoms',
                'full'   => 'one-pieces',
                default  => 'tops',
            };

            $fashnParams = [
                'model_image'        => ImageUtils::fileToBase64Uri($avatarPath),
                'garment_image'      => ImageUtils::fileToBase64Uri($clothingPath),
                'category'           => $fashnCategory,
                // Use quality mode for full-body garments (saree, lehenga, dress)
                // to get better draping, fabric flow, and identity preservation.
                'mode'               => ($garmentType === 'full') ? 'quality' : null,
                'adjust_hands'       => true,
                'restore_background' => true,
                // For full-body garments from a worn reference image, allow full
                // outfit replacement (restore_clothes: false). For flat-lay images
                // keep true so non-garment body parts are preserved.
                'restore_clothes'    => ($garmentType === 'full' && ($mapping['image_type'] ?? 'flat_lay') === 'on_model') ? false : true,
                'seed'               => $seed,
            ];

            // Flag long tops (kurti, kurta, tunic, kaftan…) so Fashn masks correctly
            if ($garmentType === 'top') {
                $pLower = strtolower($clothingPrompt);
                if (preg_match('/\b(kurti|kurta|tunic|kaftan|longline|long[\s_-]*shirt|long[\s_-]*top)\b/', $pLower)) {
                    $fashnParams['long_top'] = true;
                }
            }

            $fashnClient = new FashnClient(AppConfig::fashnApiKey(), AppConfig::fashnApiMode());
            $result      = $fashnClient->tryOn($fashnParams);
        } else {
            // ── TryOnDiffusion path (RapidAPI legacy) ───────────────────────────
            $params = [
                'clothing_image_path'   => $clothingPath,
                'avatar_image_path'     => $avatarPath,
                'background_image_path' => null,
                'clothing_prompt'       => $clothingPrompt,
                'avatar_prompt'         => $avatarPrompt,
                'avatar_sex'            => $avatarSex,
                'background_prompt'     => null,
                'seed'                  => $seed,
            ];

            $client = new TryOnDiffusionClient(Config::apiUrl(), Config::apiKey());
            $result = $client->tryOnFile($params);
        }

        $this->cleanupTempFiles($tempFiles);

        $sessionId = $payload['session_id'] ?? null;
        $sessionRepo = new \TryFit\Db\SessionRepo();
        $analyticsRepo = new \TryFit\Db\AnalyticsRepo();

        if ($result['status_code'] !== 200 || $result['image_bytes'] === null) {
            $rawError = $result['error_details'] ?? 'Try-on API request failed';

            // Log the actual API error so it appears in logs/app.log for debugging.
            writeLog('WARNING', 'Try-on API failed', [
                'status_code'   => $result['status_code'],
                'error_details' => $rawError,
                'shop'          => trim((string)($_GET['shop'] ?? '')),
            ]);

            // Map upstream error codes to user-friendly messages
            if ($result['status_code'] === 429) {
                $userError = 'Service temporarily unavailable. Please try again later.';
            } elseif ($result['status_code'] === 400 && is_string($rawError) && str_contains($rawError, 'image_too_small')) {
                $userError = 'Try-on failed. Please try again.';
            } elseif ($result['status_code'] === 400 && is_string($rawError) && str_contains($rawError, 'File size exceeds')) {
                $userError = 'Image file is too large. Please use a smaller photo and try again.';
            } elseif ($result['status_code'] === 0) {
                $userError = 'Try-on request timed out. Please try again.';
            } elseif ($result['status_code'] === 401 || $result['status_code'] === 403) {
                $userError = 'Try-on service configuration error. Please contact support.';
            } else {
                $userError = 'Try-on failed. Please try again.';
            }

            if ($sessionId) {
                $sessionRepo->updateStatus($sessionId, 'failed', [
                    'error_message' => $rawError
                ]);
            }
            $this->logCompletion($analyticsRepo, 'tryon_failed', $merchant);

            respondJson([
                'error'       => $userError,
                'status_code' => $result['status_code'],
                'raw_error'   => $rawError,
            ], $result['status_code'] === 429 ? 503 : 400);
        }

        $resultsDir = Config::resultsDir();
        if (!is_dir($resultsDir)) {
            @mkdir($resultsDir, 0755, true);
        }

        $filename = 'tryon_result_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.jpg';
        $outputPath = $resultsDir . DIRECTORY_SEPARATOR . $filename;

        if (!ImageUtils::saveImageBytes($result['image_bytes'], $outputPath)) {
            if ($sessionId) {
                $sessionRepo->updateStatus($sessionId, 'failed', ['error_message' => 'Failed to save result image']);
            }
            respondJson(['error' => 'Failed to save result image'], 500);
        }

        $url = baseUrl() . basePath() . '/results/' . $filename;

        if ($sessionId) {
            $sessionRepo->updateStatus($sessionId, 'completed', [
                'result_image_url' => $url,
                'result_seed' => $result['seed'],
                'api_latency_ms' => (int)((microtime(true) - $_SERVER['REQUEST_TIME_FLOAT']) * 1000),
            ]);
        }

        // Increment monthly usage counter — only charged on a successful try-on
        try {
            $mRepo->incrementTryonCount((int)$merchant['id']);
        } catch (\Throwable $e) {
            error_log('[FitFyce] merchant count increment failed: ' . $e->getMessage());
        }

        $this->logCompletion($analyticsRepo, 'tryon_completed', $merchant);

        respondJson(['result_image' => $url, 'seed' => $result['seed']]);
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
        ]);
        curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        fclose($fp);

        if ($status < 200 || $status >= 300) {
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
        $prompt = $mapping['clothing_prompt'] ?? ($payload['clothing_prompt'] ?? null);

        // Full-body garments (saree, lehenga, dress…) must always map to 'full'
        // regardless of what the merchant stored — sending them as 'tops' produces
        // a short-dress result because Fashn only replaces the upper body.
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
     * Maps a clothing prompt to a FlatLayConverter garment hint key.
     * Returns 'saree', 'lehenga', or 'default'.
     */
    private function inferGarmentHint(string $prompt): string
    {
        $p = strtolower($prompt);
        if (preg_match('/\b(saree|sari)\b/', $p))    return 'saree';
        if (preg_match('/\b(lehenga|lehnga)\b/', $p)) return 'lehenga';
        return 'default';
    }

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

}
