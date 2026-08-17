<?php

declare(strict_types=1);

// Front controller — all HTTP requests are routed here by .htaccess.
// Load AppConfig and helpers before router.php so this works
// regardless of which version of router.php is deployed on the server.
require_once __DIR__ . '/config/AppConfig.php';
require_once __DIR__ . '/shared/helpers.php';
require_once __DIR__ . '/router.php';

// No route matched
http_response_code(404);
header('Content-Type: application/json');
echo json_encode(['error' => 'Not Found']);
exit;
