<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

/**
 * Complete Your Look module — a merchant manually picks which other products
 * to show as "styling ideas" alongside a given product. No automatic
 * matching, per the agreed MVP scope.
 */
class ProductPairingRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /** @return array<int,int[]> shopify_product_id => [paired shopify_product_id, ...], ordered */
    public function getAllPairingsForMerchant(int $merchantId): array
    {
        $stmt = $this->db->prepare(
            'SELECT shopify_product_id, paired_shopify_product_id
             FROM product_pairings
             WHERE merchant_id = ?
             ORDER BY shopify_product_id, sort_order'
        );
        $stmt->execute([$merchantId]);

        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $src = (int)$row['shopify_product_id'];
            $out[$src] ??= [];
            $out[$src][] = (int)$row['paired_shopify_product_id'];
        }
        return $out;
    }

    /** @return int[] paired shopify_product_ids for one product, in order */
    public function getPairingsForProduct(int $merchantId, int $shopifyProductId): array
    {
        $stmt = $this->db->prepare(
            'SELECT paired_shopify_product_id FROM product_pairings
             WHERE merchant_id = ? AND shopify_product_id = ?
             ORDER BY sort_order'
        );
        $stmt->execute([$merchantId, $shopifyProductId]);
        return array_map(fn($r) => (int)$r['paired_shopify_product_id'], $stmt->fetchAll());
    }

    /** Replaces the full pairing list for one product (order = array order). */
    public function setPairings(int $merchantId, int $shopifyProductId, array $pairedIds): void
    {
        $this->db->beginTransaction();
        try {
            $del = $this->db->prepare('DELETE FROM product_pairings WHERE merchant_id = ? AND shopify_product_id = ?');
            $del->execute([$merchantId, $shopifyProductId]);

            $ins = $this->db->prepare(
                'INSERT INTO product_pairings (merchant_id, shopify_product_id, paired_shopify_product_id, sort_order)
                 VALUES (?, ?, ?, ?)'
            );
            foreach (array_values($pairedIds) as $i => $pairedId) {
                if ((int)$pairedId === $shopifyProductId) continue; // a product can't pair with itself
                $ins->execute([$merchantId, $shopifyProductId, (int)$pairedId, $i]);
            }
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * Public storefront lookup — paired products for one product, with the
     * display fields the widget needs (title/image/price), scoped by shop
     * domain rather than merchant_id since the storefront has no API key.
     *
     * @return array{id:int, title:string, image:string, price:string, url:string}[]
     */
    public function findByShopDomainAndProduct(string $shopDomain, int $shopifyProductId): array
    {
        $stmt = $this->db->prepare(
            'SELECT p.shopify_product_id AS id, p.title, p.image_url AS image,
                    COALESCE(p.price, 0.00) AS price, p.handle
             FROM product_pairings pp
             JOIN merchants m ON m.id = pp.merchant_id
             JOIN products p ON p.merchant_id = pp.merchant_id AND p.shopify_product_id = pp.paired_shopify_product_id
             WHERE m.shopify_domain = ? AND pp.shopify_product_id = ?
             ORDER BY pp.sort_order'
        );
        $stmt->execute([$shopDomain, $shopifyProductId]);

        return array_map(static function (array $row): array {
            return [
                'id'    => (int)$row['id'],
                'title' => (string)($row['title'] ?? ''),
                'image' => (string)($row['image'] ?? ''),
                'price' => number_format((float)($row['price'] ?? 0), 2, '.', ''),
                'handle' => (string)($row['handle'] ?? ''),
            ];
        }, $stmt->fetchAll());
    }
}
