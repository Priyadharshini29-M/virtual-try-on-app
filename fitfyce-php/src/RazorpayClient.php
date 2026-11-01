<?php

declare(strict_types=1);

namespace TryFit\Src;

/**
 * Minimal Razorpay REST client — just the two calls the wallet needs:
 *   createOrder()   — one-time charge, used by WalletController::topup()
 *   verifyWebhook() — HMAC check for payment.captured events
 *
 * No vendor package: Razorpay's PHP SDK isn't on the server and would need
 * Composer wiring. The REST API is simple (Basic auth with key+secret).
 */
class RazorpayClient
{
    private string $keyId;
    private string $keySecret;

    public function __construct()
    {
        $this->keyId     = (string)(getenv('RAZORPAY_KEY_ID') ?: '');
        $this->keySecret = (string)(getenv('RAZORPAY_KEY_SECRET') ?: '');
    }

    public function isConfigured(): bool
    {
        return $this->keyId !== '' && $this->keySecret !== '';
    }

    public function keyId(): string
    {
        return $this->keyId;
    }

    /**
     * Create a one-time payment order for a top-up pack.
     * amount is in the smallest currency unit (paise for INR, cents for USD).
     * Returns the Razorpay order payload (contains `id`, which the frontend
     * passes into the Checkout widget).
     */
    public function createOrder(int $amountMinor, string $currency, string $receipt, array $notes = []): array
    {
        $payload = [
            'amount'   => $amountMinor,
            'currency' => strtoupper($currency),
            'receipt'  => $receipt,
            'notes'    => $notes,
            'payment_capture' => 1,
        ];
        return $this->post('/orders', $payload);
    }

    /**
     * Verifies a Razorpay webhook signature against the raw request body.
     * Returns true when the HMAC matches the configured RAZORPAY_WEBHOOK_SECRET.
     */
    public function verifyWebhook(string $rawBody, string $signature): bool
    {
        $secret = (string)(getenv('RAZORPAY_WEBHOOK_SECRET') ?: '');
        if ($secret === '' || $signature === '') {
            return false;
        }
        $expected = hash_hmac('sha256', $rawBody, $secret);
        return hash_equals($expected, $signature);
    }

    /**
     * Verifies the client-side payment-success signature returned by Checkout.
     * This is a different HMAC than the webhook — it uses the API secret as
     * the key and `<order_id>|<payment_id>` as the message.
     */
    public function verifyPaymentSignature(string $orderId, string $paymentId, string $signature): bool
    {
        if ($this->keySecret === '' || $signature === '') {
            return false;
        }
        $expected = hash_hmac('sha256', $orderId . '|' . $paymentId, $this->keySecret);
        return hash_equals($expected, $signature);
    }

    private function post(string $path, array $payload): array
    {
        $ch = curl_init('https://api.razorpay.com/v1' . $path);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($payload),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_USERPWD        => $this->keyId . ':' . $this->keySecret,
            CURLOPT_TIMEOUT        => 15,
        ]);
        $body = curl_exec($ch);
        $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw new \RuntimeException('Razorpay request failed: ' . $err);
        }
        $data = json_decode((string)$body, true);
        if (!is_array($data)) {
            throw new \RuntimeException('Razorpay returned non-JSON (HTTP ' . $http . ')');
        }
        if ($http < 200 || $http >= 300) {
            $msg = $data['error']['description'] ?? ('HTTP ' . $http);
            throw new \RuntimeException('Razorpay error: ' . $msg);
        }
        return $data;
    }
}
