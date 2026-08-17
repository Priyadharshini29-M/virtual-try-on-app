<?php

declare(strict_types=1);

namespace VTON;

/**
 * Minimal S3-compatible object storage REST client — same house style as
 * QdrantClient/FashnClient/OpenAIClient (no SDK, no Composer dependency):
 * raw cURL + a hand-rolled AWS Signature Version 4 implementation, just
 * enough to PUT an object and hand back its public URL. Used by
 * InfographicController to store generated infographics — see
 * AppConfig::s3Enabled()/awsAccessKeyId()/awsSecretAccessKey()/awsRegion()/
 * awsS3Bucket()/storageProvider().
 *
 * Supports two $provider values:
 *  - 'aws' (default) — real AWS S3, host {bucket}.s3.{region}.amazonaws.com.
 *  - 'gcs' — Google Cloud Storage's XML API, which is deliberately
 *    S3-API-compatible for exactly this reason (host
 *    {bucket}.storage.googleapis.com, HMAC interoperability keys instead of
 *    a service-account JSON key, SigV4 signing with region literally set to
 *    "auto" per Google's own documented requirement for this API — GCS
 *    doesn't partition signing by region the way AWS does). Chosen as a
 *    temporary alternative when AWS account setup was more friction than
 *    wanted; switching back later is a config change only, not a rewrite.
 *
 * Deliberately does NOT set an object ACL (e.g. `x-amz-acl: public-read`) —
 * AWS's current default for newly-created buckets is "Bucket owner
 * enforced" Object Ownership, which DISABLES ACLs entirely; sending one
 * would make every upload fail with AccessControlListNotSupported. Public
 * read access is expected to come from a BUCKET POLICY instead (applies
 * regardless of the ACL setting) — see the setup instructions given to the
 * merchant alongside this feature. GCS has an equivalent (uniform bucket-
 * level access + a public IAM binding), same reasoning applies.
 */
class S3Client
{
    private string $accessKeyId;
    private string $secretAccessKey;
    private string $region;
    private string $bucket;
    private string $provider;

    public function __construct(string $accessKeyId, string $secretAccessKey, string $region, string $bucket, string $provider = 'aws')
    {
        $this->accessKeyId     = $accessKeyId;
        $this->secretAccessKey = $secretAccessKey;
        $this->region          = $region;
        $this->bucket          = $bucket;
        $this->provider        = $provider === 'gcs' ? 'gcs' : 'aws';
    }

    /**
     * Uploads $body as $key with $contentType and returns its public URL.
     * $key must contain only unreserved URI characters (letters, digits,
     * '-', '_', '.', '/') — every caller in this codebase builds keys from
     * its own generated filenames, never raw user input, so this is never
     * URL-encoded here; a key with other characters would produce an
     * incorrectly-signed request. Throws on any failure — callers decide
     * how to handle/fall back (e.g. to local disk storage).
     */
    public function putObject(string $key, string $body, string $contentType): string
    {
        $key  = ltrim($key, '/');
        $host = $this->provider === 'gcs'
            ? "{$this->bucket}.storage.googleapis.com"
            : "{$this->bucket}.s3.{$this->region}.amazonaws.com";
        $url = "https://{$host}/{$key}";

        // GCS's XML API doesn't partition SigV4 signing by region the way
        // AWS does — Google's docs specify the literal string "auto" here
        // regardless of the bucket's actual location.
        $signingRegion = $this->provider === 'gcs' ? 'auto' : $this->region;

        $amzDate     = gmdate('Ymd\THis\Z');
        $dateStamp   = gmdate('Ymd');
        $payloadHash = hash('sha256', $body);

        // Canonical headers MUST be lowercase and sorted by header name —
        // ksort() on this associative array does both at once, since every
        // key here is already lowercase.
        $headers = [
            'content-type'         => $contentType,
            'host'                 => $host,
            'x-amz-content-sha256' => $payloadHash,
            'x-amz-date'           => $amzDate,
        ];
        ksort($headers);

        $canonicalHeaders = '';
        foreach ($headers as $k => $v) {
            $canonicalHeaders .= "{$k}:{$v}\n";
        }
        $signedHeaders = implode(';', array_keys($headers));

        $canonicalRequest = implode("\n", [
            'PUT',
            "/{$key}",
            '', // no query string
            $canonicalHeaders,
            $signedHeaders,
            $payloadHash,
        ]);

        $credentialScope = "{$dateStamp}/{$signingRegion}/s3/aws4_request";
        $stringToSign = implode("\n", [
            'AWS4-HMAC-SHA256',
            $amzDate,
            $credentialScope,
            hash('sha256', $canonicalRequest),
        ]);

        $signature = hash_hmac('sha256', $stringToSign, $this->deriveSigningKey($dateStamp, $signingRegion));

        $authorization = 'AWS4-HMAC-SHA256 ' .
            "Credential={$this->accessKeyId}/{$credentialScope}, " .
            "SignedHeaders={$signedHeaders}, " .
            "Signature={$signature}";

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => 'PUT',
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => [
                "Host: {$host}",
                "Content-Type: {$contentType}",
                "X-Amz-Content-Sha256: {$payloadHash}",
                "X-Amz-Date: {$amzDate}",
                "Authorization: {$authorization}",
            ],
            CURLOPT_TIMEOUT        => 60,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);
        $raw      = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($curlErr) {
            throw new \RuntimeException("Object storage upload failed: {$curlErr}");
        }
        if ($httpCode >= 300) {
            throw new \RuntimeException("Object storage upload failed: HTTP {$httpCode} — " . substr((string)$raw, 0, 500));
        }

        return $url;
    }

    /** Standard AWS SigV4 key-derivation chain — see AWS's "Calculating a Signature" docs. Each step's output is raw binary, fed as the HMAC key for the next. */
    private function deriveSigningKey(string $dateStamp, string $signingRegion): string
    {
        $kDate    = hash_hmac('sha256', $dateStamp, 'AWS4' . $this->secretAccessKey, true);
        $kRegion  = hash_hmac('sha256', $signingRegion, $kDate, true);
        $kService = hash_hmac('sha256', 's3', $kRegion, true);
        return hash_hmac('sha256', 'aws4_request', $kService, true);
    }
}
