<?php

declare(strict_types=1);

namespace VTON;

/**
 * Contract shared by every vector-store backend. `db/QdrantVectorStore.php`
 * is the only implementation today; the interface exists so a future
 * backend swap (or a per-environment choice) doesn't touch any caller.
 *
 * Every implementation MUST scope both writes and reads to `merchant_id` via
 * an explicit filter — never rely on collection/namespace boundaries alone
 * for tenant isolation.
 */
interface VectorStoreInterface
{
    /**
     * Embeds nothing itself — `$chunks` are already-embedded
     * [text, embedding][] pairs. Replaces any previous chunks for this
     * (merchantId, sourceType, sourceId).
     *
     * @param array $chunks List of ['text' => string, 'embedding' => float[]]
     */
    public function upsertDocument(
        int $merchantId,
        string $sourceType,
        string $sourceId,
        string $title,
        array $chunks
    ): void;

    /**
     * @param float[] $queryEmbedding
     * @return array List of ['title' => string, 'source_type' => string, 'source_id' => string, 'chunk_text' => string, 'score' => float]
     */
    public function query(
        int $merchantId,
        array $queryEmbedding,
        int $topK = 8,
        ?string $sourceType = null
    ): array;

    public function deleteDocument(int $merchantId, string $sourceType, string $sourceId): void;
}
