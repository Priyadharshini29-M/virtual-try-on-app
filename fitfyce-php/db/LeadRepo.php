<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

/**
 * Storefront widget lead capture — email/phone collected once per browser
 * (gated behind the blurred try-on result) before the merchant's Privacy
 * Policy / Terms of Service are agreed to. Separate from tryon_sessions so
 * leads can be queried/exported independently of generation analytics.
 */
class LeadRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
        $this->ensureTable();
    }

    private function ensureTable(): void
    {
        $this->db->exec("
            CREATE TABLE IF NOT EXISTS customer_leads (
                id CHAR(36) NOT NULL,
                merchant_id INT NOT NULL,
                session_id CHAR(36) NULL,
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(30) NOT NULL,
                consent_marketing TINYINT(1) NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                INDEX idx_leads_merchant (merchant_id),
                INDEX idx_leads_merchant_email (merchant_id, email),
                INDEX idx_leads_created (merchant_id, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    }

    public function create(array $data): string
    {
        $uuid = $this->generateUuidV4();

        $stmt = $this->db->prepare(
            'INSERT INTO customer_leads
             (id, merchant_id, session_id, email, phone, consent_marketing)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $uuid,
            $data['merchant_id'],
            $data['session_id'] ?? null,
            $data['email'],
            $data['phone'],
            $data['consent_marketing'] ? 1 : 0,
        ]);

        return $uuid;
    }

    /** @return array<int, array{id:string, merchant_id:int, session_id:?string, email:string, phone:string, consent_marketing:int, created_at:string}> */
    public function listByMerchant(int $merchantId, int $limit = 100): array
    {
        $stmt = $this->db->prepare(
            'SELECT id, merchant_id, session_id, email, phone, consent_marketing, created_at
             FROM customer_leads
             WHERE merchant_id = ?
             ORDER BY created_at DESC
             LIMIT ?'
        );
        $stmt->bindValue(1, $merchantId, PDO::PARAM_INT);
        $stmt->bindValue(2, $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** @return array<int, array{id:string, merchant_id:int, session_id:?string, email:string, phone:string, consent_marketing:int, created_at:string}> */
    public function listRecent(int $limit = 20): array
    {
        $stmt = $this->db->prepare(
            'SELECT id, merchant_id, session_id, email, phone, consent_marketing, created_at
             FROM customer_leads
             ORDER BY created_at DESC
             LIMIT ?'
        );
        $stmt->bindValue(1, $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function generateUuidV4(): string
    {
        $data = random_bytes(16);
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
