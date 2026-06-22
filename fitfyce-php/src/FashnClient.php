<?php

declare(strict_types=1);

namespace VTON;

/**
 * Client for Fashn.ai virtual try-on API (IDM-VTON).
 *
 * Flow: POST /v1/run → receive prediction ID → poll /v1/status/{id}
 * until completed, then download the result image.
 *
 * Fashn handles human parsing, clothing masking, and pose conditioning
 * internally — no prompt tuning required.
 */
final class FashnClient
{
    private string $apiKey;
    private string $mode;

    private const BASE_URL          = 'https://api.fashn.ai/v1';
    private const POLL_MAX_ATTEMPTS = 30;    // 30 × 2.5 s = 75 s max wait
    private const POLL_INTERVAL_US  = 2_500_000; // 2.5 seconds

    public function __construct(string $apiKey, string $mode = 'balanced')
    {
        $this->apiKey = $apiKey;
        $this->mode   = in_array($mode, ['performance', 'balanced', 'quality'], true)
            ? $mode : 'balanced';
    }

    /**
     * @param array{
     *   model_image:         string,  // base64 data URI (data:image/jpeg;base64,…)
     *   garment_image:       string,  // base64 data URI or https:// URL
     *   category:            string,  // 'tops' | 'bottoms' | 'one-pieces'
     *   long_top?:           bool,
     *   adjust_hands?:       bool,    // improve hand quality near garment (default true)
     *   restore_background?: bool,    // keep original background (default true)
     *   restore_clothes?:    bool,    // preserve body parts/clothes not covered (default true)
     *   seed?:               int
     * } $params
     * @return array{status_code:int, image_bytes:?string, error_details:?string, seed:?int}
     */
    public function tryOn(array $params): array
    {
        $runResult = $this->submitRun($params);

        if ($runResult['status_code'] !== 200 || empty($runResult['prediction_id'])) {
            return [
                'status_code'   => $runResult['status_code'],
                'image_bytes'   => null,
                'error_details' => $runResult['error_details'],
                'seed'          => null,
            ];
        }

        return $this->pollForResult((string)$runResult['prediction_id']);
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function submitRun(array $params): array
    {
        $body = [
            'model_image'        => $params['model_image'],
            'garment_image'      => $params['garment_image'],
            'category'           => $params['category'],
            'mode'               => $this->mode,
            // Identity & pose preservation — keep original person, background, and
            // any clothing not covered by the transferred garment.
            'adjust_hands'       => $params['adjust_hands']       ?? true,
            'restore_background' => $params['restore_background'] ?? true,
            'restore_clothes'    => $params['restore_clothes']    ?? true,
        ];

        if (!empty($params['long_top'])) {
            $body['long_top'] = true;
        }
        if (isset($params['seed']) && $params['seed'] >= 0) {
            $body['seed'] = (int)$params['seed'];
        }

        $ch = curl_init(self::BASE_URL . '/run');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->apiKey,
            ],
            CURLOPT_POSTFIELDS     => (string)json_encode($body),
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
        ]);

        $response = curl_exec($ch);
        $status   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            return ['status_code' => 0, 'prediction_id' => null, 'error_details' => $curlErr ?: 'Curl request failed'];
        }

        $decoded = json_decode((string)$response, true);

        if ($status < 200 || $status >= 300) {
            $detail = is_array($decoded)
                ? ($decoded['error'] ?? $decoded['detail'] ?? substr((string)$response, 0, 200))
                : substr((string)$response, 0, 200);
            return ['status_code' => $status, 'prediction_id' => null, 'error_details' => (string)$detail];
        }

        if (!is_array($decoded) || empty($decoded['id'])) {
            return ['status_code' => 500, 'prediction_id' => null, 'error_details' => 'Unexpected response (no prediction ID)'];
        }

        return ['status_code' => 200, 'prediction_id' => (string)$decoded['id'], 'error_details' => null];
    }

    private function pollForResult(string $predictionId): array
    {
        for ($i = 0; $i < self::POLL_MAX_ATTEMPTS; $i++) {
            if ($i > 0) usleep(self::POLL_INTERVAL_US);

            $ch = curl_init(self::BASE_URL . '/status/' . urlencode($predictionId));
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $this->apiKey],
                CURLOPT_TIMEOUT        => 15,
                CURLOPT_CONNECTTIMEOUT => 5,
            ]);

            $response = curl_exec($ch);
            $status   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($response === false || $status !== 200) continue;

            $decoded = json_decode((string)$response, true);
            if (!is_array($decoded)) continue;

            $jobStatus = (string)($decoded['status'] ?? '');

            if ($jobStatus === 'completed') {
                $outputUrl = $decoded['output'][0] ?? null;
                if (!is_string($outputUrl) || $outputUrl === '') {
                    return ['status_code' => 500, 'image_bytes' => null, 'error_details' => 'No output URL in response', 'seed' => null];
                }
                $imageBytes = $this->downloadImage($outputUrl);
                if ($imageBytes === null) {
                    return ['status_code' => 500, 'image_bytes' => null, 'error_details' => 'Failed to download result image', 'seed' => null];
                }
                return ['status_code' => 200, 'image_bytes' => $imageBytes, 'error_details' => null, 'seed' => null];
            }

            if ($jobStatus === 'failed') {
                $error = $decoded['error'] ?? 'Try-on generation failed';
                return ['status_code' => 400, 'image_bytes' => null, 'error_details' => (string)$error, 'seed' => null];
            }

            // 'starting' or 'processing' — keep polling
        }

        return ['status_code' => 408, 'image_bytes' => null, 'error_details' => 'Timed out waiting for result', 'seed' => null];
    }

    private function downloadImage(string $url): ?string
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
