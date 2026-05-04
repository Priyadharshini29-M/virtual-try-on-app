<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\ProductRepo;
use TryFit\Middleware\ApiKeyAuth;

class ProductController
{
    public function list(): void
    {
        $merchant = ApiKeyAuth::handle();
        $repo = new ProductRepo();
        respondJson($repo->listForMerchant((int)$merchant['id']));
    }

    public function sync(): void
    {
        $merchant = ApiKeyAuth::handle();

        $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

        $required = ['shopify_product_id', 'shopify_product_gid', 'title', 'handle'];
        foreach ($required as $field) {
            if (empty($body[$field])) {
                respondJson(['error' => "Missing field: {$field}"], 400);
            }
        }

        $repo = new ProductRepo();
        $id   = $repo->syncProduct((int)$merchant['id'], $body);
        respondJson(['id' => $id]);
    }

    public function getMappings(): void
    {
        $merchant  = ApiKeyAuth::handle();
        $productId = isset($_GET['product_id']) ? (int)$_GET['product_id'] : null;

        if ($productId === null) {
            respondJson(['error' => 'product_id is required'], 400);
        }

        $repo = new ProductRepo();
        respondJson($repo->getVariantMappings($productId));
    }

    public function saveMapping(): void
    {
        $merchant = ApiKeyAuth::handle();

        $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

        $required = ['product_id', 'shopify_variant_id', 'shopify_variant_gid', 'tryon_image_url'];
        foreach ($required as $field) {
            if (empty($body[$field])) {
                respondJson(['error' => "Missing field: {$field}"], 400);
            }
        }

        $repo = new ProductRepo();
        $repo->saveVariantMapping((int)$merchant['id'], (int)$body['product_id'], $body);
        respondJson(['ok' => true]);
    }
}
