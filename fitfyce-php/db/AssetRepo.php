<?php

declare(strict_types=1);

namespace TryFit\Db;

class AssetRepo
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
            CREATE TABLE IF NOT EXISTS assets (
                id CHAR(36) NOT NULL,
                merchant_id INT NOT NULL,
                url TEXT NOT NULL,
                thumbnail_url TEXT NULL,
                source_type ENUM('saved_model','generation','infographic') NOT NULL,
                source_id CHAR(36) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                INDEX idx_assets_merchant_created (merchant_id, created_at),
                INDEX idx_assets_source (source_type, source_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    }

    public function record(int $merchantId, string $url, ?string $thumbnailUrl, string $sourceType, ?string $sourceId): string
    {
        $id = $this->newUuid();
        $stmt = $this->db->prepare(
            'INSERT INTO assets (id, merchant_id, url, thumbnail_url, source_type, source_id)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$id, $merchantId, $url, $thumbnailUrl, $sourceType, $sourceId]);
        return $id;
    }

    public function listByMerchant(int $merchantId, int $limit = 100, int $offset = 0): array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM assets WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        );
        $stmt->execute([$merchantId, $limit, $offset]);
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    public function deleteBySource(string $sourceType, string $sourceId): void
    {
        $stmt = $this->db->prepare('DELETE FROM assets WHERE source_type = ? AND source_id = ?');
        $stmt->execute([$sourceType, $sourceId]);
    }

    private function newUuid(): string
    {
        $data    = random_bytes(16);
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
