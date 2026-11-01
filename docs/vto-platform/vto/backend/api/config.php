<?php
/**
 * GET /backend/api/config.php?key=SITE_KEY
 * Returns everything the widget needs: settings, plan order and Plan-A selectors.
 */
declare(strict_types=1);
require __DIR__ . '/../lib/bootstrap.php';
require __DIR__ . '/../lib/FitfyceSettings.php';

handle_cors_preflight();
$site = site_from_request(false);
rate_limit('config', (int)cfg('rate_limit.config_per_min'), (int)$site['id']);

$rows = DB::all(
    "SELECT id, page_type, target, selector, source, confidence
       FROM selectors
      WHERE site_id = ? AND status = 'active'
      ORDER BY (source = 'manual') DESC, confidence DESC, hits DESC, id ASC",
    [$site['id']]
);

$selectors = ['product' => [], 'collection' => []];
foreach ($rows as $r) {
    $selectors[$r['page_type']][$r['target']][] = [
        'id'  => (int)$r['id'],
        'sel' => $r['selector'],
        'src' => $r['source'],
        'c'   => (float)$r['confidence'],
    ];
}

$planOrder = array_values(array_intersect(
    array_map('trim', explode(',', $site['plan_order'])),
    ['scrapy', 'block', 'inspect']
));
if (!$planOrder) $planOrder = ['scrapy', 'block', 'inspect'];

// Button / icon design comes from the FitFyce app; the site's own columns are only a fallback
$fitfyce = $site['fitfyce_shop'] ? FitfyceSettings::fetch($site['fitfyce_shop']) : null;
$ui = $fitfyce ? FitfyceSettings::toUi($fitfyce) : [
    'productButton' => (bool)$site['enable_product_button'],
    'imageIcon'     => (bool)$site['enable_image_icon'],
    'cardIcon'      => (bool)$site['enable_card_icon'],
    'text'          => $site['button_text'],
    'color'         => $site['button_color'],
    'textColor'     => $site['button_text_color'],
    'source'        => 'default',
];

$payload = [
    'ok'   => true,
    'site' => [
        'id'       => (int)$site['id'],
        'name'     => $site['name'],
        'category' => $site['category'],
    ],
    'plans' => $planOrder,
    'ui' => $ui,
    'patterns' => [
        'product'    => $site['product_url_pattern'],
        'collection' => $site['collection_url_pattern'],
    ],
    'selectors' => $selectors,
];

// Revalidate on every page view instead of caching for a minute: settings saved in FitFyce
// (or selectors activated) show up on the next load, and unchanged config costs only a 304.
$etag = '"' . sha1(json_encode($payload)) . '"';
header('Cache-Control: no-cache');
header('ETag: ' . $etag);
if (trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
    http_response_code(304);
    exit;
}
json_out($payload);
