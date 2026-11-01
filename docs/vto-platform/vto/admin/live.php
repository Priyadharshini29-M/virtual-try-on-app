<?php
// Fingerprint of the store / wallet data; admin pages marked "● live" poll it and reload when it changes.
require __DIR__ . '/_init.php';
if (!admin()) { http_response_code(401); exit; }
$r = DB::one('SELECT COUNT(*) n, MAX(synced_at) s, (SELECT COALESCE(MAX(id),0) FROM wallet_ledger) l,
                     (SELECT MAX(updated_at) FROM platform_settings) p FROM stores');
header('Content-Type: application/json');
header('Cache-Control: no-store');
echo json_encode(['stamp' => sha1(implode('|', array_map('strval', $r)))]);
