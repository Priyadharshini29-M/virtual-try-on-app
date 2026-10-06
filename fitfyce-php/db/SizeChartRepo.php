<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

/**
 * Size Chart module — a merchant builds one or more charts (a unit + a
 * simple columns/rows table, stored as JSON since the shape is entirely
 * merchant-defined) and assigns one chart per product. Each row can
 * optionally carry a matching rule (age/height/weight ranges) that powers
 * the storefront "Size Assistant" quiz — a chart with no rules just shows
 * the static table with no quiz offered.
 */
class SizeChartRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /** @return array{id:int, name:string, unit:string, columns:array, rows:array}[] */
    public function listForMerchant(int $merchantId): array
    {
        $stmt = $this->db->prepare(
            'SELECT sc.*, COUNT(psc.shopify_product_id) AS assigned_count
             FROM size_charts sc
             LEFT JOIN product_size_charts psc ON psc.chart_id = sc.id
             WHERE sc.merchant_id = ?
             GROUP BY sc.id
             ORDER BY sc.created_at DESC'
        );
        $stmt->execute([$merchantId]);
        return array_map([$this, 'formatChart'], $stmt->fetchAll());
    }

    public function find(int $merchantId, int $chartId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM size_charts WHERE id = ? AND merchant_id = ? LIMIT 1');
        $stmt->execute([$chartId, $merchantId]);
        $row = $stmt->fetch();
        return $row !== false ? $this->formatChart($row) : null;
    }

    /** @param array{name:string, unit:string, columns:array, rows:array, rules?:array} $data */
    public function create(int $merchantId, array $data): int
    {
        $stmt = $this->db->prepare(
            'INSERT INTO size_charts (merchant_id, name, unit, columns_json, rows_json, rules_json) VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $merchantId,
            $data['name'],
            $data['unit'],
            json_encode($data['columns'], JSON_UNESCAPED_UNICODE),
            json_encode($data['rows'], JSON_UNESCAPED_UNICODE),
            json_encode($data['rules'] ?? [], JSON_UNESCAPED_UNICODE),
        ]);
        return (int)$this->db->lastInsertId();
    }

    /** @param array{name:string, unit:string, columns:array, rows:array, rules?:array} $data */
    public function update(int $merchantId, int $chartId, array $data): void
    {
        $stmt = $this->db->prepare(
            'UPDATE size_charts SET name = ?, unit = ?, columns_json = ?, rows_json = ?, rules_json = ? WHERE id = ? AND merchant_id = ?'
        );
        $stmt->execute([
            $data['name'],
            $data['unit'],
            json_encode($data['columns'], JSON_UNESCAPED_UNICODE),
            json_encode($data['rows'], JSON_UNESCAPED_UNICODE),
            json_encode($data['rules'] ?? [], JSON_UNESCAPED_UNICODE),
            $chartId,
            $merchantId,
        ]);
    }

    public function delete(int $merchantId, int $chartId): void
    {
        $stmt = $this->db->prepare('DELETE FROM size_charts WHERE id = ? AND merchant_id = ?');
        $stmt->execute([$chartId, $merchantId]);
        // Assignments pointing at a deleted chart would otherwise silently
        // keep matching nothing — clean them up explicitly.
        $stmt2 = $this->db->prepare('DELETE FROM product_size_charts WHERE chart_id = ? AND merchant_id = ?');
        $stmt2->execute([$chartId, $merchantId]);
    }

    public function assignToProduct(int $merchantId, int $shopifyProductId, int $chartId): void
    {
        $stmt = $this->db->prepare(
            'INSERT INTO product_size_charts (merchant_id, shopify_product_id, chart_id)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE chart_id = VALUES(chart_id)'
        );
        $stmt->execute([$merchantId, $shopifyProductId, $chartId]);
    }

    public function unassignFromProduct(int $merchantId, int $shopifyProductId): void
    {
        $stmt = $this->db->prepare('DELETE FROM product_size_charts WHERE merchant_id = ? AND shopify_product_id = ?');
        $stmt->execute([$merchantId, $shopifyProductId]);
    }

    /** @return array<int,int> shopify_product_id => chart_id, for every assigned product of this merchant */
    public function getAssignments(int $merchantId): array
    {
        $stmt = $this->db->prepare('SELECT shopify_product_id, chart_id FROM product_size_charts WHERE merchant_id = ?');
        $stmt->execute([$merchantId]);
        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $out[(int)$row['shopify_product_id']] = (int)$row['chart_id'];
        }
        return $out;
    }

    /** Public storefront lookup — the chart assigned to one product, or null. */
    public function findByShopDomainAndProduct(string $shopDomain, int $shopifyProductId): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT sc.*
             FROM product_size_charts psc
             JOIN size_charts sc ON sc.id = psc.chart_id
             JOIN merchants m ON m.id = psc.merchant_id
             WHERE m.shopify_domain = ? AND psc.shopify_product_id = ?
             LIMIT 1'
        );
        $stmt->execute([$shopDomain, $shopifyProductId]);
        $row = $stmt->fetch();
        return $row !== false ? $this->formatChart($row) : null;
    }

    private function formatChart(array $row): array
    {
        return [
            'id'             => (int)$row['id'],
            'name'           => (string)$row['name'],
            'unit'           => (string)$row['unit'],
            'columns'        => json_decode((string)$row['columns_json'], true) ?? [],
            'rows'           => json_decode((string)$row['rows_json'], true) ?? [],
            // One entry per row, same order — {ageMin,ageMax,heightMin,heightMax,weightMin,weightMax},
            // all nullable. Powers the storefront quiz; absent/empty means "no quiz for this chart".
            'rules'          => json_decode((string)($row['rules_json'] ?? ''), true) ?? [],
            'assigned_count' => isset($row['assigned_count']) ? (int)$row['assigned_count'] : null,
        ];
    }
}
