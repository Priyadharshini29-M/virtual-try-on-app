<?php
// SECURITY: Delete this file immediately after use.
declare(strict_types=1);

require_once __DIR__ . '/config/AppConfig.php';
require_once __DIR__ . '/db/Database.php';

header('Content-Type: application/json');

$report = [
    'db_connected'          => false,
    'tables'                => [],
    'columns'               => [],
    'merchant_count'        => 0,
    'analytics_rows'        => 0,
    'tryon_sessions'        => 0,
    'api_key_sample'        => null,
    'analytics_api_test'    => null,
    'errors'                => [],
];

try {
    $db = TryFit\Db\Database::getInstance();
    $report['db_connected'] = true;

    // ── 1. Check required tables exist ───────────────────────────────
    $requiredTables = [
        'merchants', 'analytics_daily', 'tryon_sessions',
        'products', 'variant_image_mappings', 'analytics_webhook_events',
    ];
    $existing = $db->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($requiredTables as $t) {
        $report['tables'][$t] = in_array($t, $existing, true) ? 'OK' : 'MISSING';
    }

    // ── 2. Check products table has image_url and price ───────────────
    $cols = $db->query("SHOW COLUMNS FROM products")->fetchAll(PDO::FETCH_COLUMN);
    $report['columns']['products.image_url'] = in_array('image_url', $cols, true) ? 'OK' : 'MISSING — run migration 011';
    $report['columns']['products.price']     = in_array('price', $cols, true)     ? 'OK' : 'MISSING — run migration 011';

    // ── 3. Row counts ─────────────────────────────────────────────────
    $report['merchant_count']  = (int) $db->query("SELECT COUNT(*) FROM merchants")->fetchColumn();
    $report['analytics_rows']  = (int) $db->query("SELECT COUNT(*) FROM analytics_daily")->fetchColumn();
    $report['tryon_sessions']  = (int) $db->query("SELECT COUNT(*) FROM tryon_sessions")->fetchColumn();

    // ── 4. Sample a real merchant API key ─────────────────────────────
    $row = $db->query("SELECT api_key, shopify_domain FROM merchants WHERE is_active = 1 LIMIT 1")->fetch();
    if ($row) {
        $report['api_key_sample'] = [
            'shop'    => $row['shopify_domain'],
            'api_key' => substr($row['api_key'], 0, 8) . '****',  // masked
        ];

        // ── 5. Live analytics query for that merchant ─────────────────
        $merchant = $db->query(
            "SELECT id FROM merchants WHERE api_key = " . $db->quote($row['api_key']) . " LIMIT 1"
        )->fetch();
        $merchantId = (int)$merchant['id'];

        $from = date('Y-m-d', strtotime('-30 days'));
        $to   = date('Y-m-d');

        $daily = $db->prepare(
            "SELECT * FROM analytics_daily
             WHERE merchant_id = ? AND date BETWEEN ? AND ?
             ORDER BY date ASC"
        );
        $daily->execute([$merchantId, $from, $to]);
        $rows = $daily->fetchAll();

        $summary = [
            'tryon_initiated'   => 0,
            'add_to_cart_count' => 0,
            'order_count'       => 0,
            'revenue_inr'       => 0,
            'save_count'        => 0,
            'share_wa_count'    => 0,
        ];
        foreach ($rows as $r) {
            foreach (array_keys($summary) as $col) {
                $summary[$col] += (float)($r[$col] ?? 0);
            }
        }

        // device split
        $devStmt = $db->prepare(
            "SELECT COALESCE(device_type,'desktop') AS dt, COUNT(*) AS cnt
             FROM tryon_sessions
             WHERE merchant_id = ? AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY device_type"
        );
        $devStmt->execute([$merchantId, $from, $to]);
        $devRows = $devStmt->fetchAll();
        $dev = ['mobile' => 0, 'desktop' => 0, 'tablet' => 0];
        foreach ($devRows as $dr) {
            if (isset($dev[$dr['dt']])) $dev[$dr['dt']] = (int)$dr['cnt'];
        }
        $devTotal = array_sum($dev);

        // top products
        $topStmt = $db->prepare(
            "SELECT p.shopify_product_id AS id, p.title,
                    COUNT(DISTINCT ts.id) AS tryon_count,
                    COALESCE(SUM(ts.action_buy_now), 0) AS buy_count
             FROM tryon_sessions ts
             JOIN products p ON p.id = ts.product_id
             WHERE ts.merchant_id = ? AND DATE(ts.created_at) BETWEEN ? AND ?
             GROUP BY p.id ORDER BY tryon_count DESC LIMIT 5"
        );
        $topStmt->execute([$merchantId, $from, $to]);

        $report['analytics_api_test'] = [
            'merchant_id'   => $merchantId,
            'date_range'    => "$from → $to",
            'daily_rows'    => count($rows),
            'summary'       => $summary,
            'device_totals' => $dev,
            'device_split_ok' => $devTotal > 0 ? 'has data' : 'no session data yet',
            'top_products'  => $topStmt->fetchAll(),
        ];
    } else {
        $report['errors'][] = 'No active merchants found in DB';
    }

} catch (\Throwable $e) {
    $report['errors'][] = $e->getMessage();
}

echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
