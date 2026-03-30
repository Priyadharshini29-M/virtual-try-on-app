<?php

declare(strict_types=1);

namespace VTON;

final class Config
{
    public static function apiUrl(): string
    {
        $env = getenv('TRY_ON_DIFFUSION_DEMO_API_URL');
        return $env !== false && $env !== ''
            ? rtrim($env, "/")
            : 'https://try-on-diffusion.p.rapidapi.com';
    }

    public static function apiKey(): string
    {
        $env = getenv('TRY_ON_DIFFUSION_DEMO_API_KEY');
        return $env !== false && $env !== ''
            ? $env
            : 'fe596ca37cmsh57bbfa0a1489ee2p138f12jsn8e7a113e042d';
    }

    public static function resultsDir(): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'results';
    }
}
