<?php

declare(strict_types=1);

namespace TryFit;

final class AppConfig
{
    // ── Database getters ───────────────────────────────────────────────────────
    public static function dbHost(): string
    {
        return (string) (getenv('DB_HOST') ?: '');
    }
    public static function dbName(): string
    {
        return (string) (getenv('DB_NAME') ?: '');
    }
    public static function dbUser(): string
    {
        return (string) (getenv('DB_USER') ?: '');
    }
    public static function dbPass(): string
    {
        return (string) (getenv('DB_PASS') ?: '');
    }
    public static function dbCharset(): string
    {
        return (string) (getenv('DB_CHARSET') ?: 'utf8mb4');
    }

    // ── API getters ────────────────────────────────────────────────────────────
    public static function vtonApiUrl(): string
    {
        $url = getenv('VTON_API_URL') ?: getenv('TRY_ON_DIFFUSION_DEMO_API_URL') ?: '';
        return rtrim((string) $url, '/');
    }

    public static function vtonApiKey(): string
    {
        return (string) (getenv('VTON_API_KEY') ?: getenv('TRY_ON_DIFFUSION_DEMO_API_KEY') ?: '');
    }

    public static function runpodApiKey(): string
    {
        return (string) (getenv('RUNPOD_API_KEY') ?: '');
    }

    public static function runpodEndpointId(): string
    {
        return (string) (getenv('RUNPOD_ENDPOINT_ID') ?: '');
    }

    /** Returns true when the RunPod FASHN VTON 1.5 endpoint is configured — the only garment-transfer engine used by this app. */
    public static function useRunpod(): bool
    {
        return self::runpodApiKey() !== '' && self::runpodEndpointId() !== '';
    }

    /**
     * Hugging Face token + Space used for accessory try-ons (Qwen-Image-Edit
     * fusion Space). Free accounts get only a few GPU-minutes per day, so this
     * suits testing / low volume; when HF_TOKEN is unset the RunPod accessory
     * endpoint below is used instead.
     */
    public static function hfToken(): string
    {
        return (string) (getenv('HF_TOKEN') ?: '');
    }

    public static function hfAccessorySpace(): string
    {
        return (string) (getenv('HF_ACCESSORY_SPACE') ?: 'prithivmlmods-qwen-image-edit-2509-loras-fast-fusion.hf.space');
    }

    public static function hfAccessoryAdapter(): string
    {
        return (string) (getenv('HF_ACCESSORY_ADAPTER') ?: 'Fuse-Objects');
    }

    public static function useHfAccessory(): bool
    {
        return self::hfToken() !== '';
    }

    /** Separate RunPod endpoint running an image-edit model (FLUX Kontext / Qwen-Image-Edit) for accessory try-ons — VTON 1.5 can't place accessories. */
    public static function runpodAccessoryEndpointId(): string
    {
        return (string) (getenv('RUNPOD_ACCESSORY_ENDPOINT_ID') ?: '');
    }

    public static function useRunpodAccessory(): bool
    {
        return self::runpodApiKey() !== '' && self::runpodAccessoryEndpointId() !== '';
    }

    public static function fashnApiKey(): string
    {
        return (string) (getenv('FASHN_API_KEY') ?: '');
    }

    /** Fashn.ai quality tier: 'performance' | 'balanced' | 'quality'. */
    public static function fashnMode(): string
    {
        return (string) (getenv('FASHN_MODE') ?: 'quality');
    }

    /** Fashn model used for sarees: 'tryon-max' (default; takes a drape prompt) or 'tryon-v1.6' (no prompt, category-based). */
    public static function fashnSareeModel(): string
    {
        $model = strtolower((string) (getenv('FASHN_SAREE_MODEL') ?: 'tryon-max'));
        return $model === 'tryon-v1.6' ? 'tryon-v1.6' : 'tryon-max';
    }

    /** Returns true when the hosted Fashn.ai API is configured — used only for saree try-ons; without it saree try-ons fail (they never fall back to RunPod). */
    public static function useFashn(): bool
    {
        return self::fashnApiKey() !== '';
    }

    public static function falApiKey(): string
    {
        return (string) (getenv('FAL_API_KEY') ?: '');
    }

    /** Returns true when FAL.ai flat-lay pre-processing is enabled. */
    public static function useFlatLayConverter(): bool
    {
        return self::falApiKey() !== '';
    }

    public static function masterApiKey(): string
    {
        return (string) (getenv('MASTER_API_KEY') ?: '');
    }

    public static function shopifyApiSecret(): string
    {
        return (string) (getenv('SHOPIFY_API_SECRET') ?: '');
    }

    public static function openAiApiKey(): string
    {
        return (string) (getenv('OPENAI_API_KEY') ?: '');
    }

    // ── RAG / Qdrant ───────────────────────────────────────────────────────────
    public static function qdrantUrl(): string
    {
        return rtrim((string) (getenv('QDRANT_URL') ?: ''), '/');
    }

    public static function qdrantApiKey(): string
    {
        return (string) (getenv('QDRANT_API_KEY') ?: '');
    }

    /** True once both Qdrant and OpenAI are configured — RAG grounding is a no-op fallback otherwise. */
    public static function ragEnabled(): bool
    {
        return self::qdrantUrl() !== '' && self::openAiApiKey() !== '';
    }

    /** Prefix applied to every generated merchant API key. */
    public const API_KEY_PREFIX = 'tf_';

    // ── Plans ──────────────────────────────────────────────────────────────────
    public const PLANS        = ['basic', 'pro', 'premium'];
    public const DEFAULT_PLAN = 'basic';
    public const SHOPIFY_APP_URL = 'https://apps.shopify.com/tryfit';

    // ── Widget / button configuration ──────────────────────────────────────────
    public const BUTTON_POSITIONS     = ['below_images', 'below_atc', 'floating'];
    public const BUTTON_ICONS         = ['none', 'eye', 'sparkles', 'camera', 'shopping-bag'];
    public const ICON_SHAPES          = ['square', 'circle'];
    public const COLLECTION_POSITIONS = ['top_left', 'top_right', 'bottom_left', 'bottom_right'];
    public const EXAMPLE_SLIDER_POSITIONS = ['above_button', 'below_button'];

    public const WIDGET_DEFAULTS = [
        'button_text'            => 'Try On This Look',
        'widget_subtitle'        => 'See how it fits before you buy',
        // Result display: a draggable before/after comparison slider instead
        // of a single static result image. Off by default (single image is
        // the safer/simpler default for merchants who never touch this tab).
        'before_after_enabled'   => 0,
        // Optional promo/demo video shown in the widget's opening state —
        // unrelated to the AI generation itself, just a merchant-provided
        // walkthrough clip. Empty = not shown.
        'promo_video_url'        => '',
        'promo_video_position'   => 'below_button',
        // Static merchant-uploaded before/after example images — fully manual,
        // not tied to any product or AI Studio generation. Off by default;
        // both images must be set (via the admin upload fields) to show.
        'example_before_after_enabled' => 0,
        'example_before_image'   => '',
        'example_after_image'    => '',
        'example_slider_position' => 'below_button',
        'example_title'          => '',
        'example_width'          => 320,
        'example_height'         => 0,
        'example_margin_top'     => 10,
        'example_margin_right'   => 0,
        'example_margin_bottom'  => 0,
        'example_margin_left'    => 0,
        'example_padding_top'    => 0,
        'example_padding_right'  => 0,
        'example_padding_bottom' => 0,
        'example_padding_left'   => 0,
        'button_color'           => '#111827',
        'button_text_color'      => '#FFFFFF',
        'button_border_radius'   => 8,
        'hover_bg_color'         => '#F3F4F6',
        'button_width'           => 0,
        'button_height'          => 0,
        'button_padding_top'     => 14,
        'button_padding_right'   => 24,
        'button_padding_bottom'  => 14,
        'button_padding_left'    => 24,
        'button_margin_top'      => 0,
        'button_margin_right'    => 0,
        'button_margin_bottom'   => 0,
        'button_margin_left'     => 0,
        'title_font_size'        => 16,
        'subtitle_font_size'     => 12,
        'title_font_weight'      => '600',
        'title_font_family'      => 'Inter, sans-serif',
        'subtitle_font_family'   => 'Inter, sans-serif',
        'button_position'        => 'below_images',
        'widget_language'        => 'en',
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
        'show_watermark'         => 1,
        'share_whatsapp_enabled' => 1,
        'save_image_enabled'     => 1,
        'privacy_notice_shown'   => 1,
    ];

    // ── Session tracking ───────────────────────────────────────────────────────
    public const SESSION_ACTIONS = ['add_to_cart', 'buy_now', 'save_image', 'share_wa'];

    public const ACTION_ANALYTICS_MAP = [
        'add_to_cart' => 'add_to_cart_count',
        'buy_now'     => 'buy_now_count',
        'save_image'  => 'save_count',
        'share_wa'    => 'share_wa_count',
    ];

    // ── Conversion attribution ─────────────────────────────────────────────────
    public const CONVERSION_ATTRIBUTION_DAYS = 7;

    // ── File upload ────────────────────────────────────────────────────────────
    public const UPLOAD_MAX_BYTES   = 5 * 1024 * 1024;
    public const UPLOAD_TTL_SECONDS = 600;
    public const JPEG_QUALITY       = 90;

    // ── File-system paths ──────────────────────────────────────────────────────
    public static function resultsDir(): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'results';
    }

    public static function tempDir(): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'temp';
    }

    /** Permanent storage for merchant-uploaded/saved model photos (Saved Models gallery). */
    public static function libraryDir(): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'library';
    }

    /** Permanent storage for FASHN-generated model images and OpenAI marketing infographics. */
    public static function generationsDir(): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'generations';
    }

    public static function resultsTtlHours(): int
    {
        return 24;
    }

    // ── AWS S3 (generated infographic storage) ─────────────────────────────────
    public static function awsAccessKeyId(): string
    {
        return (string) (getenv('AWS_ACCESS_KEY_ID') ?: '');
    }

    public static function awsSecretAccessKey(): string
    {
        return (string) (getenv('AWS_SECRET_ACCESS_KEY') ?: '');
    }

    public static function awsRegion(): string
    {
        return (string) (getenv('AWS_REGION') ?: '');
    }

    public static function awsS3Bucket(): string
    {
        return (string) (getenv('AWS_S3_BUCKET') ?: '');
    }

    /** 'aws' (default) or 'gcs' — Google Cloud Storage's S3-compatible XML API, using the same AWS_* credential vars (populated with GCS interoperability HMAC keys instead). See S3Client's docblock. */
    public static function storageProvider(): string
    {
        $provider = strtolower((string) (getenv('STORAGE_PROVIDER') ?: 'aws'));
        return $provider === 'gcs' ? 'gcs' : 'aws';
    }

    /** True once all four AWS S3 settings are configured — InfographicController falls back to local disk storage otherwise. */
    public static function s3Enabled(): bool
    {
        return self::awsAccessKeyId() !== ''
            && self::awsSecretAccessKey() !== ''
            && self::awsRegion() !== ''
            && self::awsS3Bucket() !== '';
    }
}
