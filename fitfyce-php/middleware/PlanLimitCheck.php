<?php

declare(strict_types=1);

namespace TryFit\Middleware;

use TryFit\AppConfig;
use TryFit\Db\Database;

class PlanLimitCheck
{
    public static function handle(array $merchant): void
    {
        $db   = Database::getInstance();
        $stmt = $db->prepare('SELECT * FROM plan_limits WHERE plan = ? LIMIT 1');
        $stmt->execute([$merchant['plan']]);
        $planRow = $stmt->fetch();

        if ($planRow === false) {
            return;
        }

        $limit = (int)$planRow['monthly_tryon_limit'];
        $used  = (int)$merchant['tryon_count_month'];

        if ($limit > 0 && $used >= $limit) {
            respondJson([
                'error'       => 'Monthly try-on limit reached',
                'plan'        => $merchant['plan'],
                'limit'       => $limit,
                'used'        => $used,
                'upgrade_url' => AppConfig::SHOPIFY_APP_URL,
            ], 429);
        }
    }
}
