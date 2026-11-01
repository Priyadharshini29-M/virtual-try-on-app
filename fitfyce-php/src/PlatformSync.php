<?php

declare(strict_types=1);

namespace TryFit\Src;

use TryFit\Db\Database;

/**
 * Keeps the VTO platform admin in step with FitFyce.
 *
 *   FitFyce ──push──▶ VTO  POST {VTO_PLATFORM_URL}/backend/api/platform.php
 *     store.updated   merchant logged in / installed / uninstalled / toggled the app
 *     wallet.changed  any credit or debit (try-on, purchase, bonus, refund, release)
 *
 *   VTO ──call──▶ FitFyce  /platform/*  (PlatformController): full sync, wallet rules, VTO try-on billing
 *
 * Both directions are signed with HMAC-SHA256 over "timestamp\nMETHOD\npath?query\nbody"
 * using VTO_PLATFORM_SECRET. Pushes are queued and sent after the response has gone out,
 * so a slow or offline admin panel never delays a merchant or a shopper; the admin's
 * "Sync now" pull repairs anything that was missed.
 */
final class PlatformSync
{
    private const MAX_SKEW = 300;   // seconds

    /** @var array<string, array{event:string, merchant_id:int, reason:string}> */
    private static array $queue = [];
    private static bool $hooked = false;
    private static bool $suppressed = false;

    public static function enabled(): bool
    {
        return self::url() !== '' && self::secret() !== '';
    }

    /** Merchant row changed (login, install, uninstall, app toggle). */
    public static function storeChanged(int $merchantId, string $reason): void
    {
        self::enqueue('store.updated', $merchantId, $reason);
    }

    /** Wallet balance changed; the push carries the newest ledger rows. */
    public static function walletChanged(int $merchantId): void
    {
        self::enqueue('wallet.changed', $merchantId, 'wallet');
    }

    /**
     * Called by PlatformController for changes the platform itself asked for
     * (VTO try-on debits): the API response already carries the new state, and
     * pushing back to the platform while it waits on us would only block it.
     */
    public static function suppress(): void
    {
        self::$suppressed = true;
    }

    private static function enqueue(string $event, int $merchantId, string $reason): void
    {
        if (!self::enabled() || $merchantId <= 0) return;
        // one push per merchant+event per request, even if several ledger rows were written
        self::$queue[$event . ':' . $merchantId] = ['event' => $event, 'merchant_id' => $merchantId, 'reason' => $reason];
        if (!self::$hooked) {
            self::$hooked = true;
            register_shutdown_function([self::class, 'flush']);
        }
    }

    /** Runs at shutdown: lets PHP-FPM finish the response first, then pushes. */
    public static function flush(): void
    {
        if (self::$suppressed || !self::$queue) return;
        if (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        }
        foreach (self::$queue as $item) {
            try {
                $data = ['reason' => $item['reason'], 'store' => self::storePayload($item['merchant_id'])];
                if ($data['store'] === null) continue;
                if ($item['event'] === 'wallet.changed') {
                    $data['transactions'] = self::ledger($item['merchant_id'], 0, 20);
                }
                self::send($item['event'], $data);
            } catch (\Throwable $e) {
                error_log('[FitFyce] platform push failed: ' . $e->getMessage());
            }
        }
        self::$queue = [];
    }

    private static function send(string $event, array $data): void
    {
        $body = json_encode(['event' => $event, 'sent_at' => gmdate('c'), 'data' => $data], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $url  = rtrim(self::url(), '/') . '/backend/api/platform.php';
        $path = (string)parse_url($url, PHP_URL_PATH);   // signed exactly as the platform sees REQUEST_URI
        $ts   = (string)time();
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT        => 4,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'X-Platform-Timestamp: ' . $ts,
                'X-Platform-Signature: ' . self::sign($ts, 'POST', $path, $body),
            ],
        ]);
        $res  = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($res === false || $code !== 200) {
            error_log("[FitFyce] platform push $event got HTTP $code $err " . substr((string)$res, 0, 200));
        }
    }

    // ── payloads (never include access tokens, API keys or secrets) ─────────

    public static function storePayload(int $merchantId): ?array
    {
        $pdo  = Database::getInstance();
        $stmt = $pdo->prepare(
            "SELECT m.id, m.shopify_domain, m.is_active, m.app_enabled, m.shopify_plan, m.installed_theme_name,
                    m.wallet_credits, m.wallet_total_debited, m.created_at, m.updated_at,
                    (SELECT MAX(COALESCE(s.last_seen_at, s.created_at)) FROM admin_sessions s WHERE s.merchant_id = m.id) AS last_login_at,
                    (SELECT COALESCE(SUM(t.delta), 0) FROM credit_transactions t WHERE t.merchant_id = m.id AND t.reason = 'purchase') AS credits_purchased,
                    (SELECT COUNT(*) FROM credit_payments p WHERE p.merchant_id = m.id AND p.status = 'captured') AS payments_captured,
                    (SELECT COALESCE(SUM(p.amount_minor), 0) FROM credit_payments p WHERE p.merchant_id = m.id AND p.status = 'captured') AS revenue_minor
               FROM merchants m WHERE m.id = ? LIMIT 1"
        );
        $stmt->execute([$merchantId]);
        $m = $stmt->fetch();
        if (!$m) return null;
        return [
            'id'                   => (int)$m['id'],
            'shop_domain'          => (string)$m['shopify_domain'],
            'is_active'            => (int)$m['is_active'] === 1,
            'app_enabled'          => (int)$m['app_enabled'] === 1,
            'shopify_plan'         => $m['shopify_plan'],
            'theme_name'           => $m['installed_theme_name'],
            'wallet_credits'       => (int)$m['wallet_credits'],
            'wallet_total_debited' => (int)$m['wallet_total_debited'],
            'credits_purchased'    => (int)$m['credits_purchased'],
            'payments_captured'    => (int)$m['payments_captured'],
            'revenue_minor'        => (int)$m['revenue_minor'],
            'installed_at'         => $m['created_at'],
            'updated_at'           => $m['updated_at'],
            'last_login_at'        => $m['last_login_at'],
        ];
    }

    /** Ledger rows with id > $afterId (oldest first when paging, newest first for pushes). */
    public static function ledger(int $merchantId, int $afterId, int $limit): array
    {
        $limit = max(1, min(1000, $limit));
        $pdo = Database::getInstance();
        if ($afterId > 0 || $merchantId === 0) {
            $stmt = $pdo->prepare(
                'SELECT id, merchant_id, delta, reason, reference_type, reference_id, balance_after, note, created_at
                   FROM credit_transactions WHERE id > ? ' . ($merchantId ? 'AND merchant_id = ? ' : '') .
                'ORDER BY id ASC LIMIT ' . $limit
            );
            $stmt->execute($merchantId ? [$afterId, $merchantId] : [$afterId]);
        } else {
            $stmt = $pdo->prepare(
                'SELECT id, merchant_id, delta, reason, reference_type, reference_id, balance_after, note, created_at
                   FROM credit_transactions WHERE merchant_id = ? ORDER BY id DESC LIMIT ' . $limit
            );
            $stmt->execute([$merchantId]);
        }
        return array_map(static function (array $r): array {
            foreach (['id', 'merchant_id', 'delta', 'balance_after'] as $k) $r[$k] = (int)$r[$k];
            return $r;
        }, $stmt->fetchAll());
    }

    // ── signing ─────────────────────────────────────────────────────────────

    public static function sign(string $ts, string $method, string $pathWithQuery, string $body): string
    {
        return hash_hmac('sha256', $ts . "\n" . strtoupper($method) . "\n" . $pathWithQuery . "\n" . $body, self::secret());
    }

    /** Verifies an inbound platform request; responds 401 and exits when it is not genuine. */
    public static function verifyRequest(string $body): void
    {
        $ts  = (string)($_SERVER['HTTP_X_PLATFORM_TIMESTAMP'] ?? '');
        $sig = (string)($_SERVER['HTTP_X_PLATFORM_SIGNATURE'] ?? '');
        $uri = (string)($_SERVER['REQUEST_URI'] ?? '');
        $ok  = self::secret() !== '' && ctype_digit($ts) && abs(time() - (int)$ts) <= self::MAX_SKEW
            && hash_equals(self::sign($ts, (string)$_SERVER['REQUEST_METHOD'], $uri, $body), $sig);
        if (!$ok) {
            respondJson(['ok' => false, 'error' => 'Invalid platform signature'], 401);
        }
    }

    private static function url(): string
    {
        return (string)(getenv('VTO_PLATFORM_URL') ?: '');
    }

    private static function secret(): string
    {
        return (string)(getenv('VTO_PLATFORM_SECRET') ?: '');
    }
}
