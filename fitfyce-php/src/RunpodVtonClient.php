<?php

declare(strict_types=1);

namespace VTON;

/**
 * Client for a RunPod Serverless endpoint running the FASHN VTON 1.5
 * handler (person_image + garment_image in, base64 images out).
 *
 * Flow: POST /v2/{endpoint}/runsync — RunPod blocks briefly for a
 * result, but on a cold worker it returns IN_QUEUE/IN_PROGRESS before
 * the job finishes, so callers must poll /v2/{endpoint}/status/{id}
 * until COMPLETED (or FAILED).
 */
final class RunpodVtonClient
{
    private string $apiKey;
    private string $endpointId;

    private const POLL_MAX_ATTEMPTS = 60;    // 60 x 3s = 180s max wait after runsync returns — temporarily raised while testing a fresh/unwarmed RunPod endpoint
    private const POLL_INTERVAL_US  = 3_000_000; // 3 seconds

    public function __construct(string $apiKey, string $endpointId)
    {
        $this->apiKey     = $apiKey;
        $this->endpointId = $endpointId;
    }

    /**
     * @param array{
     *   person_image:        string, // base64 (no data: prefix) or data URI
     *   garment_image:       string, // base64 (no data: prefix) or data URI
     *   prompt?:              string,
     *   category?:            string, // 'tops' | 'bottoms' | 'one-pieces' | 'saree'
     *   garment_photo_type?:  string, // 'model' | 'flat-lay'
     *   num_samples?:         int,
     *   num_timesteps?:       int,
     *   guidance_scale?:      float,
     *   seed?:                int,
     *   segmentation_free?:   bool
     * } $params
     * @return array{status_code:int, images:?array, error_details:?string}
     */
    public function tryOn(array $params): array
    {
        $input = $this->buildInput($params);

        $submit = $this->post('/runsync', ['input' => $input], 300);

        if ($submit['status_code'] !== 200) {
            return ['status_code' => $submit['status_code'], 'images' => null, 'error_details' => $submit['error_details']];
        }

        return $this->resolve($submit['decoded']);
    }

    /**
     * Submits a job without waiting for it to complete (POST /run — pure
     * async, unlike runsync's brief-then-fallback blocking). Mirrors
     * FashnClient's submitRun()/checkStatus() shape so this client can be
     * dropped into a submit-then-poll architecture (GarmentStudioController,
     * StudioV2Controller) alongside Fashn.ai.
     *
     * @param array $params see tryOn()
     * @return array{status_code:int, prediction_id:?string, error_details:?string}
     */
    public function submitRun(array $params): array
    {
        $input = $this->buildInput($params);

        $submit = $this->post('/run', ['input' => $input], 30);

        if ($submit['status_code'] !== 200 || empty($submit['decoded']['id'])) {
            return [
                'status_code'   => $submit['status_code'] ?: 500,
                'prediction_id' => null,
                'error_details' => $submit['error_details'] ?? 'RunPod submission failed',
            ];
        }

        return ['status_code' => 200, 'prediction_id' => (string)$submit['decoded']['id'], 'error_details' => null];
    }

    /**
     * Submits an accessory try-on to an image-edit worker (a different
     * endpoint from the VTON 1.5 garment worker this class otherwise talks
     * to). The worker takes the model photo, the accessory photo and a
     * placement prompt, and returns output.images like the VTON worker does,
     * so checkStatus() works unchanged.
     *
     * @param array{person_image:string, accessory_image:string, prompt:string, seed?:int} $params
     * @return array{status_code:int, prediction_id:?string, error_details:?string}
     */
    public function submitAccessoryRun(array $params): array
    {
        $input = [
            'person_image'    => $this->stripDataUri($params['person_image']),
            'accessory_image' => $this->stripDataUri($params['accessory_image']),
            'prompt'          => (string)$params['prompt'],
            'seed'            => (int)($params['seed'] ?? 42),
        ];

        $submit = $this->post('/run', ['input' => $input], 30);

        if ($submit['status_code'] !== 200 || empty($submit['decoded']['id'])) {
            return [
                'status_code'   => $submit['status_code'] ?: 500,
                'prediction_id' => null,
                'error_details' => $submit['error_details'] ?? 'RunPod submission failed',
            ];
        }

        return ['status_code' => 200, 'prediction_id' => (string)$submit['decoded']['id'], 'error_details' => null];
    }

    /**
     * Checks a job's status exactly once (no retry loop) — the building
     * block for async polling from the caller's own short-lived requests.
     * Mirrors FashnClient::checkStatus()'s shape.
     *
     * @return array{job_status:string, image_bytes:?string, error_details:?string}
     *   job_status is one of: 'processing' (still running — call again
     *   later), 'completed' (image_bytes holds the first result image),
     *   'failed' (error_details set), or 'error' (transient network/HTTP
     *   problem checking status — safe to retry).
     */
    public function checkStatus(string $jobId): array
    {
        $check = $this->post('/status/' . urlencode($jobId), null, 15, 'GET');

        if ($check['status_code'] !== 200 || !is_array($check['decoded'])) {
            return ['job_status' => 'error', 'image_bytes' => null, 'error_details' => 'Status check failed'];
        }

        $status = (string)($check['decoded']['status'] ?? '');

        if ($status === 'COMPLETED') {
            $images = $this->extractImages($check['decoded']);
            if ($images === null) {
                return ['job_status' => 'failed', 'image_bytes' => null, 'error_details' => 'RunPod completed but returned no images'];
            }
            return ['job_status' => 'completed', 'image_bytes' => base64_decode($images[0]), 'error_details' => null];
        }

        if ($status === 'FAILED') {
            return ['job_status' => 'failed', 'image_bytes' => null, 'error_details' => $this->extractError($check['decoded'])];
        }

        // 'IN_QUEUE' or 'IN_PROGRESS'
        return ['job_status' => 'processing', 'image_bytes' => null, 'error_details' => null];
    }

    /** @return array{person_image:string, garment_image:string, prompt:string, category:string, garment_photo_type:string, num_samples:int, num_timesteps:int, guidance_scale:float, seed:int, segmentation_free:bool} */
    private function buildInput(array $params): array
    {
        return [
            'person_image'       => $this->stripDataUri($params['person_image']),
            'garment_image'      => $this->stripDataUri($params['garment_image']),
            'prompt'             => $params['prompt'] ?? '',
            'category'           => $params['category'] ?? 'tops',
            'garment_photo_type' => $params['garment_photo_type'] ?? 'model',
            'num_samples'        => (int)($params['num_samples'] ?? 1),
            'num_timesteps'      => (int)($params['num_timesteps'] ?? 20),
            'guidance_scale'     => (float)($params['guidance_scale'] ?? 1.5),
            'seed'               => (int)($params['seed'] ?? 42),
            'segmentation_free'  => (bool)($params['segmentation_free'] ?? true),
        ];
    }

    private function resolve(?array $decoded): array
    {
        if (!is_array($decoded)) {
            return ['status_code' => 500, 'images' => null, 'error_details' => 'Invalid RunPod response'];
        }

        $status = (string)($decoded['status'] ?? '');

        if ($status === 'COMPLETED') {
            $images = $this->extractImages($decoded);
            if ($images === null) {
                return ['status_code' => 500, 'images' => null, 'error_details' => 'RunPod completed but returned no images'];
            }
            return ['status_code' => 200, 'images' => $images, 'error_details' => null];
        }

        if ($status === 'FAILED') {
            return ['status_code' => 400, 'images' => null, 'error_details' => $this->extractError($decoded)];
        }

        // IN_QUEUE / IN_PROGRESS — poll until done or timeout
        $jobId = (string)($decoded['id'] ?? '');
        if ($jobId === '') {
            return ['status_code' => 500, 'images' => null, 'error_details' => 'RunPod response missing job id to poll'];
        }

        for ($i = 0; $i < self::POLL_MAX_ATTEMPTS; $i++) {
            usleep(self::POLL_INTERVAL_US);

            $check = $this->post('/status/' . urlencode($jobId), null, 15, 'GET');
            if ($check['status_code'] !== 200) {
                continue; // transient — retry
            }

            $checkStatus = (string)($check['decoded']['status'] ?? '');
            if ($checkStatus === 'COMPLETED') {
                $images = $this->extractImages($check['decoded']);
                if ($images === null) {
                    return ['status_code' => 500, 'images' => null, 'error_details' => 'RunPod completed but returned no images'];
                }
                return ['status_code' => 200, 'images' => $images, 'error_details' => null];
            }
            if ($checkStatus === 'FAILED') {
                return ['status_code' => 400, 'images' => null, 'error_details' => $this->extractError($check['decoded'])];
            }
            // else still IN_QUEUE / IN_PROGRESS — keep polling
        }

        return ['status_code' => 408, 'images' => null, 'error_details' => 'Timed out waiting for RunPod result'];
    }

    /** @return string[]|null base64 strings (no data: prefix) */
    private function extractImages(array $decoded): ?array
    {
        $output = $decoded['output'] ?? null;
        $images = null;
        if (is_array($output) && isset($output['images'])) {
            $images = $output['images'];
        } elseif (isset($decoded['images'])) {
            $images = $decoded['images'];
        }
        if (!is_array($images) || count($images) === 0) {
            return null;
        }
        return array_map(fn($img) => $this->stripDataUri((string)$img), $images);
    }

    private function extractError(array $decoded): string
    {
        $error = $decoded['error'] ?? null;
        if (!is_string($error) || $error === '') {
            return 'RunPod job failed';
        }

        // A worker-side Python crash arrives as a JSON-encoded string holding
        // error_type/error_message/error_traceback — the raw traceback is
        // noisy and useless to show anyone downstream, so pull out just the
        // exception type + message.
        $decodedError = json_decode($error, true);
        if (is_array($decodedError) && isset($decodedError['error_message'])) {
            $type = isset($decodedError['error_type'])
                ? trim((string)$decodedError['error_type'], "<class '>\"")
                : null;
            $message = (string)$decodedError['error_message'];
            return $type !== null && $type !== '' ? "{$type}: {$message}" : $message;
        }

        return $error;
    }

    private function stripDataUri(string $value): string
    {
        return str_contains($value, ',') ? explode(',', $value, 2)[1] : $value;
    }

    /**
     * @return array{status_code:int, decoded:?array, error_details:?string}
     */
    private function post(string $path, ?array $body, int $timeout, string $method = 'POST'): array
    {
        $url = "https://api.runpod.ai/v2/{$this->endpointId}{$path}";

        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->apiKey,
            ],
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 10,
        ];
        if ($method === 'GET') {
            $opts[CURLOPT_HTTPGET] = true;
        } else {
            $opts[CURLOPT_POST]       = true;
            $opts[CURLOPT_POSTFIELDS] = (string)json_encode($body);
        }
        curl_setopt_array($ch, $opts);

        $response = curl_exec($ch);
        $status   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            return ['status_code' => 0, 'decoded' => null, 'error_details' => $curlErr ?: 'Curl request failed'];
        }

        $decoded = json_decode((string)$response, true);

        if ($status < 200 || $status >= 300) {
            $msg = is_array($decoded) ? $this->extractError($decoded) : substr((string)$response, 0, 200);
            return ['status_code' => $status, 'decoded' => is_array($decoded) ? $decoded : null, 'error_details' => $msg];
        }

        return ['status_code' => 200, 'decoded' => is_array($decoded) ? $decoded : null, 'error_details' => null];
    }
}
