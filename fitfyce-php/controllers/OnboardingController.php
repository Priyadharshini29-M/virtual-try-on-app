<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\Database;
use TryFit\Middleware\ApiKeyAuth;

/**
 * First-run onboarding answers collected by the Shopify admin wizard.
 *
 *   GET  /merchant/onboarding  → the calling merchant's saved answers (or null)
 *   POST /merchant/onboarding  → upsert answers (called after every wizard step)
 *
 * One row per merchant (merchant_onboarding.merchant_id is the primary key).
 * Frequently queried answers get their own columns; the full payload is kept
 * in answers_json so new questions never need a migration.
 */
class OnboardingController
{
    private const GOALS = ['sell_more', 'fewer_returns', 'collect_emails', 'stand_out', 'order_value', 'other'];

    public function get(): void
    {
        $merchant = ApiKeyAuth::handle();
        $stmt = Database::getInstance()->prepare('SELECT * FROM merchant_onboarding WHERE merchant_id = ?');
        $stmt->execute([(int)$merchant['id']]);
        $row = $stmt->fetch();

        if (!$row) {
            respondJson(['onboarding' => null]);
        }
        $row['goals']        = json_decode((string)($row['goals'] ?? '[]'), true) ?: [];
        $row['answers_json'] = json_decode((string)($row['answers_json'] ?? '{}'), true) ?: [];
        respondJson(['onboarding' => $row]);
    }

    public function save(): void
    {
        $merchant = ApiKeyAuth::handle();
        $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

        $str = static fn ($v, int $max) => ($v === null || $v === '') ? null : mb_substr(trim((string)$v), 0, $max);

        $goals = array_values(array_intersect(self::GOALS, array_map('strval', (array)($body['goals'] ?? []))));

        $email = $str($body['contact_email'] ?? null, 255);
        if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            respondJson(['error' => 'Please enter a valid email address'], 400);
        }

        $step      = max(0, min(20, (int)($body['step'] ?? 0)));
        $completed = !empty($body['completed']);
        $skipped   = !empty($body['skipped']);

        try {
            Database::getInstance()->prepare(
                'INSERT INTO merchant_onboarding
                    (merchant_id, shopify_domain, goals, heard_from, store_type, catalog_size, product_scope,
                     products_enabled, embed_confirmed, block_confirmed,
                     contact_name, contact_email, contact_phone, selected_plan, current_step, xp,
                     answers_json, completed_at, skipped_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    shopify_domain = VALUES(shopify_domain), goals = VALUES(goals), heard_from = VALUES(heard_from),
                    store_type = VALUES(store_type), catalog_size = VALUES(catalog_size),
                    product_scope = VALUES(product_scope),
                    products_enabled = GREATEST(products_enabled, VALUES(products_enabled)),
                    embed_confirmed = VALUES(embed_confirmed), block_confirmed = VALUES(block_confirmed),
                    contact_name = VALUES(contact_name),
                    contact_email = VALUES(contact_email), contact_phone = VALUES(contact_phone),
                    selected_plan = VALUES(selected_plan), current_step = VALUES(current_step), xp = VALUES(xp),
                    answers_json = VALUES(answers_json),
                    completed_at = COALESCE(completed_at, VALUES(completed_at)),
                    skipped_at = VALUES(skipped_at)'
            )->execute([
                (int)$merchant['id'],
                $merchant['shopify_domain'] ?? null,
                json_encode($goals),
                $str($body['heard_from'] ?? null, 60),
                $str($body['store_type'] ?? null, 60),
                $str($body['catalog_size'] ?? null, 30),
                $str($body['product_scope'] ?? null, 30),
                max(0, min(100000, (int)($body['products_enabled'] ?? 0))),
                !empty($body['embed_confirmed']) ? 1 : 0,
                !empty($body['block_confirmed']) ? 1 : 0,
                $str($body['contact_name'] ?? null, 120),
                $email,
                $str($body['contact_phone'] ?? null, 30),
                $str($body['selected_plan'] ?? null, 20),
                $step,
                max(0, min(1000, (int)($body['xp'] ?? 0))),
                json_encode($body, JSON_UNESCAPED_UNICODE),
                $completed ? date('Y-m-d H:i:s') : null,
                $skipped ? date('Y-m-d H:i:s') : null,
            ]);
        } catch (\Throwable $e) {
            writeLog('ERROR', 'OnboardingController save failed', ['message' => $e->getMessage()]);
            respondJson(['error' => 'Could not save onboarding answers'], 500);
        }

        respondJson(['ok' => true]);
    }
}
