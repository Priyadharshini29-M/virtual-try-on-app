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

        // Fetch domain so new daily rows are tagged
        $domainStmt = $this->db->prepare(
            'SELECT shopify_domain, shopify_store_id FROM merchants WHERE id = ? LIMIT 1'
        );
        $domainStmt->execute([$merchantId]);
        $m = $domainStmt->fetch() ?: [];

        // Also backfill domain on existing rows if currently NULL
        $setClauses[] = 'shopify_domain = COALESCE(shopify_domain, VALUES(shopify_domain))';
        $setClauses[] = 'shopify_store_id = COALESCE(shopify_store_id, VALUES(shopify_store_id))';

        $insertCols = implode(', ', array_merge(
            ['merchant_id', 'date', 'shopify_domain', 'shopify_store_id'],
            $allowed
        ));
        $insertVals = implode(', ', array_fill(0, count($allowed) + 4, '?'));
        $updateStr  = implode(', ', $setClauses);

        $sql = "INSERT INTO analytics_daily ({$insertCols}) VALUES ({$insertVals})
                ON DUPLICATE KEY UPDATE {$updateStr}";

        $params = [
            $merchantId,
            $date,
            $m['shopify_domain']   ?? null,
            $m['shopify_store_id'] ?? null,
        ];
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

    /**
     * Returns top products by try-on count with fields matching the frontend contract:
     * { id, title, image, price, tryon_count, buy_count }
     *
     * Requires migration 011 (products.image_url and products.price columns).
     */
    public function getTopProducts(
        int $merchantId,
        string $from,
        string $to,
        int $limit = 10
    ): array {
        $stmt = $this->db->prepare(
            'SELECT
                p.shopify_product_id                                           AS id,
                COALESCE(MAX(p.title), MAX(p.collection_title),
                         CONCAT(\'Product #\', p.shopify_product_id))          AS title,
                COALESCE(MAX(p.image_url), MIN(vim.tryon_image_url), \'\')     AS image,
                MAX(COALESCE(p.price, 0.00))                                   AS price,
                COUNT(DISTINCT ts.id)                                          AS tryon_count,
                COALESCE(SUM(ts.action_buy_now), 0)                            AS buy_count
             FROM tryon_sessions ts
             JOIN products p ON p.id = ts.product_id
             LEFT JOIN variant_image_mappings vim ON vim.product_id = p.id
             WHERE ts.merchant_id = ?
               AND DATE(ts.created_at) BETWEEN ? AND ?
             GROUP BY p.id, p.shopify_product_id
             ORDER BY tryon_count DESC, buy_count DESC
             LIMIT ?'
        );
        $stmt->execute([$merchantId, $from, $to, $limit]);

        return array_map(static function (array $row): array {
            return [
                'id'          => (int)$row['id'],
                'title'       => (string)$row['title'],
                'image'       => (string)$row['image'],
                'price'       => number_format((float)$row['price'], 2, '.', ''),
                'tryon_count' => (int)$row['tryon_count'],
                'buy_count'   => (int)$row['buy_count'],
            ];
        }, $stmt->fetchAll());
    }

    /**
     * Returns device share as integer percentages summing to ≤100.
     * Reads from tryon_sessions.device_type ENUM('mobile','tablet','desktop').
     */
    public function getDeviceSplit(int $merchantId, string $from, string $to): array
    {
        $stmt = $this->db->prepare(
            'SELECT COALESCE(device_type, \'desktop\') AS device_type, COUNT(*) AS cnt
             FROM tryon_sessions
             WHERE merchant_id = ? AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY device_type'
        );
        $stmt->execute([$merchantId, $from, $to]);

        $counts = ['mobile' => 0, 'desktop' => 0, 'tablet' => 0];
        foreach ($stmt->fetchAll() as $row) {
            $type = (string)$row['device_type'];
            if (array_key_exists($type, $counts)) {
                $counts[$type] = (int)$row['cnt'];
            }
        }

        $total = array_sum($counts);
        if ($total === 0) {
            return ['mobile' => 0, 'desktop' => 0, 'tablet' => 0];
        }

        return [
            'mobile'  => (int)round(($counts['mobile']  / $total) * 100),
            'desktop' => (int)round(($counts['desktop'] / $total) * 100),
            'tablet'  => (int)round(($counts['tablet']  / $total) * 100),
        ];
    }
}
