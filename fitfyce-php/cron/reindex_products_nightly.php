<?php

declare(strict_types=1);

/**
 * Nightly full-catalog RAG resync for every active merchant. Hash-skip
 * (RagIngestor) means this is cheap — only products whose facts actually
 * changed since the last run get re-embedded.
 *
 * Recommended crontab entry:
 * 0 3 * * * php /path/to/fitfyce-php/cron/reindex_products_nightly.php >> /dev/null 2>&1
 */

// ── Load .env (same parser as cleanup_results.php) ────────────────────────────
$envFile = dirname(__DIR__) . '/.env';
if (is_file($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (strpos($line, '=') !== false) {
            [$k, $v] = explode('=', $line, 2);
            putenv(trim($k) . '=' . trim($v));
            $_ENV[trim($k)] = trim($v);
        }
    }
}

require_once __DIR__ . '/../config/AppConfig.php';
require_once __DIR__ . '/../db/Database.php';
require_once __DIR__ . '/../db/ProductRepo.php';
require_once __DIR__ . '/../src/OpenAIClient.php';
require_once __DIR__ . '/../src/QdrantClient.php';
require_once __DIR__ . '/../src/VectorStoreInterface.php';
require_once __DIR__ . '/../db/QdrantVectorStore.php';
require_once __DIR__ . '/../src/RagIngestor.php';

use TryFit\AppConfig;
use TryFit\Db\Database;
use VTON\OpenAIClient;
use VTON\RagIngestor;

$logDir  = dirname(__DIR__) . '/logs';
$logFile = $logDir . '/rag_reindex.log';
if (!is_dir($logDir)) {
    @mkdir($logDir, 0755, true);
}

function ragCronLog(string $message): void
{
    global $logFile;
    $line = '[' . date('Y-m-d H:i:s') . '] ' . $message . PHP_EOL;
    file_put_contents($logFile, $line, FILE_APPEND);
    echo $line;
}

if (!AppConfig::ragEnabled()) {
    ragCronLog('RAG not configured (QDRANT_URL/OPENAI_API_KEY unset) — nothing to do.');
    exit(0);
}

$pdo      = Database::getInstance();
$ingestor = new RagIngestor(new OpenAIClient(AppConfig::openAiApiKey()));

$merchants = $pdo->query('SELECT id, shopify_domain FROM merchants WHERE is_active = 1')->fetchAll();
ragCronLog('Starting nightly reindex for ' . count($merchants) . ' active merchant(s).');

foreach ($merchants as $m) {
    $merchantId = (int)$m['id'];
    try {
        $count = $ingestor->indexAllForMerchant($merchantId);
        ragCronLog("Merchant {$merchantId} ({$m['shopify_domain']}): indexed {$count} product(s).");
    } catch (\Throwable $e) {
        ragCronLog("Merchant {$merchantId} ({$m['shopify_domain']}): FAILED — " . $e->getMessage());
    }
}

ragCronLog('Nightly reindex finished.');
