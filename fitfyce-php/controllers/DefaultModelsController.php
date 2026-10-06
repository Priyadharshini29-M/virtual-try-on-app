<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\Database;
use TryFit\Db\DefaultModelCatalog;
use TryFit\Middleware\ApiKeyAuth;
use VTON\ImageUtils;
use VTON\OpenAIClient;

/**
 * Built-in model library for AI Studio.
 *
 *   GET  /studio/default-models           → every model + whether this store activated it
 *   POST /studio/default-models/activate  → {model_key, active} toggle for this store
 *
 * Photos are generated once by generate-default-models.php (admin, key-protected),
 * which calls DefaultModelsController::generateBatch(). Images live at
 * models/default/<model_key>.jpg (+ thumb_<model_key>.jpg) and are served
 * statically from this host.
 */
class DefaultModelsController
{
    private const IMAGE_DIR = 'models/default';

    // ── Merchant endpoints ────────────────────────────────────────────────────

    public function list(): void
    {
        $merchant = ApiKeyAuth::handle();
        self::seedCatalog();

        $db = Database::getInstance();
        $stmt = $db->prepare(
            'SELECT d.model_key, d.name, d.gender, d.look, d.skin_tone, d.body_type, d.age_group, d.hair,
                    d.image_path, d.thumb_path, d.status, d.sort_order,
                    (a.model_key IS NOT NULL) AS activated
             FROM default_models d
             LEFT JOIN merchant_active_models a ON a.model_key = d.model_key AND a.merchant_id = ?
             ORDER BY d.sort_order'
        );
        $stmt->execute([(int)$merchant['id']]);

        $models = array_map(static function (array $r): array {
            return [
                'model_key' => $r['model_key'],
                'name'      => $r['name'],
                'gender'    => $r['gender'],
                'look'      => $r['look'],
                'skin_tone' => $r['skin_tone'],
                'body_type' => $r['body_type'],
                'age_group' => $r['age_group'],
                'hair'      => $r['hair'],
                'status'    => $r['status'],
                'activated' => (bool)(int)$r['activated'],
                'image_url' => $r['image_path'] ? self::publicUrl($r['image_path']) : null,
                'thumb_url' => $r['thumb_path'] ? self::publicUrl($r['thumb_path']) : ($r['image_path'] ? self::publicUrl($r['image_path']) : null),
            ];
        }, $stmt->fetchAll());

        $ready = count(array_filter($models, static fn ($m) => $m['status'] === 'ready'));
        respondJson(['models' => $models, 'ready' => $ready, 'total' => count($models)]);
    }

    public function activate(): void
    {
        $merchant = ApiKeyAuth::handle();
        $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);
        $key = trim((string)($body['model_key'] ?? ''));
        if ($key === '' || DefaultModelCatalog::find($key) === null) {
            respondJson(['error' => 'Unknown model'], 400);
        }

        $db = Database::getInstance();
        if (!empty($body['active'])) {
            $db->prepare('INSERT IGNORE INTO merchant_active_models (merchant_id, model_key) VALUES (?, ?)')
               ->execute([(int)$merchant['id'], $key]);
        } else {
            $db->prepare('DELETE FROM merchant_active_models WHERE merchant_id = ? AND model_key = ?')
               ->execute([(int)$merchant['id'], $key]);
        }
        respondJson(['ok' => true, 'model_key' => $key, 'active' => !empty($body['active'])]);
    }

    // ── Catalog + generation (used by generate-default-models.php) ───────────

    /** Inserts any catalog models not yet in the table (never overwrites generated images). */
    public static function seedCatalog(): void
    {
        $db = Database::getInstance();
        $count = (int)$db->query('SELECT COUNT(*) FROM default_models')->fetchColumn();
        $catalog = DefaultModelCatalog::all();
        if ($count >= count($catalog)) return;

        $ins = $db->prepare(
            'INSERT IGNORE INTO default_models
                (model_key, name, gender, look, skin_tone, body_type, age_group, hair, prompt, seed, sort_order, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'pending\')'
        );
        foreach ($catalog as $m) {
            $ins->execute([
                $m['model_key'], $m['name'], $m['gender'], $m['look'], $m['skin_tone'], $m['body_type'],
                $m['age_group'], $m['hair'], $m['prompt'], $m['seed'], $m['sort_order'],
            ]);
        }
    }

    /**
     * Generates up to $limit pending models (and retries failed ones up to 3 attempts).
     * Pass $onlyKey to (re)generate one specific model.
     *
     * @return array{processed:list<array>, counts:array<string,int>}
     */
    public static function generateBatch(int $limit = 2, ?string $onlyKey = null): array
    {
        @set_time_limit(300);
        self::seedCatalog();
        $db = Database::getInstance();

        if ($onlyKey !== null) {
            // A regenerate must produce a new variation — the same seed returns the same image.
            $db->prepare('UPDATE default_models SET seed = seed + 7919, attempts = 0 WHERE model_key = ?')->execute([$onlyKey]);
            $stmt = $db->prepare('SELECT * FROM default_models WHERE model_key = ?');
            $stmt->execute([$onlyKey]);
        } else {
            $stmt = $db->prepare(
                "SELECT * FROM default_models
                 WHERE status = 'pending'
                    OR (status = 'failed' AND attempts < 3)
                    OR (status = 'generating' AND updated_at < NOW() - INTERVAL 10 MINUTE AND attempts < 3)
                 ORDER BY sort_order LIMIT " . max(1, min(5, $limit))
            );
            $stmt->execute();
        }
        $rows = $stmt->fetchAll();

        $apiKey = AppConfig::openAiApiKey();
        $processed = [];
        if ($apiKey === '') {
            return ['processed' => [['model_key' => '-', 'ok' => false, 'error' => 'OPENAI_API_KEY is not set in .env']], 'counts' => self::counts()];
        }

        $root = dirname(__DIR__);
        $dir  = $root . '/' . self::IMAGE_DIR;
        if (!is_dir($dir)) @mkdir($dir, 0755, true);

        // OpenAI gpt-image-1, portrait 1024×1536 at high quality.
        $client = new OpenAIClient($apiKey);
        foreach ($rows as $r) {
            $db->prepare("UPDATE default_models SET status = 'generating', attempts = attempts + 1 WHERE model_key = ?")
               ->execute([$r['model_key']]);

            // gpt-image-1 has no seed parameter, so a variation hint keeps
            // "Regenerate" (which bumps the seed) from repeating itself.
            $prompt = $r['prompt'] . ' Variation ' . (int)$r['seed'] . '.';
            try {
                $res = ['status_code' => 200, 'image_bytes' => $client->generateImage($prompt, '1024x1536', 'high'), 'error_details' => null];
            } catch (\Throwable $e) {
                $res = ['status_code' => 500, 'image_bytes' => null, 'error_details' => $e->getMessage()];
            }

            if ($res['status_code'] !== 200 || empty($res['image_bytes'])) {
                $err = (string)($res['error_details'] ?? 'Generation failed');
                $db->prepare("UPDATE default_models SET status = 'failed', last_error = ? WHERE model_key = ?")
                   ->execute([mb_substr($err, 0, 500), $r['model_key']]);
                $processed[] = ['model_key' => $r['model_key'], 'name' => $r['name'], 'ok' => false, 'error' => $err];
                continue;
            }

            $file  = $r['model_key'] . '.jpg';
            $path  = $dir . '/' . $file;
            $saved = false;
            $img = @imagecreatefromstring($res['image_bytes']);
            if ($img !== false) {
                $saved = @imagejpeg($img, $path, 90);
                imagedestroy($img);
            }
            if (!$saved) {
                $saved = @file_put_contents($path, $res['image_bytes']) !== false;
            }
            if (!$saved) {
                $db->prepare("UPDATE default_models SET status = 'failed', last_error = ? WHERE model_key = ?")
                   ->execute(['Could not write image to ' . self::IMAGE_DIR, $r['model_key']]);
                $processed[] = ['model_key' => $r['model_key'], 'name' => $r['name'], 'ok' => false, 'error' => 'Could not write image file'];
                continue;
            }

            $thumbFile = 'thumb_' . $file;
            $thumbRel  = ImageUtils::makeThumbnail($path, $dir . '/' . $thumbFile, 480) ? self::IMAGE_DIR . '/' . $thumbFile : null;

            $db->prepare(
                "UPDATE default_models SET status = 'ready', image_path = ?, thumb_path = ?, last_error = NULL, generated_at = NOW()
                 WHERE model_key = ?"
            )->execute([self::IMAGE_DIR . '/' . $file, $thumbRel, $r['model_key']]);

            $processed[] = ['model_key' => $r['model_key'], 'name' => $r['name'], 'ok' => true, 'url' => self::publicUrl(self::IMAGE_DIR . '/' . $file)];
        }

        return ['processed' => $processed, 'counts' => self::counts()];
    }

    /** @return array<string,int> */
    public static function counts(): array
    {
        $rows = Database::getInstance()->query('SELECT status, COUNT(*) AS n FROM default_models GROUP BY status')->fetchAll();
        $out = ['pending' => 0, 'generating' => 0, 'ready' => 0, 'failed' => 0];
        foreach ($rows as $r) {
            $out[$r['status']] = (int)$r['n'];
        }
        return $out;
    }

    public static function publicUrl(string $relPath): string
    {
        return rtrim(baseUrl() . basePath(), '/') . '/' . ltrim($relPath, '/');
    }
}
