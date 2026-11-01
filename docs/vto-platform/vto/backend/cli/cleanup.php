<?php
// Cron (hourly):  0 * * * * php /var/www/vto/backend/cli/cleanup.php
// Deletes shopper photos/garments older than user_image_ttl_hours and trims old telemetry.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require __DIR__ . '/../lib/bootstrap.php';

$ttl = (int)cfg('user_image_ttl_hours', 24);
$dir = rtrim(cfg('upload_dir'), '/');
$cut = time() - $ttl * 3600;
$deleted = 0;
foreach (['user', 'garment'] as $sub) {
    foreach (glob("$dir/$sub/*") ?: [] as $file) {
        if (filemtime($file) < $cut) { unlink($file); $deleted++; }
    }
}
DB::run("DELETE FROM events WHERE created_at < NOW() - INTERVAL 90 DAY");
DB::run("DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL 1 HOUR");
echo "Deleted $deleted private images\n";
