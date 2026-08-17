<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\Database;
use TryFit\Db\ProductRepo;
use TryFit\Middleware\ApiKeyAuth;
use TryFit\Src\ShopifyApi;

class ShopifySyncController
{
    /**
     * POST /shopify/sync
     *
     * Fetches collections + products from Shopify and stores them in the DB.
     * Preserves existing is_tryon_enabled values for already-known products.
     * Keeps products_json and enabled_products in merchant_settings up to date.
     */
    public function sync(): void
    {
        $merchant = ApiKeyAuth::handle();
        $mid      = (int)$merchant['id'];

        if ($mid === 0) {
            respondJson(['error' => 'Merchant not identified — use merchant api_key, not master key'], 400);
        }

        $db   = Database::getInstance();
        $repo = new ProductRepo();

        // Fetch merchant access token + domain
        $m = $db->prepare('SELECT shopify_domain, access_token FROM merchants WHERE id = ? LIMIT 1');
        $m->execute([$mid]);
        $merchantRow = $m->fetch();

        if (!$merchantRow || empty($merchantRow['access_token'])) {
            respondJson(['error' => 'No access token found for merchant'], 400);
        }

        $api    = new ShopifyApi($merchantRow['shopify_domain'], $merchantRow['access_token']);
        $domain = $merchantRow['shopify_domain'];
        $log    = [];

        // ── 1. Fetch all collections (custom + smart) ─────────────────────────
        $customCollections = $api->fetchAll('custom_collections', 'custom_collections');
        $smartCollections  = $api->fetchAll('smart_collections',  'smart_collections');
        $allCollections    = array_merge($customCollections, $smartCollections);

        $log['collections_fetched'] = count($allCollections);

        // Build collection lookup: shopify_collection_id → collection row
        $collectionMap = [];
        foreach ($allCollections as $col) {
            $colId  = (int)$col['id'];
            $colGid = 'gid://shopify/Collection/' . $colId;

            $db->prepare(
                'INSERT INTO collections
                 (merchant_id, shopify_collection_id, shopify_collection_gid, title, handle, products_count)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   shopify_collection_gid = VALUES(shopify_collection_gid),
                   title                  = VALUES(title),
                   handle                 = VALUES(handle),
                   updated_at             = CURRENT_TIMESTAMP'
            )->execute([
                $mid, $colId, $colGid,
                $col['title'], $col['handle'],
                $col['products_count'] ?? 0,
            ]);

            $collectionMap[$colId] = [
                'collection_id'     => $colId,
                'collection_gid'    => $colGid,
                'collection_title'  => $col['title'],
                'collection_handle' => $col['handle'],
            ];
        }

        // ── 2. Build product→collection map by fetching products per collection ──
        // collects API only covers custom collections — this covers both custom + smart.
        $productColMap = [];
        foreach ($collectionMap as $colId => $colInfo) {
            $colProducts = $api->fetchAll('products', 'products', [
                'collection_id' => $colId,
                'fields'        => 'id',
            ]);
            foreach ($colProducts as $cp) {
                // First collection wins — avoid overwriting if already mapped
                $pid = (int)$cp['id'];
                if (!isset($productColMap[$pid])) {
                    $productColMap[$pid] = $colId;
                }
            }
        }

        $log['products_mapped_to_collections'] = count($productColMap);

        // ── 3. Fetch all products ─────────────────────────────────────────────
        $products = $api->fetchAll('products', 'products', [
            'fields' => 'id,title,handle,status,variants',
        ]);

        $log['products_fetched'] = count($products);
        $synced = 0;

        foreach ($products as $p) {
            $shopifyProductId  = (int)$p['id'];
            $shopifyProductGid = 'gid://shopify/Product/' . $shopifyProductId;

            // Find collection for this product
            $colId     = $productColMap[$shopifyProductId] ?? null;
            $colInfo   = $colId ? ($collectionMap[$colId] ?? []) : [];

            // Preserve existing is_tryon_enabled (default 0 for new products)
            $sel = $db->prepare('SELECT is_tryon_enabled FROM products WHERE merchant_id = ? AND shopify_product_id = ? LIMIT 1');
            $sel->execute([$mid, $shopifyProductId]);
            $existing         = $sel->fetch();
            $isTryonEnabled   = $existing ? (int)$existing['is_tryon_enabled'] : 0;

            $repo->syncProduct($mid, [
                'shopify_product_id'  => $shopifyProductId,
                'shopify_product_gid' => $shopifyProductGid,
                'collection_id'       => $colInfo['collection_id']     ?? null,
                'collection_gid'      => $colInfo['collection_gid']    ?? null,
                'collection_title'    => $colInfo['collection_title']  ?? null,
                'collection_handle'   => $colInfo['collection_handle'] ?? null,
                'is_tryon_enabled'    => $isTryonEnabled,
            ]);

            $synced++;
        }

        $log['products_synced'] = $synced;

        // products_json + enabled_products are rebuilt inside syncProduct()
        respondJson([
            'ok'  => true,
            'log' => $log,
        ]);
    }
}
