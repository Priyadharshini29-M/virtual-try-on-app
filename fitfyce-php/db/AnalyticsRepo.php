<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

class AnalyticsRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Atomic increments via INSERT ... ON DUPLICATE KEY UPDATE.
     *
     * $increments keys: tryon_initiated, tryon_completed, tryon_failed,
     *   add_to_cart_count, buy_now_count, save_count, share_wa_count,
     *   order_count, revenue_inr
     */
    public function upsertDaily(int $merchantId, string $date, array $increments): void
    {
        $allowed = [
            'tryon_initiated', 'tryon_completed', 'tryon_failed',
            'add_to_cart_count', 'buy_now_count', 'save_count',
            'share_wa_count', 'order_count', 'revenue_inr',
        ];

        $setClauses = [];
        foreach ($allowed as $col) {
            if (isset($increments[$col]) && $increments[$col] != 0) {
                $setClauses[] = "{$col} = {$col} + " . (float)$increments[$col];
            }
        }

        if (empty($setClauses)) {
            return;
        }

        $insertCols = implode(', ', array_merge(['merchant_id', 'date'], $allowed));
        $insertVals = implode(', ', array_fill(0, count($allowed) + 2, '?'));
        $updateStr  = implode(', ', $setClauses);

        $sql = "INSERT INTO analytics_daily ({$insertCols}) VALUES ({$insertVals})
                ON DUPLICATE KEY UPDATE {$updateStr}";

        $params = [$merchantId, $date];
        foreach ($allowed as $col) {
            $params[] = $increments[$col] ?? 0;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
    }

    public function getRange(int $merchantId, string $from, string $to): array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM analytics_daily
             WHERE merchant_id = ? AND date BETWEEN ? AND ?
             ORDER BY date ASC'
        );
        $stmt->execute([$merchantId, $from, $to]);
        return $stmt->fetchAll();
    }

    public function getTopProducts(
        int $merchantId,
        string $from,
        string $to,
        int $limit = 10
    ): array {
        $stmt = $this->db->prepare(
            'SELECT p.shopify_product_id, p.title, p.handle,
                    COUNT(ts.id) AS tryon_count,
                    SUM(ts.action_add_to_cart) AS cart_count,
                    SUM(ts.action_buy_now) AS buy_count
             FROM tryon_sessions ts
             JOIN products p ON p.id = ts.product_id
             WHERE ts.merchant_id = ?
               AND DATE(ts.created_at) BETWEEN ? AND ?
             GROUP BY ts.product_id
             ORDER BY tryon_count DESC
             LIMIT ?'
        );
        $stmt->execute([$merchantId, $from, $to, $limit]);
        return $stmt->fetchAll();
    }
}
