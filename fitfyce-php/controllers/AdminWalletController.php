<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Admin\View;
use TryFit\Db\WalletRepo;
use TryFit\Middleware\AdminSession;

/**
 * PHP admin "Credits" page — merchant-facing wallet balance, top-up packs,
 * and recent transactions. Mirrors the retired Remix /app/wallet route but
 * server-renders the HTML. Payment itself still happens via Razorpay
 * Checkout (checkout.js), kicked off by a form POST to this controller's
 * `topup` action.
 */
class AdminWalletController
{
    public function show(): void
    {
        $merchant = AdminSession::require();
        $repo     = new WalletRepo();
        $id       = (int)$merchant['id'];

        $data = [
            'merchant' => $merchant,
            'balance'  => $repo->balance($id),
            'used'     => $repo->totalDebited($id),
            'packs'    => \TryFit\Src\WalletSettings::packs(),
            'recent'   => $repo->recentTransactions($id, 20),
            'topup_success' => isset($_GET['topup']) && $_GET['topup'] === '1',
            'razorpay_key'  => (string)(getenv('RAZORPAY_KEY_ID') ?: ''),
        ];
        View::render('wallet', $data, 'wallet', 'Credits · Brix-TryOn');
    }

    /**
     * Creates a Razorpay order and returns JSON for the checkout widget to
     * open on the client. XHR-style endpoint; the page's inline JS calls
     * this and then opens the widget.
     */
    public function createOrder(): void
    {
        $merchant = AdminSession::require();
        // Reuse the existing API controller's logic by faking the api-key
        // auth: it only needs $merchant to proceed. We bypass ApiKeyAuth by
        // calling WalletRepo directly here instead.
        $body   = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);
        $packId = (string)($body['pack_id'] ?? '');

        $pack = \TryFit\Src\WalletSettings::pack($packId);
        if ($pack === null) {
            respondJson(['ok' => false, 'error' => 'Unknown credit pack'], 400);
        }
        $client = new \TryFit\Src\RazorpayClient();

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
            writeLog('ERROR', 'Admin wallet create-order failed', ['message' => $e->getMessage()]);
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
        ]);
    }

    public function verifyPayment(): void
    {
        $merchant = AdminSession::require();
        $body     = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);
        $orderId  = (string)($body['order_id']   ?? '');
        $paymentId= (string)($body['payment_id'] ?? '');
        $signature= (string)($body['signature']  ?? '');

        if ($orderId === '' || $paymentId === '' || $signature === '') {
            respondJson(['ok' => false, 'error' => 'Missing payment confirmation fields'], 400);
        }

        $client = new \TryFit\Src\RazorpayClient();
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
}
