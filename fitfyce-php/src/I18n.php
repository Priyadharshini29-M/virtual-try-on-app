<?php

declare(strict_types=1);

namespace TryFit\Src;

/**
 * Minimal i18n for the merchant-facing PHP API.
 *
 * Boot once per request from router.php; after that `t('errors.plan_limit')`
 * returns the localised string for the active locale. Unknown keys fall back
 * to the key itself so a missing translation shows up loudly in UI rather
 * than as an empty string.
 */
class I18n
{
    private static string $locale = 'en';
    private static array $strings = [];
    private static array $fallbackStrings = [];
    private static bool $booted = false;

    public const RTL = ['ar'];

    /**
     * @param string|null $shopDomain  Merchant to persist detection against (step 2).
     * @param string|null $acceptLang  Accept-Language header value if available.
     * @param string|null $shopPrimaryLocale  Shopify shop.primaryLocale when caller already has it.
     */
    public static function boot(
        ?string $shopDomain = null,
        ?string $acceptLang = null,
        ?string $shopPrimaryLocale = null,
        ?string $cfIpCountry = null
    ): void {
        $locale = LocaleDetector::detect($shopDomain, $acceptLang, $shopPrimaryLocale, $cfIpCountry);
        self::setLocale($locale);
        self::$booted = true;
    }

    public static function setLocale(string $locale): void
    {
        if (!in_array($locale, LocaleDetector::SUPPORTED, true)) {
            $locale = LocaleDetector::DEFAULT_LOCALE;
        }
        self::$locale = $locale;

        $file = __DIR__ . "/../locales/{$locale}.php";
        self::$strings = is_file($file) ? (array)require $file : [];

        if ($locale !== LocaleDetector::DEFAULT_LOCALE && empty(self::$fallbackStrings)) {
            $enFile = __DIR__ . '/../locales/' . LocaleDetector::DEFAULT_LOCALE . '.php';
            self::$fallbackStrings = is_file($enFile) ? (array)require $enFile : [];
        }
    }

    public static function locale(): string
    {
        return self::$locale;
    }

    public static function isRtl(): bool
    {
        return in_array(self::$locale, self::RTL, true);
    }

    public static function isBooted(): bool
    {
        return self::$booted;
    }

    /**
     * Look up a dotted key (e.g. 'errors.tryon.no_face_detected').
     * Falls back to the English string, then to the key itself.
     */
    public static function t(string $key, array $params = []): string
    {
        $val = self::lookup($key, self::$strings);
        if ($val === null && !empty(self::$fallbackStrings)) {
            $val = self::lookup($key, self::$fallbackStrings);
        }
        if (!is_string($val)) {
            self::logMissing($key);
            return $key;
        }
        foreach ($params as $k => $v) {
            $val = str_replace('{' . $k . '}', (string)$v, $val);
        }
        return $val;
    }

    private static function lookup(string $key, array $strings)
    {
        $val = $strings;
        foreach (explode('.', $key) as $p) {
            if (!is_array($val) || !array_key_exists($p, $val)) {
                return null;
            }
            $val = $val[$p];
        }
        return $val;
    }

    private static function logMissing(string $key): void
    {
        error_log('[FitSnap][i18n.missing_key] locale=' . self::$locale . ' key=' . $key);
    }
}

if (!function_exists('t')) {
    /** Shortcut mirroring the plan's spec. */
    function t(string $key, array $params = []): string
    {
        return \TryFit\Src\I18n::t($key, $params);
    }
}
