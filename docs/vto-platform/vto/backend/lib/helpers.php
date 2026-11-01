<?php
declare(strict_types=1);

/* ---------------- JSON / HTTP ---------------- */

function json_out($data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(string $msg, int $code = 400): void
{
    json_out(['ok' => false, 'error' => $msg], $code);
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if (strlen($raw) > 256 * 1024) json_error('Payload too large', 413);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function client_ip(): string
{
    // Only trust REMOTE_ADDR by default. If behind a trusted proxy/CDN, adapt here.
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function ip_hash(): string
{
    return hash('sha256', client_ip() . cfg('ip_salt'));
}

/* ---------------- Sites / origin checks ---------------- */

function normalize_host(string $hostOrUrl): string
{
    $h = $hostOrUrl;
    if (str_contains($h, '://')) $h = parse_url($h, PHP_URL_HOST) ?: '';
    $h = strtolower(trim($h));
    return preg_replace('/^www\./', '', $h);
}

/** Resolve the site from the public API key and verify the browser Origin belongs to it. */
function site_from_request(bool $requireOrigin = true): array
{
    $key = $_GET['key'] ?? $_POST['key'] ?? ($_SERVER['HTTP_X_VTO_KEY'] ?? '');
    if (!preg_match('/^[a-f0-9]{40}$/', (string)$key)) json_error('Invalid key', 401);

    $site = DB::one('SELECT * FROM sites WHERE api_key = ?', [$key]);
    if (!$site) json_error('Unknown key', 401);
    if ($site['status'] === 'paused') json_error('Site paused', 403);

    $origin = $_SERVER['HTTP_ORIGIN'] ?? ($_SERVER['HTTP_REFERER'] ?? '');
    $allowed = site_allowed_hosts($site);

    if ($origin !== '') {
        $host = normalize_host($origin);
        $ok = false;
        foreach ($allowed as $a) {
            if ($host === $a || str_ends_with($host, '.' . $a)) { $ok = true; break; }
        }
        if (!$ok) json_error('Origin not allowed for this key', 403);
        header('Access-Control-Allow-Origin: ' . (parse_url($origin, PHP_URL_SCHEME) ?: 'https') . '://' . parse_url($origin, PHP_URL_HOST));
        header('Vary: Origin');
    } elseif ($requireOrigin) {
        json_error('Missing origin', 403);
    }
    return $site;
}

function site_allowed_hosts(array $site): array
{
    $hosts = [normalize_host($site['domain'])];
    foreach (preg_split('/\R/', (string)$site['allowed_origins']) as $line) {
        $line = trim($line);
        if ($line !== '') $hosts[] = normalize_host($line);
    }
    return array_values(array_unique(array_filter($hosts)));
}

function handle_cors_preflight(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin) header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-VTO-Key');
        header('Access-Control-Max-Age: 86400');
        http_response_code(204);
        exit;
    }
}

/* ---------------- Rate limit ---------------- */

function rate_limit(string $name, int $perMinute, int $siteId): void
{
    $bucket = substr($name . ':' . $siteId . ':' . ip_hash(), 0, 120);
    $pdo = DB::pdo();
    $pdo->prepare(
        'INSERT INTO rate_limits (bucket, hits, window_start) VALUES (?, 1, NOW())
         ON DUPLICATE KEY UPDATE
           hits = IF(window_start < NOW() - INTERVAL 1 MINUTE, 1, hits + 1),
           window_start = IF(window_start < NOW() - INTERVAL 1 MINUTE, NOW(), window_start)'
    )->execute([$bucket]);
    $hits = (int)DB::val('SELECT hits FROM rate_limits WHERE bucket = ?', [$bucket]);
    if ($hits > $perMinute) json_error('Too many requests', 429);
}

/* ---------------- Misc ---------------- */

function new_api_key(): string
{
    return bin2hex(random_bytes(20)); // 40 hex chars
}

function e($s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function log_event(int $siteId, string $type, ?string $plan, ?string $pageType, ?string $url, array $meta = []): void
{
    DB::insert('events', [
        'site_id'   => $siteId,
        'type'      => $type,
        'plan'      => $plan,
        'page_type' => $pageType,
        'url'       => $url ? mb_substr($url, 0, 700) : null,
        'meta'      => $meta ? json_encode($meta, JSON_UNESCAPED_SLASHES) : null,
    ]);
}

/** Very light CSS selector sanity filter – blocks script-ish payloads coming from browsers. */
function valid_selector(string $sel): bool
{
    if ($sel === '' || strlen($sel) > 600) return false;
    // ">" is a valid CSS child combinator, so only block markup / CSS-block / script-ish payloads
    if (preg_match('/[<{};]|javascript:|expression\(|url\(/i', $sel)) return false;
    return true;
}
