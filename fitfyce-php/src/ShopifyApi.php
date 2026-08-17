<?php

declare(strict_types=1);

namespace TryFit\Src;

class ShopifyApi
{
    private const API_VERSION = '2024-04';
    private string $domain;
    private string $token;

    public function __construct(string $shopDomain, string $accessToken)
    {
        $this->domain = rtrim($shopDomain, '/');
        $this->token  = $accessToken;
    }

    /**
     * Fetches all pages of a resource and returns merged results array.
     */
    public function fetchAll(string $endpoint, string $key, array $params = []): array
    {
        $results  = [];
        $pageInfo = null;

        do {
            $query = $pageInfo
                ? http_build_query(['limit' => 250, 'page_info' => $pageInfo])
                : http_build_query(array_merge(['limit' => 250], $params));

            $url  = "https://{$this->domain}/admin/api/" . self::API_VERSION . "/{$endpoint}.json?{$query}";
            $resp = $this->get($url);

            if (isset($resp['errors'])) {
                break;
            }

            $batch    = $resp[$key] ?? [];
            $results  = array_merge($results, $batch);
            $pageInfo = $resp['_next_page_info'] ?? null;

        } while ($pageInfo !== null);

        return $results;
    }

    /**
     * Raw GET — returns decoded JSON + injects _next_page_info from Link header.
     */
    public function get(string $url): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_HTTPHEADER     => [
                "X-Shopify-Access-Token: {$this->token}",
                "Content-Type: application/json",
            ],
            CURLOPT_HEADERFUNCTION => function ($ch, $header) use (&$linkHeader) {
                if (stripos($header, 'Link:') === 0) {
                    $linkHeader = $header;
                }
                return strlen($header);
            },
        ]);

        $linkHeader = '';
        $body       = curl_exec($ch);
        curl_close($ch);

        $data = json_decode($body, true) ?? [];

        // Parse next page_info from Link header
        if ($linkHeader && preg_match('/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/', $linkHeader, $m)) {
            $data['_next_page_info'] = $m[1];
        }

        return $data;
    }
}
