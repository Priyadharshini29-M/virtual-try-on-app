<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\AnalyticsRepo;
use TryFit\Db\Database;
use TryFit\Db\MerchantRepo;
use TryFit\Middleware\ApiKeyAuth;

class ConversionController
{
    public function record(): void
    {
        $merchant   = ApiKeyAuth::handle();
        $merchantId = (int)$merchant['id'];

        $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

        // When called via Shopify webhook with the master key (id=0),
        // resolve the real merchant from the shop domain in the payload.
        if ($merchantId === 0) {
            $domain = trim((string)($body['merchant_domain'] ?? ''));
            if ($domain === '') {
                respondJson(['error' => 'merchant_domain required for webhook calls'], 400);
            }
            $merchantRow = (new MerchantRepo())->findByDomain($domain);
            if ($merchantRow === null || (int)$merchantRow['is_active'] === 0) {
                respondJson(['ok' => true]); // Unknown shop — silent OK so Shopify doesn't retry
            }
            $merchantId = (int)$merchantRow['id'];
        }

        $shopifyOrderId = isset($body['shopify_order_id']) ? (int)$body['shopify_order_id'] : null;
        $orderValueInr  = isset($body['order_value_inr'])  ? (float)$body['order_value_inr'] : null;
        $lineItems      = is_array($body['line_items'] ?? null) ? $body['line_items'] : [];
        $webhookEventId = trim((string)($body['webhook_event_id'] ?? ''));
        $eventType      = (string)($body['event_type'] ?? 'orders/paid');

        if ($shopifyOrderId === null) {
            respondJson(['error' => 'shopify_order_id is required'], 400);
        }

        $db = Database::getInstance();

        // Dedup: skip already-processed webhook events
        if ($webhookEventId !== '') {
            $dedup = $db->prepare(
                'INSERT IGNORE INTO analytics_webhook_events
                 (webhook_event_id, merchant_id, event_type) VALUES (?, ?, ?)'
            );
            $dedup->execute([$webhookEventId, $merchantId, $eventType]);
            if ($dedup->rowCount() === 0) {
                respondJson(['ok' => true, 'duplicate' => true]);
            }
        }

        $attributionDays = AppConfig::CONVERSION_ATTRIBUTION_DAYS;

        foreach ($lineItems as $item) {
            $productId  = isset($item['product_id']) ? (int)$item['product_id'] : null;
            $properties = is_array($item['properties'] ?? null) ? $item['properties'] : [];

            // Prefer exact session from line item property (set by widget addToCart/buyNow)
            $fitfyceSession = trim((string)($properties['_fitfyce_session'] ?? ''));
            $sessionId = false;

            if ($fitfyceSession !== '') {
                $exact = $db->prepare(
                    'SELECT id FROM tryon_sessions WHERE id = ? AND merchant_id = ? LIMIT 1'
                );
                $exact->execute([$fitfyceSession, $merchantId]);
                $sessionId = $exact->fetchColumn();
            }

            // Fall back to time-window attribution when no explicit session ID
            if ($sessionId === false && $productId !== null) {
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
                $stmt->execute([$merchantId, $productId]);
                $sessionId = $stmt->fetchColumn();
            }

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
                    $merchantId,
                    $shopifyOrderId,
                    $body['shopify_order_gid'] ?? null,
                    $orderValueInr,
                ]);
            } catch (\PDOException $e) {
                // Duplicate key — safe to ignore
            }
        }

        (new AnalyticsRepo())->upsertDaily(
            $merchantId,
            date('Y-m-d'),
            ['order_count' => 1, 'revenue_inr' => $orderValueInr ?? 0]
        );

        respondJson(['ok' => true]);
    }
}
