<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\WidgetSettingsRepo;
use TryFit\Middleware\ApiKeyAuth;

class WidgetController
{
    /**
     * GET /widget/settings
     * Returns shop_id + full button_config object (all fields).
     */
    public function get(): void
    {
        $merchant = ApiKeyAuth::handle();
        $repo     = new WidgetSettingsRepo();
        $row      = $repo->getButtonConfig((int)$merchant['id']);

        respondJson([
            'shop_id'       => (int)$row['shop_id'],
            'button_config' => $this->formatConfig($row),
        ]);
    }

    /**
     * PATCH /widget/settings
     * Accepts any subset of config fields — only those fields are written.
     */
    public function patch(): void
    {
        $merchant = ApiKeyAuth::handle();
        $body     = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

        $fields = $this->sanitizeFields($body);

        if (empty($fields)) {
            respondJson(['error' => 'No valid fields provided'], 400);
        }

        $repo = new WidgetSettingsRepo();
        $row  = $repo->patchButtonConfig((int)$merchant['id'], $fields);

        respondJson([
            'shop_id'       => (int)$row['shop_id'],
            'button_config' => $this->formatConfig($row),
        ]);
    }

    // -------------------------------------------------------------------------

    private function sanitizeFields(array $b): array
    {
        $out = [];
        $d   = AppConfig::WIDGET_DEFAULTS;

        if (array_key_exists('button_text', $b)) {
            $v = trim((string)$b['button_text']);
            if ($v !== '') $out['button_text'] = substr($v, 0, 100);
        }
        if (array_key_exists('widget_subtitle', $b)) {
            $out['widget_subtitle'] = substr(trim((string)$b['widget_subtitle']), 0, 200);
        }
        foreach (['button_color', 'button_text_color', 'hover_bg_color', 'icon_color'] as $f) {
            if (array_key_exists($f, $b)) {
                $v = $this->hex((string)$b[$f]);
                if ($v !== null) $out[$f] = $v;
            }
        }
        foreach (['main_icon_bg_color', 'coll_icon_bg_color'] as $f) {
            if (array_key_exists($f, $b)) {
                $v = $this->color((string)$b[$f]);
                if ($v !== null) $out[$f] = $v;
            }
        }
        foreach ([
            'button_border_radius'  => [0,  100],
            'button_width'          => [0,  800],
            'button_height'         => [0,  200],
            'button_padding_top'    => [0,  200],
            'button_padding_right'  => [0,  200],
            'button_padding_bottom' => [0,  200],
            'button_padding_left'   => [0,  200],
            'button_margin_top'     => [0,  200],
            'button_margin_right'   => [0,  200],
            'button_margin_bottom'  => [0,  200],
            'button_margin_left'    => [0,  200],
            'title_font_size'       => [8,   72],
            'subtitle_font_size'    => [8,   48],
            'icon_size'             => [8,   48],
            'icon_radius'           => [0,   32],
            'icon_opacity'          => [0,  100],
        ] as $f => [$min, $max]) {
            if (array_key_exists($f, $b)) {
                $out[$f] = max($min, min($max, (int)$b[$f]));
            }
        }
        foreach (['title_font_weight', 'title_font_family', 'subtitle_font_family'] as $f) {
            if (array_key_exists($f, $b) && trim((string)$b[$f]) !== '') {
                $out[$f] = substr(trim((string)$b[$f]), 0, 100);
            }
        }
        if (array_key_exists('widget_language', $b) && trim((string)$b['widget_language']) !== '') {
            $out['widget_language'] = substr(trim((string)$b['widget_language']), 0, 10);
        }
        if (array_key_exists('button_icon', $b) && in_array($b['button_icon'], AppConfig::BUTTON_ICONS, true)) {
            $out['button_icon'] = $b['button_icon'];
        }
        if (array_key_exists('icon_shape', $b) && in_array($b['icon_shape'], AppConfig::ICON_SHAPES, true)) {
            $out['icon_shape'] = $b['icon_shape'];
        }
        if (array_key_exists('collection_position', $b) && in_array($b['collection_position'], AppConfig::COLLECTION_POSITIONS, true)) {
            $out['collection_position'] = $b['collection_position'];
        }
        foreach (['show_on_collection', 'show_watermark', 'share_whatsapp_enabled', 'save_image_enabled', 'privacy_notice_shown'] as $f) {
            if (array_key_exists($f, $b)) {
                $out[$f] = (int)(bool)$b[$f];
            }
        }

        return $out;
    }

    private function formatConfig(array $row): array
    {
        $d = AppConfig::WIDGET_DEFAULTS;
        return [
            'button_text'            => $row['button_text']           ?? $d['button_text'],
            'widget_subtitle'        => $row['widget_subtitle']        ?? $d['widget_subtitle'],
            'button_color'           => $row['button_color']           ?? $d['button_color'],
            'button_text_color'      => $row['button_text_color']      ?? $d['button_text_color'],
            'button_border_radius'   => (int)($row['button_border_radius']   ?? $d['button_border_radius']),
            'hover_bg_color'         => $row['hover_bg_color']         ?? $d['hover_bg_color'],
            'button_width'           => (int)($row['button_width']           ?? $d['button_width']),
            'button_height'          => (int)($row['button_height']          ?? $d['button_height']),
            'button_padding_top'     => (int)($row['button_padding_top']     ?? $d['button_padding_top']),
            'button_padding_right'   => (int)($row['button_padding_right']   ?? $d['button_padding_right']),
            'button_padding_bottom'  => (int)($row['button_padding_bottom']  ?? $d['button_padding_bottom']),
            'button_padding_left'    => (int)($row['button_padding_left']    ?? $d['button_padding_left']),
            'button_margin_top'      => (int)($row['button_margin_top']      ?? $d['button_margin_top']),
            'button_margin_right'    => (int)($row['button_margin_right']    ?? $d['button_margin_right']),
            'button_margin_bottom'   => (int)($row['button_margin_bottom']   ?? $d['button_margin_bottom']),
            'button_margin_left'     => (int)($row['button_margin_left']     ?? $d['button_margin_left']),
            'title_font_size'        => (int)($row['title_font_size']        ?? $d['title_font_size']),
            'subtitle_font_size'     => (int)($row['subtitle_font_size']     ?? $d['subtitle_font_size']),
            'title_font_weight'      => $row['title_font_weight']      ?? $d['title_font_weight'],
            'title_font_family'      => $row['title_font_family']      ?? $d['title_font_family'],
            'subtitle_font_family'   => $row['subtitle_font_family']   ?? $d['subtitle_font_family'],
            'widget_language'        => $row['widget_language']        ?? $d['widget_language'],
            'button_icon'            => $row['button_icon']            ?? $d['button_icon'],
            'icon_color'             => $row['icon_color']             ?? $d['icon_color'],
            'main_icon_bg_color'     => $row['main_icon_bg_color']     ?? $d['main_icon_bg_color'],
            'coll_icon_bg_color'     => $row['coll_icon_bg_color']     ?? $d['coll_icon_bg_color'],
            'icon_size'              => (int)($row['icon_size']              ?? $d['icon_size']),
            'icon_radius'            => (int)($row['icon_radius']            ?? $d['icon_radius']),
            'icon_shape'             => $row['icon_shape']             ?? $d['icon_shape'],
            'icon_opacity'           => (int)($row['icon_opacity']           ?? $d['icon_opacity']),
            'show_on_collection'     => (bool)($row['show_on_collection']    ?? $d['show_on_collection']),
            'collection_position'    => $row['collection_position']    ?? $d['collection_position'],
            'show_watermark'         => (bool)($row['show_watermark']        ?? $d['show_watermark']),
            'share_whatsapp_enabled' => (bool)($row['share_whatsapp_enabled'] ?? $d['share_whatsapp_enabled']),
            'save_image_enabled'     => (bool)($row['save_image_enabled']    ?? $d['save_image_enabled']),
            'privacy_notice_shown'   => (bool)($row['privacy_notice_shown']  ?? $d['privacy_notice_shown']),
        ];
    }

    private function hex(string $v): ?string
    {
        $v = trim($v);
        return preg_match('/^#[0-9A-Fa-f]{6}$/', $v) ? $v : null;
    }

    private function color(string $v): ?string
    {
        $v = trim($v);
        if ($v === 'transparent') return 'transparent';
        return preg_match('/^#[0-9A-Fa-f]{6}$/', $v) ? $v : null;
    }
}
