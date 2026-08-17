<?php

declare(strict_types=1);

namespace VTON;

final class TryOnDiffusionClient
{
    private string $baseUrl;
    private string $apiKey;
    private ?string $rapidApiHost = null;

    public function __construct(string $baseUrl, string $apiKey)
    {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->apiKey = $apiKey;

        $host = parse_url($this->baseUrl, PHP_URL_HOST);
        if (is_string($host) && str_ends_with($host, '.rapidapi.com')) {
            $this->rapidApiHost = $host;
        }
    }

    /**
     * @param array{
     *   clothing_image_path?: string,
     *   clothing_prompt?: string,
     *   avatar_image_path?: string,
     *   avatar_prompt?: string,
     *   avatar_sex?: string,
     *   background_image_path?: string,
     *   background_prompt?: string,
     *   seed?: int
     * } $params
     * @return array{status_code:int,image_bytes:?string,response_data:?string,error_details:?string,seed:?int}
     */
    public function tryOnFile(array $params): array
    {
        $url = $this->baseUrl . '/try-on-file';

        $fields = [
            'seed' => (string)($params['seed'] ?? -1),
        ];

        if (!empty($params['clothing_prompt'])) {
            $fields['clothing_prompt'] = $params['clothing_prompt'];
        }
        if (!empty($params['avatar_prompt'])) {
            $fields['avatar_prompt'] = $params['avatar_prompt'];
        }
        if (!empty($params['avatar_sex'])) {
            $fields['avatar_sex'] = $params['avatar_sex'];
        }
        if (!empty($params['background_prompt'])) {
            $fields['background_prompt'] = $params['background_prompt'];
        }

        $fileFields = [
            'clothing_image_path' => 'clothing_image',
            'avatar_image_path' => 'avatar_image',
            'background_image_path' => 'background_image',
        ];

        foreach ($fileFields as $pathKey => $fieldName) {
            if (!empty($params[$pathKey]) && is_file($params[$pathKey])) {
                $mime = ImageUtils::detectMimeType($params[$pathKey]);
                $fields[$fieldName] = new \CURLFile($params[$pathKey], $mime, basename($params[$pathKey]));
            }
        }

        $headers = [];
        if ($this->rapidApiHost !== null) {
            $headers[] = 'X-RapidAPI-Key: ' . $this->apiKey;
            $headers[] = 'X-RapidAPI-Host: ' . $this->rapidApiHost;
        } else {
            $headers[] = 'X-API-Key: ' . $this->apiKey;
        }

        $seedHeader = null;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POSTFIELDS     => $fields,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => 90,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_HEADERFUNCTION => static function ($curl, $header) use (&$seedHeader) {
                $len = strlen($header);
                $header = trim($header);
                if (stripos($header, 'X-Seed:') === 0) {
                    $seedHeader = (int)trim(substr($header, 7));
                }
                return $len;
            },
        ]);

        $response = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            return [
                'status_code' => 0,
                'image_bytes' => null,
                'response_data' => null,
                'error_details' => $curlError !== '' ? $curlError : 'Request failed',
                'seed' => null,
            ];
        }

        $result = [
            'status_code' => $status,
            'image_bytes' => null,
            'response_data' => $response,
            'error_details' => null,
            'seed' => $seedHeader,
        ];

        if ($status === 200) {
            $result['image_bytes'] = $response;
            return $result;
        }

        $decoded = json_decode($response, true);
        if (is_array($decoded) && isset($decoded['detail'])) {
            $result['error_details'] = (string)$decoded['detail'];
        } elseif ($response !== '') {
            $result['error_details'] = substr($response, 0, 500);
        }

        return $result;
    }
}
