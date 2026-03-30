<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

class SessionRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /** Generates UUID v4, inserts row, returns id */
    public function create(array $data): string
    {
        $uuid = $this->generateUuidV4();

        $stmt = $this->db->prepare(
            'INSERT INTO tryon_sessions
             (id, merchant_id, product_id, variant_id, status, device_type, country_code)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $uuid,
            $data['merchant_id'],
            $data['product_id'],
            $data['variant_id'] ?? null,
            'pending',
            $data['device_type'] ?? null,
            $data['country_code'] ?? null,
        ]);

        return $uuid;
    }

    public function updateStatus(string $id, string $status, array $extra = []): void
    {
        $fields = ['status = ?'];
        $values = [$status];

        $allowed = [
            'result_image_url', 'result_seed', 'result_expires_at',
            'error_message', 'api_request_at', 'api_response_at', 'api_latency_ms',
        ];

        foreach ($allowed as $col) {
            if (array_key_exists($col, $extra)) {
                $fields[] = "{$col} = ?";
                $values[] = $extra[$col];
            }
        }

        $values[] = $id;

        $sql = 'UPDATE tryon_sessions SET ' . implode(', ', $fields) . ' WHERE id = ?';
        $stmt = $this->db->prepare($sql);
        $stmt->execute($values);
    }

    /**
     * Sets action_{$action} = 1
     * Valid actions: add_to_cart, buy_now, save_image, share_wa
     */
    public function trackAction(string $id, string $action): void
    {
        $valid = ['add_to_cart', 'buy_now', 'save_image', 'share_wa'];
        if (!in_array($action, $valid, true)) {
            return;
        }

        $col = "action_{$action}";
        $stmt = $this->db->prepare(
            "UPDATE tryon_sessions SET {$col} = 1 WHERE id = ?"
        );
        $stmt->execute([$id]);
    }

    public function findById(string $id): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM tryon_sessions WHERE id = ? LIMIT 1'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    private function generateUuidV4(): string
    {
        $data = random_bytes(16);
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
