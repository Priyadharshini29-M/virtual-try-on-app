<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\Database;
use TryFit\Middleware\ApiKeyAuth;

class PlanController
{
    public function checkLimit(): void
    {
        $merchant = ApiKeyAuth::handle();

        $db   = Database::getInstance();
        $stmt = $db->prepare('SELECT * FROM plan_limits WHERE plan = ? LIMIT 1');
        $stmt->execute([$merchant['plan']]);
        $planRow = $stmt->fetch();

        $limit = $planRow !== false ? (int)$planRow['monthly_tryon_limit'] : 0;
        $used  = (int)$merchant['tryon_count_month'];

        respondJson([
            'ok'           => true,
            'plan'         => $merchant['plan'],
            'used'         => $used,
            'limit'        => $limit,
            'remaining'    => max(0, $limit - $used),
            'is_unlimited' => $limit === 0,
        ]);
    }

    public function updatePlan(): void
    {
        $merchant = ApiKeyAuth::handle();

        $body    = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);
        $newPlan = trim((string)($body['plan'] ?? ''));

        $allowed = ['basic', 'pro', 'premium'];
        if (!in_array($newPlan, $allowed, true)) {
            respondJson(['ok' => false, 'error' => 'Invalid plan'], 400);
        }

        $repo = new \TryFit\Db\MerchantRepo();
        $repo->updatePlan((int)$merchant['id'], $newPlan);

        respondJson(['ok' => true, 'plan' => $newPlan]);
    }

    public function listPlans(): void
    {
        ApiKeyAuth::handle(); // Require authentication

        $db   = Database::getInstance();
        $stmt = $db->query('SELECT * FROM plan_limits ORDER BY price_inr_monthly ASC');
        $plans = $stmt->fetchAll();

        respondJson([
            'ok'    => true,
            'plans' => $plans
        ]);
    }
}
