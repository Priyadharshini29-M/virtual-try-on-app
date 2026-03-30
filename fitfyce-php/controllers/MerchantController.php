<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\MerchantRepo;
use TryFit\Middleware\ApiKeyAuth;

class MerchantController
{
    /**
     * GET /merchant/by-domain?domain=xxx.myshopify.com
     * Protected by master X-Api-Key (PHP_API_SECRET in Remix .env).
     * Returns the merchant row so Remix can pick up the per-merchant api_key.
     */
    public function byDomain(): void
    {
        // Still require a valid API key for this lookup
        ApiKeyAuth::handle();

        $domain = trim((string)($_GET['domain'] ?? ''));
        if ($domain === '') {
            respondJson(['error' => 'domain is required'], 400);
        }

        $repo     = new MerchantRepo();
        $merchant = $repo->findByDomain($domain);

        if ($merchant === null) {
            respondJson(['error' => 'Merchant not found'], 404);
        }

        // Return only safe fields — never expose access_token or api_secret
        respondJson([
            'id'            => $merchant['id'],
            'shopify_domain'=> $merchant['shopify_domain'],
            'plan'          => $merchant['plan'],
            'api_key'       => $merchant['api_key'],
            'is_active'     => $merchant['is_active'],
            'tryon_count_month' => $merchant['tryon_count_month'],
        ]);
    }

    /**
     * POST /merchant/register
     * Called by Remix on app install (OAuth callback).
     * Creates or reactivates a merchant row, returns their api_key.
     */
    public function register(): void
    {
        // Use master key for this privileged operation
        ApiKeyAuth::handle();

        $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

        $domain  = trim((string)($body['shopify_domain']  ?? ''));
        $storeId = trim((string)($body['shopify_store_id'] ?? ''));
        $token   = trim((string)($body['access_token']     ?? ''));

        if ($domain === '' || $storeId === '' || $token === '') {
            respondJson(['error' => 'shopify_domain, shopify_store_id, access_token are required'], 400);
        }

        $repo     = new MerchantRepo();
        $existing = $repo->findByDomain($domain);

        if ($existing !== null) {
            // Reactivate and refresh token
            $db = \TryFit\Db\Database::getInstance();
            $stmt = $db->prepare(
                'UPDATE merchants SET access_token = ?, is_active = 1 WHERE id = ?'
            );
            $stmt->execute([$token, $existing['id']]);

            respondJson([
                'id'      => $existing['id'],
                'api_key' => $existing['api_key'],
                'created' => false,
            ]);
        }

        // New merchant — generate unique api_key and api_secret
        $apiKey    = 'tf_' . bin2hex(random_bytes(24));
        $apiSecret = bin2hex(random_bytes(32));

        $id = $repo->create([
            'shopify_domain'     => $domain,
            'shopify_store_id'   => $storeId,
            'access_token'       => $token,
            'plan'               => 'free',
            'api_key'            => $apiKey,
            'api_secret'         => $apiSecret,
            'billing_cycle_start'=> date('Y-m-d'),
            'is_active'          => 1,
        ]);

        // Create default settings row
        $db = \TryFit\Db\Database::getInstance();
        $db->prepare(
            'INSERT IGNORE INTO merchant_settings (merchant_id) VALUES (?)'
        )->execute([$id]);

        respondJson([
            'id'      => $id,
            'api_key' => $apiKey,
            'created' => true,
        ]);
    }

    /**
     * POST /merchant/deactivate
     * Called by Remix on app/uninstalled webhook.
     */
    public function deactivate(): void
    {
        ApiKeyAuth::handle();

        $body   = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);
        $domain = trim((string)($body['shopify_domain'] ?? ''));

        if ($domain === '') {
            respondJson(['error' => 'shopify_domain is required'], 400);
        }

        $db   = \TryFit\Db\Database::getInstance();
        $stmt = $db->prepare('UPDATE merchants SET is_active = 0 WHERE shopify_domain = ?');
        $stmt->execute([$domain]);

        respondJson(['ok' => true]);
    }
}
