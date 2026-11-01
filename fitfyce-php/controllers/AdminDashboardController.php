<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Admin\View;
use TryFit\Db\Database;
use TryFit\Db\WalletRepo;
use TryFit\Middleware\AdminSession;

/**
 * Dashboard page — welcome header, setup checklist, credits gauge, 7-day
 * KPIs, and quick actions. All data comes from the local MySQL (merchants,
 * products, merchant_settings, analytics_daily, credit_transactions); no
 * Shopify API calls, by design.
 */
class AdminDashboardController
{
    public function show(): void
    {
        $merchant = AdminSession::require();
        $id       = (int)$merchant['id'];
        $pdo      = Database::getInstance();
        $wallet   = new WalletRepo();

        // Products: enabled vs total.
        $prodStmt = $pdo->prepare(
            'SELECT COUNT(*) total, SUM(is_tryon_enabled) enabled FROM products WHERE merchant_id = ?'
        );
        $prodStmt->execute([$id]);
        $prod = $prodStmt->fetch() ?: ['total' => 0, 'enabled' => 0];

        // Settings — merchant customised the widget config?
        $sStmt = $pdo->prepare(
            'SELECT widget_config FROM merchant_settings WHERE merchant_id = ? LIMIT 1'
        );
        $sStmt->execute([$id]);
        $widgetJson = $sStmt->fetchColumn();
        $widgetCustomised = $widgetJson !== false && $widgetJson !== null && $widgetJson !== '';

        // Analytics: last 7 days + lifetime try-on count.
        $to   = date('Y-m-d');
        $from = date('Y-m-d', strtotime('-6 days'));
        $wkStmt = $pdo->prepare(
            'SELECT date,
                    tryon_initiated, add_to_cart_count, order_count,
                    revenue_inr
               FROM analytics_daily
              WHERE merchant_id = ? AND date BETWEEN ? AND ?
              ORDER BY date ASC'
        );
        $wkStmt->execute([$id, $from, $to]);
        $week = $wkStmt->fetchAll();

        $sum = static function (array $rows, string $col): int {
            $t = 0; foreach ($rows as $r) { $t += (int)$r[$col]; } return $t;
        };
        $tryons   = $sum($week, 'tryon_initiated');
        $carts    = $sum($week, 'add_to_cart_count');
        $orders   = $sum($week, 'order_count');
        $revenue  = 0.0;
        foreach ($week as $r) { $revenue += (float)$r['revenue_inr']; }

        // Checklist derived from local state (no Shopify API).
        $balance = $wallet->balance($id);
        $items = [
            ['key' => 'enable_products',  'title' => 'Enable try-on on at least 1 product',
             'done' => (int)$prod['enabled'] > 0,
             'todo' => 'Open Products and switch some on.',
             'done_text' => (int)$prod['enabled'] . ' of ' . (int)$prod['total'] . ' live',
             'to' => '/admin/products'],
            ['key' => 'customise_widget', 'title' => 'Customise your try-on button',
             'done' => $widgetCustomised,
             'todo' => 'Pick your button colour, text and placement.',
             'done_text' => 'Widget customised',
             'to' => '/admin/settings'],
            ['key' => 'first_tryon', 'title' => 'See your first try-on happen',
             'done' => $tryons > 0,
             'todo' => 'Open a product page and try it on.',
             'done_text' => $tryons . ' try-on' . ($tryons === 1 ? '' : 's') . ' in the last 7 days',
             'to' => null],
            ['key' => 'first_order', 'title' => 'Get your first try-on-attributed order',
             'done' => $orders > 0,
             'todo' => 'Keep try-on live for shoppers.',
             'done_text' => $orders . ' order' . ($orders === 1 ? '' : 's'),
             'to' => null],
        ];
        $doneCount = 0; foreach ($items as $i) { if ($i['done']) $doneCount++; }
        $pct = count($items) > 0 ? (int)round(100 * $doneCount / count($items)) : 0;

        // 7-day charts as number arrays for the sparkline SVG.
        $daysMap = [];
        for ($i = 6; $i >= 0; $i--) {
            $d = date('Y-m-d', strtotime("-$i days"));
            $daysMap[$d] = ['tryons' => 0, 'carts' => 0, 'orders' => 0, 'revenue' => 0];
        }
        foreach ($week as $r) {
            if (isset($daysMap[$r['date']])) {
                $daysMap[$r['date']] = [
                    'tryons'  => (int)$r['tryon_initiated'],
                    'carts'   => (int)$r['add_to_cart_count'],
                    'orders'  => (int)$r['order_count'],
                    'revenue' => (float)$r['revenue_inr'],
                ];
            }
        }
        $charts = [
            'tryons'    => array_column($daysMap, 'tryons'),
            'cart_rate' => array_map(static fn($d) => $d['tryons'] > 0 ? ($d['carts'] / $d['tryons']) : 0, $daysMap),
            'purch_rate'=> array_map(static fn($d) => $d['tryons'] > 0 ? ($d['orders'] / $d['tryons']) : 0, $daysMap),
            'revenue'   => array_column($daysMap, 'revenue'),
        ];

        // Recent credit activity (last 8 ledger rows) and a short "recent
        // try-ons" feed from analytics_daily — both read-only, powers the
        // bottom-left activity panel. Fail silent → empty arrays.
        $recentCredits = [];
        $recentDays    = [];
        try {
            $recentCredits = $wallet->recentTransactions($id, 8);
        } catch (\Throwable $e) { /* non-fatal */ }
        try {
            $recentDaysStmt = $pdo->prepare(
                'SELECT date, tryon_initiated, add_to_cart_count, order_count
                   FROM analytics_daily
                  WHERE merchant_id = ? AND (tryon_initiated > 0 OR add_to_cart_count > 0 OR order_count > 0)
                  ORDER BY date DESC
                  LIMIT 5'
            );
            $recentDaysStmt->execute([$id]);
            $recentDays = $recentDaysStmt->fetchAll();
        } catch (\Throwable $e) { /* non-fatal */ }

        View::render('dashboard-full', [
            'merchant' => $merchant,
            'app_enabled' => (int)($merchant['app_enabled'] ?? 1) === 1,
            'recent_credits' => $recentCredits,
            'recent_days'    => $recentDays,
            'balance'  => $balance,
            'used'     => $wallet->totalDebited($id),
            'checklist' => ['items' => $items, 'done' => $doneCount, 'total' => count($items), 'pct' => $pct],
            'counts'    => [
                'enabled_products' => (int)$prod['enabled'],
                'total_products'   => (int)$prod['total'],
                'tryons'           => $tryons,
                'orders'           => $orders,
            ],
            'week' => [
                'tryons' => $tryons, 'carts' => $carts, 'orders' => $orders, 'revenue' => $revenue,
                'charts' => $charts,
            ],
        ], 'dashboard', 'Dashboard · Brix-TryOn');
    }

    /** POST toggle for "try-on is live" status strip on the dashboard. */
    public function toggleApp(): void
    {
        $merchant = AdminSession::require();
        $enabled  = (int)!empty($_POST['enabled']);
        try {
            Database::getInstance()
                ->prepare('UPDATE merchants SET app_enabled = ? WHERE id = ?')
                ->execute([$enabled, (int)$merchant['id']]);
            if (class_exists(\TryFit\Src\PlatformSync::class)) {
                \TryFit\Src\PlatformSync::storeChanged((int)$merchant['id'], 'app_toggle');
            }
        } catch (\Throwable $e) {
            // Column may be absent on older DB snapshots; non-fatal.
        }
        header('Location: ' . \TryFit\AppConfig::adminBaseUrl() . '/admin', true, 303);
        exit;
    }
}
