<?php

declare(strict_types=1);

namespace TryFit\Middleware;

use TryFit\AppConfig;
use TryFit\Db\WalletRepo;

/**
 * Wallet-credit gatekeeper. One credit per billable action — try-on, AI
 * Studio generation, infographic — matching the Interakt-style pay-per-use
 * model that replaced the fixed plans. Callers invoke reserve() right before
 * handing the job to the provider and release() if the submit fails.
 *
 * This replaces the old PlanLimitCheck (monthly try-on quota per tier). The
 * class name is kept distinct so stale callers hard-fail instead of silently
 * doing the wrong thing.
 */
class WalletCheck
{
    public const COST_TRYON       = 1;
    public const COST_STUDIO      = 1;
    public const COST_INFOGRAPHIC = 1;

    /**
     * Non-destructive read: short-circuits a request with 402 when the wallet
     * is already empty. Safe to call anywhere; the actual debit is done by
     * reserve().
     */
    public static function handle(array $merchant, ?int $cost = null): void
    {
        $cost = $cost ?? self::currentCost('tryon');
        $balance = (int)($merchant['wallet_credits'] ?? 0);
        if ($balance < $cost) {
            respondJson([
                'error'       => 'Wallet balance is empty. Top up to continue.',
                'balance'     => $balance,
                'cost'        => $cost,
                'topup_url'   => AppConfig::SHOPIFY_APP_URL,
            ], 402);
        }
    }

    /**
     * Atomically debits the wallet or responds 402. Call right before the job
     * is sent to the provider; on submit/generation failure, call release().
     * reason is the ledger label (tryon|studio|infographic).
     */
    public static function reserve(array $merchant, string $reason = 'tryon', int $cost = self::COST_TRYON, ?string $refType = null, ?string $refId = null): void
    {
        if (!(new WalletRepo())->debit((int)$merchant['id'], $cost, $reason, $refType, $refId)) {
            respondJson([
                'error'     => 'Wallet balance is empty. Top up to continue.',
                'balance'   => 0,
                'cost'      => $cost,
                'topup_url' => AppConfig::SHOPIFY_APP_URL,
            ], 402);
        }
    }

    /** Cost from the platform admin's wallet rules; the COST_* constants are the fallback. */
    public static function currentCost(string $action): int
    {
        return class_exists(\TryFit\Src\WalletSettings::class) ? \TryFit\Src\WalletSettings::cost($action) : self::COST_TRYON;
    }

    /** Refunds a reserved credit after a submit/generation failure. */
    public static function release(int $merchantId, int $cost = self::COST_TRYON, ?string $refType = null, ?string $refId = null): void
    {
        (new WalletRepo())->release($merchantId, $cost, $refType, $refId);
    }
}
