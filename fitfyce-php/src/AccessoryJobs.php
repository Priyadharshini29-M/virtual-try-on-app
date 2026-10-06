<?php

declare(strict_types=1);

namespace VTON;

use TryFit\AppConfig;

/**
 * File-backed async jobs for accessory try-ons on the Hugging Face Space.
 *
 * The Space takes ~20-60s and its result stream can't be re-read, so the
 * generation has to run in one long-lived request that the caller doesn't wait
 * for. create() stores the photos and fires a fire-and-forget loopback request
 * to POST /accessory-worker (HMAC-signed, so it can't be triggered from
 * outside); that worker runs process(). Callers poll status(), which is a pure
 * file read and mirrors the {job_status, image_bytes, error_details} shape of
 * the other engines' checkStatus(). No DB table needed.
 */
final class AccessoryJobs
{
    private const KEEP_SECONDS       = 7200;  // prune job folders older than this
    private const PENDING_RETRIGGER  = 8;     // re-fire the worker if nobody claimed the job by now
    private const PENDING_GIVE_UP    = 120;   // never claimed → fail
    private const PROCESSING_GIVE_UP = 330;   // claimed but never finished → fail

    /** Stores the two photos and starts the worker. Returns the bare job id. */
    public static function create(string $personImage, string $accessoryImage, string $prompt, int $seed = 42): string
    {
        self::prune();

        $id  = bin2hex(random_bytes(8));
        $dir = self::jobDir($id);
        if (!@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException('Cannot create accessory job folder');
        }

        file_put_contents($dir . '/person.raw', self::decodeImage($personImage));
        file_put_contents($dir . '/accessory.raw', self::decodeImage($accessoryImage));
        self::writeMeta($id, ['status' => 'pending', 'created' => time(), 'prompt' => $prompt, 'seed' => $seed]);

        self::trigger($id);
        return $id;
    }

    /** @return array{job_status:string, image_bytes:?string, error_details:?string} */
    public static function status(string $id): array
    {
        $meta = self::readMeta($id);
        if ($meta === null) {
            return self::failed('Accessory job not found or expired');
        }

        $now = time();
        switch ($meta['status']) {
            case 'completed':
                $bytes = @file_get_contents(self::jobDir($id) . '/result.jpg');
                return $bytes !== false
                    ? ['job_status' => 'completed', 'image_bytes' => $bytes, 'error_details' => null]
                    : self::failed('Accessory result file missing');

            case 'failed':
                return self::failed((string)($meta['error'] ?? 'Accessory try-on failed'));

            case 'processing':
                if ($now - (int)($meta['started'] ?? $now) > self::PROCESSING_GIVE_UP) {
                    self::fail($id, 'Accessory try-on timed out');
                    return self::failed('Accessory try-on timed out');
                }
                break;

            default: // pending
                $age = $now - (int)$meta['created'];
                if ($age > self::PENDING_GIVE_UP) {
                    self::fail($id, 'Accessory worker never started');
                    return self::failed('Accessory worker never started');
                }
                // Self-heal: the first loopback request may have been dropped.
                $marker = self::jobDir($id) . '/retrigger';
                if ($age > self::PENDING_RETRIGGER && !is_dir(self::jobDir($id) . '/claimed')
                    && (!is_file($marker) || $now - (int)filemtime($marker) > self::PENDING_RETRIGGER)) {
                    @touch($marker);
                    self::trigger($id);
                }
        }

        return ['job_status' => 'processing', 'image_bytes' => null, 'error_details' => null];
    }

    /** Runs one job to completion. Called only by the signed worker route. */
    public static function process(string $id): void
    {
        $dir = self::jobDir($id);
        if (!is_dir($dir) || !@mkdir($dir . '/claimed')) {
            return; // unknown job, or another worker already claimed it
        }

        $meta = self::readMeta($id) ?? [];
        self::writeMeta($id, ['status' => 'processing', 'started' => time()] + $meta);

        try {
            // Same box sizes the local tests used: keeps the 20B model fast and
            // the output framing predictable.
            self::prepareImage($dir . '/person.raw', $dir . '/person.jpg', 768, 1152);
            self::prepareImage($dir . '/accessory.raw', $dir . '/accessory.jpg', 640, 640);

            // The Space's model refers to inputs by position, and only ever
            // saw "image 1 / image 2" wording in testing.
            $prompt = 'Image 1 is the person photo to edit. Image 2 is the accessory product photo. '
                . str_replace('product image', 'accessory in image 2', (string)$meta['prompt']);

            $client = new HfSpaceClient(
                AppConfig::hfAccessorySpace(),
                AppConfig::hfToken(),
                AppConfig::hfAccessoryAdapter()
            );
            $result = $client->run($dir . '/person.jpg', $dir . '/accessory.jpg', $prompt, (int)($meta['seed'] ?? 42));

            if (!$result['ok']) {
                self::fail($id, self::friendlyError((string)$result['error']));
                return;
            }

            file_put_contents($dir . '/result.jpg', (string)$result['image_bytes']);
            self::writeMeta($id, ['status' => 'completed', 'finished' => time()] + $meta);
        } catch (\Throwable $e) {
            writeLog('ERROR', 'AccessoryJobs::process failed', ['job' => $id, 'message' => $e->getMessage()]);
            self::fail($id, 'Accessory try-on failed: ' . $e->getMessage());
        } finally {
            // The photos are no longer needed once the job is settled.
            foreach (['person.raw', 'accessory.raw', 'person.jpg', 'accessory.jpg'] as $f) {
                @unlink($dir . '/' . $f);
            }
        }
    }

    public static function sign(string $id): string
    {
        return hash_hmac('sha256', $id, self::secret());
    }

    public static function verify(string $id, string $sig): bool
    {
        return $id !== '' && self::secret() !== '' && hash_equals(self::sign($id), $sig);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private static function secret(): string
    {
        return (string)(getenv('CRON_SECRET_TOKEN') ?: AppConfig::hfToken());
    }

    private static function trigger(string $id): void
    {
        if (self::secret() === '') {
            return;
        }
        $ch = curl_init(baseUrl() . basePath() . '/accessory-worker');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => http_build_query(['job' => $id, 'sig' => self::sign($id)]),
            CURLOPT_RETURNTRANSFER => true,
            // Fire-and-forget: hang up almost immediately; the worker keeps
            // running because it sets ignore_user_abort(true).
            CURLOPT_TIMEOUT_MS     => 1500,
            CURLOPT_CONNECTTIMEOUT_MS => 1500,
            CURLOPT_NOSIGNAL       => true,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);
        @curl_exec($ch);
        curl_close($ch);
    }

    private static function fail(string $id, string $message): void
    {
        $meta = self::readMeta($id) ?? [];
        self::writeMeta($id, ['status' => 'failed', 'error' => $message, 'finished' => time()] + $meta);
    }

    /** @return array{job_status:string, image_bytes:null, error_details:string} */
    private static function failed(string $message): array
    {
        return ['job_status' => 'failed', 'image_bytes' => null, 'error_details' => $message];
    }

    private static function friendlyError(string $raw): string
    {
        if (stripos($raw, 'quota') !== false) {
            return 'Accessory try-on is at its daily free GPU limit. Please try again later.';
        }
        return 'Accessory try-on failed: ' . $raw;
    }

    private static function jobDir(string $id): string
    {
        return AppConfig::tempDir() . DIRECTORY_SEPARATOR . 'accessory_jobs' . DIRECTORY_SEPARATOR . preg_replace('/[^a-f0-9]/', '', $id);
    }

    private static function readMeta(string $id): ?array
    {
        $raw = @file_get_contents(self::jobDir($id) . '/meta.json');
        $data = $raw === false ? null : json_decode($raw, true);
        return is_array($data) ? $data : null;
    }

    private static function writeMeta(string $id, array $meta): void
    {
        file_put_contents(self::jobDir($id) . '/meta.json', json_encode($meta), LOCK_EX);
    }

    private static function prune(): void
    {
        $root = AppConfig::tempDir() . DIRECTORY_SEPARATOR . 'accessory_jobs';
        foreach (@glob($root . '/*', GLOB_ONLYDIR) ?: [] as $dir) {
            if (time() - (int)@filemtime($dir) > self::KEEP_SECONDS) {
                foreach (@glob($dir . '/{,.}*', GLOB_BRACE) ?: [] as $f) {
                    if (is_file($f)) {
                        @unlink($f);
                    } elseif (is_dir($f) && !in_array(basename($f), ['.', '..'], true)) {
                        @rmdir($f);
                    }
                }
                @rmdir($dir);
            }
        }
    }

    /** Accepts a data: URI or raw base64. */
    private static function decodeImage(string $value): string
    {
        $b64 = str_contains($value, ',') ? explode(',', $value, 2)[1] : $value;
        $bytes = base64_decode($b64, true);
        if ($bytes === false || $bytes === '') {
            throw new \RuntimeException('Invalid image data');
        }
        return $bytes;
    }

    /** Downscales to fit $maxW x $maxH (never upscales) and flattens transparency onto white. */
    private static function prepareImage(string $src, string $dst, int $maxW, int $maxH): void
    {
        $img = function_exists('imagecreatefromstring') ? @imagecreatefromstring((string)file_get_contents($src)) : false;
        if ($img === false) {
            copy($src, $dst);
            return;
        }
        $w = imagesx($img);
        $h = imagesy($img);
        $scale = min($maxW / $w, $maxH / $h, 1.0);
        $nw = max(1, (int)round($w * $scale));
        $nh = max(1, (int)round($h * $scale));

        $out = imagecreatetruecolor($nw, $nh);
        imagefill($out, 0, 0, imagecolorallocate($out, 255, 255, 255));
        imagecopyresampled($out, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
        imagejpeg($out, $dst, 92);
        imagedestroy($img);
        imagedestroy($out);
    }
}
