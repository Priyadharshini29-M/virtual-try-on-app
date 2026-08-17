<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\AnalyticsRepo;
use TryFit\Db\MerchantRepo;
use TryFit\Db\ProductRepo;
use TryFit\Db\SessionRepo;
use TryFit\Middleware\ApiKeyAuth;

class SessionController
{
    public function create(): void
    {
        $merchant = $this->authenticate();

        $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

        $productId   = isset($body['product_id'])  ? (int)$body['product_id']  : null;
        $variantId   = isset($body['variant_id'])  ? (int)$body['variant_id']  : null;
        $deviceType  = $body['device_type']  ?? null;
        $countryCode = $body['country_code'] ?? null;

        if ($productId === null) {
            respondJson(['error' => 'product_id is required'], 400);
        }

        // Widget sends Shopify product ID; look up internal products.id for the FK
        $productRepo = new ProductRepo();
        $dbProduct = $productRepo->findByShopifyId((int)$merchant['id'], $productId);
        $internalProductId = $dbProduct ? (int)$dbProduct['id'] : null;

        // Create session (only possible when product is synced to DB)
        $uuid = null;
        if ($internalProductId !== null) {
            $sessionRepo = new SessionRepo();
            try {
                $uuid = $sessionRepo->create([
                    'merchant_id'  => (int)$merchant['id'],
                    'product_id'   => $internalProductId,
                    'variant_id'   => $variantId,
                    'device_type'  => $deviceType,
                    'country_code' => $countryCode,
                ]);
            } catch (\Throwable $e) {
                error_log('[FitSnap] session create failed: ' . $e->getMessage());
            }
        }

        // Always record daily analytics regardless of session creation success
        try {
            $analyticsRepo = new AnalyticsRepo();
            $analyticsRepo->upsertDaily((int)$merchant['id'], date('Y-m-d'), ['tryon_initiated' => 1]);
        } catch (\Throwable $e) {
            error_log('[FitSnap] analytics upsert failed: ' . $e->getMessage());
        }

        respondJson(['session_id' => $uuid]);
    }

    public function track(): void
    {
        $merchant = $this->authenticate();

        $body   = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);
        $sessId = trim((string)($body['session_id'] ?? ''));
        $action = trim((string)($body['action'] ?? ''));

        if ($sessId === '' || !in_array($action, AppConfig::SESSION_ACTIONS, true)) {
            respondJson(['error' => 'Invalid session_id or action'], 400);
        }

        $sessionRepo = new SessionRepo();
        $session     = $sessionRepo->findById($sessId);

        if ($session === null || (int)$session['merchant_id'] !== (int)$merchant['id']) {
            respondJson(['error' => 'Session not found'], 404);
        }

        $sessionRepo->trackAction($sessId, $action);

        try {
            $analyticsRepo = new AnalyticsRepo();
            $analyticsRepo->upsertDaily(
                (int)$merchant['id'],
                date('Y-m-d'),
                [AppConfig::ACTION_ANALYTICS_MAP[$action] => 1]
            );
        } catch (\Throwable $e) {
            error_log('[FitSnap] analytics track failed: ' . $e->getMessage());
        }

        respondJson(['ok' => true]);
    }

    private function authenticate(): array
    {
        $key = trim((string)($_SERVER['HTTP_X_API_KEY'] ?? ''));
        if ($key !== '') {
            return ApiKeyAuth::handle();
        }

        $shop = trim((string)($_GET['shop'] ?? ''));
        if ($shop !== '') {
            $repo     = new MerchantRepo();
            $merchant = $repo->findByDomain($shop);
            if ($merchant && (int)$merchant['is_active'] === 1) {
                return $merchant;
            }
        }

        respondJson(['error' => 'Unauthorized'], 401);
        exit;
    }
}
