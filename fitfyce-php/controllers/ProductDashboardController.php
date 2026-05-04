<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\ProductSummaryRepo;
use TryFit\Middleware\ApiKeyAuth;

class ProductDashboardController
{
    /**
     * GET /shop/products
     *
     * Returns: shop_id, collections_list, products_list,
     *          enabled_products_count, variant_map (keyed by product_id)
     */
    public function get(): void
    {
        $merchant = ApiKeyAuth::handle();
        $mid      = (int)$merchant['id'];
        $repo     = new ProductSummaryRepo();

        respondJson([
            'shop_id'               => $mid,
            'collections'           => $repo->getCollections($mid),
            'products'              => $repo->getProducts($mid),
            'enabled_products_count' => $repo->getEnabledProductsCount($mid),
            'variant_map'           => $repo->getVariantMappingsMap($mid),
        ]);
    }
}
