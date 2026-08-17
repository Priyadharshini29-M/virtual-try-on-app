<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

class WebhookLogRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public function logEvent(array $data): int
    {
        $stmt = $this->db->prepare(
            'INSERT INTO webhook_logs
                (merchant_id, event_type, direction, payload, headers, response_status, error_message, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())'
        );
        $stmt->execute([
            $data['merchant_id'],
            $data['event_type'],
            $data['direction'],
            json_encode($data['payload']),
            isset($data['headers']) ? json_encode($data['headers']) : null,
            $data['response_status'] ?? null,
            $data['error_message'] ?? null
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function updateStatus(int $id, int $responseStatus = null, string $errorMessage = null): void
    {
        $stmt = $this->db->prepare(
            'UPDATE webhook_logs SET response_status = ?, error_message = ?, updated_at = NOW() WHERE id = ?'
        );
        $stmt->execute([$responseStatus, $errorMessage, $id]);
    }
}
