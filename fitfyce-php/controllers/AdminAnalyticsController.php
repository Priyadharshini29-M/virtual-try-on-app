<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Admin\View;
use TryFit\AppConfig;
use TryFit\Db\Database;
use TryFit\Middleware\AdminSession;

/**
 * Analytics module. Pulls everything from local tables (analytics_daily
 * for rollups, tryon_sessions for per-event detail, leads for the lead
 * capture panel). No Shopify Admin API calls.
 *
 * Range selector: 7D / 30D / 90D presets + optional custom from/to.
 * All KPIs show a comparison-to-previous-period delta so the trend
 * badges in the UI never read empty.
 */
class AdminAnalyticsController
{
    public function show(): void
    {
        $merchant = AdminSession::require();
        $pdo      = Database::getInstance();
        $id       = (int)$merchant['id'];

        // ── Range parsing: 7d / 30d / 90d / custom(from,to) ──────────────
        $range = (string)($_GET['range'] ?? '30d');
        $to    = date('Y-m-d');
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($_GET['to'] ?? ''))) {
            $to = (string)$_GET['to'];
        }
        $preset = match ($range) { '7d' => 7, '90d' => 90, default => 30 };
        $from   = date('Y-m-d', strtotime('-' . ($preset - 1) . ' days', strtotime($to)));
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($_GET['from'] ?? ''))) {
            $from  = (string)$_GET['from'];
            $range = 'custom';
        }

        // Previous period of equal length (for the +X.X% trend badges).
        $periodDays = max(1, (int)((strtotime($to) - strtotime($from)) / 86400) + 1);
        $prevTo     = date('Y-m-d', strtotime('-1 day', strtotime($from)));
        $prevFrom   = date('Y-m-d', strtotime('-' . ($periodDays - 1) . ' days', strtotime($prevTo)));

        // ── Current + previous rollups from analytics_daily ─────────────
        $cur  = $this->rollup($pdo, $id, $from, $to);
        $prev = $this->rollup($pdo, $id, $prevFrom, $prevTo);

        $tryons   = (int)$cur['tryon_initiated'];
        $saves    = (int)$cur['save_count'];
        $shares   = (int)$cur['share_wa_count'];
        $carts    = (int)$cur['add_to_cart_count'];
        $buyNows  = (int)$cur['buy_now_count'];
        $orders   = (int)$cur['order_count'];
        $revenue  = (float)$cur['revenue_inr'];

        $prevTryons  = (int)$prev['tryon_initiated'];
        $prevCarts   = (int)$prev['add_to_cart_count'];
        $prevOrders  = (int)$prev['order_count'];
        $prevRevenue = (float)$prev['revenue_inr'];

        $pct = static fn (float $cur, float $prev): float => $prev > 0 ? (($cur - $prev) / $prev) * 100 : 0.0;
        $cartRate  = $tryons > 0 ? ($carts  / $tryons) * 100 : 0;
        $purchRate = $tryons > 0 ? ($orders / $tryons) * 100 : 0;
        $prevCartRate  = $prevTryons > 0 ? ($prevCarts  / $prevTryons) * 100 : 0;
        $prevPurchRate = $prevTryons > 0 ? ($prevOrders / $prevTryons) * 100 : 0;

        $kpis = [
            'tryons'  => ['value' => $tryons,  'delta' => $pct((float)$tryons, (float)$prevTryons)],
            'carts'   => ['value' => $cartRate, 'delta' => $cartRate - $prevCartRate],
            'orders'  => ['value' => $purchRate, 'delta' => $purchRate - $prevPurchRate],
            'revenue' => ['value' => $revenue, 'delta' => $pct($revenue, $prevRevenue)],
        ];

        // Per-day arrays for sparklines (filled over the range so flat days render as 0).
        $daily = $this->dailySeries($pdo, $id, $from, $to);

        // ── Device split from tryon_sessions ────────────────────────────
        $deviceStmt = $pdo->prepare(
            'SELECT COALESCE(device_type, \'unknown\') AS d, COUNT(*) AS n
               FROM tryon_sessions
              WHERE merchant_id = ? AND created_at BETWEEN ? AND ?
              GROUP BY d'
        );
        $deviceStmt->execute([$id, $from . ' 00:00:00', $to . ' 23:59:59']);
        $deviceRows = $deviceStmt->fetchAll();
        $devices = ['mobile' => 0, 'desktop' => 0, 'tablet' => 0];
        $deviceTotal = 0;
        foreach ($deviceRows as $r) {
            $k = (string)$r['d'];
            if (isset($devices[$k])) {
                $devices[$k] = (int)$r['n'];
                $deviceTotal += (int)$r['n'];
            }
        }

        // ── Top products ────────────────────────────────────────────────
        $topStmt = $pdo->prepare(
            'SELECT p.id, p.title, p.handle, COUNT(s.id) AS n_tryons
               FROM tryon_sessions s
               JOIN products p ON p.id = s.product_id
              WHERE s.merchant_id = ? AND s.created_at BETWEEN ? AND ?
              GROUP BY p.id
              ORDER BY n_tryons DESC
              LIMIT 5'
        );
        $topStmt->execute([$id, $from . ' 00:00:00', $to . ' 23:59:59']);
        $top = $topStmt->fetchAll();

        // ── Captured leads ──────────────────────────────────────────────
        $leadFilter = (string)($_GET['leads'] ?? 'all');
        $leadQ      = trim((string)($_GET['lq'] ?? ''));
        $leads = [];
        $leadTotal = 0;
        try {
            $where = 'merchant_id = ?';
            $args  = [$id];
            if ($leadFilter === 'opted')     { $where .= ' AND consent_marketing = 1'; }
            if ($leadFilter === 'not_given') { $where .= ' AND consent_marketing = 0'; }
            if ($leadQ !== '')               { $where .= ' AND (email LIKE ? OR phone LIKE ?)'; $args[] = '%' . $leadQ . '%'; $args[] = '%' . $leadQ . '%'; }
            $leadCount = $pdo->prepare('SELECT COUNT(*) FROM leads WHERE ' . $where);
            $leadCount->execute($args);
            $leadTotal = (int)$leadCount->fetchColumn();
            $leadStmt = $pdo->prepare('SELECT id, email, phone, consent_marketing, created_at FROM leads WHERE ' . $where . ' ORDER BY created_at DESC LIMIT 50');
            $leadStmt->execute($args);
            $leads = $leadStmt->fetchAll();
        } catch (\Throwable $e) { /* leads table may not exist pre-migration */ }

        $hasAnyData = $tryons > 0 || $saves > 0 || $shares > 0 || $carts > 0 || $orders > 0;

        View::render('analytics', [
            'merchant'     => $merchant,
            'range'        => $range,
            'from'         => $from, 'to' => $to,
            'period_days'  => $periodDays,
            'kpis'         => $kpis,
            'funnel'       => [
                'tryons' => $tryons, 'saves' => $saves, 'shares' => $shares,
                'carts'  => $carts,  'orders' => $orders,
            ],
            'actions'      => [
                'carts' => ['value' => $carts,  'delta' => $pct((float)$carts,  (float)$prevCarts)],
                'saves' => ['value' => $saves,  'delta' => $pct((float)$saves,  (float)$prev['save_count'])],
                'shares'=> ['value' => $shares, 'delta' => $pct((float)$shares, (float)$prev['share_wa_count'])],
                'orders'=> ['value' => $orders, 'delta' => $pct((float)$orders, (float)$prevOrders)],
            ],
            'daily'        => $daily,
            'devices'      => $devices,
            'device_total' => $deviceTotal,
            'top_products' => $top,
            'leads'        => $leads,
            'lead_total'   => $leadTotal,
            'lead_filter'  => $leadFilter,
            'lead_q'       => $leadQ,
            'has_any_data' => $hasAnyData,
            'revenue'      => $revenue,
        ], 'analytics', 'Analytics · Brix-TryOn');
    }

    public function exportCsv(): void
    {
        $merchant = AdminSession::require();
        $pdo      = Database::getInstance();
        $id       = (int)$merchant['id'];

        $filename = 'brix-tryon-leads-' . date('Y-m-d') . '.csv';
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');

        $out = fopen('php://output', 'w');
        fputcsv($out, ['Email', 'Phone', 'Opted in', 'Captured at']);
        $stmt = $pdo->prepare('SELECT email, phone, consent_marketing, created_at FROM leads WHERE merchant_id = ? ORDER BY created_at DESC');
        $stmt->execute([$id]);
        while ($row = $stmt->fetch()) {
            fputcsv($out, [
                (string)($row['email'] ?? ''),
                (string)($row['phone'] ?? ''),
                (int)$row['consent_marketing'] === 1 ? 'yes' : 'no',
                (string)$row['created_at'],
            ]);
        }
        fclose($out);
        exit;
    }

    // ─── helpers ────────────────────────────────────────────────────────

    private function rollup(\PDO $pdo, int $merchantId, string $from, string $to): array
    {
        $stmt = $pdo->prepare(
            'SELECT
                COALESCE(SUM(tryon_initiated),   0) AS tryon_initiated,
                COALESCE(SUM(save_count),        0) AS save_count,
                COALESCE(SUM(share_wa_count),    0) AS share_wa_count,
                COALESCE(SUM(add_to_cart_count), 0) AS add_to_cart_count,
                COALESCE(SUM(buy_now_count),     0) AS buy_now_count,
                COALESCE(SUM(order_count),       0) AS order_count,
                COALESCE(SUM(revenue_inr),       0) AS revenue_inr
               FROM analytics_daily
              WHERE merchant_id = ? AND date BETWEEN ? AND ?'
        );
        $stmt->execute([$merchantId, $from, $to]);
        return $stmt->fetch() ?: [
            'tryon_initiated' => 0, 'save_count' => 0, 'share_wa_count' => 0,
            'add_to_cart_count' => 0, 'buy_now_count' => 0,
            'order_count' => 0, 'revenue_inr' => 0,
        ];
    }

    /** Returns [YYYY-MM-DD => ['tryons' => n, 'carts' => n, 'orders' => n, 'revenue' => f]]. */
    private function dailySeries(\PDO $pdo, int $merchantId, string $from, string $to): array
    {
        $map = [];
        $cursor = strtotime($from);
        $end    = strtotime($to);
        while ($cursor <= $end) {
            $map[date('Y-m-d', $cursor)] = ['tryons' => 0, 'carts' => 0, 'orders' => 0, 'revenue' => 0];
            $cursor = strtotime('+1 day', $cursor);
        }
        $stmt = $pdo->prepare(
            'SELECT date, tryon_initiated, add_to_cart_count, order_count, revenue_inr
               FROM analytics_daily
              WHERE merchant_id = ? AND date BETWEEN ? AND ?'
        );
        $stmt->execute([$merchantId, $from, $to]);
        foreach ($stmt->fetchAll() as $r) {
            if (isset($map[$r['date']])) {
                $map[$r['date']] = [
                    'tryons'  => (int)$r['tryon_initiated'],
                    'carts'   => (int)$r['add_to_cart_count'],
                    'orders'  => (int)$r['order_count'],
                    'revenue' => (float)$r['revenue_inr'],
                ];
            }
        }
        return $map;
    }
}
