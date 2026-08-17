<?php

declare(strict_types=1);

namespace VTON;

use PDO;
use TryFit\Db\Database;
use TryFit\Db\QdrantVectorStore;

/**
 * Knowledge RAG ingestion — embeds real product facts (title, vendor,
 * product_type, tags, description_html) into Qdrant so infographic
 * generation can be grounded in them instead of inventing/trusting whatever
 * free text a merchant typed. Content-hash skip keeps re-syncs cheap (see
 * migration 014's vector_index_status table).
 */
class RagIngestor
{
    private const SOURCE_TYPE = 'product';

    private PDO $db;
    private OpenAIClient $openai;
    private QdrantVectorStore $store;

    public function __construct(OpenAIClient $openai, ?QdrantVectorStore $store = null)
    {
        $this->db     = Database::getInstance();
        $this->openai = $openai;
        $this->store  = $store ?? new QdrantVectorStore();
    }

    /**
     * @param array $product A row from the `products` table (must include
     *   id, title, vendor, product_type, tags, description_html).
     */
    public function indexProduct(int $merchantId, array $product): void
    {
        if (!$this->store->isReady()) return;

        $productId = (string)($product['id'] ?? '');
        if ($productId === '') return;

        $title = trim((string)($product['title'] ?? ''));
        $text  = $this->buildChunkText($product);
        if ($text === '') return; // nothing groundable yet (product not fully synced)

        $hash = sha1($text);
        if ($this->isUnchanged($merchantId, $productId, $hash)) {
            return; // hash-skip — this exact text is already indexed
        }

        $embeddings = $this->openai->embedTexts([$text]);
        if (empty($embeddings) || empty($embeddings[0])) {
            return; // embedding call failed — leave the previous index entry as-is
        }

        $this->store->upsertDocument($merchantId, self::SOURCE_TYPE, $productId, $title !== '' ? $title : "Product #{$productId}", [
            ['text' => $text, 'embedding' => $embeddings[0]],
        ]);

        $this->recordIndexed($merchantId, $productId, $hash);
    }

    /** Full-catalog backfill/resync — used by RagController::reindex() and the nightly cron. */
    public function indexAllForMerchant(int $merchantId): int
    {
        $stmt = $this->db->prepare(
            'SELECT id, title, vendor, product_type, tags, description_html FROM products WHERE merchant_id = ?'
        );
        $stmt->execute([$merchantId]);

        $count = 0;
        foreach ($stmt->fetchAll() as $row) {
            $this->indexProduct($merchantId, $row);
            $count++;
        }
        return $count;
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    private function buildChunkText(array $product): string
    {
        $title       = trim((string)($product['title'] ?? ''));
        $vendor      = trim((string)($product['vendor'] ?? ''));
        $productType = trim((string)($product['product_type'] ?? ''));
        $tags        = trim((string)($product['tags'] ?? ''));
        $description = $this->stripHtml((string)($product['description_html'] ?? ''));

        if ($title === '' && $description === '') return '';

        // Title-prefixed so retrieval still identifies the product even if a
        // chunk is later split/reused without its heading.
        $parts = array_filter([
            $title,
            $vendor      !== '' ? "Vendor: {$vendor}"       : null,
            $productType !== '' ? "Type: {$productType}"    : null,
            $tags        !== '' ? "Tags: {$tags}"           : null,
            $description !== '' ? $description              : null,
        ]);
        return implode(' — ', $parts);
    }

    private function stripHtml(string $html): string
    {
        if ($html === '') return '';
        $text = strip_tags($html);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5);
        $text = preg_replace('/\s+/', ' ', $text);
        return trim((string)$text);
    }

    private function isUnchanged(int $merchantId, string $sourceId, string $hash): bool
    {
        $stmt = $this->db->prepare(
            'SELECT content_hash FROM vector_index_status
             WHERE merchant_id = ? AND source_type = ? AND source_id = ? LIMIT 1'
        );
        $stmt->execute([$merchantId, self::SOURCE_TYPE, $sourceId]);
        $existing = $stmt->fetchColumn();
        return $existing !== false && hash_equals((string)$existing, $hash);
    }

    private function recordIndexed(int $merchantId, string $sourceId, string $hash): void
    {
        $this->db->prepare(
            'INSERT INTO vector_index_status (merchant_id, collection, source_type, source_id, content_hash, chunk_count)
             VALUES (?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE content_hash = VALUES(content_hash), chunk_count = 1'
        )->execute([$merchantId, 'fitfyce_knowledge', self::SOURCE_TYPE, $sourceId, $hash]);
    }
}
