<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

class ProductRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Upsert by shopify_product_id, return internal id
     */
    public function syncProduct(int $merchantId, array $product): int
    {
        $stmt = $this->db->prepare(
            'INSERT INTO products
             (merchant_id, shopify_product_id, shopify_product_gid, title, handle, is_tryon_enabled)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               shopify_product_gid = VALUES(shopify_product_gid),
               title               = VALUES(title),
               handle              = VALUES(handle),
               is_tryon_enabled    = VALUES(is_tryon_enabled),
               updated_at          = CURRENT_TIMESTAMP'
        );
        $stmt->execute([
            $merchantId,
            $product['shopify_product_id'],
            $product['shopify_product_gid'],
            $product['title'],
            $product['handle'],
            $product['is_tryon_enabled'] ?? 1,
        ]);

        // Return existing id on duplicate
        $sel = $this->db->prepare(
            'SELECT id FROM products WHERE merchant_id = ? AND shopify_product_id = ? LIMIT 1'
        );
        $sel->execute([$merchantId, $product['shopify_product_id']]);
        return (int)$sel->fetchColumn();
    }

    public function setTryonEnabled(int $merchantId, int $shopifyProductId, bool $enabled): void
    {
        $stmt = $this->db->prepare(
            'UPDATE products SET is_tryon_enabled = ? WHERE merchant_id = ? AND shopify_product_id = ?'
        );
        $stmt->execute([$enabled ? 1 : 0, $merchantId, $shopifyProductId]);
    }

    /**
     * Upsert by shopify_variant_id. merchant_id stored directly for O(1) shop lookup.
     */
    public function saveVariantMapping(int $merchantId, int $productId, array $mapping): void
    {
        $stmt = $this->db->prepare(
            'INSERT INTO variant_image_mappings
             (merchant_id, product_id, shopify_variant_id, shopify_variant_gid, variant_title,
              tryon_image_url, image_type, avatar_sex, clothing_prompt, is_approved)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               shopify_variant_gid = VALUES(shopify_variant_gid),
               variant_title       = VALUES(variant_title),
               tryon_image_url     = VALUES(tryon_image_url),
               image_type          = VALUES(image_type),
               avatar_sex          = VALUES(avatar_sex),
               clothing_prompt     = VALUES(clothing_prompt),
               is_approved         = VALUES(is_approved),
               updated_at          = CURRENT_TIMESTAMP'
        );
        $stmt->execute([
            $merchantId,
            $productId,
            $mapping['shopify_variant_id'],
            $mapping['shopify_variant_gid'],
            $mapping['variant_title'] ?? null,
            $mapping['tryon_image_url'],
            $mapping['image_type'] ?? 'flat_lay',
            $mapping['avatar_sex'] ?? null,
            $mapping['clothing_prompt'] ?? null,
            $mapping['is_approved'] ?? 1,
        ]);
    }

    public function getVariantMappings(int $productId): array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM variant_image_mappings WHERE product_id = ? ORDER BY id ASC'
        );
        $stmt->execute([$productId]);
        return $stmt->fetchAll();
    }

    public function getMappingByVariantId(int $shopifyVariantId): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM variant_image_mappings WHERE shopify_variant_id = ? LIMIT 1'
        );
        $stmt->execute([$shopifyVariantId]);
        $res = $stmt->fetch();
        return $res ?: null;
    }

    public function listForMerchant(int $merchantId): array
    {
        $stmt = $this->db->prepare(
            'SELECT p.*,
                    COUNT(vim.id) AS variant_mapping_count
             FROM products p
             LEFT JOIN variant_image_mappings vim ON vim.product_id = p.id
             WHERE p.merchant_id = ?
             GROUP BY p.id
             ORDER BY p.title ASC'
        );
        $stmt->execute([$merchantId]);
        return $stmt->fetchAll();
    }
}
