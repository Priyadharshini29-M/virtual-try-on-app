<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

class MerchantRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public function findByApiKey(string $key): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM merchants WHERE api_key = ? LIMIT 1'
        );
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    public function findByDomain(string $domain): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM merchants WHERE shopify_domain = ? LIMIT 1'
        );
        $stmt->execute([$domain]);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    /**
     * Fuzzy fallback for domains stored with protocol prefix or trailing slash.
     * Used when exact-match fails (e.g. DB has "https://store.myshopify.com"
     * but caller sends "store.myshopify.com").
     */
    public function findByDomainLike(string $domain): ?array
    {
        $stmt = $this->db->prepare(
            "SELECT * FROM merchants WHERE shopify_domain LIKE ? LIMIT 1"
        );
        $stmt->execute(['%' . $domain . '%']);
        $row = $stmt->fetch();
        if ($row === false) return null;

        // Self-heal: normalise the stored domain for future exact matches
        $normalised = preg_replace('#^https?://#i', '', (string)$row['shopify_domain']);
        $normalised = rtrim($normalised, '/');
        if ($normalised !== $row['shopify_domain']) {
            $fix = $this->db->prepare('UPDATE merchants SET shopify_domain = ? WHERE id = ?');
            $fix->execute([$normalised, $row['id']]);
            $row['shopify_domain'] = $normalised;
            error_log("[FitSnap] MerchantRepo: normalised shopify_domain for id={$row['id']} to '{$normalised}'");
        }

        return $row;
    }

    public function create(array $data): int
    {
        $stmt = $this->db->prepare(
            'INSERT INTO merchants
             (shopify_domain, shopify_store_id, access_token, plan,
              api_key, api_secret, billing_cycle_start, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $data['shopify_domain'],
            $data['shopify_store_id'],
            $data['access_token'],
            $data['plan'] ?? 'basic',
            $data['api_key'],
            $data['api_secret'],
            $data['billing_cycle_start'] ?? date('Y-m-d'),
            $data['is_active'] ?? 1,
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function updatePlan(int $id, string $plan): void
    {
        $stmt = $this->db->prepare(
            'UPDATE merchants SET plan = ? WHERE id = ?'
        );
        $stmt->execute([$plan, $id]);
    }

    public function incrementTryonCount(int $id): void
    {
        $stmt = $this->db->prepare(
            'UPDATE merchants SET tryon_count_month = tryon_count_month + 1 WHERE id = ?'
        );
        $stmt->execute([$id]);
    }

    public function resetMonthlyCount(int $id): void
    {
        $stmt = $this->db->prepare(
            'UPDATE merchants
             SET tryon_count_month = 0, billing_cycle_start = CURDATE()
             WHERE id = ?'
        );
        $stmt->execute([$id]);
    }
}
