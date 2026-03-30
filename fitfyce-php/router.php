<?php

declare(strict_types=1);

require_once __DIR__ . '/shared/helpers.php';

// Load .env if available (simple key=value parser, no extra library needed)
$envFile = __DIR__ . '/.env';
if (is_file($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (strpos($line, '=') !== false) {
            [$k, $v] = explode('=', $line, 2);
            $k = trim($k);
            $v = trim($v);
            if (!isset($_ENV[$k]) && getenv($k) === false) {
                putenv("{$k}={$v}");
                $_ENV[$k] = $v;
            }
        }
    }
}

// Autoload db layer
require_once __DIR__ . '/db/Database.php';
require_once __DIR__ . '/db/MerchantRepo.php';
require_once __DIR__ . '/db/SessionRepo.php';
require_once __DIR__ . '/db/ProductRepo.php';
require_once __DIR__ . '/db/AnalyticsRepo.php';

// Autoload middleware
require_once __DIR__ . '/middleware/CorsMiddleware.php';
require_once __DIR__ . '/middleware/ApiKeyAuth.php';
require_once __DIR__ . '/middleware/PlanLimitCheck.php';

// Autoload VTON classes (needed by TryOnController and api.php)
require_once __DIR__ . '/src/Config.php';
require_once __DIR__ . '/src/ImageUtils.php';
require_once __DIR__ . '/src/TryOnDiffusionClient.php';

// Autoload controllers
require_once __DIR__ . '/controllers/SessionController.php';
require_once __DIR__ . '/controllers/SettingsController.php';
require_once __DIR__ . '/controllers/ProductController.php';
require_once __DIR__ . '/controllers/AnalyticsController.php';
require_once __DIR__ . '/controllers/ConversionController.php';
require_once __DIR__ . '/controllers/PlanController.php';
require_once __DIR__ . '/controllers/UploadController.php';
require_once __DIR__ . '/controllers/MerchantController.php';
require_once __DIR__ . '/controllers/TryOnController.php';

use TryFit\Controllers\AnalyticsController;
use TryFit\Controllers\ConversionController;
use TryFit\Controllers\MerchantController;
use TryFit\Controllers\PlanController;
use TryFit\Controllers\ProductController;
use TryFit\Controllers\SessionController;
use TryFit\Controllers\SettingsController;
use TryFit\Controllers\UploadController;
use TryFit\Middleware\CorsMiddleware;

$path     = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$basePath = basePath();
$route    = $path;

if ($basePath !== '' && str_starts_with($path, $basePath)) {
    $route = substr($path, strlen($basePath));
}

// Normalise: ensure leading slash, strip trailing slash
$route = '/' . ltrim($route, '/');
$route = rtrim($route, '/') ?: '/';

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

$routes = [
    'POST /session/create'   => [SessionController::class,  'create'],
    'POST /session/track'    => [SessionController::class,  'track'],
    'GET /settings'          => [SettingsController::class, 'get'],
    'POST /settings'         => [SettingsController::class, 'save'],
    'GET /products'          => [ProductController::class,  'list'],
    'POST /products/sync'    => [ProductController::class,  'sync'],
    'GET /variants/mapping'  => [ProductController::class,  'getMappings'],
    'POST /variants/mapping' => [ProductController::class,  'saveMapping'],
    'GET /analytics'         => [AnalyticsController::class,'get'],
    'POST /conversion'       => [ConversionController::class,'record'],
    'GET /plans'                 => [PlanController::class,     'listPlans'],
    'GET /plan/limit'            => [PlanController::class,     'checkLimit'],
    'POST /plan/update'          => [PlanController::class,     'updatePlan'],
    'POST /upload-temp'          => [UploadController::class,   'uploadTemp'],
    'POST /tryon'                => [\TryFit\Controllers\TryOnController::class, 'handle'],
    'GET /merchant/by-domain'    => [MerchantController::class, 'byDomain'],
    'POST /merchant/register'    => [MerchantController::class, 'register'],
    'POST /merchant/deactivate'  => [MerchantController::class, 'deactivate'],
];

$key = "{$method} {$route}";

if (isset($routes[$key])) {
    CorsMiddleware::handle();
    [$class, $action] = $routes[$key];
    (new $class())->$action();
    exit;
}

// No route matched — fall through to the original api.php logic
