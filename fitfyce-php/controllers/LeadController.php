<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\LeadRepo;
use TryFit\Db\MerchantRepo;
use TryFit\Middleware\ApiKeyAuth;

/**
 * Storefront widget lead capture — POST /api/lead/capture.
 * Called once per browser, gated behind the blurred try-on result, before
 * the widget reveals the image. See tryon-widget.js's lead-gate flow.
 */
class LeadController
{
    public function capture(): void
    {
        $merchant = $this->authenticate();

        $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

        $email   = trim((string)($body['email'] ?? ''));
        $phone   = trim((string)($body['phone'] ?? ''));
        $consent = (bool)($body['consent'] ?? false);
        $sessionId = trim((string)($body['session_id'] ?? '')) ?: null;

        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            respondJson(['error' => 'A valid email address is required'], 400);
            return;
        }
        if ($phone === '' || mb_strlen($phone) < 6) {
            respondJson(['error' => 'A valid phone number is required'], 400);
            return;
        }
        if (!$consent) {
            respondJson(['error' => 'Please agree to the Privacy Policy and Terms of Service to continue'], 400);
            return;
        }

        try {
            $leadRepo = new LeadRepo();
            $leadRepo->create([
                'merchant_id'       => (int)$merchant['id'],
                'session_id'        => $sessionId,
                'email'             => $email,
                'phone'             => $phone,
                'consent_marketing' => $consent,
            ]);
        } catch (\Throwable $e) {
            writeLog('ERROR', 'LeadController capture failed', ['message' => $e->getMessage()]);
            respondJson(['error' => 'Failed to save your details. Please try again.'], 500);
            return;
        }

        respondJson(['ok' => true]);
    }

    /**
     * Merchant-facing — GET /leads. Used by the admin app's Analytics page.
     */
    public function listForMerchant(): void
    {
        $merchant = $this->authenticate();

        $limit = min(200, max(1, (int)($_GET['limit'] ?? 100)));

        $leadRepo = new LeadRepo();
        respondJson(['leads' => $leadRepo->listByMerchant((int)$merchant['id'], $limit)]);
    }

    /**
     * Diagnostic — GET /lead/list?key=MASTER_KEY. Master API key only (not a
     * per-merchant key), since this exists purely to verify captures are
     * actually landing in customer_leads while testing. Not linked from any
     * UI; safe to remove once the storefront lead-capture flow is trusted.
     */
    public function list(): void
    {
        $key = trim((string)($_SERVER['HTTP_X_API_KEY'] ?? $_GET['key'] ?? ''));
        $masterKey = AppConfig::masterApiKey();
        if ($masterKey === '' || $key !== $masterKey) {
            respondJson(['error' => 'Unauthorized'], 401);
            return;
        }

        $leadRepo = new LeadRepo();
        respondJson(['leads' => $leadRepo->listRecent(20)]);
    }

    /**
     * Shop domain wins over API key when both are present. The Remix proxy
     * (api.lead.capture.jsx / api.tryon.jsx) always sends the master API key
     * PLUS the real shop domain — resolving by key first would attribute
     * every lead to the master account (merchant_id 0) instead of the actual
     * shop, which is what was happening before this fix. Mirrors
     * TryOnController's resolution order.
     */
    private function authenticate(): array
    {
        $shop = trim((string)($_GET['shop'] ?? $_SERVER['HTTP_X_SHOP_DOMAIN'] ?? ''));
        if ($shop !== '') {
            $repo     = new MerchantRepo();
            $merchant = $repo->findByDomain($shop) ?? $repo->findByDomainLike($shop);
            if ($merchant && (int)$merchant['is_active'] === 1) {
                return $merchant;
            }
        }

        $key = trim((string)($_SERVER['HTTP_X_API_KEY'] ?? ''));
        if ($key !== '') {
            return ApiKeyAuth::handle();
        }

        respondJson(['error' => 'Unauthorized'], 401);
        exit;
    }
}
