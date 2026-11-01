<?php

declare(strict_types=1);

namespace VTON;

/**
 * Converts a flat-lay garment image into a worn reference image using
 * an image-edit model on RunPod (Qwen-Image-Edit worker, see
 * runpod-accessory-worker/). The result is cached for 7 days by garment URL
 * so each unique product image is only processed once.
 *
 * Pipeline role:
 *   flat-lay URL → FlatLayConverter → worn reference image path
 *                                          ↓
 *                                    TryOnDiffusion / Fashn.ai
 */
final class FlatLayConverter
{
    private string $apiKey;
    private string $endpointId;
    private string $cacheDir;

    private const CACHE_TTL    = 86400 * 7; // 7 days

    // Prompts per garment family
    private const PROMPTS = [
        'saree' => 'Transform this flat-lay saree into a photorealistic image of an Indian woman '
                 . 'wearing the saree in traditional nivi drape style. Show the full outfit: '
                 . 'fitted blouse matching the border color, white petticoat visible at the hem, '
                 . 'neat accordion pleats tucked at the front waist, pallu draped over the left '
                 . 'shoulder revealing the zari border and motifs. '
                 . 'Preserve the exact fabric color, all zari embroidery, border design, and '
                 . 'textile patterns. Standing front-facing, neutral cream background, '
                 . 'professional studio lighting, full body head to feet, photorealistic '
                 . 'fashion photography quality.',

        'lehenga' => 'Transform this flat-lay lehenga into a photorealistic image of an Indian '
                   . 'woman wearing the complete lehenga choli set. Show fitted blouse (choli), '
                   . 'full flared skirt with natural folds and embroidery, dupatta draped over '
                   . 'one shoulder. Preserve exact colors, embroidery patterns, and fabric '
                   . 'texture. Standing front-facing, neutral background, studio lighting, '
                   . 'full body, photorealistic fashion photography.',

        'default' => 'Transform this flat-lay garment into a photorealistic image of a person '
                   . 'wearing it naturally. Show the complete garment worn with correct fit, '
                   . 'natural fabric drape and folds, full body front-facing view. '
                   . 'Preserve exact colors, patterns, and fabric texture. '
                   . 'Neutral background, studio lighting, photorealistic fashion photography.',
    ];

    public function __construct(string $apiKey, string $endpointId, string $cacheDir)
    {
        $this->apiKey     = $apiKey;
        $this->endpointId = $endpointId;
        $this->cacheDir   = rtrim($cacheDir, DIRECTORY_SEPARATOR);
    }

    /**
     * Returns a local file path to the worn-reference image.
     * Serves from cache when available; calls RunPod otherwise.
     *
     * @param string $clothingUrl  Public URL of the flat-lay garment image
     * @param string $garmentHint  'saree' | 'lehenga' | 'default'
     * @param array  &$tempFiles   Accumulator for temp files to clean up later
     * @return string|null  Absolute path to the worn-reference JPEG, or null on failure
     */
    public function getWornReference(
        string $clothingUrl,
        string $garmentHint,
        array &$tempFiles
    ): ?string {
        $cacheKey  = md5($clothingUrl . $garmentHint);
        $cachePath = $this->cacheDir . DIRECTORY_SEPARATOR . 'wornref_' . $cacheKey . '.jpg';

        // Serve from cache if fresh
        if (is_file($cachePath) && (time() - (int)filemtime($cachePath)) < self::CACHE_TTL) {
            writeLog('INFO', 'FlatLayConverter: cache hit', ['key' => $cacheKey]);
            $tmpCopy = tempnam(sys_get_temp_dir(), 'vton_wref_');
            if ($tmpCopy !== false && copy($cachePath, $tmpCopy)) {
                $tempFiles[] = $tmpCopy;
                return $tmpCopy;
            }
        }

        // Generate via RunPod image-edit
        $prompt     = self::PROMPTS[$garmentHint] ?? self::PROMPTS['default'];
        $imageBytes = $this->editViaRunpod($clothingUrl, $prompt);

        if ($imageBytes === null) {
            writeLog('WARNING', 'FlatLayConverter: RunPod image-edit failed', ['url' => $clothingUrl]);
            return null;
        }

        // Persist to cache
        if (!is_dir($this->cacheDir)) {
            @mkdir($this->cacheDir, 0755, true);
        }
        @file_put_contents($cachePath, $imageBytes);

        // Write to temp file for this request
        $tmpPath = tempnam(sys_get_temp_dir(), 'vton_wref_');
        if ($tmpPath === false || file_put_contents($tmpPath, $imageBytes) === false) {
            return null;
        }
        $tempFiles[] = $tmpPath;

        writeLog('INFO', 'FlatLayConverter: generated worn reference', [
            'garment' => $garmentHint,
            'cache'   => $cacheKey,
        ]);

        return $tmpPath;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /** Sends the source image + prompt to the RunPod image-edit worker; returns the edited image bytes or null. */
    private function editViaRunpod(string $imageUrl, string $prompt): ?string
    {
        if (str_starts_with($imageUrl, 'data:image')) {
            $source = $imageUrl;
        } else {
            $bytes = $this->downloadUrl($imageUrl);
            if ($bytes === null) {
                writeLog('WARNING', 'FlatLayConverter: failed to download source image', ['url' => $imageUrl]);
                return null;
            }
            $source = base64_encode($bytes);
        }

        $client = new RunpodVtonClient($this->apiKey, $this->endpointId);
        $result = $client->editImage(['image' => $source, 'prompt' => $prompt]);

        if ($result['image_bytes'] === null) {
            writeLog('WARNING', 'FlatLayConverter: RunPod error', [
                'status'   => $result['status_code'],
                'response' => substr((string)$result['error_details'], 0, 300),
            ]);
            return null;
        }

        return $result['image_bytes'];
    }

    private function downloadUrl(string $url): ?string
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_USERAGENT      => 'TryFit/1.0',
        ]);
        $bytes  = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return ($bytes !== false && $status === 200) ? (string)$bytes : null;
    }
}
