<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\AnalyticsRepo;
use TryFit\Db\Database;
use TryFit\Middleware\ApiKeyAuth;

class AnalyticsController
{
    public function get(): void
    {
        $merchant = ApiKeyAuth::handle();

        // Check analytics_enabled for plan
        $db   = Database::getInstance();
        $stmt = $db->prepare('SELECT analytics_enabled FROM plan_limits WHERE plan = ? LIMIT 1');
        $stmt->execute([$merchant['plan']]);
        $planRow = $stmt->fetch();

        if ($planRow === false || (int)$planRow['analytics_enabled'] === 0) {
            respondJson(['error' => 'Analytics not available on your plan'], 403);
        }

        $from = $_GET['from'] ?? date('Y-m-d', strtotime('-30 days'));
        $to   = $_GET['to']   ?? date('Y-m-d');

        // Basic date validation
        if (!$this->isValidDate($from) || !$this->isValidDate($to)) {
            respondJson(['error' => 'Invalid date format. Use YYYY-MM-DD'], 400);
        }

        $repo    = new AnalyticsRepo();
        $daily   = $repo->getRange((int)$merchant['id'], $from, $to);
        $topProds = $repo->getTopProducts((int)$merchant['id'], $from, $to);

        // Compute summary totals
        $summary = [
            'tryon_initiated'   => 0,
            'tryon_completed'   => 0,
            'tryon_failed'      => 0,
            'add_to_cart_count' => 0,
            'buy_now_count'     => 0,
            'save_count'        => 0,
            'share_wa_count'    => 0,
            'order_count'       => 0,
            'revenue_inr'       => 0.0,
        ];

        foreach ($daily as $row) {
            foreach (array_keys($summary) as $col) {
                $summary[$col] += (float)($row[$col] ?? 0);
            }
        }

        respondJson([
            'summary'      => $summary,
            'daily'        => $daily,
            'top_products' => $topProds,
        ]);
    }

    private function isValidDate(string $date): bool
    {
        $d = \DateTime::createFromFormat('Y-m-d', $date);
        return $d !== false && $d->format('Y-m-d') === $date;
    }
}
