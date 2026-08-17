<?php
/**
 * Debugs the GET /shop/products 500 error — tests every query the controller runs.
 * Access: https://tryonapp.digifyce.com/debug_shop_products.php?key=migrate2025
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
$mid = (int)($_GET['mid'] ?? 4);
$out = ['testing_merchant_id' => $mid];

// Show all tables
$tables = $pdo->query("SHOW TABLES")->fetchAll(\PDO::FETCH_COLUMN);
$out['all_tables'] = $tables;

// 1. getCollections
try {
    $stmt = $pdo->prepare(
        'SELECT id AS collection_id, shopify_collection_id, shopify_collection_gid,
                title, handle, products_count, created_at, updated_at
         FROM collections WHERE merchant_id = ? ORDER BY title ASC'
    );
    $stmt->execute([$mid]);
    $out['getCollections'] = ['ok' => true, 'count' => count($stmt->fetchAll())];
} catch (\Throwable $e) {
    $out['getCollections'] = ['ok' => false, 'error' => $e->getMessage()];
}

// 2. getProducts
try {
    $stmt = $pdo->prepare(
        'SELECT p.id AS product_id, p.merchant_id, p.shopify_domain,
                p.shopify_product_id, p.shopify_product_gid,
                p.collection_id, p.collection_title, p.collection_handle,
                p.shopify_variants, p.is_tryon_enabled, p.created_at, p.updated_at,
                COUNT(vim.id) AS variant_mapping_count
         FROM products p
         LEFT JOIN variant_image_mappings vim ON vim.product_id = p.id
         WHERE p.merchant_id = ? GROUP BY p.id ORDER BY p.collection_title ASC'
    );
    $stmt->execute([$mid]);
    $out['getProducts'] = ['ok' => true, 'count' => count($stmt->fetchAll())];
} catch (\Throwable $e) {
    $out['getProducts'] = ['ok' => false, 'error' => $e->getMessage()];
}

// 3. getEnabledProductsCount
try {
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM products WHERE merchant_id = ? AND is_tryon_enabled = 1');
    $stmt->execute([$mid]);
    $out['getEnabledProductsCount'] = ['ok' => true, 'count' => (int)$stmt->fetchColumn()];
} catch (\Throwable $e) {
    $out['getEnabledProductsCount'] = ['ok' => false, 'error' => $e->getMessage()];
}

// 4. getVariantMappingsMap
try {
    $stmt = $pdo->prepare(
        'SELECT id, product_id, shopify_variant_id, shopify_variant_gid,
                variant_title, tryon_image_url, image_type, avatar_sex,
                clothing_prompt, is_approved, created_at, updated_at
         FROM variant_image_mappings WHERE merchant_id = ? ORDER BY product_id ASC, id ASC'
    );
    $stmt->execute([$mid]);
    $out['getVariantMappingsMap'] = ['ok' => true, 'count' => count($stmt->fetchAll())];
} catch (\Throwable $e) {
    $out['getVariantMappingsMap'] = ['ok' => false, 'error' => $e->getMessage()];
}

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
