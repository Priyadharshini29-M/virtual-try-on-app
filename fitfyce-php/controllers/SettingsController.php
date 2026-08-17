<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\WidgetSettingsRepo;
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
        try {
            $merchant = ApiKeyAuth::handle();
            $repo     = new WidgetSettingsRepo();
            $config   = $repo->getButtonConfig((int)$merchant['id']);
            respondJson($this->toResponse($config, (int)$merchant['id']));
        } catch (\Throwable $e) {
            error_log("[FitSnap Settings] GET error: " . $e->getMessage());
            respondJson(['error' => 'Failed to load settings: ' . $e->getMessage()], 500);
        }
    }

    public function save(): void
    {
        try {
            $merchant = ApiKeyAuth::handle();
            $mid      = (int)$merchant['id'];

            $input = (string)file_get_contents('php://input');
            error_log("[FitSnap Settings] POST /settings | merchant=$mid | body_len=" . strlen($input));

            if (trim($input) === '') {
                respondJson(['error' => 'Empty request body'], 400);
                return;
            }

            $decoded = json_decode($input, true);
            if (!is_array($decoded)) {
                respondJson(['error' => 'Invalid JSON body'], 400);
                return;
            }
            $body = $decoded;

            if ($mid === 0) {
                error_log("[FitSnap Settings] Error: Merchant not identified (master key used)");
                respondJson(['error' => 'Cannot save settings: merchant not identified'], 400);
                return;
            }

            // Flatten the nested 'css' object so widget_config uses a flat key structure.
            // Also strip the key entirely if it arrived as a non-array string (e.g. "[object Object]"
            // from a FormData serialisation bug) so it is never persisted to widget_config.
            if (isset($body['css'])) {
                if (is_array($body['css'])) {
                    foreach ($body['css'] as $k => $v) {
                        $body[$k] = $v;
                    }
                }
                unset($body['css']);
            }

            // Keep button_text in sync with widget_title so both read paths always work
            if (isset($body['widget_title']) && trim((string)$body['widget_title']) !== '') {
                $body['button_text'] = $body['widget_title'];
            }

            // Strip non-config keys before storing
            unset($body['shopify_domain'], $body['shop_id']);

            $repo   = new WidgetSettingsRepo();
            $result = $repo->patchButtonConfig($mid, $body);

            error_log("[FitSnap Settings] Saved OK for merchant $mid");
            respondJson(array_merge(['ok' => true], $this->toResponse($result, $mid)));
        } catch (\Throwable $e) {
            $class = get_class($e);
            error_log("[FitSnap Settings] ERROR ($class): " . $e->getMessage()
                . " | file=" . $e->getFile() . ":" . $e->getLine());
            respondJson(['error' => 'Save failed: ' . $e->getMessage()], 500);
        }
    }

    // -------------------------------------------------------------------------

    /** Maps DB row → JSX-compatible response shape. */
    private function toResponse(array $s, int $merchantId): array
    {
        $d = AppConfig::WIDGET_DEFAULTS;
        // Support both flat (new) and nested-css (legacy) storage formats
        $css = array_merge((array)($s['css'] ?? []), $s);

        return [
            'merchant_id'            => $merchantId,
            'widget_title'           => $css['widget_title'] ?? $css['button_text'] ?? $d['button_text'],
            'widget_subtitle'        => $css['widget_subtitle']        ?? $d['widget_subtitle'],
            'button_color'           => $css['button_color']           ?? $d['button_color'],
            'button_text_color'      => $css['button_text_color']      ?? $d['button_text_color'],
            'button_border_radius'   => (int)($css['button_border_radius']   ?? $d['button_border_radius']),
            'hover_bg_color'         => $css['hover_bg_color']         ?? $d['hover_bg_color'],
            'button_width'           => (int)($css['button_width']           ?? $d['button_width']),
            'button_height'          => (int)($css['button_height']          ?? $d['button_height']),
            'button_padding_top'     => (int)($css['button_padding_top']     ?? $d['button_padding_top']),
            'button_padding_right'   => (int)($css['button_padding_right']   ?? $d['button_padding_right']),
            'button_padding_bottom'  => (int)($css['button_padding_bottom']  ?? $d['button_padding_bottom']),
            'button_padding_left'    => (int)($css['button_padding_left']    ?? $d['button_padding_left']),
            'button_margin_top'      => (int)($css['button_margin_top']      ?? $d['button_margin_top']),
            'button_margin_right'    => (int)($css['button_margin_right']    ?? $d['button_margin_right']),
            'button_margin_bottom'   => (int)($css['button_margin_bottom']   ?? $d['button_margin_bottom']),
            'button_margin_left'     => (int)($css['button_margin_left']     ?? $d['button_margin_left']),
            'title_font_size'        => (int)($css['title_font_size']        ?? $d['title_font_size']),
            'subtitle_font_size'     => (int)($css['subtitle_font_size']     ?? $d['subtitle_font_size']),
            'title_font_weight'      => $css['title_font_weight']      ?? $d['title_font_weight'],
            'title_font_family'      => $css['title_font_family']      ?? $d['title_font_family'],
            'subtitle_font_family'   => $css['subtitle_font_family']   ?? $d['subtitle_font_family'],
            // Per-view font sizes
            'desktop_title_font_size' => (int)($css['desktop_title_font_size'] ?? $css['title_font_size'] ?? $d['title_font_size']),
            'mobile_title_font_size'  => (int)($css['mobile_title_font_size']  ?? 14),
            // Per-view padding
            'desktop_padding_top'    => (int)($css['desktop_padding_top']    ?? $css['button_padding_top']    ?? $d['button_padding_top']),
            'desktop_padding_right'  => (int)($css['desktop_padding_right']  ?? $css['button_padding_right']  ?? $d['button_padding_right']),
            'desktop_padding_bottom' => (int)($css['desktop_padding_bottom'] ?? $css['button_padding_bottom'] ?? $d['button_padding_bottom']),
            'desktop_padding_left'   => (int)($css['desktop_padding_left']   ?? $css['button_padding_left']   ?? $d['button_padding_left']),
            'mobile_padding_top'     => (int)($css['mobile_padding_top']     ?? 8),
            'mobile_padding_right'   => (int)($css['mobile_padding_right']   ?? 16),
            'mobile_padding_bottom'  => (int)($css['mobile_padding_bottom']  ?? 8),
            'mobile_padding_left'    => (int)($css['mobile_padding_left']    ?? 16),
            // Per-view widget dimensions
            'desktop_widget_width'       => (int)($css['desktop_widget_width']       ?? $css['button_width']  ?? 0),
            'desktop_widget_width_unit'  => $css['desktop_widget_width_unit']  ?? 'px',
            'desktop_widget_height'      => (int)($css['desktop_widget_height']      ?? $css['button_height'] ?? 0),
            'desktop_widget_height_unit' => $css['desktop_widget_height_unit'] ?? 'px',
            'mobile_widget_width'        => (int)($css['mobile_widget_width']        ?? 100),
            'mobile_widget_width_unit'   => $css['mobile_widget_width_unit']   ?? '%',
            'mobile_widget_height'       => (int)($css['mobile_widget_height']       ?? 0),
            'mobile_widget_height_unit'  => $css['mobile_widget_height_unit']  ?? 'auto',
            'widget_language'        => $css['widget_language']        ?? $d['widget_language'],
            'button_icon'            => $css['button_icon']            ?? $d['button_icon'],
            'icon_color'             => $css['icon_color']             ?? $d['icon_color'],
            'main_icon_bg_color'     => $css['main_icon_bg_color']     ?? $d['main_icon_bg_color'],
            'coll_icon_bg_color'     => $css['coll_icon_bg_color']     ?? $d['coll_icon_bg_color'],
            'icon_size'              => (int)($css['icon_size']              ?? $d['icon_size']),
            'icon_radius'            => (int)($css['icon_radius']            ?? $d['icon_radius']),
            'icon_shape'             => $css['icon_shape']             ?? $d['icon_shape'],
            'icon_opacity'           => (int)($css['icon_opacity']           ?? $d['icon_opacity']),
            'show_on_collection'     => (bool)($css['show_on_collection']    ?? $d['show_on_collection']),
            'collection_position'    => $css['collection_position']    ?? $d['collection_position'],
            'show_watermark'         => (bool)($css['show_watermark']        ?? $d['show_watermark']),
            'share_whatsapp_enabled' => (bool)($css['share_whatsapp_enabled'] ?? $d['share_whatsapp_enabled']),
            'save_image_enabled'     => (bool)($css['save_image_enabled']    ?? $d['save_image_enabled']),
            'privacy_notice_shown'   => (bool)($css['privacy_notice_shown']  ?? $d['privacy_notice_shown']),
        ];
    }

    /** Validates and normalises the JSX POST body → DB column map. */
    private function sanitize(array $b): array
    {
        $d = AppConfig::WIDGET_DEFAULTS;
        $css = $b['css'] ?? [];
        return [
            'button_text'            => substr(trim((string)($b['widget_title']        ?? $d['button_text'])), 0, 100),
            'widget_subtitle'        => substr(trim((string)($b['widget_subtitle']     ?? $d['widget_subtitle'])), 0, 200),
            // Store CSS as JSON
            'widget_css'             => json_encode([
                'button_color'           => $css['button_color']           ?? $d['button_color'],
                'button_text_color'      => $css['button_text_color']      ?? $d['button_text_color'],
                'hover_bg_color'         => $css['hover_bg_color']         ?? $d['hover_bg_color'],
                'button_border_radius'   => $css['button_border_radius']   ?? $d['button_border_radius'],
                'button_width'           => $css['button_width']           ?? $d['button_width'],
                'button_height'          => $css['button_height']          ?? $d['button_height'],
                'button_padding_top'     => $css['button_padding_top']     ?? $d['button_padding_top'],
                'button_padding_right'   => $css['button_padding_right']   ?? $d['button_padding_right'],
                'button_padding_bottom'  => $css['button_padding_bottom']  ?? $d['button_padding_bottom'],
                'button_padding_left'    => $css['button_padding_left']    ?? $d['button_padding_left'],
                'button_margin_top'      => $css['button_margin_top']      ?? $d['button_margin_top'],
                'button_margin_right'    => $css['button_margin_right']    ?? $d['button_margin_right'],
                'button_margin_bottom'   => $css['button_margin_bottom']   ?? $d['button_margin_bottom'],
                'button_margin_left'     => $css['button_margin_left']     ?? $d['button_margin_left'],
                'title_font_size'        => $css['title_font_size']        ?? $d['title_font_size'],
                'subtitle_font_size'     => $css['subtitle_font_size']     ?? $d['subtitle_font_size'],
                'title_font_weight'      => $css['title_font_weight']      ?? $d['title_font_weight'],
                'title_font_family'      => $css['title_font_family']      ?? $d['title_font_family'],
                'subtitle_font_family'   => $css['subtitle_font_family']   ?? $d['subtitle_font_family'],
                'button_icon'            => $css['button_icon']            ?? $d['button_icon'],
                'icon_color'             => $css['icon_color']             ?? $d['icon_color'],
                'main_icon_bg_color'     => $css['main_icon_bg_color']     ?? $d['main_icon_bg_color'],
                'coll_icon_bg_color'     => $css['coll_icon_bg_color']     ?? $d['coll_icon_bg_color'],
                'icon_size'              => $css['icon_size']              ?? $d['icon_size'],
                'icon_radius'            => $css['icon_radius']            ?? $d['icon_radius'],
                'icon_shape'             => $css['icon_shape']             ?? $d['icon_shape'],
                'icon_opacity'           => $css['icon_opacity']           ?? $d['icon_opacity'],
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'widget_language'        => substr(trim((string)($b['widget_language']     ?? $d['widget_language'])), 0, 10),
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
