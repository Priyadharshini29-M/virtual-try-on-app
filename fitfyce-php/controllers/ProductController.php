<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\ProductRepo;
use TryFit\Middleware\ApiKeyAuth;
use VTON\OpenAIClient;
use VTON\RagIngestor;

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
        try {
            $merchant = ApiKeyAuth::handle();

            $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

            $required = ['shopify_product_id', 'shopify_product_gid'];
            foreach ($required as $field) {
                if (empty($body[$field])) {
                    respondJson(['error' => "Missing field: {$field}"], 400);
                }
            }

            $repo = new ProductRepo();
            $merchantId = (int)$merchant['id'];
            $id   = $repo->syncProduct($merchantId, $body);

            // Fire-and-forget RAG indexing — a Qdrant/OpenAI hiccup must
            // never fail a product sync response. No-ops instantly when
            // AppConfig::ragEnabled() is false (QDRANT_URL unset).
            if (AppConfig::ragEnabled()) {
                try {
                    $product = $repo->findById($merchantId, $id);
                    if ($product !== null) {
                        (new RagIngestor(new OpenAIClient(AppConfig::openAiApiKey())))
                            ->indexProduct($merchantId, $product);
                    }
                } catch (\Throwable $e) {
                    error_log('[FitSnap RAG] index-on-sync failed: ' . $e->getMessage());
                }
            }

            respondJson(['id' => $id]);
        } catch (\Throwable $e) {
            error_log('[FitSnap Product] sync error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            respondJson(['error' => 'Product sync failed: ' . $e->getMessage()], 500);
        }
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
        try {
            $merchant = ApiKeyAuth::handle();
            $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

            $required = ['product_id', 'shopify_variant_id', 'shopify_variant_gid', 'tryon_image_url'];
            foreach ($required as $field) {
                if (empty($body[$field])) {
                    respondJson(['error' => "Missing field: {$field}"], 400);
                }
            }

            $merchantId = (int)$merchant['id'];
            if ($merchantId === 0) {
                $shop = trim((string)($_GET['shop'] ?? $_SERVER['HTTP_X_SHOP_DOMAIN'] ?? ''));
                if ($shop !== '') {
                    $mRepo = new \TryFit\Db\MerchantRepo();
                    $m = $mRepo->findByDomain($shop) ?? $mRepo->findByDomainLike($shop);
                    if ($m) $merchantId = (int)$m['id'];
                }
            }

            self::ensureMappingColumns();

            $repo = new ProductRepo();
            $repo->saveVariantMapping($merchantId, (int)$body['product_id'], $body);
            respondJson(['ok' => true]);
        } catch (\Throwable $e) {
            error_log('[FitSnap] saveMapping error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            respondJson(['error' => 'Save failed: ' . $e->getMessage()], 500);
        }
    }

    public function updateMapping(): void
    {
        try {
            $merchant = ApiKeyAuth::handle();
            $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

            $required = ['product_id', 'shopify_variant_id', 'shopify_variant_gid', 'tryon_image_url'];
            foreach ($required as $field) {
                if (empty($body[$field])) {
                    respondJson(['error' => "Missing field: {$field}"], 400);
                }
            }

            $merchantId = (int)$merchant['id'];
            if ($merchantId === 0) {
                $shop = trim((string)($_GET['shop'] ?? $_SERVER['HTTP_X_SHOP_DOMAIN'] ?? ''));
                if ($shop !== '') {
                    $mRepo = new \TryFit\Db\MerchantRepo();
                    $m = $mRepo->findByDomain($shop) ?? $mRepo->findByDomainLike($shop);
                    if ($m) $merchantId = (int)$m['id'];
                }
            }

            self::ensureMappingColumns();

            $repo = new ProductRepo();
            $repo->saveVariantMapping($merchantId, (int)$body['product_id'], $body);
            respondJson(['ok' => true]);
        } catch (\Throwable $e) {
            error_log('[FitSnap] updateMapping error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            respondJson(['error' => 'Update failed: ' . $e->getMessage()], 500);
        }
    }

    private static function ensureMappingColumns(): void
    {
        static $done = false;
        if ($done) return;
        $done = true;

        $db = \TryFit\Db\Database::getInstance();

        $cols = $db->query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variant_image_mappings'"
        )->fetchAll(\PDO::FETCH_COLUMN);
        $existing = array_flip($cols);

        $alters = [
            'garment_type'   => "ALTER TABLE variant_image_mappings ADD COLUMN garment_type ENUM('top','bottom','full') NOT NULL DEFAULT 'top'",
            'avatar_sex'     => "ALTER TABLE variant_image_mappings ADD COLUMN avatar_sex ENUM('male','female') DEFAULT NULL",
            'clothing_prompt'=> "ALTER TABLE variant_image_mappings ADD COLUMN clothing_prompt VARCHAR(200) DEFAULT NULL",
            'is_approved'    => "ALTER TABLE variant_image_mappings ADD COLUMN is_approved TINYINT(1) NOT NULL DEFAULT 1",
        ];

        foreach ($alters as $col => $ddl) {
            if (!isset($existing[$col])) {
                try { $db->exec($ddl); } catch (\Throwable $e) { /* already added by concurrent request */ }
            }
        }
    }
}
