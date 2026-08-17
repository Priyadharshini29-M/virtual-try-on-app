<?php
/**
 * Self-contained Shopify sync debugger — no external dependencies.
 * Access: https://tryonapp.digifyce.com/debug_shopify_sync.php?key=migrate2025&mid=3
 * DELETE after use.
 */
if (($_GET['key'] ?? '') !== 'migrate2025') {
    http_response_code(403);
    exit(json_encode(['error' => 'Forbidden']));
}

header('Content-Type: application/json');

require_once __DIR__ . '/config/AppConfig.php';
require_once __DIR__ . '/db/Database.php';

$mid = (int)($_GET['mid'] ?? 3);
$pdo = \TryFit\Db\Database::getInstance();

$m = $pdo->prepare('SELECT shopify_domain, access_token FROM merchants WHERE id = ? LIMIT 1');
$m->execute([$mid]);
$merchant = $m->fetch();

if (!$merchant) {
    exit(json_encode(['error' => "Merchant {$mid} not found"]));
}

$domain = $merchant['shopify_domain'];
$token  = $merchant['access_token'];
$ver    = '2024-04';

$out = [
    'merchant_id'    => $mid,
    'shopify_domain' => $domain,
    'has_token'      => !empty($token),
];

function shopifyGet(string $url, string $token): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HTTPHEADER     => [
            "X-Shopify-Access-Token: {$token}",
            "Content-Type: application/json",
        ],
    ]);
    $body   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    return [
        'status'  => $status,
        'error'   => $err ?: null,
        'data'    => json_decode($body, true) ?? [],
        'raw'     => substr($body, 0, 500),
    ];
}

// 1. Custom collections
$r = shopifyGet("https://{$domain}/admin/api/{$ver}/custom_collections.json?limit=10", $token);
$out['custom_collections_status'] = $r['status'];
$out['custom_collections_error']  = $r['error'];
$out['custom_collections']        = array_map(
    fn($c) => ['id' => $c['id'], 'title' => $c['title'], 'handle' => $c['handle']],
    $r['data']['custom_collections'] ?? []
);
$out['custom_collections_count']  = count($out['custom_collections']);

// 2. Smart collections
$r = shopifyGet("https://{$domain}/admin/api/{$ver}/smart_collections.json?limit=10", $token);
$out['smart_collections_status']  = $r['status'];
$out['smart_collections']         = array_map(
    fn($c) => ['id' => $c['id'], 'title' => $c['title'], 'handle' => $c['handle']],
    $r['data']['smart_collections'] ?? []
);
$out['smart_collections_count']   = count($out['smart_collections']);

// 3. Products (first 5)
$r = shopifyGet("https://{$domain}/admin/api/{$ver}/products.json?limit=5&fields=id,title,handle,status", $token);
$out['products_status'] = $r['status'];
$out['products_sample'] = array_map(
    fn($p) => ['id' => $p['id'], 'title' => $p['title']],
    $r['data']['products'] ?? []
);

// 4. Test collection→product mapping for first collection found
$allCols = array_merge($out['custom_collections'], $out['smart_collections']);
if (!empty($allCols)) {
    $firstCol = $allCols[0];
    $r2 = shopifyGet(
        "https://{$domain}/admin/api/{$ver}/products.json?collection_id={$firstCol['id']}&limit=10&fields=id,title",
        $token
    );
    $out['test_collection_products'] = [
        'collection_id'    => $firstCol['id'],
        'collection_title' => $firstCol['title'],
        'status'           => $r2['status'],
        'products'         => array_map(
            fn($p) => ['id' => $p['id'], 'title' => $p['title']],
            $r2['data']['products'] ?? []
        ),
    ];
}

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
