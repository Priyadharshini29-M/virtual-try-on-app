<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\AdminSessionRepo;
use TryFit\Db\MerchantRepo;

/**
 * Shopify OAuth for the non-embedded PHP admin UI.
 *
 * Flow:
 *   1. Merchant lands on /auth/install?shop=foo.myshopify.com
 *      → we build the Shopify authorize URL + store a one-time state,
 *        and 302 to Shopify.
 *   2. Shopify redirects back to /auth/callback?shop=&code=&hmac=&state=
 *      → we verify HMAC + state, exchange `code` for an access_token,
 *        upsert the merchant row, create an admin_sessions row, set the
 *        cookie, redirect to /admin.
 *
 * This replaces the OAuth flow that lived in the retired Remix app.
 */
class AdminAuthController
{
    private const SHOP_DOMAIN_RE = '/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i';
    public  const COOKIE_NAME    = 'fitfyce_sess';

    public function install(): void
    {
        $shop = $this->requireShopParam();

        $apiKey    = AppConfig::shopifyApiKey();
        $scopes    = AppConfig::shopifyScopes();
        $base      = AppConfig::adminBaseUrl();

        if ($apiKey === '' || AppConfig::shopifyApiSecret() === '' || $base === '') {
            respondJson([
                'error' => 'Admin OAuth is not configured. Set SHOPIFY_API_KEY, SHOPIFY_API_SECRET and ADMIN_BASE_URL.',
            ], 503);
        }

        $state       = (new AdminSessionRepo())->createOauthState($shop);
        $redirectUri = $base . '/auth/callback';
        $authUrl     = sprintf(
            'https://%s/admin/oauth/authorize?client_id=%s&scope=%s&redirect_uri=%s&state=%s',
            rawurlencode($shop),
            rawurlencode($apiKey),
            rawurlencode($scopes),
            rawurlencode($redirectUri),
            rawurlencode($state)
        );

        header('Location: ' . $authUrl, true, 302);
        exit;
    }

    public function callback(): void
    {
        $shop  = $this->requireShopParam();
        $code  = trim((string)($_GET['code']  ?? ''));
        $state = trim((string)($_GET['state'] ?? ''));
        $hmac  = trim((string)($_GET['hmac']  ?? ''));

        if ($code === '' || $state === '' || $hmac === '') {
            respondJson(['error' => 'Missing OAuth parameters'], 400);
        }

        // 1. HMAC check — Shopify signs every callback with the app secret.
        if (!$this->verifyHmac($_GET, $hmac, AppConfig::shopifyApiSecret())) {
            respondJson(['error' => 'HMAC verification failed'], 400);
        }

        // 2. CSRF guard — state must have been issued by /auth/install and
        //    be bound to the same shop. Single-use (consumed inside the repo).
        $expectedShop = (new AdminSessionRepo())->consumeOauthState($state);
        if ($expectedShop === null || strcasecmp($expectedShop, $shop) !== 0) {
            respondJson(['error' => 'OAuth state mismatch'], 400);
        }

        // 3. Exchange code for access_token.
        try {
            $tokenPayload = $this->exchangeCodeForToken($shop, $code);
        } catch (\Throwable $e) {
            writeLog('ERROR', 'OAuth token exchange failed', [
                'shop'    => $shop,
                'message' => $e->getMessage(),
            ]);
            respondJson(['error' => 'Could not complete sign-in. Please try again.'], 502);
        }

        $accessToken = (string)($tokenPayload['access_token'] ?? '');
        $scope       = (string)($tokenPayload['scope'] ?? '');
        if ($accessToken === '') {
            respondJson(['error' => 'Shopify did not return an access token'], 502);
        }

        // 4. Upsert the merchant row + create a session.
        $merchantId = $this->upsertMerchant($shop, $accessToken);
        if (class_exists(\TryFit\Src\PlatformSync::class)) {
            \TryFit\Src\PlatformSync::storeChanged($merchantId, 'login');
        }
        $sessionId  = (new AdminSessionRepo())->create(
            $merchantId,
            $shop,
            $accessToken,
            $scope !== '' ? $scope : null
        );

        $this->setSessionCookie($sessionId);
        header('Location: ' . AppConfig::adminBaseUrl() . '/admin', true, 302);
        exit;
    }

    public function logout(): void
    {
        $sid = (string)($_COOKIE[self::COOKIE_NAME] ?? '');
        if ($sid !== '') {
            (new AdminSessionRepo())->destroy($sid);
        }
        $this->clearSessionCookie();
        header('Location: ' . AppConfig::adminBaseUrl() . '/auth/login', true, 302);
        exit;
    }

    public function loginPage(): void
    {
        // Simple shop-domain prompt (merchants arriving directly without a shop= param).
        \TryFit\Admin\View::render('login', [], '', 'Log in · Brix-TryOn');
    }

    /**
     * Dev shortcut: creates a fresh admin_sessions row for the first merchant
     * in the DB and sets the cookie, then redirects to /admin. Only enabled
     * on local-dev machines (gated on the presence of a .env.local file +
     * the cli-server SAPI); production never exposes this route.
     */
    public function devLogin(): void
    {
        if (PHP_SAPI !== 'cli-server' || !is_file(__DIR__ . '/../.env.local')) {
            http_response_code(404);
            exit;
        }
        $pdo = \TryFit\Db\Database::getInstance();
        $shop = (string)($_GET['shop'] ?? '');
        $stmt = $shop !== ''
            ? $pdo->prepare('SELECT id, shopify_domain FROM merchants WHERE shopify_domain = ? LIMIT 1')
            : $pdo->prepare('SELECT id, shopify_domain FROM merchants ORDER BY id ASC LIMIT 1');
        $stmt->execute($shop !== '' ? [$shop] : []);
        $m = $stmt->fetch();
        if ($m === false) {
            respondJson(['error' => 'No merchants in local DB'], 404);
        }
        if (class_exists(\TryFit\Src\PlatformSync::class)) {
            \TryFit\Src\PlatformSync::storeChanged((int)$m['id'], 'login');
        }
        $sid = (new \TryFit\Db\AdminSessionRepo())->create(
            (int)$m['id'],
            (string)$m['shopify_domain'],
            'dev-fake-token',
            'read_orders,read_products,write_products'
        );
        $this->setSessionCookie($sid);
        header('Location: ' . AppConfig::adminBaseUrl() . '/admin', true, 302);
        exit;
    }

    public function dashboardPage(): void
    {
        $merchant = \TryFit\Middleware\AdminSession::require();
        $repo     = new \TryFit\Db\WalletRepo();
        \TryFit\Admin\View::render(
            'dashboard',
            [
                'merchant' => $merchant,
                'balance'  => $repo->balance((int)$merchant['id']),
            ],
            'dashboard',
            'Dashboard · Brix-TryOn'
        );
    }

    // ── Internals ──────────────────────────────────────────────────────────

    private function requireShopParam(): string
    {
        $shop = strtolower(trim((string)($_GET['shop'] ?? '')));
        if ($shop === '' || !preg_match(self::SHOP_DOMAIN_RE, $shop)) {
            respondJson(['error' => 'Invalid or missing shop parameter'], 400);
        }
        return $shop;
    }

    /**
     * Verifies the Shopify-signed query string from an OAuth callback. Keys
     * other than `hmac` are sorted, joined back into a querystring, and
     * HMAC-SHA256'd with the app secret. The result must match the hmac
     * param byte-for-byte.
     */
    private function verifyHmac(array $query, string $hmac, string $secret): bool
    {
        if ($secret === '' || $hmac === '') return false;
        $params = $query;
        unset($params['hmac'], $params['signature']);
        ksort($params);
        $pairs = [];
        foreach ($params as $k => $v) {
            $pairs[] = $k . '=' . $v;
        }
        $expected = hash_hmac('sha256', implode('&', $pairs), $secret);
        return hash_equals($expected, $hmac);
    }

    private function exchangeCodeForToken(string $shop, string $code): array
    {
        $url = sprintf('https://%s/admin/oauth/access_token', $shop);
        $ch  = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode([
                'client_id'     => AppConfig::shopifyApiKey(),
                'client_secret' => AppConfig::shopifyApiSecret(),
                'code'          => $code,
            ]),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT        => 20,
        ]);
        $body = curl_exec($ch);
        $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            throw new \RuntimeException('curl error: ' . $err);
        }
        $data = json_decode((string)$body, true);
        if (!is_array($data) || $http < 200 || $http >= 300) {
            throw new \RuntimeException('token exchange http ' . $http);
        }
        return $data;
    }

    private function upsertMerchant(string $shop, string $accessToken): int
    {
        $repo    = new MerchantRepo();
        $existing = $repo->findByDomain($shop) ?? $repo->findByDomainLike($shop);
        if ($existing !== null) {
            // Refresh the stored token for next page load.
            $pdo = \TryFit\Db\Database::getInstance();
            $pdo->prepare('UPDATE merchants SET access_token = ?, is_active = 1 WHERE id = ?')
                ->execute([$accessToken, (int)$existing['id']]);
            return (int)$existing['id'];
        }

        return $repo->create([
            'shopify_domain'   => $shop,
            'shopify_store_id' => $shop,
            'access_token'     => $accessToken,
            'api_key'          => AppConfig::API_KEY_PREFIX . bin2hex(random_bytes(16)),
            'api_secret'       => bin2hex(random_bytes(16)),
        ]);
    }

    private function setSessionCookie(string $sessionId): void
    {
        $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
        setcookie(self::COOKIE_NAME, $sessionId, [
            'expires'  => time() + 30 * 86400,
            'path'     => '/',
            'secure'   => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    private function clearSessionCookie(): void
    {
        setcookie(self::COOKIE_NAME, '', [
            'expires'  => time() - 3600,
            'path'     => '/',
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
}
