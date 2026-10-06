<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\ProductPairingRepo;
use TryFit\Db\MerchantRepo;
use TryFit\Middleware\ApiKeyAuth;

/**
 * Complete Your Look module — merchant manually pairs products ("styling
 * ideas"), admin CRUD (API-key authenticated) plus a public storefront
 * lookup by shop domain + product id.
 */
class CompleteLookController
{
    /** GET /complete-look — all pairings + module enabled flag. */
    public function list(): void
    {
        $merchant = ApiKeyAuth::handle();

        respondJson([
            'enabled'  => (bool)($merchant['complete_look_enabled'] ?? false),
            'pairings' => (new ProductPairingRepo())->getAllPairingsForMerchant((int)$merchant['id']),
        ]);
    }

    /** POST /complete-look/pairings — body: {shopify_product_id, paired_ids:[...]} */
    public function setPairings(): void
    {
        $merchant  = ApiKeyAuth::handle();
        $body      = $this->body();
        $productId = (int)($body['shopify_product_id'] ?? 0);
        $pairedIds = is_array($body['paired_ids'] ?? null) ? array_map('intval', $body['paired_ids']) : null;

        if ($productId <= 0 || $pairedIds === null) {
            respondJson(['error' => 'shopify_product_id and paired_ids are required'], 400);
            return;
        }

        // Cap at 12 — this is a curated "styling ideas" rail, not a full catalog dump.
        (new ProductPairingRepo())->setPairings((int)$merchant['id'], $productId, array_slice($pairedIds, 0, 12));
        respondJson(['ok' => true]);
    }

    /** POST /complete-look/enabled — body: {enabled} */
    public function setEnabled(): void
    {
        $merchant = ApiKeyAuth::handle();
        $enabled  = (bool)($this->body()['enabled'] ?? false);

        (new MerchantRepo())->setCompleteLookEnabled((int)$merchant['id'], $enabled);
        respondJson(['ok' => true]);
    }

    /**
     * GET /api/complete-look?shop=...&product_id=...
     * Public — no API key, scoped by shop domain.
     */
    public function publicGet(): void
    {
        header('Cache-Control: no-store, must-revalidate');

        $shop      = rtrim(preg_replace('#^https?://#i', '', trim((string)($_GET['shop'] ?? ''))), '/');
        $productId = (int)($_GET['product_id'] ?? 0);

        if ($shop === '' || $productId <= 0) {
            respondJson(['products' => []]);
            return;
        }

        $mRepo    = new MerchantRepo();
        $merchant = $mRepo->findByDomain($shop) ?? $mRepo->findByDomainLike($shop);

        if ($merchant === null || !($merchant['complete_look_enabled'] ?? false)) {
            respondJson(['products' => []]);
            return;
        }

        $products = (new ProductPairingRepo())->findByShopDomainAndProduct($shop, $productId);
        respondJson(['products' => $products]);
    }

    private function body(): array
    {
        return (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);
    }
}
