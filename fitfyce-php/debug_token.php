<?php
/**
 * Checks stored access tokens and Shopify error detail.
 * Access: https://tryonapp.digifyce.com/debug_token.php?key=migrate2025
 * DELETE after use.
 */
if (($_GET['key'] ?? '') !== 'migrate2025') {
    http_response_code(403);
    exit(json_encode(['error' => 'Forbidden']));
}

header('Content-Type: application/json');

require_once __DIR__ . '/config/AppConfig.php';
require_once __DIR__ . '/db/Database.php';

$pdo = \TryFit\Db\Database::getInstance();

$merchants = $pdo->query(
    "SELECT id, shopify_domain, access_token, is_active FROM merchants ORDER BY id"
)->fetchAll();

$out = [];

foreach ($merchants as $m) {
    $token  = $m['access_token'] ?? '';
    $domain = $m['shopify_domain'];

    // Show token prefix only — never expose full token
    $tokenPreview = $token
        ? substr($token, 0, 10) . '...(len=' . strlen($token) . ')'
        : 'EMPTY';

    // Make a real Shopify call and capture the error body
    $ch = curl_init("https://{$domain}/admin/api/2024-04/shop.json");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            "X-Shopify-Access-Token: {$token}",
            "Content-Type: application/json",
        ],
    ]);
    $body   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $decoded = json_decode($body, true);

    $out[] = [
        'merchant_id'    => $m['id'],
        'shopify_domain' => $domain,
        'is_active'      => (int)$m['is_active'],
        'token_preview'  => $tokenPreview,
        'shopify_status' => $status,
        'shopify_error'  => $decoded['errors'] ?? ($decoded['error'] ?? null),
        'shop_name'      => $decoded['shop']['name'] ?? null,
    ];
}

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
