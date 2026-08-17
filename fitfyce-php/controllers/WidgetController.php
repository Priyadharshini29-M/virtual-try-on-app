<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\WidgetSettingsRepo;
use TryFit\Middleware\ApiKeyAuth;

class WidgetController
{
    /**
     * GET /api/widget-settings?shop=...
     * Public endpoint (no API key) — called by the storefront widget via the Shopify app proxy.
     * Returns flat widget config keyed exactly as the widget JS reads them.
     */
    public function publicGet(): void
    {
        header('Cache-Control: no-store, must-revalidate');
        header('Pragma: no-cache');

        $shop = trim((string)($_GET['shop'] ?? ''));
        if ($shop === '') {
            error_log('[FitSnap Widget] publicGet: missing shop param — request URI: ' . ($_SERVER['REQUEST_URI'] ?? ''));
            respondJson([]);
            return;
        }

        // Normalise: strip protocol prefix and trailing slashes that some
        // themes or proxies may inject (e.g. "https://store.myshopify.com/")
        $shop = preg_replace('#^https?://#i', '', $shop);
        $shop = rtrim($shop, '/');

        $mRepo    = new \TryFit\Db\MerchantRepo();
        $merchant = $mRepo->findByDomain($shop);

        if (!$merchant) {
            // Fallback: try a LIKE match in case domain was stored with protocol or trailing slash
            $merchant = $mRepo->findByDomainLike($shop);
        }

        if (!$merchant) {
            error_log("[FitSnap Widget] publicGet: no merchant row for shop={$shop}");
            respondJson([]);
            return;
        }

        // Serve settings regardless of is_active — widget blocks remain in themes
        // even after uninstall until the merchant manually removes them. Withholding
        // settings would only break the storefront for users who still have the block.
        if ((int)$merchant['is_active'] !== 1) {
            error_log("[FitSnap Widget] publicGet: merchant id={$merchant['id']} is_active={$merchant['is_active']} — serving settings anyway");
        }

        $repo = new WidgetSettingsRepo();
        $raw  = $repo->getButtonConfig((int)$merchant['id']);

        // Fetch per-product enabled status so the storefront JS can filter
        // collection icons and validate the product-page button without relying
        // solely on Shopify's CDN-cached metafield HTML.
        $productsData    = $repo->getProductsData((int)$merchant['id']);
        $enabledProducts = $productsData['enabled_products']; // null = no data yet, [] = zero enabled
        $allProducts     = $productsData['products'] ?? [];

        // Build a handle lookup from ALL products (including old rows that
        // predate the handle column). collection_products contains every product
        // in the same collection including the product itself — so we can always
        // find the handle there even when the dedicated column is empty.
        $handleMap = [];
        foreach ($allProducts as $p) {
            $pid = (string)($p['shopify_product_id'] ?? '');
            if ($pid === '') continue;
            $h = (string)($p['handle'] ?? '');
            if ($h !== '') {
                $handleMap[$pid] = $h;
                continue;
            }
            $collProds = is_array($p['collection_products'])
                ? $p['collection_products']
                : (json_decode((string)($p['collection_products'] ?? 'null'), true) ?? []);
            foreach ($collProds as $cp) {
                if (
                    isset($cp['handle'], $cp['shopify_product_id']) &&
                    $cp['handle'] !== '' &&
                    (string)$cp['shopify_product_id'] === $pid
                ) {
                    $handleMap[$pid] = (string)$cp['handle'];
                    break;
                }
            }
        }

        $flat = $this->flatConfig($raw);

        // Free / basic plan merchants always show the watermark regardless of their saved setting.
        // Paid plans with branding_removable respect the per-shop toggle.
        $plan = strtolower(trim((string)($merchant['plan'] ?? '')));
        $freePlans = ['', 'free', 'basic'];
        if (in_array($plan, $freePlans, true)) {
            $flat['show_watermark'] = true;
        }

        // Only include enabled-product lists when the data is actually populated.
        // Omitting the keys causes the JS to fall back to "show icon on all cards"
        // mode, which is the correct behaviour before any product sync has run.
        // Sending an empty array would (incorrectly) hide all collection icons.
        if (is_array($enabledProducts)) {
            $flat['enabled_product_ids'] = array_values(array_map(
                function ($p) { return (string)($p['shopify_product_id'] ?? ''); },
                $enabledProducts
            ));
            $flat['enabled_product_handles'] = array_values(array_filter(array_map(
                function ($p) use ($handleMap) {
                    $pid = (string)($p['shopify_product_id'] ?? '');
                    $h   = (string)($p['handle'] ?? '');
                    return $h !== '' ? $h : ($handleMap[$pid] ?? '');
                },
                $enabledProducts
            )));
        }

        respondJson($flat);
    }

    /**
     * GET /widget/settings
     * Returns shop_id + full button_config object (all fields).
     */
    public function get(): void
    {
        $merchant    = ApiKeyAuth::handle();
        $mid         = (int)$merchant['id'];
        $repo        = new WidgetSettingsRepo();
        $row         = $repo->getButtonConfig($mid);
        $productsData = $repo->getProductsData($mid);

        respondJson([
            'shop_id'          => $mid,
            'button_config'    => $this->formatConfig($row),
            'products'         => $productsData['products'],
            'enabled_products' => $productsData['enabled_products'],
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

    /**
     * Returns the config as a flat array with keys matching what tryon-widget.js reads.
     * Handles both flat (new) and nested-css (legacy) storage formats.
     */
    private function flatConfig(array $s): array
    {
        $d   = AppConfig::WIDGET_DEFAULTS;
        // Merge nested css first, then flat keys override (flat = newer saves)
        $cfg = array_merge((array)($s['css'] ?? []), $s);

        return [
            'widget_title'           => $cfg['widget_title'] ?? $cfg['button_text'] ?? $d['button_text'],
            'widget_subtitle'        => $cfg['widget_subtitle']        ?? $d['widget_subtitle'],
            'button_color'           => $cfg['button_color']           ?? $d['button_color'],
            'button_text_color'      => $cfg['button_text_color']      ?? $d['button_text_color'],
            'button_border_radius'   => (int)($cfg['button_border_radius']   ?? $d['button_border_radius']),
            'hover_bg_color'         => $cfg['hover_bg_color']         ?? $d['hover_bg_color'],
            'button_width'           => (int)($cfg['button_width']           ?? $d['button_width']),
            'button_height'          => (int)($cfg['button_height']          ?? $d['button_height']),
            'button_padding_top'     => (int)($cfg['button_padding_top']     ?? $d['button_padding_top']),
            'button_padding_right'   => (int)($cfg['button_padding_right']   ?? $d['button_padding_right']),
            'button_padding_bottom'  => (int)($cfg['button_padding_bottom']  ?? $d['button_padding_bottom']),
            'button_padding_left'    => (int)($cfg['button_padding_left']    ?? $d['button_padding_left']),
            'button_margin_top'      => (int)($cfg['button_margin_top']      ?? $d['button_margin_top']),
            'button_margin_right'    => (int)($cfg['button_margin_right']    ?? $d['button_margin_right']),
            'button_margin_bottom'   => (int)($cfg['button_margin_bottom']   ?? $d['button_margin_bottom']),
            'button_margin_left'     => (int)($cfg['button_margin_left']     ?? $d['button_margin_left']),
            'title_font_size'        => (int)($cfg['title_font_size']        ?? $d['title_font_size']),
            'subtitle_font_size'     => (int)($cfg['subtitle_font_size']     ?? $d['subtitle_font_size']),
            'title_font_weight'      => $cfg['title_font_weight']      ?? $d['title_font_weight'],
            'title_font_family'      => $cfg['title_font_family']      ?? $d['title_font_family'],
            'subtitle_font_family'   => $cfg['subtitle_font_family']   ?? $d['subtitle_font_family'],
            // Per-view font sizes
            'desktop_title_font_size' => (int)($cfg['desktop_title_font_size'] ?? $cfg['title_font_size'] ?? $d['title_font_size']),
            'mobile_title_font_size'  => (int)($cfg['mobile_title_font_size']  ?? 14),
            // Per-view padding
            'desktop_padding_top'    => (int)($cfg['desktop_padding_top']    ?? $cfg['button_padding_top']    ?? $d['button_padding_top']),
            'desktop_padding_right'  => (int)($cfg['desktop_padding_right']  ?? $cfg['button_padding_right']  ?? $d['button_padding_right']),
            'desktop_padding_bottom' => (int)($cfg['desktop_padding_bottom'] ?? $cfg['button_padding_bottom'] ?? $d['button_padding_bottom']),
            'desktop_padding_left'   => (int)($cfg['desktop_padding_left']   ?? $cfg['button_padding_left']   ?? $d['button_padding_left']),
            'mobile_padding_top'     => (int)($cfg['mobile_padding_top']     ?? 8),
            'mobile_padding_right'   => (int)($cfg['mobile_padding_right']   ?? 16),
            'mobile_padding_bottom'  => (int)($cfg['mobile_padding_bottom']  ?? 8),
            'mobile_padding_left'    => (int)($cfg['mobile_padding_left']    ?? 16),
            // Per-view widget dimensions
            'desktop_widget_width'       => (int)($cfg['desktop_widget_width']       ?? $cfg['button_width']  ?? 0),
            'desktop_widget_width_unit'  => $cfg['desktop_widget_width_unit']  ?? 'px',
            'desktop_widget_height'      => (int)($cfg['desktop_widget_height']      ?? $cfg['button_height'] ?? 0),
            'desktop_widget_height_unit' => $cfg['desktop_widget_height_unit'] ?? 'px',
            'mobile_widget_width'        => (int)($cfg['mobile_widget_width']        ?? 100),
            'mobile_widget_width_unit'   => $cfg['mobile_widget_width_unit']   ?? '%',
            'mobile_widget_height'       => (int)($cfg['mobile_widget_height']       ?? 0),
            'mobile_widget_height_unit'  => $cfg['mobile_widget_height_unit']  ?? 'auto',
            'widget_language'        => $cfg['widget_language']        ?? $d['widget_language'],
            'button_icon'            => $cfg['button_icon']            ?? $d['button_icon'],
            'icon_color'             => $cfg['icon_color']             ?? $d['icon_color'],
            'main_icon_bg_color'     => $cfg['main_icon_bg_color']     ?? $d['main_icon_bg_color'],
            'coll_icon_bg_color'     => $cfg['coll_icon_bg_color']     ?? $d['coll_icon_bg_color'],
            'icon_size'              => (int)($cfg['icon_size']              ?? $d['icon_size']),
            'icon_radius'            => (int)($cfg['icon_radius']            ?? $d['icon_radius']),
            'icon_shape'             => $cfg['icon_shape']             ?? $d['icon_shape'],
            'icon_opacity'           => (int)($cfg['icon_opacity']           ?? $d['icon_opacity']),
            'show_on_collection'     => (bool)($cfg['show_on_collection']    ?? $d['show_on_collection']),
            'collection_position'    => $cfg['collection_position']    ?? $d['collection_position'],
            'show_watermark'         => (bool)($cfg['show_watermark']        ?? $d['show_watermark']),
            'share_whatsapp_enabled' => (bool)($cfg['share_whatsapp_enabled'] ?? $d['share_whatsapp_enabled']),
            'save_image_enabled'     => (bool)($cfg['save_image_enabled']    ?? $d['save_image_enabled']),
            'privacy_notice_shown'   => (bool)($cfg['privacy_notice_shown']  ?? $d['privacy_notice_shown']),
        ];
    }

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
        foreach (
            [
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
            ] as $f => [$min, $max]
        ) {
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
