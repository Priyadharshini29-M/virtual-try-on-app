<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

class ProductSummaryRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public function getCollections(int $merchantId): array
    {
        $stmt = $this->db->prepare(
            'SELECT
                id                      AS collection_id,
                shopify_collection_id,
                shopify_collection_gid,
                title,
                handle,
                products_count,
                created_at,
                updated_at
             FROM collections
             WHERE merchant_id = ?
             ORDER BY title ASC'
        );
        $stmt->execute([$merchantId]);
        return $stmt->fetchAll();
    }

    public function getProducts(int $merchantId): array
    {
        $stmt = $this->db->prepare(
            'SELECT
                p.id                    AS product_id,
                p.merchant_id,
                p.shopify_domain,
                p.shopify_product_id,
                p.shopify_product_gid,
                p.collection_id,
                p.collection_title,
                p.collection_handle,
                p.collection_products,
                p.shopify_variants,
                p.is_tryon_enabled,
                p.created_at,
                p.updated_at,
                COUNT(vim.id)           AS variant_mapping_count
             FROM products p
             LEFT JOIN variant_image_mappings vim ON vim.product_id = p.id
             WHERE p.merchant_id = ?
             GROUP BY p.id
             ORDER BY p.collection_title ASC'
        );
        $stmt->execute([$merchantId]);
        return $stmt->fetchAll();
    }

    public function getEnabledProductsCount(int $merchantId): int
    {
        $stmt = $this->db->prepare(
            'SELECT COUNT(*) FROM products WHERE merchant_id = ? AND is_tryon_enabled = 1'
        );
        $stmt->execute([$merchantId]);
        return (int)$stmt->fetchColumn();
    }

    /**
     * Returns all variant mappings for a merchant, keyed by product_id.
     * Queries variant_image_mappings directly via merchant_id — no JOIN needed.
     *
     * Shape: { "<product_id>": [ { variant fields… }, … ], … }
     */
    public function getVariantMappingsMap(int $merchantId): array
    {
        $stmt = $this->db->prepare(
            'SELECT
                id,
                product_id,
                shopify_variant_id,
                shopify_variant_gid,
                variant_title,
                tryon_image_url,
                image_type,
                avatar_sex,
                clothing_prompt,
                is_approved,
                created_at,
                updated_at
             FROM variant_image_mappings
             WHERE merchant_id = ?
             ORDER BY product_id ASC, id ASC'
        );
        $stmt->execute([$merchantId]);

        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $map[(int)$row['product_id']][] = $row;
        }
        return $map;
    }

    public function upsertCollection(int $merchantId, array $col): int
    {
        $stmt = $this->db->prepare(
            'INSERT INTO collections
             (merchant_id, shopify_collection_id, shopify_collection_gid, title, handle, products_count)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               shopify_collection_gid = VALUES(shopify_collection_gid),
               title                  = VALUES(title),
               handle                 = VALUES(handle),
               products_count         = VALUES(products_count),
               updated_at             = CURRENT_TIMESTAMP'
        );
        $stmt->execute([
            $merchantId,
            $col['shopify_collection_id'],
            $col['shopify_collection_gid'],
            $col['title'],
            $col['handle'],
            $col['products_count'] ?? 0,
        ]);

        $sel = $this->db->prepare(
            'SELECT id FROM collections WHERE merchant_id = ? AND shopify_collection_id = ? LIMIT 1'
        );
        $sel->execute([$merchantId, $col['shopify_collection_id']]);
        return (int)$sel->fetchColumn();
    }

    public function linkProductToCollection(int $productId, int $collectionId): void
    {
        $this->db->prepare(
            'INSERT IGNORE INTO product_collection_map (product_id, collection_id) VALUES (?, ?)'
        )->execute([$productId, $collectionId]);
    }
}
