<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\WalletRepo;
use TryFit\Middleware\ApiKeyAuth;
use TryFit\Src\RazorpayClient;
use TryFit\Src\WalletSettings;

/**
 * Wallet-credit API — balance, top-up order creation, and the Razorpay
 * webhook that captures the payment and tops up the balance.
 *
 * Credit packs are static so merchants always see the same price per credit.
 * Prices are in INR paise (the smallest unit) — Razorpay India charges that
 * way. Add USD/Stripe packs here when that provider gets wired up.
 */
class WalletController
{
    /**
     * Default top-up packs, used until a platform admin saves packs (see WalletSettings).
     * amount_minor is paise (1 INR = 100 paise). Keep pack IDs stable:
     * clients send `pack_id` from this list to /wallet/topup.
     */
    public const PACKS = [
        'starter' => ['credits' => 100,  'amount_minor' => 49900,  'currency' => 'INR', 'label' => 'Starter'],
        'growth'  => ['credits' => 500,  'amount_minor' => 199900, 'currency' => 'INR', 'label' => 'Growth',  'popular' => true],
        'scale'   => ['credits' => 2000, 'amount_minor' => 599900, 'currency' => 'INR', 'label' => 'Scale'],
        'pro'     => ['credits' => 5000, 'amount_minor' => 1299900,'currency' => 'INR', 'label' => 'Pro'],
    ];

    public function balance(): void
    {
        $merchant = ApiKeyAuth::handle();
        $repo     = new WalletRepo();
        $id       = (int)$merchant['id'];

        respondJson([
            'ok'       => true,
            'balance'  => $repo->balance($id),
            // Kept so legacy UI callers that still read `credits` keep working.
            'credits'  => $repo->balance($id),
            'used'     => $repo->totalDebited($id),
            'packs'    => array_map(static function (string $id, array $p): array {
                return [
                    'id'            => $id,
                    'label'         => $p['label'],
                    'credits'       => $p['credits'],
                    'amount_minor'  => $p['amount_minor'],
                    'currency'      => $p['currency'],
                    'popular'       => !empty($p['popular']),
                ];
            }, array_keys(WalletSettings::packs()), WalletSettings::packs()),
            'recent'   => $repo->recentTransactions($id, 20),
        ]);
    }

    /**
     * Creates a Razorpay order for the chosen pack. Returns the order details
     * the client needs to open the Checkout widget. The wallet is only
     * topped up after the webhook (or /wallet/verify fallback) confirms the
     * payment was captured.
     */
    public function topup(): void
    {
        $merchant = ApiKeyAuth::handle();
        $body     = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);
        $packId   = (string)($body['pack_id'] ?? '');

        $pack = WalletSettings::pack($packId);   // packs are edited in the platform admin
        if ($pack === null) {
            respondJson(['ok' => false, 'error' => 'Unknown credit pack'], 400);
        }

        $client = new RazorpayClient();
        if (!$client->isConfigured()) {
            respondJson([
                'ok'    => false,
                'error' => 'Payments are not set up on the server. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
            ], 503);
        }

        $receipt = 'wallet_' . $merchant['id'] . '_' . time();
        try {
            $order = $client->createOrder(
                (int)$pack['amount_minor'],
                (string)$pack['currency'],
                $receipt,
                [
                    'merchant_id'    => (string)$merchant['id'],
                    'shopify_domain' => (string)$merchant['shopify_domain'],
                    'pack_id'        => $packId,
                    'credits'        => (string)$pack['credits'],
                ]
            );
        } catch (\Throwable $e) {
            writeLog('ERROR', 'Razorpay order failed', ['message' => $e->getMessage()]);
            respondJson(['ok' => false, 'error' => 'Could not start payment. Please try again.'], 502);
        }

        (new WalletRepo())->createPaymentOrder(
            (int)$merchant['id'],
            'razorpay',
            (string)$order['id'],
            (int)$pack['amount_minor'],
            (string)$pack['currency'],
            (int)$pack['credits']
        );

        respondJson([
            'ok'       => true,
            'order_id' => $order['id'],
            'key_id'   => $client->keyId(),
            'amount'   => (int)$pack['amount_minor'],
            'currency' => $pack['currency'],
            'credits'  => (int)$pack['credits'],
            'pack'     => $packId,
            'notes'    => [
                'shopify_domain' => $merchant['shopify_domain'],
                'merchant_id'    => $merchant['id'],
            ],
        ]);
    }

    /**
     * Fallback verifier called by the frontend right after Checkout's success
     * callback. Idempotent — the webhook also credits the wallet when it
     * fires, and WalletRepo::capturePayment() ignores a repeat capture.
     */
    public function verify(): void
    {
        $merchant = ApiKeyAuth::handle();
        $body     = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);
        $orderId  = (string)($body['order_id']   ?? '');
        $paymentId= (string)($body['payment_id'] ?? '');
        $signature= (string)($body['signature']  ?? '');

        if ($orderId === '' || $paymentId === '' || $signature === '') {
            respondJson(['ok' => false, 'error' => 'Missing payment confirmation fields'], 400);
        }

        $client = new RazorpayClient();
        if (!$client->verifyPaymentSignature($orderId, $paymentId, $signature)) {
            respondJson(['ok' => false, 'error' => 'Invalid payment signature'], 400);
        }

        $repo  = new WalletRepo();
        $order = $repo->findPaymentOrder('razorpay', $orderId);
        if ($order === null || (int)$order['merchant_id'] !== (int)$merchant['id']) {
            respondJson(['ok' => false, 'error' => 'Order not found for this account'], 404);
        }

        $repo->capturePayment((int)$order['id'], $paymentId);

        respondJson([
            'ok'      => true,
            'credits' => (int)$order['credits'],
            'balance' => $repo->balance((int)$merchant['id']),
        ]);
    }

    /**
     * Razorpay webhook endpoint (set to /wallet/webhook/razorpay in the
     * Razorpay dashboard). Verifies the HMAC and captures the payment.
     * Returns 200 as fast as possible so Razorpay stops retrying.
     */
    public function webhook(): void
    {
        $raw       = (string)file_get_contents('php://input');
        $signature = (string)($_SERVER['HTTP_X_RAZORPAY_SIGNATURE'] ?? '');

        $client = new RazorpayClient();
        if (!$client->verifyWebhook($raw, $signature)) {
            writeLog('WARNING', 'Razorpay webhook signature mismatch', [
                'has_sig' => $signature !== '',
                'bytes'   => strlen($raw),
            ]);
            respondJson(['ok' => false, 'error' => 'Invalid signature'], 400);
        }

        $payload = json_decode($raw, true);
        if (!is_array($payload)) {
            respondJson(['ok' => false, 'error' => 'Invalid payload'], 400);
        }

        $event = (string)($payload['event'] ?? '');
        if ($event !== 'payment.captured' && $event !== 'order.paid') {
            // Ack ignored events so Razorpay doesn't retry forever.
            respondJson(['ok' => true, 'ignored' => $event]);
        }

        $payment = $payload['payload']['payment']['entity']   ?? null;
        $orderId = $payment['order_id']   ?? ($payload['payload']['order']['entity']['id'] ?? '');
        $payId   = $payment['id']         ?? null;

        if (!is_string($orderId) || $orderId === '') {
            respondJson(['ok' => false, 'error' => 'Missing order_id'], 400);
        }

        $repo  = new WalletRepo();
        $order = $repo->findPaymentOrder('razorpay', $orderId);
        if ($order === null) {
            writeLog('WARNING', 'Razorpay webhook for unknown order', ['order_id' => $orderId]);
            // 200 still — we don't want retries, nothing to fix on their side.
            respondJson(['ok' => true, 'order_not_found' => true]);
        }

        $repo->capturePayment((int)$order['id'], is_string($payId) ? $payId : null);
        respondJson(['ok' => true]);
    }
}
