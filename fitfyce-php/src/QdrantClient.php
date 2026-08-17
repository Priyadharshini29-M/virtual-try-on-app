<?php

declare(strict_types=1);

namespace VTON;

/**
 * Thin cURL wrapper for the Qdrant REST API — same house style as
 * OpenAIClient/FashnClient (no SDK, no Composer dependency).
 * Base URL + API key come from AppConfig::qdrantUrl()/qdrantApiKey().
 */
class QdrantClient
{
    private string $baseUrl;
    private string $apiKey;

    public function __construct(string $baseUrl, string $apiKey)
    {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->apiKey  = $apiKey;
    }

    /** Creates the collection if it doesn't already exist. Safe to call every time (idempotent). */
    public function ensureCollection(string $name, int $vectorSize, string $distance = 'Cosine'): void
    {
        // GET first — Qdrant returns 404 for a missing collection, which jsonRequest()
        // would otherwise throw on; a plain existence check avoids relying on that.
        [$httpCode] = $this->rawRequest('GET', "/collections/{$name}");
        if ($httpCode === 200) {
            return;
        }

        $this->jsonRequest('PUT', "/collections/{$name}", [
            'vectors' => ['size' => $vectorSize, 'distance' => $distance],
        ]);
    }

    /**
     * @param array $points Each: ['id' => int|string, 'vector' => float[], 'payload' => array]
     */
    public function upsertPoints(string $collection, array $points): void
    {
        if (empty($points)) return;
        $this->jsonRequest('PUT', "/collections/{$collection}/points?wait=true", [
            'points' => $points,
        ]);
    }

    /**
     * @param array|null $filter Qdrant filter DSL, e.g. ['must' => [['key' => 'merchant_id', 'match' => ['value' => 42]]]]
     * @return array List of ['id' => ..., 'score' => float, 'payload' => array]
     */
    public function search(string $collection, array $vector, int $topK = 8, ?array $filter = null): array
    {
        $body = [
            'vector'       => $vector,
            'limit'        => $topK,
            'with_payload' => true,
        ];
        if ($filter !== null) {
            $body['filter'] = $filter;
        }
        $response = $this->jsonRequest('POST', "/collections/{$collection}/points/search", $body);
        return $response['result'] ?? [];
    }

    /** @param array $filter Qdrant filter DSL — deletes every point matching it. */
    public function deleteByFilter(string $collection, array $filter): void
    {
        $this->jsonRequest('POST', "/collections/{$collection}/points/delete?wait=true", [
            'filter' => $filter,
        ]);
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    private function jsonRequest(string $method, string $path, array $body): array
    {
        [$httpCode, $raw, $curlErr] = $this->rawRequest($method, $path, $body);

        if ($curlErr) {
            throw new \RuntimeException("Qdrant request failed: {$curlErr}");
        }
        $data = json_decode((string)$raw, true) ?? [];
        if ($httpCode >= 400) {
            $msg = $data['status']['error'] ?? "Qdrant error HTTP {$httpCode}";
            throw new \RuntimeException($msg);
        }
        return $data;
    }

    /** @return array{0:int,1:string,2:string} [httpCode, rawBody, curlError] */
    private function rawRequest(string $method, string $path, ?array $body = null): array
    {
        $url = $this->baseUrl . $path;
        $ch  = curl_init($url);

        $headers = ['Content-Type: application/json'];
        if ($this->apiKey !== '') {
            $headers[] = 'api-key: ' . $this->apiKey;
        }

        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ];
        if ($body !== null) {
            $opts[CURLOPT_POSTFIELDS] = json_encode($body);
        }
        curl_setopt_array($ch, $opts);

        $raw      = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        return [$httpCode, (string)$raw, $curlErr];
    }
}
