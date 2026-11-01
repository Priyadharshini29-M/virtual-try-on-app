<?php
/**
 * POST /backend/api/report.php?key=SITE_KEY
 * The widget reports the outcome of the fallback loop:
 *  - which plan finally injected the buttons
 *  - hit/miss counts for Plan-A selectors (so stale ones auto-disable)
 *  - NEW selectors learned by Plan B (block) / Plan C (inspect) -> saved so next visit Plan A uses them
 *  - click events
 *
 * Body JSON:
 * {
 *   "event": "inject" | "click",
 *   "pageType": "product"|"collection"|"unknown",
 *   "plan": "scrapy"|"block"|"inspect"|"none",
 *   "url": "...",
 *   "hits": [12, 15], "misses": [9],
 *   "learned": [{"target":"add_to_cart","selector":"button.pdp-add","confidence":0.8}],
 *   "tried": ["scrapy","block"], "injected": 3,
 *   "trigger": "product_button"
 * }
 */
declare(strict_types=1);
require __DIR__ . '/../lib/bootstrap.php';

handle_cors_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST only', 405);

$site = site_from_request();
$siteId = (int)$site['id'];
rate_limit('report', (int)cfg('rate_limit.report_per_min'), $siteId);

$b = read_json_body();
$pageType = in_array($b['pageType'] ?? '', ['product', 'collection'], true) ? $b['pageType'] : 'unknown';
$plan     = in_array($b['plan'] ?? '', ['scrapy', 'block', 'inspect', 'manual', 'none'], true) ? $b['plan'] : 'none';
$url      = is_string($b['url'] ?? null) ? $b['url'] : null;
$event    = $b['event'] ?? 'inject';

if ($event === 'click') {
    $trigger = in_array($b['trigger'] ?? '', ['product_button', 'image_icon', 'card_icon'], true) ? $b['trigger'] : null;
    log_event($siteId, 'click', $plan, $pageType, $url, ['trigger' => $trigger]);
    json_out(['ok' => true]);
}

/* ---- 1. hit / miss bookkeeping for Plan-A selectors ---- */
$ids = fn($arr) => array_slice(array_values(array_filter(array_map('intval', (array)$arr))), 0, 50);
$hits = $ids($b['hits'] ?? []);
$misses = $ids($b['misses'] ?? []);

if ($hits) {
    $in = implode(',', array_fill(0, count($hits), '?'));
    DB::run("UPDATE selectors SET hits = hits + 1 WHERE site_id = ? AND id IN ($in)", array_merge([$siteId], $hits));
}
if ($misses) {
    $in = implode(',', array_fill(0, count($misses), '?'));
    DB::run("UPDATE selectors SET misses = misses + 1 WHERE site_id = ? AND id IN ($in)", array_merge([$siteId], $misses));
    // Auto-disable selectors that keep failing (site redesign etc.) – manual ones are never auto-disabled
    DB::run(
        "UPDATE selectors SET status = 'disabled'
          WHERE site_id = ? AND source <> 'manual' AND status = 'active'
            AND misses >= 25 AND misses > hits * 3 AND id IN ($in)",
        array_merge([$siteId], $misses)
    );
}

/* ---- 2. store selectors learned by Plan B / Plan C ---- */
$validTargets = [
    'product'    => ['add_to_cart', 'product_image', 'product_title'],
    'collection' => ['card', 'card_image', 'card_link'],
];
$learnedSaved = 0;
if (in_array($plan, ['block', 'inspect'], true) && isset($validTargets[$pageType])) {
    foreach (array_slice((array)($b['learned'] ?? []), 0, 10) as $l) {
        $target = $l['target'] ?? '';
        $sel    = trim((string)($l['selector'] ?? ''));
        $conf   = max(0.05, min(0.95, (float)($l['confidence'] ?? 0.5)));
        if (!in_array($target, $validTargets[$pageType], true) || !valid_selector($sel)) continue;

        // New browser-learned selectors start as 'pending'; they become 'active'
        // automatically once confirmed by 3 separate page views (hits >= 3).
        DB::run(
            "INSERT INTO selectors (site_id, page_type, target, selector, source, confidence, hits, status, sample_url)
             VALUES (?, ?, ?, ?, ?, ?, 1, 'pending', ?)
             ON DUPLICATE KEY UPDATE
               hits = hits + 1,
               confidence = GREATEST(confidence, VALUES(confidence)),
               status = IF(status = 'pending' AND hits >= 3, 'active', status)",
            [$siteId, $pageType, $target, $sel, $plan, $conf, $url ? mb_substr($url, 0, 500) : null]
        );
        $learnedSaved++;
    }
}

if ($event === 'learn') json_out(['ok' => true, 'learned' => $learnedSaved]);   // complement-only report

/* ---- 3. telemetry ---- */
$tried = array_values(array_intersect((array)($b['tried'] ?? []), ['scrapy', 'block', 'inspect']));
$injected = max(0, (int)($b['injected'] ?? 0));
if ($injected > 0) {
    log_event($siteId, 'inject_ok', $plan, $pageType, $url, ['injected' => $injected, 'tried' => $tried]);
    if (count($tried) > 1) log_event($siteId, 'plan_fallback', $plan, $pageType, $url, ['tried' => $tried]);
} else {
    log_event($siteId, 'inject_fail', 'none', $pageType, $url, ['tried' => $tried]);
}

if ($site['status'] === 'pending' && $injected > 0) {
    DB::run("UPDATE sites SET status = 'active' WHERE id = ?", [$siteId]);
}

json_out(['ok' => true, 'learned' => $learnedSaved]);
