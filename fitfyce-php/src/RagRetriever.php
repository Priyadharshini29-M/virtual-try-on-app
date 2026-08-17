<?php

declare(strict_types=1);

namespace VTON;

use TryFit\Db\ProductRepo;
use TryFit\Db\QdrantVectorStore;

/**
 * Research Agent — fetches grounded knowledge for a product before
 * generation. Every failure mode (Qdrant unconfigured, product not indexed,
 * network error) returns [] rather than throwing, so InfographicController's
 * fallback to the plain ungrounded flow is always safe.
 */
class RagRetriever
{
    private OpenAIClient $openai;
    private QdrantVectorStore $store;

    public function __construct(OpenAIClient $openai, ?QdrantVectorStore $store = null)
    {
        $this->openai = $openai;
        $this->store  = $store ?? new QdrantVectorStore();
    }

    /**
     * @return array List of ['title', 'source_type', 'source_id', 'chunk_text', 'score']
     */
    public function retrieve(int $merchantId, ?int $productId, int $topK = 4): array
    {
        if (!$this->store->isReady() || $productId === null) {
            return [];
        }

        try {
            // The product's own title is a strong-enough query to pull its own
            // chunk back as the top result (and any related products after it,
            // which is fine — extractKeyPointsGrounded() only uses what's given).
            // $productId is the internal `products.id` — the same `product_id`
            // used throughout the API (variant mappings, etc), not the Shopify id.
            $product = (new ProductRepo())->findById($merchantId, $productId);
            $queryText = trim((string)($product['title'] ?? ''));
            if ($queryText === '') return [];

            $embeddings = $this->openai->embedTexts([$queryText]);
            if (empty($embeddings) || empty($embeddings[0])) return [];

            return $this->store->query($merchantId, $embeddings[0], $topK, 'product');
        } catch (\Throwable $e) {
            return [];
        }
    }
}
