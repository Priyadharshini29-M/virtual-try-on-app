<?php
/**
 * Central configuration. Values can be overridden with environment variables
 * (recommended in production) – e.g. set VTO_DB_PASS in your Apache/Nginx/PHP-FPM env.
 */
return [
    'app_name' => 'VTO Platform',
    'base_url' => getenv('VTO_BASE_URL') ?: 'https://vto.yourdomain.com',   // where /backend is served
    'debug'    => (bool)(getenv('VTO_DEBUG') ?: false),

    'db' => [
        'host'    => getenv('VTO_DB_HOST') ?: '127.0.0.1',
        'port'    => (int)(getenv('VTO_DB_PORT') ?: 3306),
        'name'    => getenv('VTO_DB_NAME') ?: 'vto_platform',
        'user'    => getenv('VTO_DB_USER') ?: 'vto_user',
        'pass'    => getenv('VTO_DB_PASS') ?: 'change_me',
        'charset' => 'utf8mb4',
    ],

    // Where shopper photos and results are stored (must be writable by PHP, NOT executable)
    'upload_dir' => __DIR__ . '/storage/uploads',
    'upload_url' => (getenv('VTO_BASE_URL') ?: 'https://vto.yourdomain.com') . '/backend/media.php?f=',
    'max_upload_bytes' => 8 * 1024 * 1024,
    'user_image_ttl_hours' => 24,           // shopper photos auto-deleted by cli/cleanup.php

    // Try-on engine. 'mock' = local GD composite (for development / demo).
    // 'http' = forward to your real model server or a 3rd-party VTO API.
    'tryon' => [
        'provider' => getenv('VTO_PROVIDER') ?: 'mock',
        'http' => [
            'endpoint' => getenv('VTO_PROVIDER_URL') ?: 'https://your-model-server/api/tryon',
            'api_key'  => getenv('VTO_PROVIDER_KEY') ?: '',
            'timeout'  => 90,
        ],
    ],

    // Button / icon design is managed in the FitFyce app (Widget Settings) and read from its public API
    'fitfyce' => [
        'api'           => getenv('VTO_FITFYCE_API') ?: 'https://tryonapp.digifyce.com',
        'cache_seconds' => (int)(getenv('VTO_FITFYCE_CACHE_SECONDS') ?: 1),   // Widget Settings changes show within ~1 s
        'retry_seconds' => 30,                                                  // after FitFyce fails, serve the stale copy this long
        'timeout'       => 4,
    ],
    'cache_dir' => __DIR__ . '/storage/cache',

    // Stores + wallets sync with FitFyce (same value as VTO_PLATFORM_SECRET in FitFyce's env).
    // FitFyce pushes to backend/api/platform.php; the admin calls FitFyce's /platform/* API.
    'platform' => [
        'secret'  => getenv('VTO_PLATFORM_SECRET') ?: '',
        'timeout' => 8,
    ],

    // Public API rate limits (per IP per site, per minute)
    'rate_limit' => [
        'config_per_min' => 120,
        'report_per_min' => 60,
        'tryon_per_min'  => 6,
    ],

    // DEV ONLY: allow product images from localhost/private IPs (keep false in production – SSRF protection)
    'dev_allow_private_images' => getenv('VTO_DEV_ALLOW_PRIVATE') === '1',

    // Salt used for hashing shopper IPs (privacy)
    'ip_salt' => getenv('VTO_IP_SALT') ?: 'replace-with-random-string',
];
