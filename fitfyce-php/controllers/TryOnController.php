<?php

declare(strict_types = 1)
;

namespace TryFit\Controllers;

use VTON\Config;
use VTON\ImageUtils;
use VTON\TryOnDiffusionClient;

class TryOnController
{
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
        $avatarPath = $this->trackJpeg($avatarPath, $tempFiles);

        $params = [
            'clothing_image_path' => $clothingPath,
            'avatar_image_path' => $avatarPath,
            'background_image_path' => null,
            'clothing_prompt' => $this->normalizeText($payload['clothing_prompt'] ?? null),
            'avatar_prompt' => $this->normalizeText($payload['avatar_prompt'] ?? null),
            'avatar_sex' => in_array($payload['avatar_sex'] ?? null, ['male', 'female'], true)
            ? $payload['avatar_sex']
            : ($mapping['avatar_sex'] ?? null),
            'background_prompt' => null,
            'seed' => isset($payload['seed']) ? (int)$payload['seed'] : -1,
        ];

        $client = new TryOnDiffusionClient(Config::apiUrl(), Config::apiKey());
        $result = $client->tryOnFile($params);

        $this->cleanupTempFiles($tempFiles);

        $sessionId = $payload['session_id'] ?? null;
        $sessionRepo = new \TryFit\Db\SessionRepo();
        $analyticsRepo = new \TryFit\Db\AnalyticsRepo();

        if ($result['status_code'] !== 200 || $result['image_bytes'] === null) {
            if ($sessionId) {
                $sessionRepo->updateStatus($sessionId, 'failed', [
                    'error_message' => $result['error_details'] ?? 'Try-on API request failed'
                ]);
            }
            $this->logCompletion($analyticsRepo, 'tryon_failed');

            respondJson([
                'error' => $result['error_details'] ?? 'Try-on API request failed',
                'status_code' => $result['status_code'],
            ], 400);
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
        $this->logCompletion($analyticsRepo, 'tryon_completed');

        respondJson(['result_image' => $url, 'seed' => $result['seed']]);
    }

    private function logCompletion(\TryFit\Db\AnalyticsRepo $repo, string $column): void
    {
        $shop = trim((string)($_GET['shop'] ?? ''));
        if ($shop !== '') {
            $mRepo = new \TryFit\Db\MerchantRepo();
            $merchant = $mRepo->findByDomain($shop);
            if ($merchant) {
                $repo->upsertDaily((int)$merchant['id'], date('Y-m-d'), [$column => 1]);
            }
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
}
