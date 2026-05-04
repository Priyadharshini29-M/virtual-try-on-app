<?php

declare(strict_types=1);

namespace TryFit;

/**
 * Central application configuration.
 * All magic strings, numbers, and env-var names live here.
 * Every other file should reference these constants / methods
 * instead of hardcoding values inline.
 */
final class AppConfig
{
    // -------------------------------------------------------------------------
    // Database
    // -------------------------------------------------------------------------

    public static function dbHost(): string { return self::env('DB_HOST', 'localhost'); }
    public static function dbName(): string { return self::env('DB_NAME', ''); }
    public static function dbUser(): string { return self::env('DB_USER', ''); }
    public static function dbPass(): string { return self::env('DB_PASS', ''); }

    // -------------------------------------------------------------------------
    // Virtual Try-On API (RapidAPI)
    // -------------------------------------------------------------------------

    public static function vtonApiUrl(): string
    {
        return rtrim(self::env('TRY_ON_DIFFUSION_DEMO_API_URL', 'https://try-on-diffusion.p.rapidapi.com'), '/');
    }

    public static function vtonApiKey(): string
    {
        return self::env('TRY_ON_DIFFUSION_DEMO_API_KEY', '');
    }

    // -------------------------------------------------------------------------
    // Authentication
    // -------------------------------------------------------------------------

    public static function masterApiKey(): string
    {
        return self::env('MASTER_API_KEY', '');
    }

    /** Prefix applied to every generated merchant API key. */
    public const API_KEY_PREFIX = 'tf_';

    // -------------------------------------------------------------------------
    // Plans
    // -------------------------------------------------------------------------

    /** All valid plan slugs after the 3-tier rebrand. */
    public const PLANS = ['basic', 'pro', 'premium'];

    /** Plan assigned to a brand-new merchant on install. */
    public const DEFAULT_PLAN = 'basic';

    /** Shopify app listing — shown in plan-limit upgrade prompts. */
    public const SHOPIFY_APP_URL = 'https://apps.shopify.com/tryfit';

    // -------------------------------------------------------------------------
    // Widget / button configuration
    // -------------------------------------------------------------------------

    public const BUTTON_POSITIONS      = ['below_images', 'below_atc', 'floating'];
    public const BUTTON_ICONS          = ['none', 'eye', 'sparkles', 'camera', 'shopping-bag'];
    public const ICON_SHAPES           = ['square', 'circle'];
    public const COLLECTION_POSITIONS  = ['top_left', 'top_right', 'bottom_left', 'bottom_right'];

    /**
     * Default values for every merchant_settings column.
     * Keys must match DB column names exactly (except widget_title which maps to button_text).
     * Used by WidgetSettingsRepo to seed new rows and as fallbacks in responses.
     */
    public const WIDGET_DEFAULTS = [
        // Text
        'button_text'            => 'Try On This Look',
        'widget_subtitle'        => 'See how it fits before you buy',
        // Colors & shape
        'button_color'           => '#111827',
        'button_text_color'      => '#FFFFFF',
        'button_border_radius'   => 8,
        'hover_bg_color'         => '#F3F4F6',
        // Dimensions
        'button_width'           => 0,
        'button_height'          => 0,
        // Padding
        'button_padding_top'     => 10,
        'button_padding_right'   => 24,
        'button_padding_bottom'  => 10,
        'button_padding_left'    => 24,
        // Margin
        'button_margin_top'      => 0,
        'button_margin_right'    => 0,
        'button_margin_bottom'   => 0,
        'button_margin_left'     => 0,
        // Typography
        'title_font_size'        => 20,
        'subtitle_font_size'     => 14,
        'title_font_weight'      => '600',
        'title_font_family'      => 'Inter, sans-serif',
        'subtitle_font_family'   => 'Inter, sans-serif',
        // Legacy position (kept for backward compat, not used by settings UI)
        'button_position'        => 'below_images',
        // Localisation (any IETF tag accepted)
        'widget_language'        => 'en',
        // Collection icon
        'button_icon'            => 'eye',
        'icon_color'             => '#FFFFFF',
        'main_icon_bg_color'     => 'transparent',
        'coll_icon_bg_color'     => 'transparent',
        'icon_size'              => 16,
        'icon_radius'            => 4,
        'icon_shape'             => 'square',
        'icon_opacity'           => 100,
        'show_on_collection'     => 1,
        'collection_position'    => 'top_right',
        // Features
        'show_watermark'         => 1,
        'share_whatsapp_enabled' => 1,
        'save_image_enabled'     => 1,
        'privacy_notice_shown'   => 1,
    ];

    // -------------------------------------------------------------------------
    // Session tracking
    // -------------------------------------------------------------------------

    public const SESSION_ACTIONS = ['add_to_cart', 'buy_now', 'save_image', 'share_wa'];

    /** Maps a session action name to its analytics_daily column. */
    public const ACTION_ANALYTICS_MAP = [
        'add_to_cart' => 'add_to_cart_count',
        'buy_now'     => 'buy_now_count',
        'save_image'  => 'save_count',
        'share_wa'    => 'share_wa_count',
    ];

    // -------------------------------------------------------------------------
    // Conversion attribution
    // -------------------------------------------------------------------------

    /** How many days back a session can be attributed to an order. */
    public const CONVERSION_ATTRIBUTION_DAYS = 7;

    // -------------------------------------------------------------------------
    // File upload
    // -------------------------------------------------------------------------

    public const UPLOAD_MAX_BYTES   = 5 * 1024 * 1024; // 5 MB
    public const UPLOAD_TTL_SECONDS = 600;              // 10 minutes
    public const JPEG_QUALITY       = 90;

    // -------------------------------------------------------------------------
    // File-system paths (all absolute, relative to project root)
    // -------------------------------------------------------------------------

    public static function resultsDir(): string
    {
        return self::projectRoot() . DIRECTORY_SEPARATOR . 'results';
    }

    public static function tempDir(): string
    {
        return self::projectRoot() . DIRECTORY_SEPARATOR . 'temp';
    }

    public static function resultsTtlHours(): int
    {
        return (int)self::env('RESULTS_TTL_HOURS', '24');
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /** Absolute path to the project root (one level above config/). */
    private static function projectRoot(): string
    {
        return dirname(__DIR__);
    }

    /** Read an env variable, falling back to $default if absent or empty. */
    private static function env(string $key, string $default = ''): string
    {
        $val = $_ENV[$key] ?? getenv($key);
        return ($val !== false && $val !== '') ? (string)$val : $default;
    }
}
