<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Admin\View;
use TryFit\AppConfig;
use TryFit\Db\Database;
use TryFit\Middleware\AdminSession;

/**
 * Widget settings page — stores a JSON blob in merchant_settings.widget_config.
 * Everything the merchant sees is driven by AppConfig::WIDGET_DEFAULTS (the
 * canonical schema); values posted back are validated against that key set,
 * so adding a new field only means editing the defaults constant and the
 * view, never this controller.
 */
class AdminSettingsController
{
    public function show(): void
    {
        $merchant = AdminSession::require();
        $pdo      = Database::getInstance();
        $id       = (int)$merchant['id'];

        $stmt = $pdo->prepare('SELECT widget_config FROM merchant_settings WHERE merchant_id = ? LIMIT 1');
        $stmt->execute([$id]);
        $raw = $stmt->fetchColumn();
        $stored = [];
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) $stored = $decoded;
        }
        $settings = array_merge(AppConfig::WIDGET_DEFAULTS, $stored);

        View::render('settings', [
            'merchant' => $merchant,
            'settings' => $settings,
            'flash'    => $_GET['saved'] ?? null,
        ], 'settings', 'Widget Settings · Brix-TryOn');
    }

    public function save(): void
    {
        $merchant = AdminSession::require();
        $pdo      = Database::getInstance();
        $id       = (int)$merchant['id'];

        $incoming = $_POST;
        $out = [];
        foreach (AppConfig::WIDGET_DEFAULTS as $key => $default) {
            if (is_bool($default) || is_int($default)) {
                // Checkboxes don't post when unchecked, so default-off booleans
                // need the explicit absence-means-0 treatment.
                $v = $incoming[$key] ?? ((is_int($default) && $default === 0) ? '0' : '');
                $out[$key] = (int)!empty($v) ? 1 : 0;
                if (is_int($default) && $default > 1) {
                    $out[$key] = isset($incoming[$key]) ? (int)$incoming[$key] : $default;
                }
            } else {
                $out[$key] = isset($incoming[$key]) ? (string)$incoming[$key] : (string)$default;
            }
        }

        $json = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        // Upsert — merchant_settings is unique per merchant_id.
        $existing = $pdo->prepare('SELECT id FROM merchant_settings WHERE merchant_id = ? LIMIT 1');
        $existing->execute([$id]);
        $hit = $existing->fetchColumn();
        if ($hit === false) {
            $pdo->prepare('INSERT INTO merchant_settings (merchant_id, shopify_domain, widget_config) VALUES (?, ?, ?)')
                ->execute([$id, (string)($merchant['shopify_domain'] ?? ''), $json]);
        } else {
            $pdo->prepare('UPDATE merchant_settings SET widget_config = ? WHERE id = ?')
                ->execute([$json, (int)$hit]);
        }

        header('Location: ' . AppConfig::adminBaseUrl() . '/admin/settings?saved=1', true, 303);
        exit;
    }
}
