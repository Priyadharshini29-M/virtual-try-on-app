<?php

declare(strict_types=1);

namespace TryFit\Src;

use TryFit\Db\MerchantRepo;

/**
 * Picks the merchant's locale using the 6-step chain from the plan:
 *   1. ff_locale cookie (explicit override)
 *   2. merchants.locale column
 *   3. Shopify shop.primaryLocale (passed in by caller, we don't call the API)
 *   4. Accept-Language header
 *   5. CF-IPCountry header -> country-to-locale map
 *   6. 'en'
 *
 * Any detected tag is normalised: fr-CA -> fr, zh-TW -> zh -> en (unsupported).
 */
class LocaleDetector
{
    public const SUPPORTED = ['en', 'hi', 'es', 'fr', 'de', 'ar'];
    public const DEFAULT_LOCALE = 'en';

    private const COUNTRY_LOCALE = [
        'IN' => 'hi',
        'ES' => 'es', 'MX' => 'es', 'AR' => 'es', 'CO' => 'es', 'CL' => 'es', 'PE' => 'es', 'VE' => 'es',
        'FR' => 'fr', 'BE' => 'fr', 'CH' => 'fr', 'LU' => 'fr', 'MC' => 'fr',
        'DE' => 'de', 'AT' => 'de',
        'SA' => 'ar', 'AE' => 'ar', 'EG' => 'ar', 'MA' => 'ar', 'DZ' => 'ar', 'TN' => 'ar',
        'JO' => 'ar', 'KW' => 'ar', 'QA' => 'ar', 'BH' => 'ar', 'OM' => 'ar', 'IQ' => 'ar',
    ];

    public static function detect(
        ?string $shopDomain,
        ?string $acceptLang = null,
        ?string $shopPrimaryLocale = null,
        ?string $cfIpCountry = null,
        ?MerchantRepo $repo = null,
        ?string $clientIp = null
    ): string {
        // 1. ff_locale cookie
        $cookie = $_COOKIE['ff_locale'] ?? null;
        if (is_string($cookie) && $cookie !== '') {
            $norm = self::normalize($cookie);
            if ($norm !== null) return $norm;
        }

        $repo ??= $shopDomain !== null && $shopDomain !== '' ? new MerchantRepo() : null;

        // 2. merchants.locale
        if ($repo !== null && $shopDomain !== null) {
            $stored = $repo->getLocale($shopDomain);
            if ($stored !== null) {
                $norm = self::normalize($stored);
                if ($norm !== null) return $norm;
            }
        }

        // 3. Shopify shop locale (caller passes it in)
        if ($shopPrimaryLocale !== null) {
            $norm = self::normalize($shopPrimaryLocale);
            if ($norm !== null) return $norm;
        }

        // 4. Accept-Language
        if ($acceptLang !== null && $acceptLang !== '') {
            $norm = self::parseAcceptLanguage($acceptLang);
            if ($norm !== null) return $norm;
        }

        // 5a. IP country via Cloudflare header (fast path when CF is in front)
        if ($cfIpCountry !== null && $cfIpCountry !== '') {
            $cc = strtoupper($cfIpCountry);
            if (isset(self::COUNTRY_LOCALE[$cc])) {
                if ($repo !== null && $shopDomain !== null) {
                    $repo->setDetectedCountry($shopDomain, $cc);
                }
                return self::COUNTRY_LOCALE[$cc];
            }
        }

        // 5b. External IP lookup fallback (when no CF header). Cached forever
        // on merchants.locale_detected_country so this call runs at most once
        // per merchant row; failures fall through silently to default.
        $country = self::lookupCountry($shopDomain, $clientIp, $repo);
        if ($country !== null && isset(self::COUNTRY_LOCALE[$country])) {
            return self::COUNTRY_LOCALE[$country];
        }

        // 6. Default
        return self::DEFAULT_LOCALE;
    }

    /**
     * Returns a 2-letter country code using (in order):
     *   - cached merchants.locale_detected_country
     *   - ip-api.com free endpoint (no key, 45 req/min, HTTPS)
     *   - null on failure
     *
     * The result is persisted on the merchant row the first time it succeeds,
     * so subsequent requests never make the HTTP call again.
     */
    private static function lookupCountry(?string $shopDomain, ?string $clientIp, ?MerchantRepo $repo): ?string
    {
        // Cached country for this merchant?
        if ($repo !== null && $shopDomain !== null) {
            try {
                $cached = $repo->getDetectedCountry($shopDomain);
                if ($cached !== null) return strtoupper($cached);
            } catch (\Throwable $e) {
                // Column may not exist yet (pre-migration) — fall through.
            }
        }

        $ip = $clientIp ?? self::clientIp();
        if ($ip === null) return null;

        // ipwho.is: free, no auth required, HTTPS, 10k requests/month.
        // ip-api.com's free tier is HTTP-only (returns 403 over HTTPS), which
        // we can't use from an embedded Shopify admin without mixed-content
        // warnings — ipwho.is avoids that.
        $url = 'https://ipwho.is/' . urlencode($ip) . '?fields=success,country_code';
        $ctx = stream_context_create([
            'http'  => ['timeout' => 2, 'ignore_errors' => true, 'header' => "Accept: application/json\r\n"],
            'https' => ['timeout' => 2, 'ignore_errors' => true, 'header' => "Accept: application/json\r\n"],
        ]);
        $raw = @file_get_contents($url, false, $ctx);
        if (!is_string($raw) || $raw === '') return null;
        $data = json_decode($raw, true);
        if (!is_array($data) || empty($data['success'])) return null;
        $cc = isset($data['country_code']) && is_string($data['country_code']) ? strtoupper($data['country_code']) : null;
        if ($cc === null || strlen($cc) !== 2) return null;

        if ($repo !== null && $shopDomain !== null) {
            try { $repo->setDetectedCountry($shopDomain, $cc); } catch (\Throwable $e) { /* skip */ }
        }
        return $cc;
    }

    /** Best-effort client IP, respecting common proxy headers. */
    private static function clientIp(): ?string
    {
        $candidates = [
            $_SERVER['HTTP_CF_CONNECTING_IP'] ?? null,
            $_SERVER['HTTP_X_FORWARDED_FOR'] ?? null,
            $_SERVER['HTTP_X_REAL_IP'] ?? null,
            $_SERVER['REMOTE_ADDR'] ?? null,
        ];
        foreach ($candidates as $v) {
            if (!is_string($v) || $v === '') continue;
            $first = trim(explode(',', $v)[0]);
            if (filter_var($first, FILTER_VALIDATE_IP) !== false) return $first;
        }
        return null;
    }

    /** Returns a supported locale, or null if the tag can't be resolved. */
    public static function normalize(?string $tag): ?string
    {
        if ($tag === null) return null;
        $tag = trim($tag);
        if ($tag === '') return null;
        $base = strtolower(preg_split('/[-_]/', $tag)[0] ?? '');
        if ($base === '') return null;
        return in_array($base, self::SUPPORTED, true) ? $base : null;
    }

    /**
     * Picks the best-matching supported locale from a q-weighted
     * Accept-Language header. Returns null when nothing matches.
     */
    private static function parseAcceptLanguage(string $header): ?string
    {
        $parts = explode(',', $header);
        $ranked = [];
        foreach ($parts as $part) {
            $segments = explode(';', trim($part));
            $tag = trim($segments[0] ?? '');
            if ($tag === '' || $tag === '*') continue;
            $q = 1.0;
            foreach (array_slice($segments, 1) as $s) {
                $s = trim($s);
                if (str_starts_with($s, 'q=')) {
                    $q = (float)substr($s, 2);
                }
            }
            $ranked[] = ['tag' => $tag, 'q' => $q];
        }
        // Preserve order among equal q values
        usort($ranked, fn($a, $b) => $b['q'] <=> $a['q']);
        foreach ($ranked as $r) {
            $norm = self::normalize($r['tag']);
            if ($norm !== null) return $norm;
        }
        return null;
    }
}
