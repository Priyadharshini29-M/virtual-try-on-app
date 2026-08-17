<?php

declare(strict_types=1);

namespace TryFit\Db;

class GenerationRepo
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
            CREATE TABLE IF NOT EXISTS generations (
                id CHAR(36) NOT NULL,
                merchant_id INT NOT NULL,
                product_id INT NULL,
                shopify_variant_id BIGINT NULL,
                product_image_url TEXT NOT NULL,
                saved_model_id CHAR(36) NULL,
                model_image_url TEXT NOT NULL,
                prompt TEXT NOT NULL,
                status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
                fashn_prediction_id VARCHAR(64) NULL,
                result_image_url TEXT NULL,
                error_message TEXT NULL,
                api_request_at DATETIME NULL,
                api_response_at DATETIME NULL,
                api_latency_ms INT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                INDEX idx_gen_merchant (merchant_id),
                INDEX idx_gen_status (status),
                INDEX idx_gen_created (merchant_id, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    }

    public function create(array $data): string
    {
        $id = $this->newUuid();
        $stmt = $this->db->prepare(
            'INSERT INTO generations
                (id, merchant_id, product_id, shopify_variant_id, product_image_url,
                 saved_model_id, model_image_url, prompt, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'pending\')'
        );
        $stmt->execute([
            $id,
            (int) $data['merchant_id'],
            isset($data['product_id']) ? (int) $data['product_id'] : null,
            isset($data['shopify_variant_id']) ? (int) $data['shopify_variant_id'] : null,
            $data['product_image_url'],
            $data['saved_model_id'] ?? null,
            $data['model_image_url'],
            $data['prompt'],
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
            ->prepare('UPDATE generations SET ' . implode(', ', $sets) . ' WHERE id = ?')
            ->execute($params);
    }

    public function findById(string $id): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM generations WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row !== false ? $row : null;
    }

    public function listByMerchant(int $merchantId, int $limit = 20, int $offset = 0): array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM generations
             WHERE merchant_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?'
        );
        $stmt->execute([$merchantId, $limit, $offset]);
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    public function delete(string $id, int $merchantId): bool
    {
        $stmt = $this->db->prepare('DELETE FROM generations WHERE id = ? AND merchant_id = ?');
        $stmt->execute([$id, $merchantId]);
        return $stmt->rowCount() > 0;
    }

    private function newUuid(): string
    {
        $data    = random_bytes(16);
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
