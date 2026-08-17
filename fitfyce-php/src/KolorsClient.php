<?php

declare(strict_types=1);

namespace VTON;

/**
 * Client for fal.ai's Kling Kolors Virtual Try-On v1.5 model.
 *
 * Flow: POST to the queue endpoint → receive request_id → poll the status
 * endpoint until COMPLETED → fetch the result → download the output image.
 *
 * Model: fal-ai/kling/v1-5/kolors-virtual-try-on
 * Docs:  https://fal.ai/models/fal-ai/kling/v1-5/kolors-virtual-try-on/api
 */
final class KolorsClient
{
    private string $apiKey;

    private const MODEL_ID           = 'fal-ai/kling/v1-5/kolors-virtual-try-on';
    private const BASE_URL            = 'https://queue.fal.run/' . self::MODEL_ID;
    private const POLL_MAX_ATTEMPTS   = 40;    // 40 x 3s = 120s max wait
    private const POLL_INTERVAL_US    = 3_000_000; // 3 seconds

    public function __construct(string $apiKey)
    {
        $this->apiKey = $apiKey;
    }

    /**
     * @param array{
     *   human_image_url:   string,  // base64 data URI (data:image/jpeg;base64,…) or https:// URL — the person
     *   garment_image_url: string,  // base64 data URI or https:// URL — the garment
     * } $params
     * @return array{status_code:int, image_bytes:?string, error_details:?string, seed:?int}
     */
    public function tryOn(array $params): array
    {
        $submit = $this->submitRun($params);

        if ($submit['status_code'] !== 200 || empty($submit['request_id'])) {
            return [
                'status_code'   => $submit['status_code'],
                'image_bytes'   => null,
                'error_details' => $submit['error_details'],
                'seed'          => null,
            ];
        }

        return $this->pollForResult((string)$submit['request_id']);
    }

    /**
     * @return array{status_code:int, request_id:?string, error_details:?string}
     */
    private function submitRun(array $params): array
    {
        $body = (string)json_encode([
            'human_image_url'   => $params['human_image_url'],
            'garment_image_url' => $params['garment_image_url'],
        ]);

        $ch = curl_init(self::BASE_URL);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Key ' . $this->apiKey,
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
        ]);

        $response = curl_exec($ch);
        $status   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            return ['status_code' => 0, 'request_id' => null, 'error_details' => $curlErr ?: 'Curl request failed'];
        }

        $decoded = json_decode((string)$response, true);

        if ($status < 200 || $status >= 300) {
            return ['status_code' => $status, 'request_id' => null, 'error_details' => $this->extractError($decoded, $response)];
        }

        if (!is_array($decoded) || empty($decoded['request_id'])) {
            return ['status_code' => 500, 'request_id' => null, 'error_details' => 'Unexpected response (no request_id)'];
        }

        return ['status_code' => 200, 'request_id' => (string)$decoded['request_id'], 'error_details' => null];
    }

    private function pollForResult(string $requestId): array
    {
        for ($i = 0; $i < self::POLL_MAX_ATTEMPTS; $i++) {
            if ($i > 0) usleep(self::POLL_INTERVAL_US);

            $check = $this->checkStatus($requestId);
            if ($check['job_status'] === 'processing') continue;

            return match ($check['job_status']) {
                'completed' => ['status_code' => 200, 'image_bytes' => $check['image_bytes'], 'error_details' => null, 'seed' => null],
                default     => ['status_code' => 400, 'image_bytes' => null, 'error_details' => $check['error_details'], 'seed' => null],
            };
        }

        return ['status_code' => 408, 'image_bytes' => null, 'error_details' => 'Timed out waiting for result', 'seed' => null];
    }

    /**
     * @return array{job_status:string, image_bytes:?string, error_details:?string}
     *   job_status is one of: 'processing', 'completed' (image_bytes set), 'failed'/'error'.
     */
    private function checkStatus(string $requestId): array
    {
        $ch = curl_init(self::BASE_URL . '/requests/' . urlencode($requestId) . '/status');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => ['Authorization: Key ' . $this->apiKey],
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
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

        if ($jobStatus === 'COMPLETED') {
            return $this->fetchResult($requestId);
        }

        if ($jobStatus === 'ERROR' || $jobStatus === 'FAILED') {
            return ['job_status' => 'failed', 'image_bytes' => null, 'error_details' => $this->extractError($decoded, $response)];
        }

        // 'IN_QUEUE' or 'IN_PROGRESS'
        return ['job_status' => 'processing', 'image_bytes' => null, 'error_details' => null];
    }

    private function fetchResult(string $requestId): array
    {
        $ch = curl_init(self::BASE_URL . '/requests/' . urlencode($requestId));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => ['Authorization: Key ' . $this->apiKey],
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);

        $response = curl_exec($ch);
        $status   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response === false || $status !== 200) {
            return ['job_status' => 'failed', 'image_bytes' => null, 'error_details' => 'Failed to fetch result'];
        }

        $decoded = json_decode((string)$response, true);
        $outputUrl = $decoded['image']['url'] ?? null;

        if (!is_string($outputUrl) || $outputUrl === '') {
            return ['job_status' => 'failed', 'image_bytes' => null, 'error_details' => 'No output image URL in response'];
        }

        $imageBytes = $this->downloadImage($outputUrl);
        if ($imageBytes === null) {
            return ['job_status' => 'failed', 'image_bytes' => null, 'error_details' => 'Failed to download result image'];
        }

        return ['job_status' => 'completed', 'image_bytes' => $imageBytes, 'error_details' => null];
    }

    private function extractError(mixed $decoded, string|false $rawResponse): string
    {
        if (is_array($decoded)) {
            $detail = $decoded['detail'] ?? null;
            if (is_string($detail)) {
                return $detail;
            }
            if (is_array($detail) && isset($detail[0]['msg'])) {
                return (string)$detail[0]['msg'];
            }
            if (isset($decoded['message']) && is_string($decoded['message'])) {
                return $decoded['message'];
            }
        }
        return substr((string)$rawResponse, 0, 200) ?: 'Kolors try-on generation failed';
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
