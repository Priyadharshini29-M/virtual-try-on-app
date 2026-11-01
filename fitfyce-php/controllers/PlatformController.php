<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\Database;
use TryFit\Db\MerchantRepo;
use TryFit\Db\WalletRepo;
use TryFit\Src\PlatformSync;
use TryFit\Src\WalletSettings;

/**
 * Server-to-server API for the VTO platform admin. Every request must carry a
 * valid X-Platform-Signature (see PlatformSync::verifyRequest); nothing here is
 * reachable by merchants or shoppers.
 *
 *   GET  /platform/stores            every merchant with wallet totals (full sync)
 *   GET  /platform/ledger            ledger rows after ?after_id= (paged, oldest first)
 *   GET  /platform/wallet-settings   credit packs + cost per action
 *   POST /platform/wallet-settings   replace packs + costs (applies immediately)
 *   POST /platform/wallet/reserve    debit a VTO try-on from the linked merchant
 *   POST /platform/wallet/release    refund it when the try-on failed
 */
class PlatformController
{
    public function stores(): void
    {
        PlatformSync::verifyRequest('');
        $ids = Database::getInstance()->query('SELECT id FROM merchants ORDER BY id')->fetchAll(\PDO::FETCH_COLUMN);
        $stores = array_values(array_filter(array_map(
            static fn($id) => PlatformSync::storePayload((int)$id),
            $ids
        )));
        respondJson(['ok' => true, 'stores' => $stores]);
    }

    public function ledger(): void
    {
        PlatformSync::verifyRequest('');
        $after = max(0, (int)($_GET['after_id'] ?? 0));
        $limit = max(1, min(1000, (int)($_GET['limit'] ?? 500)));
        $rows  = PlatformSync::ledger(0, $after, $limit);
        respondJson(['ok' => true, 'transactions' => $rows, 'more' => count($rows) === $limit]);
    }

    public function walletSettings(): void
    {
        PlatformSync::verifyRequest('');
        respondJson(['ok' => true] + WalletSettings::export());
    }

    public function saveWalletSettings(): void
    {
        $raw = (string)file_get_contents('php://input');
        PlatformSync::verifyRequest($raw);
        $b = (array)(json_decode($raw, true) ?? []);
        $error = WalletSettings::save((array)($b['packs'] ?? []), (array)($b['costs'] ?? []), isset($b['by']) ? substr((string)$b['by'], 0, 190) : null);
        if ($error !== null) {
            respondJson(['ok' => false, 'error' => $error], 422);
        }
        respondJson(['ok' => true] + WalletSettings::export());
    }

    /** Body: {shop, action: tryon, ref} → {ok, cost, balance, transactions} or 402 */
    public function reserve(): void
    {
        $raw = (string)file_get_contents('php://input');
        PlatformSync::verifyRequest($raw);
        PlatformSync::suppress();
        $b        = (array)(json_decode($raw, true) ?? []);
        $merchant = $this->merchantFor((string)($b['shop'] ?? ''));
        $action   = in_array($b['action'] ?? 'tryon', WalletSettings::ACTIONS, true) ? (string)($b['action'] ?? 'tryon') : 'tryon';
        $cost     = WalletSettings::cost($action);
        $ref      = substr((string)($b['ref'] ?? ''), 0, 100) ?: null;
        $id       = (int)$merchant['id'];

        if ((int)$merchant['is_active'] !== 1) {
            respondJson(['ok' => false, 'error' => 'store_inactive', 'balance' => (int)$merchant['wallet_credits']], 402);
        }
        $repo = new WalletRepo();
        if (!$repo->debit($id, $cost, $action, 'vto', $ref, 'VTO widget try-on')) {
            respondJson(['ok' => false, 'error' => 'insufficient_credits', 'cost' => $cost, 'balance' => $repo->balance($id)], 402);
        }
        respondJson($this->walletState($id) + ['ok' => true, 'cost' => $cost]);
    }

    /** Body: {shop, cost, ref} — refunds a reserve() whose try-on failed */
    public function release(): void
    {
        $raw = (string)file_get_contents('php://input');
        PlatformSync::verifyRequest($raw);
        PlatformSync::suppress();
        $b        = (array)(json_decode($raw, true) ?? []);
        $merchant = $this->merchantFor((string)($b['shop'] ?? ''));
        $cost     = max(0, min(1000, (int)($b['cost'] ?? 0)));
        $ref      = substr((string)($b['ref'] ?? ''), 0, 100) ?: null;
        (new WalletRepo())->release((int)$merchant['id'], $cost, 'vto', $ref);
        respondJson($this->walletState((int)$merchant['id']) + ['ok' => true]);
    }

    private function merchantFor(string $shop): array
    {
        $shop = rtrim(preg_replace('#^https?://#i', '', strtolower(trim($shop))), '/');
        $repo = new MerchantRepo();
        $m    = $shop !== '' ? ($repo->findByDomain($shop) ?? $repo->findByDomainLike($shop)) : null;
        if ($m === null) {
            respondJson(['ok' => false, 'error' => 'unknown_store'], 404);
        }
        return $m;
    }

    private function walletState(int $merchantId): array
    {
        return [
            'store'        => PlatformSync::storePayload($merchantId),
            'transactions' => PlatformSync::ledger($merchantId, 0, 5),
        ];
    }
}
