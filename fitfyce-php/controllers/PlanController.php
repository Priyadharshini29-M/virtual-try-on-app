<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\Database;
use TryFit\Db\MerchantRepo;
use TryFit\Middleware\ApiKeyAuth;
use TryFit\Middleware\PlanLimitCheck;

class PlanController
{
    public function checkLimit(): void
    {
        $merchant = ApiKeyAuth::handle();

        // Auto-reset monthly count when the 30-day billing window has elapsed
        $billingStart = $merchant['billing_cycle_start'] ?? null;
        if ($billingStart !== null && strtotime('+30 days', (int)strtotime($billingStart)) <= time()) {
            $mRepo = new MerchantRepo();
            $mRepo->resetMonthlyCount((int)$merchant['id']);
            $merchant['tryon_count_month']   = 0;
            $merchant['billing_cycle_start'] = date('Y-m-d');
        }

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

        if (!in_array($newPlan, AppConfig::PLANS, true)) {
            respondJson(['ok' => false, 'error' => 'Invalid plan'], 400);
        }

        $repo = new MerchantRepo();
        $repo->updatePlan((int)$merchant['id'], $newPlan);

        respondJson(['ok' => true, 'plan' => $newPlan]);
    }

    public function listPlans(): void
    {
        ApiKeyAuth::handle();

        $db    = Database::getInstance();
        $stmt  = $db->query('SELECT * FROM plan_limits ORDER BY price_inr_monthly ASC');
        $plans = $stmt->fetchAll();

        respondJson(['ok' => true, 'plans' => $plans]);
    }
}
