<?php

declare(strict_types=1);

namespace TryFit\Db;

class SavedModelRepo
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
            CREATE TABLE IF NOT EXISTS saved_models (
                id CHAR(36) NOT NULL,
                merchant_id INT NOT NULL,
                image_url TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                INDEX idx_sm_merchant (merchant_id),
                INDEX idx_sm_created (merchant_id, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    }

    public function create(int $merchantId, string $imageUrl): string
    {
        $id = $this->newUuid();
        $stmt = $this->db->prepare(
            'INSERT INTO saved_models (id, merchant_id, image_url) VALUES (?, ?, ?)'
        );
        $stmt->execute([$id, $merchantId, $imageUrl]);
        return $id;
    }

    public function findById(string $id): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM saved_models WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row !== false ? $row : null;
    }

    public function listByMerchant(int $merchantId): array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM saved_models WHERE merchant_id = ? ORDER BY created_at DESC'
        );
        $stmt->execute([$merchantId]);
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    public function delete(string $id, int $merchantId): bool
    {
        $stmt = $this->db->prepare('DELETE FROM saved_models WHERE id = ? AND merchant_id = ?');
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
