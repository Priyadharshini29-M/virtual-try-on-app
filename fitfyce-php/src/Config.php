<?php

declare(strict_types=1);

namespace VTON;

use TryFit\AppConfig;

/**
 * Thin wrapper kept for backward-compatibility with TryOnDiffusionClient.
 * All values are sourced from the central AppConfig.
 */
final class Config
{
    public static function apiUrl(): string
    {
        return AppConfig::vtonApiUrl();
    }

    public static function apiKey(): string
    {
        return AppConfig::vtonApiKey();
    }

    public static function resultsDir(): string
    {
        return AppConfig::resultsDir();
    }
}
