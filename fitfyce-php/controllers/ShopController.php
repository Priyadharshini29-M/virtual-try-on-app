<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\ShopRepo;
use TryFit\Middleware\ApiKeyAuth;

class ShopController
{
    /**
     * GET /shop
     *
     * Returns: shop_id, shop_domain, app_status, app_plan, shopify_plan,
     *          installed_theme_name, installed_theme_id, enabled_at, updated_app
     */
    public function get(): void
    {
        $merchant = ApiKeyAuth::handle();
        $repo     = new ShopRepo();
        $info     = $repo->getShopInfo((int)$merchant['id']);

        if ($info === null) {
            respondJson(['error' => 'Shop not found'], 404);
        }

        respondJson($info);
    }
}
