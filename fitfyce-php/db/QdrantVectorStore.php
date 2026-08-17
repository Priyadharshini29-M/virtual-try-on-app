<?php

declare(strict_types=1);

namespace TryFit\Db;

use TryFit\AppConfig;
use VTON\QdrantClient;
use VTON\VectorStoreInterface;

/**
 * Qdrant-backed implementation of VectorStoreInterface. Single collection
 * (`fitfyce_knowledge`) shared by every merchant and source type — every
 * point payload carries merchant_id/source_type/source_id, and every query
 * filters on them explicitly (see class doc on VectorStoreInterface).
 */
class QdrantVectorStore implements VectorStoreInterface
{
    private const COLLECTION   = 'fitfyce_knowledge';
    private const VECTOR_SIZE  = 1536; // text-embedding-3-small

    private QdrantClient $client;
    private bool $ready;

    public function __construct()
    {
        $url = AppConfig::qdrantUrl();
        $key = AppConfig::qdrantApiKey();
        $this->ready  = $url !== '';
        $this->client = new QdrantClient($url, $key);
    }

    public function isReady(): bool
    {
        return $this->ready;
    }

    public function upsertDocument(
        int $merchantId,
        string $sourceType,
        string $sourceId,
        string $title,
        array $chunks
    ): void {
        if (!$this->ready || empty($chunks)) return;

        $this->client->ensureCollection(self::COLLECTION, self::VECTOR_SIZE);

        // Replace-not-merge: drop any previously indexed chunks for this
        // document first so a shrinking chunk count never leaves orphans.
        $this->deleteDocument($merchantId, $sourceType, $sourceId);

        $points = [];
        foreach (array_values($chunks) as $i => $chunk) {
            $points[] = [
                'id'      => $this->pointId($merchantId, $sourceType, $sourceId, $i),
                'vector'  => $chunk['embedding'],
                'payload' => [
                    'merchant_id' => $merchantId,
                    'source_type' => $sourceType,
                    'source_id'   => $sourceId,
                    'title'       => $title,
                    'chunk_text'  => $chunk['text'],
                ],
            ];
        }
        $this->client->upsertPoints(self::COLLECTION, $points);
    }

    public function query(
        int $merchantId,
        array $queryEmbedding,
        int $topK = 8,
        ?string $sourceType = null
    ): array {
        if (!$this->ready) return [];

        $must = [
            ['key' => 'merchant_id', 'match' => ['value' => $merchantId]],
        ];
        if ($sourceType !== null) {
            $must[] = ['key' => 'source_type', 'match' => ['value' => $sourceType]];
        }

        try {
            $results = $this->client->search(self::COLLECTION, $queryEmbedding, $topK, ['must' => $must]);
        } catch (\Throwable $e) {
            // Retrieval failure must never break generation — caller falls back to [].
            return [];
        }

        return array_map(static fn(array $r) => [
            'title'       => (string)($r['payload']['title'] ?? ''),
            'source_type' => (string)($r['payload']['source_type'] ?? ''),
            'source_id'   => (string)($r['payload']['source_id'] ?? ''),
            'chunk_text'  => (string)($r['payload']['chunk_text'] ?? ''),
            'score'       => (float)($r['score'] ?? 0.0),
        ], $results);
    }

    public function deleteDocument(int $merchantId, string $sourceType, string $sourceId): void
    {
        if (!$this->ready) return;
        try {
            $this->client->deleteByFilter(self::COLLECTION, ['must' => [
                ['key' => 'merchant_id', 'match' => ['value' => $merchantId]],
                ['key' => 'source_type', 'match' => ['value' => $sourceType]],
                ['key' => 'source_id',   'match' => ['value' => $sourceId]],
            ]]);
        } catch (\Throwable $e) {
            // Best-effort — a stale chunk left behind is far less harmful than
            // a delete failure blocking the calling sync/index request.
        }
    }

    /** Deterministic UUID from (merchant, source, chunk index) so re-indexing overwrites in place. */
    private function pointId(int $merchantId, string $sourceType, string $sourceId, int $chunkIndex): string
    {
        $hash = md5("{$merchantId}:{$sourceType}:{$sourceId}:{$chunkIndex}");
        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hash, 0, 8),
            substr($hash, 8, 4),
            substr($hash, 12, 4),
            substr($hash, 16, 4),
            substr($hash, 20, 12)
        );
    }
}
