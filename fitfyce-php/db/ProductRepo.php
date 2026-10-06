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
        $this->ensureHandleColumn();
        $this->ensureRagFactColumns();

        // Resolve shopify_domain from merchants table
        $domainRow = $this->db->prepare('SELECT shopify_domain FROM merchants WHERE id = ? LIMIT 1');
        $domainRow->execute([$merchantId]);
        $shopDomain = $domainRow->fetchColumn() ?: null;

        // Encode variants array to JSON if provided
        $variantsJson = null;
        if (isset($product['shopify_variants']) && $product['shopify_variants'] !== null) {
            $variantsJson = is_array($product['shopify_variants'])
                ? json_encode($product['shopify_variants'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
                : $product['shopify_variants'];
        }

        // Encode collection_products JSON
        $collectionProductsJson = null;
        if (isset($product['collection_products']) && $product['collection_products'] !== null) {
            $collectionProductsJson = is_array($product['collection_products'])
                ? json_encode($product['collection_products'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
                : $product['collection_products'];
        }

        $stmt = $this->db->prepare(
            'INSERT INTO products
             (merchant_id, shopify_domain, shopify_product_id, shopify_product_gid,
              collection_id, collection_title, collection_handle,
              collection_products, shopify_variants, is_tryon_enabled, handle,
              vendor, product_type, tags, description_html)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               shopify_domain       = VALUES(shopify_domain),
               shopify_product_gid  = VALUES(shopify_product_gid),
               -- A sync that omits these (bulk/collection toggles) must not wipe
               -- the collection link or variants saved by an earlier full sync.
               collection_id        = COALESCE(VALUES(collection_id), collection_id),
               collection_title     = COALESCE(VALUES(collection_title), collection_title),
               collection_handle    = COALESCE(VALUES(collection_handle), collection_handle),
               collection_products  = COALESCE(VALUES(collection_products), collection_products),
               shopify_variants     = COALESCE(VALUES(shopify_variants), shopify_variants),
               is_tryon_enabled     = VALUES(is_tryon_enabled),
               handle               = COALESCE(VALUES(handle), handle),
               vendor               = COALESCE(VALUES(vendor), vendor),
               product_type         = COALESCE(VALUES(product_type), product_type),
               tags                 = COALESCE(VALUES(tags), tags),
               description_html     = COALESCE(VALUES(description_html), description_html),
               updated_at           = CURRENT_TIMESTAMP'
        );
        $stmt->execute([
            $merchantId,
            $shopDomain,
            $product['shopify_product_id'],
            $product['shopify_product_gid'],
            $product['collection_id']       ?? null,
            $product['collection_title']    ?? null,
            $product['collection_handle']   ?? null,
            $collectionProductsJson,
            $variantsJson,
            $product['is_tryon_enabled']    ?? 1,
            $product['handle']              ?? null,
            $product['vendor']              ?? null,
            $product['product_type']        ?? null,
            is_array($product['tags'] ?? null) ? implode(', ', $product['tags']) : ($product['tags'] ?? null),
            $product['description_html']    ?? null,
        ]);

        // Return existing id on duplicate
        $sel = $this->db->prepare(
            'SELECT id FROM products WHERE merchant_id = ? AND shopify_product_id = ? LIMIT 1'
        );
        $sel->execute([$merchantId, $product['shopify_product_id']]);
        $id = (int)$sel->fetchColumn();

        // Auto-upsert collection and link product when collection info is present
        if (!empty($product['collection_id'])) {
            $this->upsertCollectionFromProduct($merchantId, $id, $product);
        }

        $this->syncProductsJson($merchantId);
        $this->syncEnabledProductsJson($merchantId);
        return $id;
    }

    private function upsertCollectionFromProduct(int $merchantId, int $productId, array $product): void
    {
        $this->db->prepare(
            'INSERT INTO collections
             (merchant_id, shopify_collection_id, shopify_collection_gid, title, handle, products_count)
             VALUES (?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
               shopify_collection_gid = COALESCE(VALUES(shopify_collection_gid), shopify_collection_gid),
               title                  = VALUES(title),
               handle                 = VALUES(handle),
               products_count         = (
                   SELECT COUNT(*) FROM products
                   WHERE merchant_id = ? AND collection_id = ?
               ),
               updated_at             = CURRENT_TIMESTAMP'
        )->execute([
            $merchantId,
            $product['collection_id'],
            $product['collection_gid'] ?? null,
            $product['collection_title'],
            $product['collection_handle'],
            $merchantId,
            $product['collection_id'],
        ]);

        $colSel = $this->db->prepare(
            'SELECT id FROM collections WHERE merchant_id = ? AND shopify_collection_id = ? LIMIT 1'
        );
        $colSel->execute([$merchantId, $product['collection_id']]);
        $collectionId = (int)$colSel->fetchColumn();

        if ($collectionId) {
            $this->db->prepare(
                'INSERT IGNORE INTO product_collection_map (product_id, collection_id) VALUES (?, ?)'
            )->execute([$productId, $collectionId]);
        }
    }

    public function setTryonEnabled(int $merchantId, int $shopifyProductId, bool $enabled): void
    {
        $stmt = $this->db->prepare(
            'UPDATE products SET is_tryon_enabled = ? WHERE merchant_id = ? AND shopify_product_id = ?'
        );
        $stmt->execute([$enabled ? 1 : 0, $merchantId, $shopifyProductId]);
        $this->syncEnabledProductsJson($merchantId);
    }

    /**
     * Rebuilds merchant_settings.products_json — full list of all products for the merchant.
     */
    public function syncProductsJson(int $merchantId): void
    {
        $stmt = $this->db->prepare(
            'SELECT id AS product_id, shopify_product_id, shopify_product_gid,
                    collection_id, collection_title, collection_handle,
                    collection_products, shopify_variants, is_tryon_enabled
             FROM products
             WHERE merchant_id = ?
             ORDER BY collection_title ASC'
        );
        $stmt->execute([$merchantId]);
        $rows = $stmt->fetchAll();

        // Decode JSON columns so they appear as objects not strings
        $all = array_map(function ($r) {
            $r['collection_products'] = isset($r['collection_products'])
                ? json_decode($r['collection_products'], true)
                : null;
            $r['shopify_variants'] = isset($r['shopify_variants'])
                ? json_decode($r['shopify_variants'], true)
                : null;
            return $r;
        }, $rows);

        $this->db->prepare(
            'UPDATE merchant_settings SET products_json = ? WHERE merchant_id = ?'
        )->execute([
            json_encode($all, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            $merchantId,
        ]);
    }

    /**
     * Rebuilds merchant_settings.enabled_products JSON from the products table.
     * Called automatically after any is_tryon_enabled change.
     *
     * Handles are backfilled from the collection_products JSON when the dedicated
     * handle column is absent or empty — this covers all rows synced before the
     * handle column was introduced without requiring re-syncs.
     */
    public function syncEnabledProductsJson(int $merchantId): void
    {
        $handleCol = $this->hasProductsColumn('handle') ? ', handle' : ", '' AS handle";

        $stmt = $this->db->prepare(
            "SELECT id AS product_id, shopify_product_id, shopify_product_gid,
                    collection_title, collection_handle, collection_products{$handleCol}
             FROM products
             WHERE merchant_id = ? AND is_tryon_enabled = 1
             ORDER BY collection_title ASC"
        );
        $stmt->execute([$merchantId]);
        $rows = $stmt->fetchAll();

        $enabled = [];
        foreach ($rows as $row) {
            $handle = (string)($row['handle'] ?? '');

            // Backfill from collection_products JSON when the handle column is empty.
            // collection_products stores ALL products in the same collection including
            // this product itself, so the handle is always findable there.
            if ($handle === '' && !empty($row['collection_products'])) {
                $collProds = json_decode((string)$row['collection_products'], true) ?? [];
                $pid = (string)($row['shopify_product_id'] ?? '');
                foreach ($collProds as $cp) {
                    if (
                        isset($cp['handle'], $cp['shopify_product_id']) &&
                        $cp['handle'] !== '' &&
                        (string)$cp['shopify_product_id'] === $pid
                    ) {
                        $handle = (string)$cp['handle'];
                        break;
                    }
                }
            }

            $enabled[] = [
                'product_id'          => $row['product_id'],
                'shopify_product_id'  => $row['shopify_product_id'],
                'shopify_product_gid' => $row['shopify_product_gid'],
                'collection_title'    => $row['collection_title'],
                'collection_handle'   => $row['collection_handle'],
                'handle'              => $handle,
            ];
        }

        $this->db->prepare(
            'UPDATE merchant_settings SET enabled_products = ? WHERE merchant_id = ?'
        )->execute([
            json_encode($enabled, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            $merchantId,
        ]);
    }

    /**
     * Upsert by shopify_variant_id. merchant_id stored directly for O(1) shop lookup.
     */
    public function saveVariantMapping(int $merchantId, int $productId, array $mapping): void
    {
        $this->ensureVariantMappingColumns();

        $stmt = $this->db->prepare(
            'INSERT INTO variant_image_mappings
             (merchant_id, product_id, shopify_variant_id, shopify_variant_gid, variant_title,
              tryon_image_url, image_type, garment_type, avatar_sex, clothing_prompt, is_approved)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               shopify_variant_gid = VALUES(shopify_variant_gid),
               variant_title       = VALUES(variant_title),
               tryon_image_url     = VALUES(tryon_image_url),
               image_type          = VALUES(image_type),
               garment_type        = VALUES(garment_type),
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
            $mapping['image_type']    ?? 'flat_lay',
            $mapping['garment_type']  ?? 'top',
            $mapping['avatar_sex']    ?? null,
            $mapping['clothing_prompt'] ?? null,
            $mapping['is_approved']   ?? 1,
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

    /** Lookup by internal products.id (the `product_id` used throughout the API — variant mappings, RAG, etc). */
    public function findById(int $merchantId, int $id): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM products WHERE merchant_id = ? AND id = ? LIMIT 1'
        );
        $stmt->execute([$merchantId, $id]);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    public function findByShopifyId(int $merchantId, int $shopifyProductId): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM products WHERE merchant_id = ? AND shopify_product_id = ? LIMIT 1'
        );
        $stmt->execute([$merchantId, $shopifyProductId]);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
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
             ORDER BY p.collection_title ASC'
        );
        $stmt->execute([$merchantId]);
        return $stmt->fetchAll();
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Adds the `handle` column to products if it does not yet exist.
     * Uses a static flag so the INFORMATION_SCHEMA query only runs once per request.
     */
    /**
     * Adds any missing columns to variant_image_mappings (self-healing migration).
     * Runs once per request via static flag.
     */
    private function ensureVariantMappingColumns(): void
    {
        static $ensured = false;
        if ($ensured) return;
        $ensured = true;

        $stmt = $this->db->query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variant_image_mappings'"
        );
        $existing = array_flip($stmt->fetchAll(PDO::FETCH_COLUMN));

        $needed = [
            'garment_type'    => "ALTER TABLE variant_image_mappings ADD COLUMN garment_type ENUM('top','bottom','full') NOT NULL DEFAULT 'top'",
            'avatar_sex'      => "ALTER TABLE variant_image_mappings ADD COLUMN avatar_sex ENUM('male','female') DEFAULT NULL",
            'clothing_prompt' => "ALTER TABLE variant_image_mappings ADD COLUMN clothing_prompt VARCHAR(200) DEFAULT NULL",
            'is_approved'     => "ALTER TABLE variant_image_mappings ADD COLUMN is_approved TINYINT(1) NOT NULL DEFAULT 1",
        ];

        foreach ($needed as $col => $ddl) {
            if (!isset($existing[$col])) {
                try { $this->db->exec($ddl); } catch (\Throwable $e) { /* already exists */ }
            }
        }
    }

    private function ensureHandleColumn(): void
    {
        static $ensured = false;
        if ($ensured) return;
        $ensured = true;

        $stmt = $this->db->prepare(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'handle'"
        );
        $stmt->execute();
        if ((int)$stmt->fetchColumn() === 0) {
            $this->db->exec('ALTER TABLE products ADD COLUMN handle VARCHAR(255) DEFAULT NULL');
        }
    }

    /**
     * Adds vendor/product_type/tags/description_html to products if missing
     * (migration 014 — RAG grounding fact columns). Self-healing, same pattern
     * as ensureHandleColumn(); production applies this without re-running
     * migrate.php.
     */
    private function ensureRagFactColumns(): void
    {
        static $ensured = false;
        if ($ensured) return;
        $ensured = true;

        $stmt = $this->db->query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'"
        );
        $existing = array_flip($stmt->fetchAll(PDO::FETCH_COLUMN));

        $needed = [
            'vendor'           => "ALTER TABLE products ADD COLUMN vendor VARCHAR(255) DEFAULT NULL",
            'product_type'     => "ALTER TABLE products ADD COLUMN product_type VARCHAR(255) DEFAULT NULL",
            'tags'             => "ALTER TABLE products ADD COLUMN tags TEXT DEFAULT NULL",
            'description_html' => "ALTER TABLE products ADD COLUMN description_html LONGTEXT DEFAULT NULL",
        ];

        foreach ($needed as $col => $ddl) {
            if (!isset($existing[$col])) {
                try { $this->db->exec($ddl); } catch (\Throwable $e) { /* already added by concurrent request */ }
            }
        }
    }

    /**
     * Returns true if the `products` table has the given column.
     * Used by syncEnabledProductsJson to produce a backwards-compatible SELECT.
     */
    private function hasProductsColumn(string $column): bool
    {
        $stmt = $this->db->prepare(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = ?"
        );
        $stmt->execute([$column]);
        return (int)$stmt->fetchColumn() > 0;
    }
}
