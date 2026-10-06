<?php

declare(strict_types=1);

namespace VTON;

/**
 * Minimal client for a Hugging Face Gradio Space running a Qwen-Image-Edit
 * "fusion" app (two input images + prompt + LoRA adapter in, one edited image
 * out) — used for accessory try-ons, which the FASHN VTON worker can't do.
 *
 * Gradio's /call result stream can only be read once, by the connection that
 * opened it, so this client is blocking: run() uploads both photos, starts the
 * job and holds one connection open until the image is ready. Callers must run
 * it in a long-lived background context (see AccessoryJobs), never in a
 * request the shopper/merchant is waiting on.
 */
final class HfSpaceClient
{
    private string $base;

    public function __construct(
        string $host,
        private string $token,
        private string $adapter = 'Fuse-Objects'
    ) {
        $this->base = 'https://' . preg_replace('#^https?://#', '', rtrim($host, '/'));
    }

    /**
     * @return array{ok:bool, image_bytes:?string, error:?string}
     */
    public function run(string $personPath, string $accessoryPath, string $prompt, int $seed = 42): array
    {
        try {
            $person    = $this->upload($personPath);
            $accessory = $this->upload($accessoryPath);

            $fileData = fn(string $path): array => ['path' => $path, 'meta' => ['_type' => 'gradio.FileData']];
            $submit   = $this->request('POST', '/gradio_api/call/infer', json_encode([
                // person, accessory, prompt, LoRA adapter, seed, randomize_seed, guidance_scale, steps
                'data' => [$fileData($person), $fileData($accessory), $prompt, $this->adapter, $seed, false, 1.0, 4],
            ]), ['Content-Type: application/json'], 30);

            $eventId = (string)(json_decode($submit, true)['event_id'] ?? '');
            if ($eventId === '') {
                throw new \RuntimeException('Space did not return an event id');
            }

            $stream = $this->request('GET', '/gradio_api/call/infer/' . rawurlencode($eventId), null, [], 280);
            $output = $this->parseResult($stream);

            $url = (string)($output['url'] ?? '');
            if ($url === '' && !empty($output['path'])) {
                $url = $this->base . '/gradio_api/file=' . $output['path'];
            }
            if ($url === '') {
                throw new \RuntimeException('Space returned no image');
            }

            $bytes = $this->request('GET', '', null, [], 60, $url);
            if (@getimagesizefromstring($bytes) === false) {
                throw new \RuntimeException('Space returned an invalid image');
            }

            return ['ok' => true, 'image_bytes' => $bytes, 'error' => null];
        } catch (\RuntimeException $e) {
            return ['ok' => false, 'image_bytes' => null, 'error' => $e->getMessage()];
        }
    }

    private function upload(string $path): string
    {
        $file = new \CURLFile($path, 'image/jpeg', basename($path));
        $body = $this->request('POST', '/gradio_api/upload', ['files' => $file], [], 60);
        $paths = json_decode($body, true);
        if (!is_array($paths) || empty($paths[0]) || !is_string($paths[0])) {
            throw new \RuntimeException('Space upload failed');
        }
        return $paths[0];
    }

    /**
     * Parses a Gradio SSE stream: blocks of "event: x\ndata: y" separated by a
     * blank line. Returns the first output component of the 'complete' event
     * (the edited image's FileData), or throws with the Space's own error text.
     */
    private function parseResult(string $stream): array
    {
        $complete = null;
        $error    = null;

        foreach (preg_split("/\r?\n\r?\n/", $stream) as $block) {
            $event = '';
            $data  = '';
            foreach (preg_split("/\r?\n/", $block) as $line) {
                if (str_starts_with($line, 'event:')) {
                    $event = trim(substr($line, 6));
                } elseif (str_starts_with($line, 'data:')) {
                    $data .= trim(substr($line, 5));
                }
            }
            if ($event === 'complete') {
                $complete = json_decode($data, true);
            } elseif ($event === 'error') {
                $decoded = json_decode($data, true);
                $error   = is_array($decoded) ? (string)($decoded['error'] ?? $data) : trim($data, "\" ");
            }
        }

        if (is_array($complete) && isset($complete[0]) && is_array($complete[0])) {
            return $complete[0];
        }
        throw new \RuntimeException($error ?? 'Space finished without a result');
    }

    private function request(string $method, string $path, string|array|null $body, array $headers, int $timeout, ?string $absoluteUrl = null): string
    {
        $ch = curl_init($absoluteUrl ?? ($this->base . $path));
        $headers[] = 'Authorization: Bearer ' . $this->token;
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 15,
        ];
        if ($method === 'POST') {
            $opts[CURLOPT_POST]       = true;
            $opts[CURLOPT_POSTFIELDS] = $body;
        }
        curl_setopt_array($ch, $opts);

        $response = curl_exec($ch);
        $status   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            throw new \RuntimeException('Space request failed: ' . ($curlErr ?: 'network error'));
        }
        if ($status >= 400) {
            throw new \RuntimeException("Space HTTP {$status}: " . substr((string)$response, 0, 200));
        }
        return (string)$response;
    }
}
