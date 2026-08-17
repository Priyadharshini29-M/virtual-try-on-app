<?php

declare(strict_types=1);

namespace VTON;

/**
 * Client for Fashn.ai virtual try-on API (tryon-v1.6).
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
    private const MODEL_NAME        = 'tryon-v1.6';
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
     *   model_image:         string,  // base64 data URI (data:image/jpeg;base64,…) or https:// URL
     *   garment_image:       string,  // base64 data URI or https:// URL
     *   category:            string,  // 'auto' | 'tops' | 'bottoms' | 'one-pieces'
     *   garment_photo_type?: string,  // 'auto' | 'flat-lay' | 'model'
     *   moderation_level?:   string,  // 'conservative' | 'permissive' | 'none' (default 'conservative')
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

    /**
     * Submits a prediction without waiting for it to complete. Use this plus
     * checkStatus() instead of tryOn() when the caller can't block on a single
     * HTTP request for the ~10-60s Fashn generation can take (e.g. a shared
     * host with a hard connection/proxy timeout well under that).
     *
     * @param array $params see tryOn()
     * @return array{status_code:int, prediction_id:?string, error_details:?string}
     */
    public function submitRun(array $params): array
    {
        $inputs = [
            'model_image'       => $params['model_image'],
            'garment_image'     => $params['garment_image'],
            'category'          => $params['category'],
            'mode'              => $this->mode,
            // Conservative moderation is the safe default for a commercial
            // e-commerce try-on tool — reduces risk of inappropriate/revealing
            // output when the garment image doesn't fully cover the body.
            'moderation_level'  => $params['moderation_level'] ?? 'conservative',
        ];

        if (!empty($params['garment_photo_type'])) {
            $inputs['garment_photo_type'] = $params['garment_photo_type'];
        }
        if (isset($params['seed']) && $params['seed'] >= 0) {
            $inputs['seed'] = (int)$params['seed'];
        }

        return $this->postRun(self::MODEL_NAME, $inputs);
    }

    /**
     * Submits a prediction to a Fashn model other than tryon-v1.6 (e.g.
     * 'tryon-max' or 'product-to-model'), whose input shapes differ from the
     * garment-transfer params submitRun() builds. The caller is responsible
     * for building an $inputs payload matching that model's own API shape.
     *
     * @return array{status_code:int, prediction_id:?string, error_details:?string}
     */
    public function submitModelRun(string $modelName, array $inputs): array
    {
        return $this->postRun($modelName, $inputs);
    }

    /**
     * Submits to an arbitrary Fashn model (e.g. 'edit') and blocks until the
     * result is ready, polling the same way tryOn() does for tryon-v1.6.
     *
     * @return array{status_code:int, image_bytes:?string, error_details:?string, seed:?int}
     */
    public function runModelAndWait(string $modelName, array $inputs): array
    {
        $runResult = $this->submitModelRun($modelName, $inputs);

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

    private function postRun(string $modelName, array $inputs): array
    {
        $body = [
            'model_name' => $modelName,
            'inputs'     => $inputs,
        ];

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
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
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
            return ['status_code' => $status, 'prediction_id' => null, 'error_details' => $this->extractError($decoded, $response)];
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

            $check = $this->checkStatus($predictionId);
            if ($check['job_status'] === 'processing') continue;

            return match ($check['job_status']) {
                'completed' => ['status_code' => 200, 'image_bytes' => $check['image_bytes'], 'error_details' => null, 'seed' => null],
                default     => ['status_code' => 400, 'image_bytes' => null, 'error_details' => $check['error_details'], 'seed' => null],
            };
        }

        return ['status_code' => 408, 'image_bytes' => null, 'error_details' => 'Timed out waiting for result', 'seed' => null];
    }

    /**
     * Checks a prediction's status exactly once (no retry loop) — the building
     * block for async polling from the caller's own short-lived requests.
     *
     * @return array{job_status:string, image_bytes:?string, error_details:?string}
     *   job_status is one of: 'processing' (still running — call again later),
     *   'completed' (image_bytes holds the result), 'failed' (error_details set),
     *   or 'error' (transient network/HTTP problem checking status — safe to retry).
     */
    public function checkStatus(string $predictionId): array
    {
        $ch = curl_init(self::BASE_URL . '/status/' . urlencode($predictionId));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $this->apiKey],
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);

        $response = curl_exec($ch);
        $status   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response === false || $status !== 200) {
            return ['job_status' => 'error', 'image_bytes' => null, 'error_details' => 'Status check failed'];
        }

        $decoded = json_decode((string)$response, true);
        if (!is_array($decoded)) {
            return ['job_status' => 'error', 'image_bytes' => null, 'error_details' => 'Invalid status response'];
        }

        $jobStatus = (string)($decoded['status'] ?? '');

        if ($jobStatus === 'completed') {
            $outputUrl = $decoded['output'][0] ?? null;
            if (!is_string($outputUrl) || $outputUrl === '') {
                return ['job_status' => 'failed', 'image_bytes' => null, 'error_details' => 'No output URL in response'];
            }
            $imageBytes = $this->downloadImage($outputUrl);
            if ($imageBytes === null) {
                return ['job_status' => 'failed', 'image_bytes' => null, 'error_details' => 'Failed to download result image'];
            }
            return ['job_status' => 'completed', 'image_bytes' => $imageBytes, 'error_details' => null];
        }

        if ($jobStatus === 'failed') {
            return ['job_status' => 'failed', 'image_bytes' => null, 'error_details' => $this->extractError($decoded, $response)];
        }

        // 'starting', 'in_queue', or 'processing'
        return ['job_status' => 'processing', 'image_bytes' => null, 'error_details' => null];
    }

    /**
     * Fashn returns errors in two different shapes depending on when they occur:
     *   - immediate request validation: {"error": "BadRequest", "message": "..."}
     *   - failed prediction (post-processing): {"error": {"name": "...", "message": "..."}}
     * Always prefer the human-readable "message" over the generic error type/name.
     */
    private function extractError(mixed $decoded, string|false $rawResponse): string
    {
        if (is_array($decoded)) {
            $error = $decoded['error'] ?? null;
            if (is_array($error)) {
                return (string)($error['message'] ?? $error['name'] ?? 'Try-on generation failed');
            }
            if (isset($decoded['message']) && is_string($decoded['message'])) {
                return $decoded['message'];
            }
            if (is_string($error)) {
                return $error;
            }
            if (isset($decoded['detail'])) {
                return (string)$decoded['detail'];
            }
        }
        return substr((string)$rawResponse, 0, 200) ?: 'Try-on generation failed';
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
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);
        $bytes  = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return ($bytes !== false && $status === 200) ? (string)$bytes : null;
    }
}
