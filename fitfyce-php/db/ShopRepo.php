<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

class ShopRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public function getShopInfo(int $merchantId): ?array
    {
        $stmt = $this->db->prepare(
            "SELECT
                id                                                          AS shop_id,
                shopify_domain                                              AS shop_domain,
                CASE WHEN is_active = 1 THEN 'enabled' ELSE 'disabled' END AS app_status,
                plan                                                        AS app_plan,
                shopify_plan,
                installed_theme_name,
                installed_theme_id,
                created_at                                                  AS enabled_at,
                updated_at                                                  AS updated_app
             FROM merchants
             WHERE id = ?
             LIMIT 1"
        );
        $stmt->execute([$merchantId]);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    /**
     * Persist shopify_plan / installed_theme_* fetched from Shopify API.
     * Only columns present in $data are touched.
     */
    public function updateShopMeta(int $merchantId, array $data): void
    {
        $allowed = ['shopify_plan', 'installed_theme_name', 'installed_theme_id'];
        $sets    = [];
        $params  = [];

        foreach ($allowed as $col) {
            if (array_key_exists($col, $data)) {
                $sets[]   = "{$col} = ?";
                $params[] = $data[$col];
            }
        }

        if (empty($sets)) {
            return;
        }

        $params[] = $merchantId;
        $this->db->prepare(
            'UPDATE merchants SET ' . implode(', ', $sets) . ' WHERE id = ?'
        )->execute($params);
    }
}
