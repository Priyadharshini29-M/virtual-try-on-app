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
        // `plan` and `billing_cycle_start` still exist on the merchants table
        // but no longer gate anything — set them to safe defaults so legacy
        // rows and admin dashboards keep parsing. The wallet is seeded by
        // the migration (015_wallet_credits.sql).
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
        $id = (int)$this->db->lastInsertId();

        // Welcome bonus mirrors the migration (015_wallet_credits.sql) so
        // every new install starts with 25 credits.
        try {
            (new WalletRepo())->credit($id, 25, 'welcome_bonus', null, null, 'New install welcome bonus');
        } catch (\Throwable $e) {
            error_log('[FitFyce] welcome bonus failed for merchant ' . $id . ': ' . $e->getMessage());
        }

        return $id;
    }

    public function setSizeChartEnabled(int $id, bool $enabled): void
    {
        $stmt = $this->db->prepare('UPDATE merchants SET size_chart_enabled = ? WHERE id = ?');
        $stmt->execute([(int)$enabled, $id]);
    }

    public function setCompleteLookEnabled(int $id, bool $enabled): void
    {
        $stmt = $this->db->prepare('UPDATE merchants SET complete_look_enabled = ? WHERE id = ?');
        $stmt->execute([(int)$enabled, $id]);
    }

    /**
     * Current stored locale for a merchant, or null if either the merchant row
     * or the locale column is missing. Safe to call before the migration has
     * run — returns null and the caller falls through the detection chain.
     */
    public function getLocale(string $shopDomain): ?string
    {
        try {
            $stmt = $this->db->prepare(
                'SELECT locale FROM merchants WHERE shopify_domain = ? LIMIT 1'
            );
            $stmt->execute([$shopDomain]);
            $val = $stmt->fetchColumn();
            return (is_string($val) && $val !== '') ? $val : null;
        } catch (\Throwable $e) {
            // Column may not exist yet (pre-migration) — fall through silently.
            return null;
        }
    }

    public function setLocale(string $shopDomain, string $locale): void
    {
        $stmt = $this->db->prepare(
            'UPDATE merchants SET locale = ? WHERE shopify_domain = ?'
        );
        $stmt->execute([$locale, $shopDomain]);
    }

    public function setDetectedCountry(string $shopDomain, string $cc): void
    {
        $stmt = $this->db->prepare(
            'UPDATE merchants SET locale_detected_country = ? WHERE shopify_domain = ?'
        );
        $stmt->execute([strtoupper($cc), $shopDomain]);
    }

    /**
     * Cached IP-derived country for the merchant. Null if we've never looked
     * it up, or the column doesn't exist (pre-migration).
     */
    public function getDetectedCountry(string $shopDomain): ?string
    {
        try {
            $stmt = $this->db->prepare(
                'SELECT locale_detected_country FROM merchants WHERE shopify_domain = ? LIMIT 1'
            );
            $stmt->execute([$shopDomain]);
            $val = $stmt->fetchColumn();
            return (is_string($val) && $val !== '') ? strtoupper($val) : null;
        } catch (\Throwable $e) {
            return null;
        }
    }
}
