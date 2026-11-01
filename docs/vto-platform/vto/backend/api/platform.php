<?php
/**
 * POST /backend/api/platform.php   (server-to-server, called by FitFyce — never by browsers)
 * Signed with X-Platform-Timestamp / X-Platform-Signature (see lib/Platform.php).
 *
 * { "event": "store.updated",  "data": { "reason": "login|install|uninstall|app_toggle", "store": {...} } }
 * { "event": "wallet.changed", "data": { "reason": "wallet", "store": {...}, "transactions": [...] } }
 */
declare(strict_types=1);
require __DIR__ . '/../lib/bootstrap.php';
require __DIR__ . '/../lib/Platform.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('POST only', 405);

$raw = (string)file_get_contents('php://input');
if (strlen($raw) > 512 * 1024) json_error('Payload too large', 413);
if (!Platform::verify($raw)) json_error('Invalid signature', 401);

$b = json_decode($raw, true);
$event = is_array($b) ? (string)($b['event'] ?? '') : '';
$data  = is_array($b['data'] ?? null) ? $b['data'] : [];
if (!in_array($event, ['store.updated', 'wallet.changed'], true) || empty($data['store'])) json_error('Unknown event', 422);

Platform::upsertStore($data['store'], $event === 'wallet.changed' ? 'wallet' : (string)($data['reason'] ?? 'update'));
$added = $event === 'wallet.changed' ? Platform::insertLedger((array)($data['transactions'] ?? [])) : 0;

json_out(['ok' => true, 'ledger_added' => $added]);
