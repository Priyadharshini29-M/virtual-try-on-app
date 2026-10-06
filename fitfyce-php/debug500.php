<?php
// TEMPORARY debug script — delete after use.
// Scans router.php's require_once targets and reports every missing file
// in one pass, instead of discovering them one fatal error at a time.
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

echo "PHP version: " . PHP_VERSION . "\n\n";

$routerSrc = file_get_contents(__DIR__ . '/router.php');
preg_match_all("/require_once __DIR__ \. '([^']+)'/", $routerSrc, $matches);

$missing = [];
$present = 0;
foreach ($matches[1] as $rel) {
    $full = __DIR__ . $rel;
    if (is_file($full)) {
        $present++;
    } else {
        $missing[] = $rel;
    }
}

echo "Checked " . count($matches[1]) . " require_once targets in router.php\n";
echo "Present: {$present}\n";
echo "Missing: " . count($missing) . "\n\n";

if ($missing) {
    echo "MISSING FILES:\n";
    foreach ($missing as $m) {
        echo "  {$m}\n";
    }
} else {
    echo "All require_once targets are present. Trying a full require of router.php...\n";
    flush();
    require __DIR__ . '/router.php';
    echo "router.php loaded without a fatal error.\n";
}
