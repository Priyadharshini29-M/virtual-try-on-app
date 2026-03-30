<?php

declare(strict_types=1);

namespace TryFit\Middleware;

use TryFit\Db\MerchantRepo;

class ApiKeyAuth
{
    public static function handle(): array
    {
        $key = trim((string)($_SERVER['HTTP_X_API_KEY'] ?? ''));

        if ($key === '') {
            respondJson(['error' => 'Unauthorized'], 401);
        }

        // Master key — allows privileged operations (register, by-domain, etc.)
        // before any merchant rows exist in the DB.
        $masterKey = trim((string)(getenv('MASTER_API_KEY') ?: ''));
        if ($masterKey !== '' && $key === $masterKey) {
            return ['id' => 0, 'is_active' => 1, 'plan' => 'master', 'api_key' => $key];
        }

        $repo     = new MerchantRepo();
        $merchant = $repo->findByApiKey($key);

        if ($merchant === null || (int)$merchant['is_active'] === 0) {
            respondJson(['error' => 'Unauthorized'], 401);
        }

        return $merchant;
    }
}
