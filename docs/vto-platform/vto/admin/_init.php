<?php
declare(strict_types=1);
require __DIR__ . '/../backend/lib/bootstrap.php';

session_name('vto_admin');
session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Lax',
    'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
]);
session_start();

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

function admin(): ?array
{
    static $a = false;
    if ($a === false) {
        $a = !empty($_SESSION['admin_id']) ? DB::one('SELECT id, name, email, role FROM admins WHERE id = ?', [$_SESSION['admin_id']]) : null;
    }
    return $a;
}

function require_login(?string $role = null): array
{
    $a = admin();
    if (!$a) { header('Location: login.php'); exit; }
    if ($role === 'super' && $a['role'] !== 'super') { http_response_code(403); exit('Forbidden'); }
    return $a;
}

function can_edit(): bool { return in_array(admin()['role'] ?? '', ['super', 'manager'], true); }

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}
function csrf_field(): string { return '<input type="hidden" name="csrf" value="' . csrf_token() . '">'; }
function check_csrf(): void
{
    if (!hash_equals($_SESSION['csrf'] ?? '', (string)($_POST['csrf'] ?? ''))) { http_response_code(400); exit('Invalid CSRF token'); }
}
function require_post_edit(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') return;
    check_csrf();
    if (!can_edit()) { http_response_code(403); exit('Read-only account'); }
}

function flash(?string $msg = null, string $type = 'ok')
{
    if ($msg !== null) { $_SESSION['flash'] = [$type, $msg]; return null; }
    $f = $_SESSION['flash'] ?? null; unset($_SESSION['flash']);
    return $f;
}
function redirect(string $to): void { header('Location: ' . $to); exit; }

function badge(string $v): string
{
    $map = [
        'active' => 'g', 'done' => 'g', 'inject_ok' => 'g', 'tryon_ok' => 'g',
        'pending' => 'y', 'queued' => 'y', 'running' => 'b', 'processing' => 'b', 'plan_fallback' => 'y', 'click' => 'b',
        'paused' => 'r', 'uninstalled' => 'r', 'app off' => 'y', 'disabled' => 'r', 'failed' => 'r', 'inject_fail' => 'r', 'tryon_fail' => 'r',
        'scrapy' => 'p', 'block' => 'b', 'inspect' => 'y', 'manual' => 'g',
    ];
    return '<span class="badge ' . ($map[$v] ?? '') . '">' . e($v) . '</span>';
}

function layout_start(string $title, string $active = ''): void
{
    $a = admin();
    $nav = [
        'index.php' => 'Dashboard', 'stores.php' => 'Stores', 'wallet.php' => 'Wallet', 'sites.php' => 'Sites', 'scans.php' => 'Scans',
        'tryons.php' => 'Try-ons', 'events.php' => 'Events',
    ];
    if (($a['role'] ?? '') === 'super') $nav['admins.php'] = 'Admins';
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<title>' . e($title) . ' · ' . e(cfg('app_name')) . '</title><link rel="stylesheet" href="assets/admin.css"></head><body>';
    echo '<aside class="side"><div class="brand">◐ ' . e(cfg('app_name')) . '</div><nav>';
    foreach ($nav as $href => $label) {
        echo '<a href="' . $href . '" class="' . ($active === $href ? 'on' : '') . '">' . $label . '</a>';
    }
    echo '</nav><div class="me">' . e($a['name'] ?? '') . '<br><small>' . e($a['role'] ?? '') . '</small><br><a href="logout.php">Log out</a></div></aside>';
    echo '<main><h1>' . e($title) . '</h1>';
    if ($f = flash()) echo '<div class="flash ' . e($f[0]) . '">' . e($f[1]) . '</div>';
}

function layout_end(): void
{
    // Pages showing "● live" reload as soon as FitFyce pushes a store or wallet change,
    // unless the admin is in the middle of editing a form.
    echo <<<'HTML'
<script>
(function () {
  if (!document.querySelector('.live-flag')) return;
  var stamp = null, dirty = false;
  document.addEventListener('input', function () { dirty = true; });
  function tick() {
    fetch('live.php', { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      if (stamp === null) stamp = j.stamp;
      else if (j.stamp !== stamp && !dirty && !document.activeElement.closest('form')) location.reload();
    }).catch(function () {}).then(function () { setTimeout(tick, 1000); });
  }
  tick();
})();
</script>
HTML;
    echo '</main></body></html>';
}

function paginate(int $total, int $per, int $page, array $q = []): string
{
    $pages = max(1, (int)ceil($total / $per));
    if ($pages === 1) return '';
    $out = '<div class="pager">';
    for ($i = max(1, $page - 4); $i <= min($pages, $page + 4); $i++) {
        $out .= '<a class="' . ($i === $page ? 'on' : '') . '" href="?' . e(http_build_query($q + ['page' => $i])) . '">' . $i . '</a>';
    }
    return $out . '</div>';
}
