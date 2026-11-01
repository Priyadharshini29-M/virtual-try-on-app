<?php
/**
 * POST /backend/api/tryon.php?key=SITE_KEY   (multipart/form-data)
 *   photo          : shopper image file (jpg/png/webp, max 8MB)
 *   product_image  : absolute https URL of the product image found on the page
 *   product_url, product_title, trigger, plan, visitor_id
 * Returns { ok, id, result_url }
 */
declare(strict_types=1);
require __DIR__ . '/../lib/bootstrap.php';
require __DIR__ . '/../lib/TryOnProvider.php';
require __DIR__ . '/../lib/Platform.php';

handle_cors_preflight();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST only', 405);

$site = site_from_request();
$siteId = (int)$site['id'];
rate_limit('tryon', (int)cfg('rate_limit.tryon_per_min'), $siteId);

$today = (int)DB::val('SELECT COUNT(*) FROM tryon_sessions WHERE site_id = ? AND created_at >= CURDATE()', [$siteId]);
if ($today >= (int)$site['daily_tryon_limit']) json_error('Daily try-on limit reached for this store', 429);

/* ---------- validate shopper photo ---------- */
if (empty($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) json_error('Photo is required');
if ($_FILES['photo']['size'] > cfg('max_upload_bytes')) json_error('Photo too large (max 8MB)');
$mime = (new finfo(FILEINFO_MIME_TYPE))->file($_FILES['photo']['tmp_name']);
$extMap = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
if (!isset($extMap[$mime])) json_error('Only JPG, PNG or WEBP photos are allowed');

$productImage = trim((string)($_POST['product_image'] ?? ''));
if (!preg_match('#^https?://#i', $productImage)) json_error('product_image must be an absolute URL');

$dir = rtrim(cfg('upload_dir'), '/');
foreach (['user', 'garment', 'result'] as $sub) if (!is_dir("$dir/$sub")) mkdir("$dir/$sub", 0750, true);

$token = bin2hex(random_bytes(16));
$userRel = "user/$token." . $extMap[$mime];
if (!move_uploaded_file($_FILES['photo']['tmp_name'], "$dir/$userRel")) json_error('Upload failed', 500);

/* ---------- fetch garment image (SSRF-safe) ---------- */
try {
    $garmentBytes = safe_fetch_image($productImage);
} catch (Throwable $e) {
    @unlink("$dir/$userRel");
    json_error('Could not load product image: ' . $e->getMessage());
}
$garmentRel = "garment/$token.img";
file_put_contents("$dir/$garmentRel", $garmentBytes);

$trigger = in_array($_POST['trigger'] ?? '', ['product_button', 'image_icon', 'card_icon'], true) ? $_POST['trigger'] : null;
$plan = in_array($_POST['plan'] ?? '', ['scrapy', 'block', 'inspect', 'manual'], true) ? $_POST['plan'] : null;
$visitor = preg_match('/^[a-f0-9-]{36}$/', (string)($_POST['visitor_id'] ?? '')) ? $_POST['visitor_id'] : null;

$provider = TryOnFactory::make();
$sessionId = DB::insert('tryon_sessions', [
    'site_id'       => $siteId,
    'visitor_id'    => $visitor,
    'product_url'   => mb_substr((string)($_POST['product_url'] ?? ''), 0, 700) ?: null,
    'product_title' => mb_substr(strip_tags((string)($_POST['product_title'] ?? '')), 0, 300) ?: null,
    'product_image' => mb_substr($productImage, 0, 700),
    'user_image'    => $userRel,
    'provider'      => $provider->name(),
    'trigger_from'  => $trigger,
    'plan_used'     => $plan,
    'ip_hash'       => ip_hash(),
]);

/* ---------- bill the linked FitFyce store (1 wallet for Shopify + VTO stores) ---------- */
$shop = (string)($site['fitfyce_shop'] ?? '');
$billRef = 'vto-' . $sessionId;
$charged = 0;
if ($shop !== '' && Platform::enabled()) {
    try {
        $bill = Platform::reserve($shop, $billRef);
    } catch (Throwable $e) {
        $bill = ['ok' => false, 'error' => 'unreachable'];
    }
    if (!$bill['ok']) {
        DB::update('tryon_sessions', ['status' => 'failed', 'error' => 'billing: ' . $bill['error']], 'id = ?', [$sessionId]);
        log_event($siteId, 'tryon_fail', $plan, 'unknown', $_POST['product_url'] ?? null, ['billing' => $bill['error']]);
        @unlink("$dir/$userRel"); @unlink("$dir/$garmentRel");
        // shoppers never see wallet details
        $outOfCredit = in_array($bill['error'], ['insufficient_credits', 'store_inactive', 'unknown_store'], true);
        json_error($outOfCredit ? 'Virtual try-on is not available for this store right now.' : 'Try-on is temporarily unavailable, please try again in a moment.', $outOfCredit ? 402 : 503);
    }
    $charged = (int)$bill['cost'];
    DB::update('tryon_sessions', ['credits_charged' => $charged], 'id = ?', [$sessionId]);
}

$t0 = microtime(true);
try {
    $out = $provider->generate("$dir/$userRel", "$dir/$garmentRel", [
        'category' => $site['category'],
        'title'    => $_POST['product_title'] ?? '',
    ]);
    $resultRel = "result/$token.jpg";
    file_put_contents("$dir/$resultRel", $out);
    DB::update('tryon_sessions', [
        'result_image' => $resultRel,
        'status'       => 'done',
        'duration_ms'  => (int)((microtime(true) - $t0) * 1000),
    ], 'id = ?', [$sessionId]);
    log_event($siteId, 'tryon_ok', $plan, 'unknown', $_POST['product_url'] ?? null, ['session' => $sessionId]);

    json_out(['ok' => true, 'id' => $sessionId, 'result_url' => cfg('upload_url') . rawurlencode($resultRel)]);
} catch (Throwable $e) {
    if ($charged > 0) {
        Platform::release($shop, $charged, $billRef);   // failed try-on → credit back
        DB::update('tryon_sessions', ['credits_charged' => 0], 'id = ?', [$sessionId]);
    }
    DB::update('tryon_sessions', [
        'status' => 'failed',
        'error'  => mb_substr($e->getMessage(), 0, 500),
        'duration_ms' => (int)((microtime(true) - $t0) * 1000),
    ], 'id = ?', [$sessionId]);
    log_event($siteId, 'tryon_fail', $plan, 'unknown', $_POST['product_url'] ?? null, ['error' => $e->getMessage()]);
    json_error('Try-on failed, please try another photo', 502);
}

/**
 * Downloads a remote image while blocking requests to private / internal networks (SSRF protection).
 */
function safe_fetch_image(string $url, int $maxBytes = 10485760): string
{
    $parts = parse_url($url);
    $host = $parts['host'] ?? '';
    if (!$host || !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true)) throw new RuntimeException('bad url');

    $ips = gethostbynamel($host) ?: [];
    if (!$ips) throw new RuntimeException('dns failed');
    foreach ($ips as $ip) {
        if (!cfg('dev_allow_private_images') && !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            throw new RuntimeException('host not allowed');
        }
    }
    $port = $parts['port'] ?? (strtolower($parts['scheme']) === 'https' ? 443 : 80);

    $ch = curl_init($url);
    $buf = '';
    curl_setopt_array($ch, [
        CURLOPT_RESOLVE        => ["$host:$port:{$ips[0]}"],   // pin the vetted IP (prevents DNS rebinding)
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_USERAGENT      => 'VTO-Fetcher/1.0',
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_WRITEFUNCTION  => function ($ch, $chunk) use (&$buf, $maxBytes) {
            $buf .= $chunk;
            return strlen($buf) > $maxBytes ? 0 : strlen($chunk);
        },
    ]);
    curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || $buf === '') throw new RuntimeException("http $code");

    $mime = (new finfo(FILEINFO_MIME_TYPE))->buffer($buf);
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'], true)) {
        throw new RuntimeException('not an image');
    }
    return $buf;
}
