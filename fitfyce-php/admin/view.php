<?php

declare(strict_types=1);

namespace TryFit\Admin;

use TryFit\AppConfig;

/**
 * Minimal view helper. render() wraps a page template with the shared
 * admin layout (header, nav, CSS, script tags). Page templates run with
 * $this bound to this class, so they can call $this->e() to escape and
 * $this->asset() to resolve asset URLs.
 */
class View
{
    public array $data = [];
    public string $title = 'Brix-TryOn';
    public string $activeNav = '';
    public ?array $merchant = null;
    public int $walletBalance = 0;

    /** Render a page template inside the shared admin layout. */
    public static function render(string $page, array $data = [], string $activeNav = '', string $title = 'Brix-TryOn'): void
    {
        $view = new self();
        $view->data = $data;
        $view->activeNav = $activeNav;
        $view->title = $title;

        // The topbar always shows the merchant handle + wallet credits.
        // Prefer the row the controller already loaded; fall back to a
        // fresh query so pages that don't pass `merchant` still work.
        if (isset($data['merchant']) && is_array($data['merchant'])) {
            $view->merchant = $data['merchant'];
        }
        if (isset($data['balance']) && is_numeric($data['balance'])) {
            $view->walletBalance = (int)$data['balance'];
        } elseif ($view->merchant !== null && class_exists('TryFit\\Db\\WalletRepo')) {
            try {
                $view->walletBalance = (new \TryFit\Db\WalletRepo())->balance((int)$view->merchant['id']);
            } catch (\Throwable $e) { /* non-fatal */ }
        }

        ob_start();
        $view->include(__DIR__ . '/pages/' . $page . '.php');
        $content = (string)ob_get_clean();

        header('Content-Type: text/html; charset=utf-8');
        $view->renderLayout($content);
    }

    public function renderLayout(string $content): void
    {
        $this->include(__DIR__ . '/layout.php', ['_content' => $content]);
    }

    /** Include a template with $view->data merged into local scope. */
    public function include(string $template, array $extra = []): void
    {
        $view = $this;
        extract($this->data, EXTR_SKIP);
        extract($extra, EXTR_SKIP);
        require $template;
    }

    /** HTML-escape a value for safe interpolation. */
    public function e(mixed $value): string
    {
        if ($value === null || is_bool($value)) {
            return $value === true ? 'true' : ($value === false ? 'false' : '');
        }
        return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    public function asset(string $path): string
    {
        $base = AppConfig::adminBaseUrl();
        $rel  = ltrim($path, '/');
        // Append the file's mtime as ?v= so the browser never serves a stale
        // cached copy after an edit. Falls back to the current time when the
        // file can't be stat'd (shouldn't happen in practice).
        $disk = dirname(__DIR__) . '/admin/assets/' . $rel;
        $v    = @filemtime($disk) ?: time();
        return $base . '/admin/assets/' . $rel . '?v=' . $v;
    }

    public function url(string $path): string
    {
        return AppConfig::adminBaseUrl() . '/' . ltrim($path, '/');
    }

    public function fsIcon(string $name, int $size = 18, int $strokeWidth = 2, string $class = ''): string
    {
        $paths = IconPaths::ALL;
        $svg   = $paths[$name] ?? $paths['sparkle'];
        return sprintf(
            '<svg width="%d" height="%d" viewBox="0 0 24 24" aria-hidden="true" class="%s" fill="none" stroke="currentColor" stroke-width="%d" stroke-linecap="round" stroke-linejoin="round">%s</svg>',
            $size,
            $size,
            htmlspecialchars($class, ENT_QUOTES),
            $strokeWidth,
            $svg
        );
    }
}

/**
 * Icon path strings — a trimmed port of the fs-ui.jsx FsIcon set. Keep
 * entries in sync with that file when the UI uses a new icon name.
 */
class IconPaths
{
    public const ALL = [
        'check'        => '<path d="M20 6 9 17l-5-5" />',
        'sparkle'      => '<path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8z" /><path d="M19 15v4M17 17h4" />',
        'bolt'         => '<path d="M13 2 4 14h7l-1 8 9-12h-7z" />',
        'info'         => '<circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />',
        'clock'        => '<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />',
        'crown'        => '<path d="M3 18h18M4 8l4 4 4-7 4 7 4-4-2 10H6z" />',
        'chevronRight' => '<path d="m9 6 6 6-6 6" />',
        'x'            => '<path d="M18 6 6 18M6 6l12 12" />',
        'box'          => '<path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" />',
        'users'        => '<circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3" />',
        'sliders'      => '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />',
        'chart'        => '<path d="M3 3v18h18" /><path d="M8 16v-4M13 16V8M18 16v-7" />',
        'dashboard'    => '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
        'wallet'       => '<path d="M3 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V5a2 2 0 0 1 2-2h11v4"/><circle cx="17" cy="13" r="1.5"/>',
        'ruler'        => '<path d="M3 16 16 3l5 5-13 13z"/><path d="m14.5 6.5 2 2M11 10l2 2M7.5 13.5l2 2"/>',
        'shirt'        => '<path d="M8 3 3 6l2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
        'layers'       => '<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5"/><path d="M2 18l10 5 10-5"/>',
        'menu'         => '<path d="M3 6h18M3 12h18M3 18h18"/>',
        'logout'       => '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
        'help'         => '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.3-1 .9-1 1.7"/><path d="M12 17h.01"/>',
    ];
}
