<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\Database;
use TryFit\Db\MerchantRepo;
use TryFit\Middleware\ApiKeyAuth;

class MerchantController
{
    /**
     * GET /merchant/by-domain?domain=xxx.myshopify.com
     */
    public function byDomain(): void
    {
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

        respondJson([
            'id'                => $merchant['id'],
            'shopify_domain'    => $merchant['shopify_domain'],
            'plan'              => $merchant['plan'],
            'api_key'           => $merchant['api_key'],
            'is_active'         => $merchant['is_active'],
            'tryon_count_month' => $merchant['tryon_count_month'],
        ]);
    }

    /**
     * POST /merchant/register
     * Called by Remix on app install (OAuth callback).
     */
    public function register(): void
    {
        ApiKeyAuth::handle();

        $rawBody = (string)file_get_contents('php://input');
        writeLog('info', 'register called', ['body' => $rawBody]);
        $body = (array)(json_decode($rawBody, true) ?? []);

        $domain  = trim((string)($body['shopify_domain']   ?? ''));
        $storeId = trim((string)($body['shopify_store_id'] ?? ''));
        $token   = trim((string)($body['access_token']     ?? ''));

        // Normalise domain — strip protocol and trailing slash so DB stores consistent format
        $domain  = preg_replace('#^https?://#i', '', $domain);
        $domain  = rtrim($domain, '/');
        $storeId = preg_replace('#^https?://#i', '', $storeId);
        $storeId = rtrim($storeId, '/');

        if ($domain === '' || $storeId === '') {
            writeLog('error', 'register missing required fields', ['domain' => $domain, 'storeId' => $storeId]);
            respondJson(['error' => 'shopify_domain and shopify_store_id are required'], 400);
        }

        $repo     = new MerchantRepo();
        $existing = $repo->findByDomain($domain) ?? $repo->findByDomainLike($domain);

        if ($existing !== null) {
            $db = Database::getInstance();
            if ($token !== '') {
                $db->prepare('UPDATE merchants SET access_token = ?, is_active = 1, shopify_domain = ? WHERE id = ?')
                   ->execute([$token, $domain, $existing['id']]);
            } else {
                // Re-activate even without a new token (e.g., app re-opened after uninstall)
                $db->prepare('UPDATE merchants SET is_active = 1, shopify_domain = ? WHERE id = ?')
                   ->execute([$domain, $existing['id']]);
            }

            respondJson(['id' => $existing['id'], 'api_key' => $existing['api_key'], 'created' => false]);
        }

        // New merchant — token required for first install
        if ($token === '') {
            writeLog('error', 'register: access_token required for new merchant', ['domain' => $domain]);
            respondJson(['error' => 'access_token is required for new merchant registration'], 400);
        }

        $apiKey    = AppConfig::API_KEY_PREFIX . bin2hex(random_bytes(24));
        $apiSecret = bin2hex(random_bytes(32));

        $id = $repo->create([
            'shopify_domain'      => $domain,
            'shopify_store_id'    => $storeId,
            'access_token'        => $token,
            'plan'                => AppConfig::DEFAULT_PLAN,
            'api_key'             => $apiKey,
            'api_secret'          => $apiSecret,
            'billing_cycle_start' => date('Y-m-d'),
            'is_active'           => 1,
        ]);

        $db = Database::getInstance();
        $db->prepare(
            'INSERT IGNORE INTO merchant_settings (merchant_id, shopify_domain, shopify_store_id) VALUES (?, ?, ?)'
        )->execute([$id, $domain, $storeId]);

        respondJson(['id' => $id, 'api_key' => $apiKey, 'created' => true]);
    }

    /**
     * POST /merchant/deactivate
     * Called by Remix on app/uninstalled webhook.
     */
    public function deactivate(): void
    {
        // HMAC verification for Shopify webhooks
        $hmacHeader = $_SERVER['HTTP_X_SHOPIFY_HMAC_SHA256'] ?? '';
        $rawBody = file_get_contents('php://input');
        $sharedSecret = AppConfig::shopifyApiSecret();
        $calculatedHmac = base64_encode(hash_hmac('sha256', $rawBody, $sharedSecret, true));
        if ($hmacHeader === '' || !hash_equals($calculatedHmac, $hmacHeader)) {
            respondJson(['error' => 'Invalid HMAC'], 401);
        }

        $body   = (array)(json_decode($rawBody, true) ?? []);
        $domain = trim((string)($body['shopify_domain'] ?? ''));

        if ($domain === '') {
            respondJson(['error' => 'shopify_domain is required'], 400);
        }

        $db   = Database::getInstance();
        $stmt = $db->prepare('UPDATE merchants SET is_active = 0 WHERE shopify_domain = ?');
        $stmt->execute([$domain]);

        respondJson(['ok' => true]);
    }
}
