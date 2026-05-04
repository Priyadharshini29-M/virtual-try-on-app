<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\Database;
use TryFit\Middleware\ApiKeyAuth;

/**
 * GET  /settings  — returns all widget config fields the JSX settings page reads.
 * POST /settings  — full-replace save of all fields sent by handleSave() in settings.jsx.
 *
 * Field-name contract (JSX ↔ PHP response):
 *   DB `button_text`  ←→ JSX `widget_title`   (aliased in response, mapped in save)
 *   All other DB column names match JSX keys exactly.
 */
class SettingsController
{
    public function get(): void
    {
        $merchant = ApiKeyAuth::handle();
        $db       = Database::getInstance();

        $stmt = $db->prepare('SELECT * FROM merchant_settings WHERE merchant_id = ? LIMIT 1');
        $stmt->execute([(int)$merchant['id']]);
        $row = $stmt->fetch();

        respondJson($this->toResponse(
            $row !== false ? $row : [],
            (int)$merchant['id']
        ));
    }

    public function save(): void
    {
        $merchant = ApiKeyAuth::handle();
        $db       = Database::getInstance();
        $mid      = (int)$merchant['id'];
        $body     = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

        $f = $this->sanitize($body);

        // Build dynamic UPSERT so the query never needs updating when columns change
        $cols         = implode(', ', array_keys($f));
        $placeholders = implode(', ', array_fill(0, count($f), '?'));
        $updates      = implode(', ', array_map(fn($c) => "{$c} = VALUES({$c})", array_keys($f)));

        $db->prepare(
            "INSERT INTO merchant_settings (merchant_id, {$cols})
             VALUES (?, {$placeholders})
             ON DUPLICATE KEY UPDATE {$updates}"
        )->execute(array_merge([$mid], array_values($f)));

        $sel = $db->prepare('SELECT * FROM merchant_settings WHERE merchant_id = ? LIMIT 1');
        $sel->execute([$mid]);
        respondJson($this->toResponse($sel->fetch(), $mid));
    }

    // -------------------------------------------------------------------------

    /** Maps DB row → JSX-compatible response shape. */
    private function toResponse(array $s, int $merchantId): array
    {
        $d = AppConfig::WIDGET_DEFAULTS;
        return [
            'merchant_id'            => $merchantId,
            // JSX reads settings?.widget_title  (stored in DB as button_text)
            'widget_title'           => $s['button_text']           ?? $d['button_text'],
            'widget_subtitle'        => $s['widget_subtitle']        ?? $d['widget_subtitle'],
            'button_color'           => $s['button_color']           ?? $d['button_color'],
            'button_text_color'      => $s['button_text_color']      ?? $d['button_text_color'],
            'button_border_radius'   => (int)($s['button_border_radius']   ?? $d['button_border_radius']),
            'hover_bg_color'         => $s['hover_bg_color']         ?? $d['hover_bg_color'],
            'button_width'           => (int)($s['button_width']           ?? $d['button_width']),
            'button_height'          => (int)($s['button_height']          ?? $d['button_height']),
            'button_padding_top'     => (int)($s['button_padding_top']     ?? $d['button_padding_top']),
            'button_padding_right'   => (int)($s['button_padding_right']   ?? $d['button_padding_right']),
            'button_padding_bottom'  => (int)($s['button_padding_bottom']  ?? $d['button_padding_bottom']),
            'button_padding_left'    => (int)($s['button_padding_left']    ?? $d['button_padding_left']),
            'button_margin_top'      => (int)($s['button_margin_top']      ?? $d['button_margin_top']),
            'button_margin_right'    => (int)($s['button_margin_right']    ?? $d['button_margin_right']),
            'button_margin_bottom'   => (int)($s['button_margin_bottom']   ?? $d['button_margin_bottom']),
            'button_margin_left'     => (int)($s['button_margin_left']     ?? $d['button_margin_left']),
            'title_font_size'        => (int)($s['title_font_size']        ?? $d['title_font_size']),
            'subtitle_font_size'     => (int)($s['subtitle_font_size']     ?? $d['subtitle_font_size']),
            'title_font_weight'      => $s['title_font_weight']      ?? $d['title_font_weight'],
            'title_font_family'      => $s['title_font_family']      ?? $d['title_font_family'],
            'subtitle_font_family'   => $s['subtitle_font_family']   ?? $d['subtitle_font_family'],
            'widget_language'        => $s['widget_language']        ?? $d['widget_language'],
            'button_icon'            => $s['button_icon']            ?? $d['button_icon'],
            'icon_color'             => $s['icon_color']             ?? $d['icon_color'],
            'main_icon_bg_color'     => $s['main_icon_bg_color']     ?? $d['main_icon_bg_color'],
            'coll_icon_bg_color'     => $s['coll_icon_bg_color']     ?? $d['coll_icon_bg_color'],
            'icon_size'              => (int)($s['icon_size']              ?? $d['icon_size']),
            'icon_radius'            => (int)($s['icon_radius']            ?? $d['icon_radius']),
            'icon_shape'             => $s['icon_shape']             ?? $d['icon_shape'],
            'icon_opacity'           => (int)($s['icon_opacity']           ?? $d['icon_opacity']),
            'show_on_collection'     => (bool)($s['show_on_collection']    ?? $d['show_on_collection']),
            'collection_position'    => $s['collection_position']    ?? $d['collection_position'],
            'share_whatsapp_enabled' => (bool)($s['share_whatsapp_enabled'] ?? $d['share_whatsapp_enabled']),
            'save_image_enabled'     => (bool)($s['save_image_enabled']    ?? $d['save_image_enabled']),
            'privacy_notice_shown'   => (bool)($s['privacy_notice_shown']  ?? $d['privacy_notice_shown']),
        ];
    }

    /** Validates and normalises the JSX POST body → DB column map. */
    private function sanitize(array $b): array
    {
        $d = AppConfig::WIDGET_DEFAULTS;
        return [
            // JSX sends widget_title → stored in DB as button_text
            'button_text'            => substr(trim((string)($b['widget_title']        ?? $d['button_text'])), 0, 100),
            'widget_subtitle'        => substr(trim((string)($b['widget_subtitle']     ?? $d['widget_subtitle'])), 0, 200),
            'button_color'           => $this->hex($b['button_color']         ?? '', $d['button_color']),
            'button_text_color'      => $this->hex($b['button_text_color']    ?? '', $d['button_text_color']),
            'button_border_radius'   => $this->clamp((int)($b['button_border_radius']  ?? $d['button_border_radius']), 0, 100),
            'hover_bg_color'         => $this->hex($b['hover_bg_color']       ?? '', $d['hover_bg_color']),
            'button_width'           => $this->clamp((int)($b['button_width']          ?? $d['button_width']), 0, 800),
            'button_height'          => $this->clamp((int)($b['button_height']         ?? $d['button_height']), 0, 200),
            'button_padding_top'     => $this->clamp((int)($b['button_padding_top']    ?? $d['button_padding_top']), 0, 200),
            'button_padding_right'   => $this->clamp((int)($b['button_padding_right']  ?? $d['button_padding_right']), 0, 200),
            'button_padding_bottom'  => $this->clamp((int)($b['button_padding_bottom'] ?? $d['button_padding_bottom']), 0, 200),
            'button_padding_left'    => $this->clamp((int)($b['button_padding_left']   ?? $d['button_padding_left']), 0, 200),
            'button_margin_top'      => $this->clamp((int)($b['button_margin_top']     ?? $d['button_margin_top']), 0, 200),
            'button_margin_right'    => $this->clamp((int)($b['button_margin_right']   ?? $d['button_margin_right']), 0, 200),
            'button_margin_bottom'   => $this->clamp((int)($b['button_margin_bottom']  ?? $d['button_margin_bottom']), 0, 200),
            'button_margin_left'     => $this->clamp((int)($b['button_margin_left']    ?? $d['button_margin_left']), 0, 200),
            'title_font_size'        => $this->clamp((int)($b['title_font_size']       ?? $d['title_font_size']), 8, 72),
            'subtitle_font_size'     => $this->clamp((int)($b['subtitle_font_size']    ?? $d['subtitle_font_size']), 8, 48),
            'title_font_weight'      => substr((string)($b['title_font_weight']        ?? $d['title_font_weight']), 0, 10),
            'title_font_family'      => substr((string)($b['title_font_family']        ?? $d['title_font_family']), 0, 100),
            'subtitle_font_family'   => substr((string)($b['subtitle_font_family']     ?? $d['subtitle_font_family']), 0, 100),
            'widget_language'        => substr(trim((string)($b['widget_language']     ?? $d['widget_language'])), 0, 10),
            'button_icon'            => $this->enum($b['button_icon']        ?? '', AppConfig::BUTTON_ICONS, $d['button_icon']),
            'icon_color'             => $this->hex($b['icon_color']          ?? '', $d['icon_color']),
            'main_icon_bg_color'     => $this->color($b['main_icon_bg_color'] ?? '', $d['main_icon_bg_color']),
            'coll_icon_bg_color'     => $this->color($b['coll_icon_bg_color'] ?? '', $d['coll_icon_bg_color']),
            'icon_size'              => $this->clamp((int)($b['icon_size']             ?? $d['icon_size']), 8, 48),
            'icon_radius'            => $this->clamp((int)($b['icon_radius']           ?? $d['icon_radius']), 0, 32),
            'icon_shape'             => $this->enum($b['icon_shape']         ?? '', AppConfig::ICON_SHAPES, $d['icon_shape']),
            'icon_opacity'           => $this->clamp((int)($b['icon_opacity']          ?? $d['icon_opacity']), 0, 100),
            'show_on_collection'     => (int)(bool)($b['show_on_collection']  ?? $d['show_on_collection']),
            'collection_position'    => $this->enum($b['collection_position'] ?? '', AppConfig::COLLECTION_POSITIONS, $d['collection_position']),
            'share_whatsapp_enabled' => (int)(bool)($b['share_whatsapp_enabled'] ?? $d['share_whatsapp_enabled']),
            'save_image_enabled'     => (int)(bool)($b['save_image_enabled']    ?? $d['save_image_enabled']),
            'privacy_notice_shown'   => (int)(bool)($b['privacy_notice_shown']  ?? $d['privacy_notice_shown']),
        ];
    }

    private function hex(string $v, string $fallback): string
    {
        $v = trim($v);
        return preg_match('/^#[0-9A-Fa-f]{6}$/', $v) ? $v : $fallback;
    }

    /** Accepts a hex colour OR the literal "transparent". */
    private function color(string $v, string $fallback): string
    {
        $v = trim($v);
        if ($v === 'transparent') return 'transparent';
        return preg_match('/^#[0-9A-Fa-f]{6}$/', $v) ? $v : $fallback;
    }

    private function clamp(int $v, int $min, int $max): int
    {
        return max($min, min($max, $v));
    }

    private function enum(string $v, array $allowed, string $fallback): string
    {
        return in_array($v, $allowed, true) ? $v : $fallback;
    }
}
