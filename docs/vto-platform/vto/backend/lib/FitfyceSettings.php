<?php
declare(strict_types=1);

/**
 * Reads the button / icon design a merchant saved in the FitFyce app (Widget Settings)
 * from FitFyce's public endpoint GET /api/widget-settings?shop=…, and maps it to the
 * `ui` block the VTO widget understands.
 *
 * Cached on disk for `fitfyce.cache_seconds` (1 s by default, so a save in FitFyce shows up
 * almost at once). If FitFyce is slow or down, the last good copy is served (however old) and
 * FitFyce is retried only every `fitfyce.retry_seconds`, so an outage never removes the button.
 */
final class FitfyceSettings
{
    /** @return array|null raw FitFyce flat config, or null when nothing could be loaded */
    public static function fetch(string $shop): ?array
    {
        $shop = strtolower(trim(preg_replace('#^https?://#i', '', $shop), '/ '));
        if (!preg_match('/^[a-z0-9.-]+$/', $shop)) return null;

        $dir = cfg('cache_dir');
        if (!is_dir($dir)) @mkdir($dir, 0750, true);
        $file = $dir . '/fitfyce_' . sha1($shop) . '.json';

        if (is_file($file) && time() - filemtime($file) < (int)cfg('fitfyce.cache_seconds', 60)) {
            $cached = json_decode((string)file_get_contents($file), true);
            if (is_array($cached)) return $cached;
        }

        $fresh = self::download($shop);
        if ($fresh !== null) {
            @file_put_contents($file, json_encode($fresh), LOCK_EX);
            return $fresh;
        }
        if (is_file($file)) {                       // stale copy beats no button at all
            // back off: date the copy into the future so it counts as fresh for retry_seconds,
            // otherwise a FitFyce outage would add the full timeout to a page view every second
            @touch($file, time() + (int)cfg('fitfyce.retry_seconds', 30) - (int)cfg('fitfyce.cache_seconds', 1));
            $cached = json_decode((string)file_get_contents($file), true);
            if (is_array($cached)) return $cached;
        }
        return null;
    }

    private static function download(string $shop): ?array
    {
        $url = rtrim((string)cfg('fitfyce.api'), '/') . '/api/widget-settings?shop=' . rawurlencode($shop);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => (int)cfg('fitfyce.timeout', 4),
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_USERAGENT      => 'VTO-Platform/1.0',
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($body === false || $code !== 200) return null;

        $j = json_decode((string)$body, true);
        // FitFyce answers [] for an unknown shop
        return (is_array($j) && isset($j['widget_title'])) ? $j : null;
    }

    /** FitFyce flat config → widget `ui` block */
    public static function toUi(array $f): array
    {
        $color = fn($v, $d) => is_string($v) && preg_match('/^(#[0-9a-f]{3,8}|transparent)$/i', $v) ? $v : $d;
        $int   = fn($v, $d, $min, $max) => is_numeric($v) ? max($min, min($max, (int)$v)) : $d;

        return [
            'productButton'   => true,
            'imageIcon'       => true,
            'cardIcon'        => (bool)($f['show_on_collection'] ?? true),
            'text'            => mb_substr(trim((string)($f['widget_title'] ?? '')) ?: 'Virtual Try-On', 0, 60),
            'subtitle'        => mb_substr(trim((string)($f['widget_subtitle'] ?? '')), 0, 200),
            'color'           => $color($f['button_color'] ?? null, '#111111'),
            'textColor'       => $color($f['button_text_color'] ?? null, '#ffffff'),
            'hoverColor'      => $color($f['hover_bg_color'] ?? null, ''),
            'radius'          => $int($f['button_border_radius'] ?? null, 6, 0, 60),
            'titleSize'       => $int($f['desktop_title_font_size'] ?? $f['title_font_size'] ?? null, 15, 10, 40),
            'mobileTitleSize' => $int($f['mobile_title_font_size'] ?? null, 14, 10, 40),
            'subtitleSize'    => $int($f['subtitle_font_size'] ?? null, 13, 9, 30),
            'iconColor'       => $color($f['icon_color'] ?? null, '#ffffff'),
            'icon'            => in_array($f['button_icon'] ?? '', ['eye', 'sparkles', 'camera', 'shopping-bag', 'none'], true) ? $f['button_icon'] : '',
            'mainIconBg'      => $color($f['main_icon_bg_color'] ?? null, ''),
            'cardIconBg'      => $color($f['coll_icon_bg_color'] ?? null, ''),
            'source'          => 'fitfyce',
        ];
    }
}
