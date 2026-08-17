<?php
header('Content-Type: application/json');
$result = ['opcache_reset' => false, 'opcache_enabled' => false];
if (function_exists('opcache_get_status')) {
    $result['opcache_enabled'] = true;
    $result['opcache_reset'] = opcache_reset();
}
echo json_encode($result);
