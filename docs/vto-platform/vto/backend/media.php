<?php
/**
 * Serves try-on result images (and, for logged-in admins, shopper photos).
 * Files live outside any executable path; names are 128-bit random tokens.
 */
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

$f = (string)($_GET['f'] ?? '');
if (!preg_match('#^(user|garment|result)/[a-f0-9]{32}\.(jpg|png|webp|img)$#', $f, $m)) {
    http_response_code(404); exit;
}

// Shopper photos & garments are private: admin session required
if ($m[1] !== 'result') {
    session_name('vto_admin');
    session_start();
    if (empty($_SESSION['admin_id'])) { http_response_code(403); exit; }
}

$path = rtrim(cfg('upload_dir'), '/') . '/' . $f;
if (!is_file($path)) { http_response_code(404); exit; }

$mime = (new finfo(FILEINFO_MIME_TYPE))->file($path) ?: 'application/octet-stream';
if (!str_starts_with($mime, 'image/')) { http_response_code(415); exit; }

header('Content-Type: ' . $mime);
header('Content-Length: ' . filesize($path));
header('Cache-Control: private, max-age=86400');
header('X-Content-Type-Options: nosniff');
header('Access-Control-Allow-Origin: *');
readfile($path);
