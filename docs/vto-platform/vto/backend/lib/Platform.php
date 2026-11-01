<?php
declare(strict_types=1);

/**
 * Link between the platform admin and FitFyce (the merchant app).
 *
 * FitFyce is the source of truth for stores and wallet balances. It pushes every login,
 * install, uninstall and wallet change to api/platform.php the moment it happens; this
 * class stores those pushes, pulls a full copy on "Sync now", edits the wallet rules and
 * bills VTO try-ons — all through FitFyce's HMAC-signed /platform/* API.
 *
 * Signature: HMAC-SHA256(secret, "timestamp\nMETHOD\n/path?query\nbody"), timestamp ±300 s.
 */
final class Platform
{
    private const MAX_SKEW = 300;

    public static function enabled(): bool
    {
        return (string)cfg('platform.secret') !== '';
    }

    public static function sign(string $ts, string $method, string $pathWithQuery, string $body): string
    {
        return hash_hmac('sha256', $ts . "\n" . strtoupper($method) . "\n" . $pathWithQuery . "\n" . $body, (string)cfg('platform.secret'));
    }

    public static function verify(string $body): bool
    {
        $ts  = (string)($_SERVER['HTTP_X_PLATFORM_TIMESTAMP'] ?? '');
        $sig = (string)($_SERVER['HTTP_X_PLATFORM_SIGNATURE'] ?? '');
        return self::enabled() && ctype_digit($ts) && abs(time() - (int)$ts) <= self::MAX_SKEW
            && hash_equals(self::sign($ts, (string)$_SERVER['REQUEST_METHOD'], (string)($_SERVER['REQUEST_URI'] ?? ''), $body), $sig);
    }

    /**
     * Signed call to FitFyce. Returns [httpCode, decodedJson|null].
     * @throws RuntimeException when FitFyce cannot be reached
     */
    public static function call(string $method, string $path, ?array $body = null): array
    {
        if (!self::enabled()) throw new RuntimeException('VTO_PLATFORM_SECRET is not set');
        $url  = rtrim((string)cfg('fitfyce.api'), '/') . $path;
        $sp   = (string)parse_url($url, PHP_URL_PATH) . (($q = parse_url($url, PHP_URL_QUERY)) ? '?' . $q : '');
        $raw  = $body === null ? '' : json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $ts   = (string)time();
        $ch   = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT        => (int)cfg('platform.timeout', 8),
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HTTPHEADER     => array_filter([
                'Accept: application/json',
                $body === null ? null : 'Content-Type: application/json',
                'X-Platform-Timestamp: ' . $ts,
                'X-Platform-Signature: ' . self::sign($ts, $method, $sp, $raw),
            ]),
        ] + ($body === null ? [] : [CURLOPT_POSTFIELDS => $raw]));
        $res  = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($res === false || $code === 0) throw new RuntimeException('FitFyce unreachable: ' . $err);
        $j = json_decode((string)$res, true);
        return [$code, is_array($j) ? $j : null];
    }

    /* ---------------- storing what FitFyce sends ---------------- */

    public static function upsertStore(array $s, string $event): void
    {
        if (empty($s['id']) || empty($s['shop_domain'])) return;
        DB::run(
            'INSERT INTO stores (id, shop_domain, is_active, app_enabled, shopify_plan, theme_name, wallet_credits,
                                 wallet_total_debited, credits_purchased, payments_captured, revenue_minor,
                                 installed_at, last_login_at, last_event, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               shop_domain = VALUES(shop_domain), is_active = VALUES(is_active), app_enabled = VALUES(app_enabled),
               shopify_plan = VALUES(shopify_plan), theme_name = VALUES(theme_name),
               wallet_credits = VALUES(wallet_credits), wallet_total_debited = VALUES(wallet_total_debited),
               credits_purchased = VALUES(credits_purchased), payments_captured = VALUES(payments_captured),
               revenue_minor = VALUES(revenue_minor), installed_at = VALUES(installed_at),
               last_login_at = VALUES(last_login_at), last_event = VALUES(last_event), synced_at = NOW()',
            [
                (int)$s['id'], strtolower((string)$s['shop_domain']), !empty($s['is_active']) ? 1 : 0, !empty($s['app_enabled']) ? 1 : 0,
                $s['shopify_plan'] ?? null, isset($s['theme_name']) ? mb_substr((string)$s['theme_name'], 0, 190) : null,
                (int)($s['wallet_credits'] ?? 0), max(0, (int)($s['wallet_total_debited'] ?? 0)),
                max(0, (int)($s['credits_purchased'] ?? 0)), max(0, (int)($s['payments_captured'] ?? 0)), max(0, (int)($s['revenue_minor'] ?? 0)),
                $s['installed_at'] ?? null, $s['last_login_at'] ?? null, mb_substr($event, 0, 40),
            ]
        );
    }

    /** Ledger rows are immutable in FitFyce, so a row id seen once never changes. */
    public static function insertLedger(array $rows): int
    {
        $n = 0;
        foreach ($rows as $r) {
            if (empty($r['id']) || empty($r['merchant_id'])) continue;
            $n += DB::run(
                'INSERT IGNORE INTO wallet_ledger (id, store_id, delta, reason, reference_type, reference_id, balance_after, note, created_at)
                 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? FROM stores WHERE id = ?',
                [(int)$r['id'], (int)$r['merchant_id'], (int)$r['delta'], mb_substr((string)$r['reason'], 0, 30),
                 $r['reference_type'] ?? null, $r['reference_id'] ?? null, (int)$r['balance_after'],
                 isset($r['note']) ? mb_substr((string)$r['note'], 0, 255) : null, $r['created_at'] ?? date('Y-m-d H:i:s'),
                 (int)$r['merchant_id']]
            )->rowCount();
        }
        return $n;
    }

    /** Full pull: every store, then every ledger row newer than what we hold. */
    public static function syncAll(): array
    {
        [$code, $j] = self::call('GET', '/platform/stores');
        if ($code !== 200 || empty($j['ok'])) throw new RuntimeException('FitFyce stores: HTTP ' . $code . ' ' . ($j['error'] ?? ''));
        foreach ($j['stores'] as $s) self::upsertStore($s, 'sync');

        $after = (int)DB::val('SELECT COALESCE(MAX(id), 0) FROM wallet_ledger');
        $added = 0;
        for ($page = 0; $page < 50; $page++) {
            [$code, $l] = self::call('GET', '/platform/ledger?after_id=' . $after . '&limit=500');
            if ($code !== 200 || empty($l['ok'])) throw new RuntimeException('FitFyce ledger: HTTP ' . $code);
            $added += self::insertLedger($l['transactions']);
            if (!$l['transactions'] || empty($l['more'])) break;
            $after = (int)end($l['transactions'])['id'];
        }
        return ['stores' => count($j['stores']), 'ledger_added' => $added];
    }

    /* ---------------- wallet rules ---------------- */

    public static function walletSettings(): ?array
    {
        try {
            [$code, $j] = self::call('GET', '/platform/wallet-settings');
            if ($code === 200 && !empty($j['ok'])) { self::rememberSettings($j, null); return $j; }
        } catch (Throwable $e) { /* fall back to the last copy */ }
        $copy = DB::val("SELECT value_json FROM platform_settings WHERE setting_key = 'wallet'");
        return $copy ? (json_decode($copy, true) + ['stale' => true]) : null;
    }

    /** @return array{0: bool, 1: string|array} [ok, error message | new settings] */
    public static function saveWalletSettings(array $packs, array $costs, string $by): array
    {
        [$code, $j] = self::call('POST', '/platform/wallet-settings', ['packs' => $packs, 'costs' => $costs, 'by' => $by]);
        if ($code === 200 && !empty($j['ok'])) { self::rememberSettings($j, $by); return [true, $j]; }
        return [false, $j['error'] ?? ('FitFyce returned HTTP ' . $code)];
    }

    private static function rememberSettings(array $j, ?string $by): void
    {
        DB::run(
            "INSERT INTO platform_settings (setting_key, value_json, updated_by) VALUES ('wallet', ?, ?)
             ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_by = COALESCE(VALUES(updated_by), updated_by)",
            [json_encode(['packs' => $j['packs'], 'costs' => $j['costs']]), $by]
        );
    }

    /* ---------------- billing VTO try-ons ---------------- */

    /** @return array{ok: bool, cost?: int, error?: string} */
    public static function reserve(string $shop, string $ref): array
    {
        [$code, $j] = self::call('POST', '/platform/wallet/reserve', ['shop' => $shop, 'action' => 'tryon', 'ref' => $ref]);
        self::absorb($j);
        if ($code === 200 && !empty($j['ok'])) return ['ok' => true, 'cost' => (int)$j['cost']];
        return ['ok' => false, 'error' => (string)($j['error'] ?? 'http_' . $code)];
    }

    public static function release(string $shop, int $cost, string $ref): void
    {
        if ($cost <= 0) return;
        try {
            [, $j] = self::call('POST', '/platform/wallet/release', ['shop' => $shop, 'cost' => $cost, 'ref' => $ref]);
            self::absorb($j);
        } catch (Throwable $e) {
            error_log('[VTO] credit release failed for ' . $shop . ': ' . $e->getMessage());
        }
    }

    /** reserve/release answers carry the new wallet state (FitFyce does not push those back) */
    private static function absorb(?array $j): void
    {
        if (!empty($j['store'])) self::upsertStore($j['store'], 'wallet');
        if (!empty($j['transactions'])) self::insertLedger($j['transactions']);
    }
}
