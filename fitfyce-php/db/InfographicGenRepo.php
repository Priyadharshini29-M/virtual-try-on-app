<?php

declare(strict_types=1);

namespace TryFit\Db;

/**
 * Repo for the 5-style marketing infographic flow (Studio v2 / marketing
 * generation pipeline). Deliberately separate from the existing
 * InfographicController's stateless text-paragraph-driven flow, which this
 * does not touch.
 */
class InfographicGenRepo
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
            CREATE TABLE IF NOT EXISTS infographics (
                id CHAR(36) NOT NULL,
                generation_id CHAR(36) NOT NULL,
                merchant_id INT NOT NULL,
                style_key VARCHAR(30) NOT NULL,
                image_url TEXT NULL,
                status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
                error_message TEXT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                INDEX idx_ig_generation (generation_id),
                INDEX idx_ig_merchant (merchant_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    }

    /** Insert one row per style key, all starting 'pending'. Returns the new row ids keyed by style_key. */
    public function createBatch(string $generationId, int $merchantId, array $styleKeys): array
    {
        $stmt = $this->db->prepare(
            'INSERT INTO infographics (id, generation_id, merchant_id, style_key, status)
             VALUES (?, ?, ?, ?, \'pending\')'
        );
        $ids = [];
        foreach ($styleKeys as $styleKey) {
            $id = $this->newUuid();
            $stmt->execute([$id, $generationId, $merchantId, $styleKey]);
            $ids[$styleKey] = $id;
        }
        return $ids;
    }

    public function markCompleted(string $id, string $imageUrl): void
    {
        $stmt = $this->db->prepare(
            "UPDATE infographics SET status = 'completed', image_url = ? WHERE id = ?"
        );
        $stmt->execute([$imageUrl, $id]);
    }

    public function markFailed(string $id, string $errorMessage): void
    {
        $stmt = $this->db->prepare(
            "UPDATE infographics SET status = 'failed', error_message = ? WHERE id = ?"
        );
        $stmt->execute([$errorMessage, $id]);
    }

    public function listByGeneration(string $generationId): array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM infographics WHERE generation_id = ? ORDER BY created_at ASC'
        );
        $stmt->execute([$generationId]);
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    public function deleteByGeneration(string $generationId): array
    {
        $rows = $this->listByGeneration($generationId);
        $stmt = $this->db->prepare('DELETE FROM infographics WHERE generation_id = ?');
        $stmt->execute([$generationId]);
        return $rows;
    }

    private function newUuid(): string
    {
        $data    = random_bytes(16);
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
