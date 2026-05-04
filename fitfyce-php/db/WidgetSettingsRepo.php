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
     * Returns the merchant_settings row for the merchant.
     * Inserts a default row if none exists yet.
     * Adds a synthetic 'shop_id' key (= merchant_id) that WidgetController reads.
     */
    public function getButtonConfig(int $merchantId): array
    {
        $row = $this->fetchRow($merchantId);

        if ($row === null) {
            $this->insertDefaults($merchantId);
            $row = $this->fetchRow($merchantId);
        }

        $row['shop_id'] = $merchantId;
        return $row;
    }

    /**
     * Patches only the supplied fields and returns the updated row.
     */
    public function patchButtonConfig(int $merchantId, array $fields): array
    {
        // Ensure a row exists
        $this->getButtonConfig($merchantId);

        if (!empty($fields)) {
            $set  = implode(', ', array_map(fn($col) => "{$col} = ?", array_keys($fields)));
            $stmt = $this->db->prepare(
                "UPDATE merchant_settings SET {$set} WHERE merchant_id = ?"
            );
            $stmt->execute(array_merge(array_values($fields), [$merchantId]));
        }

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
        $this->db->prepare(
            'INSERT IGNORE INTO merchant_settings
             (merchant_id, button_text, widget_subtitle,
              button_color, button_text_color, hover_bg_color,
              button_border_radius, button_icon, icon_color,
              show_on_collection, collection_position, widget_language)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $merchantId,
            $d['button_text'],
            $d['widget_subtitle'],
            $d['button_color'],
            $d['button_text_color'],
            $d['hover_bg_color'],
            $d['button_border_radius'],
            $d['button_icon'],
            $d['icon_color'],
            $d['show_on_collection'] ? 1 : 0,
            $d['collection_position'],
            $d['widget_language'],
        ]);
    }
}
