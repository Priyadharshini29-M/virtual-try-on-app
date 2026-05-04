<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\AnalyticsRepo;
use TryFit\Db\Database;
use TryFit\Middleware\ApiKeyAuth;

class ConversionController
{
    public function record(): void
    {
        $merchant = ApiKeyAuth::handle();

        $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

        $shopifyOrderId = isset($body['shopify_order_id']) ? (int)$body['shopify_order_id'] : null;
        $orderValueInr  = isset($body['order_value_inr'])  ? (float)$body['order_value_inr'] : null;
        $lineItems      = is_array($body['line_items'] ?? null) ? $body['line_items'] : [];

        if ($shopifyOrderId === null) {
            respondJson(['error' => 'shopify_order_id is required'], 400);
        }

        $db             = Database::getInstance();
        $attributionDays = AppConfig::CONVERSION_ATTRIBUTION_DAYS;

        foreach ($lineItems as $item) {
            $productId = isset($item['product_id']) ? (int)$item['product_id'] : null;
            if ($productId === null) {
                continue;
            }

            $stmt = $db->prepare(
                "SELECT ts.id FROM tryon_sessions ts
                 JOIN products p ON p.id = ts.product_id
                 WHERE ts.merchant_id = ?
                   AND p.shopify_product_id = ?
                   AND ts.status = 'completed'
                   AND ts.created_at >= DATE_SUB(NOW(), INTERVAL {$attributionDays} DAY)
                 ORDER BY ts.created_at DESC
                 LIMIT 1"
            );
            $stmt->execute([(int)$merchant['id'], $productId]);
            $sessionId = $stmt->fetchColumn();

            if ($sessionId === false) {
                continue;
            }

            try {
                $db->prepare(
                    'INSERT IGNORE INTO tryon_conversions
                     (tryon_session_id, merchant_id, shopify_order_id,
                      shopify_order_gid, order_value_inr)
                     VALUES (?, ?, ?, ?, ?)'
                )->execute([
                    $sessionId,
                    (int)$merchant['id'],
                    $shopifyOrderId,
                    $body['shopify_order_gid'] ?? null,
                    $orderValueInr,
                ]);
            } catch (\PDOException $e) {
                // Duplicate — skip silently
            }
        }

        $analyticsRepo = new AnalyticsRepo();
        $analyticsRepo->upsertDaily(
            (int)$merchant['id'],
            date('Y-m-d'),
            ['order_count' => 1, 'revenue_inr' => $orderValueInr ?? 0]
        );

        respondJson(['ok' => true]);
    }
}
