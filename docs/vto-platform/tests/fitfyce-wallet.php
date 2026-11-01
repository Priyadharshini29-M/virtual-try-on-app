<?php
// Test helper: change a LOCAL FitFyce wallet through FitFyce's own WalletRepo, exactly like a
// Razorpay top-up would, so its push to the platform admin can be observed.
//   php tests/fitfyce-wallet.php <merchant_id> <+credits|-credits> "<note>"
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit(1);
[$_, $merchantId, $delta, $note] = array_pad($argv, 4, 'test');
$root = getenv('FITFYCE_PHP') ?: __DIR__ . '/../../../fitfyce-php';

foreach (['/.env' => false, '/.env.local' => true] as $f => $force) {          // same loader as router.php
    if (!is_file($root . $f)) continue;
    foreach (file($root . $f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
        [$k, $v] = array_map('trim', explode('=', $line, 2));
        if ($force || getenv($k) === false) putenv("$k=$v");
    }
}
require $root . '/shared/helpers.php';
require $root . '/config/AppConfig.php';
require $root . '/db/Database.php';
require $root . '/db/WalletRepo.php';
require $root . '/src/PlatformSync.php';

$repo = new \TryFit\Db\WalletRepo();
$d = (int)$delta;
if ($d > 0) {
    $balance = $repo->credit((int)$merchantId, $d, 'admin_grant', 'test', null, $note);
} else {
    $repo->debit((int)$merchantId, -$d, 'admin_debit', 'test', null, $note);
    $balance = $repo->balance((int)$merchantId);
}
echo json_encode(['merchant' => (int)$merchantId, 'delta' => $d, 'balance' => $balance]), "\n";
// PlatformSync pushes to the platform admin at shutdown
