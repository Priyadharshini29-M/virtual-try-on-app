<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\Database;
use TryFit\Middleware\ApiKeyAuth;
use VTON\OpenAIClient;
use VTON\RagIngestor;

/**
 * Manual controls for the product knowledge index that grounds infographic
 * generation (see InfographicController). Per-product indexing itself
 * happens inline in ProductController::sync() — these endpoints are for the
 * one-time backfill of products synced before this feature existed, the
 * nightly cron, and a status banner in the Studio wizard.
 */
class RagController
{
    /** POST /rag/reindex — full-catalog (re)index for the authenticated merchant. */
    public function reindex(): void
    {
        try {
            $merchant = ApiKeyAuth::handle();
            if (!AppConfig::ragEnabled()) {
                respondJson(['error' => 'RAG is not configured (QDRANT_URL/OPENAI_API_KEY unset).'], 503);
                return;
            }

            $ingestor = new RagIngestor(new OpenAIClient(AppConfig::openAiApiKey()));
            $count    = $ingestor->indexAllForMerchant((int)$merchant['id']);

            respondJson(['ok' => true, 'indexed_products' => $count]);
        } catch (\Throwable $e) {
            error_log('[FitSnap RAG] reindex error: ' . $e->getMessage());
            respondJson(['error' => 'Reindex failed: ' . $e->getMessage()], 500);
        }
    }

    /** GET /rag/status — index freshness for the Studio wizard's status banner. */
    public function status(): void
    {
        try {
            $merchant = ApiKeyAuth::handle();

            if (!AppConfig::ragEnabled()) {
                respondJson(['enabled' => false, 'indexed_products' => 0, 'last_indexed_at' => null]);
                return;
            }

            $db = Database::getInstance();
            $stmt = $db->prepare(
                "SELECT COUNT(*) AS cnt, MAX(updated_at) AS last_at
                 FROM vector_index_status
                 WHERE merchant_id = ? AND source_type = 'product'"
            );
            $stmt->execute([(int)$merchant['id']]);
            $row = $stmt->fetch() ?: ['cnt' => 0, 'last_at' => null];

            respondJson([
                'enabled'          => true,
                'indexed_products' => (int)$row['cnt'],
                'last_indexed_at'  => $row['last_at'],
            ]);
        } catch (\Throwable $e) {
            error_log('[FitSnap RAG] status error: ' . $e->getMessage());
            respondJson(['error' => 'Status check failed: ' . $e->getMessage()], 500);
        }
    }
}
