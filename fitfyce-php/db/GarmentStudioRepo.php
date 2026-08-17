<?php

declare(strict_types=1);

namespace TryFit\Db;

class GarmentStudioRepo
{
    private \PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
        $this->ensureTable();
    }

    private function ensureTable(): void
    {
        $this->db->exec("
            CREATE TABLE IF NOT EXISTS garment_studio_sessions (
                id CHAR(36) NOT NULL,
                merchant_id INT NOT NULL,
                product_id INT NULL,
                shopify_variant_id BIGINT NULL,
                front_image_url TEXT NOT NULL,
                back_image_url TEXT NOT NULL,
                detail_image_1_url TEXT NULL,
                detail_image_2_url TEXT NULL,
                detail_image_3_url TEXT NULL,
                gender ENUM('female','male') NOT NULL DEFAULT 'female',
                model_key VARCHAR(50) NOT NULL,
                garment_type VARCHAR(20) NOT NULL DEFAULT 'top',
                clothing_prompt TEXT NULL,
                status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
                result_image_url TEXT NULL,
                error_message TEXT NULL,
                saved_to_gallery TINYINT(1) NOT NULL DEFAULT 0,
                api_request_at DATETIME NULL,
                api_response_at DATETIME NULL,
                api_latency_ms INT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                INDEX idx_gss_merchant (merchant_id),
                INDEX idx_gss_status (status),
                INDEX idx_gss_created (merchant_id, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        // Stores the Fashn.ai prediction ID so /studio/generate-status can poll
        // it later without re-submitting — generation is async because a single
        // blocking HTTP request risks exceeding the host's connection timeout.
        $this->db->exec("
            ALTER TABLE garment_studio_sessions
            ADD COLUMN IF NOT EXISTS fashn_prediction_id VARCHAR(64) NULL AFTER model_key
        ");
    }

    public function create(array $data): string
    {
        $id = $this->newUuid();

        $stmt = $this->db->prepare("
            INSERT INTO garment_studio_sessions
                (id, merchant_id, product_id, shopify_variant_id,
                 front_image_url, back_image_url,
                 detail_image_1_url, detail_image_2_url, detail_image_3_url,
                 gender, model_key, garment_type, clothing_prompt, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        ");
        $stmt->execute([
            $id,
            (int) $data['merchant_id'],
            isset($data['product_id'])         ? (int) $data['product_id']         : null,
            isset($data['shopify_variant_id']) ? (int) $data['shopify_variant_id'] : null,
            $data['front_image_url'],
            $data['back_image_url'],
            $data['detail_image_1_url'] ?? null,
            $data['detail_image_2_url'] ?? null,
            $data['detail_image_3_url'] ?? null,
            $data['gender'],
            $data['model_key'],
            $data['garment_type'] ?? 'top',
            $data['clothing_prompt'] ?? null,
        ]);
        return $id;
    }

    public function updateStatus(string $id, string $status, array $extra = []): void
    {
        $sets   = ['status = ?', 'updated_at = NOW()'];
        $params = [$status];

        foreach (['result_image_url', 'error_message', 'api_request_at', 'api_response_at', 'fashn_prediction_id'] as $col) {
            if (array_key_exists($col, $extra)) {
                $sets[]   = "`{$col}` = ?";
                $params[] = $extra[$col];
            }
        }
        if (array_key_exists('api_latency_ms', $extra)) {
            $sets[]   = 'api_latency_ms = ?';
            $params[] = (int) $extra['api_latency_ms'];
        }

        $params[] = $id;
        $this->db
            ->prepare('UPDATE garment_studio_sessions SET ' . implode(', ', $sets) . ' WHERE id = ?')
            ->execute($params);
    }

    public function markSavedToGallery(string $id): void
    {
        $this->db
            ->prepare('UPDATE garment_studio_sessions SET saved_to_gallery = 1, updated_at = NOW() WHERE id = ?')
            ->execute([$id]);
    }

    public function findById(string $id): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM garment_studio_sessions WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row !== false ? $row : null;
    }

    public function listByMerchant(int $merchantId, int $limit = 20, int $offset = 0): array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM garment_studio_sessions
             WHERE merchant_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?'
        );
        $stmt->execute([$merchantId, $limit, $offset]);
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    private function newUuid(): string
    {
        $data    = random_bytes(16);
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
