<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;
use TryFit\AppConfig;

class WidgetSettingsRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Returns the widget_config JSON for the merchant.
     * Inserts a default row if none exists yet.
     */
    public function getButtonConfig(int $merchantId): array
    {
        $row = $this->fetchRow($merchantId);
        if ($row === null) {
            $this->insertDefaults($merchantId);
            $row = $this->fetchRow($merchantId);
        }
        $config = isset($row['widget_config']) && $row['widget_config'] ? json_decode($row['widget_config'], true) : [];
        $config['shop_id'] = $merchantId;
        return $config;
    }

    /**
     * Returns products_json and enabled_products for the merchant.
     */
    public function getProductsData(int $merchantId): array
    {
        $row = $this->fetchRow($merchantId);
        // Return null (not []) when the enabled_products column is absent or NULL.
        // Callers must distinguish "no data available" (null) from "zero products enabled" ([]).
        $rawEnabled = $row['enabled_products'] ?? null;
        $decoded    = $rawEnabled !== null ? json_decode($rawEnabled, true) : null;
        return [
            'products'         => json_decode($row['products_json'] ?? 'null', true) ?? [],
            'enabled_products' => $decoded,
        ];
    }

    /**
     * Merges $fields into the existing widget_config (partial update).
     * Uses a simple single-table UPDATE — no JOIN required.
     */
    public function patchButtonConfig(int $merchantId, array $fields): array
    {
        // Read existing config (creates default row if absent)
        $existing = $this->getButtonConfig($merchantId);
        unset($existing['shop_id']); // strip internal key before storing

        // Merge: incoming fields overwrite matching keys, existing keys are kept
        $merged = array_merge($existing, $fields);

        $json = json_encode(
            $merged,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        );

        // UPSERT — handles the rare case where insertDefaults was skipped
        $stmt = $this->db->prepare(
            "INSERT INTO merchant_settings (merchant_id, widget_config)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE widget_config = VALUES(widget_config)"
        );
        $stmt->execute([$merchantId, $json]);

        return $this->getButtonConfig($merchantId);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private function fetchRow(int $merchantId): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM merchant_settings WHERE merchant_id = ? LIMIT 1'
        );
        $stmt->execute([$merchantId]);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    private function insertDefaults(int $merchantId): void
    {
        $d = AppConfig::WIDGET_DEFAULTS;

        // Store widget_title alongside button_text so both read paths work immediately
        $defaults = array_merge($d, ['widget_title' => $d['button_text']]);

        // Look up domain from merchants table to populate the columns
        $merchant = $this->db->prepare('SELECT shopify_domain, shopify_store_id FROM merchants WHERE id = ? LIMIT 1');
        $merchant->execute([$merchantId]);
        $m = $merchant->fetch() ?: [];

        $this->db->prepare(
            'INSERT IGNORE INTO merchant_settings
             (merchant_id, shopify_domain, shopify_store_id, widget_config)
             VALUES (?, ?, ?, ?)'
        )->execute([
            $merchantId,
            $m['shopify_domain'] ?? null,
            $m['shopify_store_id'] ?? null,
            json_encode($defaults, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
    }
}
