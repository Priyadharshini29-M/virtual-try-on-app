<?php
declare(strict_types=1);

$GLOBALS['VTO_CONFIG'] = require __DIR__ . '/../config.php';

function cfg(string $path, $default = null) {
    $node = $GLOBALS['VTO_CONFIG'];
    foreach (explode('.', $path) as $k) {
        if (!is_array($node) || !array_key_exists($k, $node)) return $default;
        $node = $node[$k];
    }
    return $node;
}

if (!cfg('debug')) {
    ini_set('display_errors', '0');
}
error_reporting(E_ALL);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/helpers.php';
