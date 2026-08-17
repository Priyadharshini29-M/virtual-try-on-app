<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\AnalyticsRepo;
use TryFit\Middleware\ApiKeyAuth;

class AnalyticsController
{
    public function get(): void
    {
        $merchant   = ApiKeyAuth::handle();
        $merchantId = (int)$merchant['id'];

        $from = trim($_GET['from'] ?? date('Y-m-d', strtotime('-30 days')));
        $to   = trim($_GET['to']   ?? date('Y-m-d'));

        if (!$this->isValidDate($from) || !$this->isValidDate($to)) {
            respondJson(['error' => 'Invalid date format. Use YYYY-MM-DD'], 400);
        }

        // Ensure from <= to
        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $repo  = new AnalyticsRepo();
        $daily = $repo->getRange($merchantId, $from, $to);

        // Previous period of the same duration (for trend comparison)
        $fromDt   = new \DateTime($from);
        $toDt     = new \DateTime($to);
        $days     = (int)$fromDt->diff($toDt)->days + 1;
        $prevTo   = (clone $fromDt)->modify('-1 day')->format('Y-m-d');
        $prevFrom = (clone $fromDt)->modify("-{$days} days")->format('Y-m-d');
        $prevDaily = $repo->getRange($merchantId, $prevFrom, $prevTo);

        $numericCols = [
            'tryon_initiated', 'add_to_cart_count', 'buy_now_count',
            'save_count', 'share_wa_count', 'order_count', 'revenue_inr',
        ];

        $cur  = array_fill_keys($numericCols, 0.0);
        foreach ($daily as $row) {
            foreach ($numericCols as $col) {
                $cur[$col] += (float)($row[$col] ?? 0);
            }
        }

        $prev = array_fill_keys($numericCols, 0.0);
        foreach ($prevDaily as $row) {
            foreach ($numericCols as $col) {
                $prev[$col] += (float)($row[$col] ?? 0);
            }
        }

        // Derived rates
        $curCartRate  = $cur['tryon_initiated'] > 0
            ? ($cur['add_to_cart_count'] / $cur['tryon_initiated']) * 100 : 0.0;
        $curPurchRate = $cur['tryon_initiated'] > 0
            ? ($cur['order_count'] / $cur['tryon_initiated']) * 100 : 0.0;
        $prevCartRate = $prev['tryon_initiated'] > 0
            ? ($prev['add_to_cart_count'] / $prev['tryon_initiated']) * 100 : 0.0;
        $prevPurchRate = $prev['tryon_initiated'] > 0
            ? ($prev['order_count'] / $prev['tryon_initiated']) * 100 : 0.0;

        $summary = [
            'tryon_initiated'   => (int)$cur['tryon_initiated'],
            'add_to_cart_count' => (int)$cur['add_to_cart_count'],
            'order_count'       => (int)$cur['order_count'],
            'revenue_inr'       => round($cur['revenue_inr'], 2),
            'save_count'        => (int)$cur['save_count'],
            'share_wa_count'    => (int)$cur['share_wa_count'],
            'tryon_trend'      => $this->trendStr($cur['tryon_initiated'],   $prev['tryon_initiated']),
            'cart_rate_trend'  => $this->trendStr($curCartRate,              $prevCartRate),
            'purch_rate_trend' => $this->trendStr($curPurchRate,             $prevPurchRate),
            'revenue_trend'    => $this->trendStr($cur['revenue_inr'],       $prev['revenue_inr']),
            'cart_trend'       => $this->trendStr($cur['add_to_cart_count'], $prev['add_to_cart_count']),
            'save_trend'       => $this->trendStr($cur['save_count'],        $prev['save_count']),
            'share_wa_trend'   => $this->trendStr($cur['share_wa_count'],    $prev['share_wa_count']),
            'order_trend'      => $this->trendStr($cur['order_count'],       $prev['order_count']),
        ];

        respondJson([
            'summary'      => $summary,
            'charts'       => $this->buildCharts($daily),
            'top_products' => $repo->getTopProducts($merchantId, $from, $to),
            'device_split' => $repo->getDeviceSplit($merchantId, $from, $to),
        ]);
    }

    private function buildCharts(array $daily): array
    {
        if (empty($daily)) {
            return [
                'tryons'     => [0],
                'cart_rate'  => [0],
                'purch_rate' => [0],
                'revenue'    => [0],
            ];
        }

        $tryons = $cartRate = $purchRate = $revenue = [];

        foreach ($daily as $row) {
            $initiated = (int)($row['tryon_initiated'] ?? 0);
            $cart      = (int)($row['add_to_cart_count'] ?? 0);
            $orders    = (int)($row['order_count'] ?? 0);
            $rev       = (float)($row['revenue_inr'] ?? 0);

            $tryons[]    = $initiated;
            $cartRate[]  = $initiated > 0 ? round(($cart / $initiated) * 100, 1) : 0.0;
            $purchRate[] = $initiated > 0 ? round(($orders / $initiated) * 100, 2) : 0.0;
            $revenue[]   = round($rev, 2);
        }

        return [
            'tryons'     => $tryons,
            'cart_rate'  => $cartRate,
            'purch_rate' => $purchRate,
            'revenue'    => $revenue,
        ];
    }

    private function trendStr(float $current, float $prev): string
    {
        if ($prev == 0.0) {
            return $current > 0 ? '+100.0%' : '+0.0%';
        }
        $pct  = (($current - $prev) / abs($prev)) * 100;
        $sign = $pct >= 0 ? '+' : '';
        return $sign . number_format($pct, 1) . '%';
    }

    private function isValidDate(string $date): bool
    {
        $d = \DateTime::createFromFormat('Y-m-d', $date);
        return $d !== false && $d->format('Y-m-d') === $date;
    }
}
