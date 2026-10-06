<?php

declare(strict_types=1);

require_once __DIR__ . '/shared/helpers.php';
require_once __DIR__ . '/config/AppConfig.php';

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
require_once __DIR__ . '/db/LeadRepo.php';
require_once __DIR__ . '/db/ProductRepo.php';
require_once __DIR__ . '/db/AnalyticsRepo.php';
require_once __DIR__ . '/db/ShopRepo.php';
require_once __DIR__ . '/db/ProductSummaryRepo.php';
require_once __DIR__ . '/db/WidgetSettingsRepo.php';
// Guarded: missing on the server right now (Size Chart not in use) — without
// this guard, a missing file here would fatal the entire router, breaking
// every unrelated route (widget settings, uploads, AI Studio, etc).
if (is_file(__DIR__ . '/db/SizeChartRepo.php')) {
    require_once __DIR__ . '/db/SizeChartRepo.php';
}
// Guarded for the same reason — also missing on the server right now.
if (is_file(__DIR__ . '/db/ProductPairingRepo.php')) {
    require_once __DIR__ . '/db/ProductPairingRepo.php';
}

// Autoload middleware
require_once __DIR__ . '/middleware/CorsMiddleware.php';
require_once __DIR__ . '/middleware/ApiKeyAuth.php';
require_once __DIR__ . '/middleware/PlanLimitCheck.php';

// Autoload VTON classes
require_once __DIR__ . '/src/Config.php';
require_once __DIR__ . '/src/ImageUtils.php';
require_once __DIR__ . '/src/TryOnDiffusionClient.php';
require_once __DIR__ . '/src/RunpodVtonClient.php';
require_once __DIR__ . '/src/FashnClient.php';
require_once __DIR__ . '/src/HfSpaceClient.php';
require_once __DIR__ . '/src/AccessoryJobs.php';
require_once __DIR__ . '/src/SareeRouting.php';

// Autoload controllers
require_once __DIR__ . '/controllers/SessionController.php';
require_once __DIR__ . '/controllers/LeadController.php';
require_once __DIR__ . '/controllers/SettingsController.php';
require_once __DIR__ . '/controllers/ProductController.php';
require_once __DIR__ . '/controllers/AnalyticsController.php';
require_once __DIR__ . '/controllers/ConversionController.php';
require_once __DIR__ . '/controllers/PlanController.php';
require_once __DIR__ . '/controllers/UploadController.php';
require_once __DIR__ . '/controllers/MerchantController.php';
require_once __DIR__ . '/controllers/OnboardingController.php';
require_once __DIR__ . '/db/DefaultModelCatalog.php';
require_once __DIR__ . '/controllers/DefaultModelsController.php';
require_once __DIR__ . '/controllers/TryOnController.php';
require_once __DIR__ . '/controllers/ShopController.php';
require_once __DIR__ . '/controllers/ProductDashboardController.php';
require_once __DIR__ . '/controllers/WidgetController.php';
// Guarded alongside db/SizeChartRepo.php above — see that comment.
if (is_file(__DIR__ . '/controllers/SizeChartController.php')) {
    require_once __DIR__ . '/controllers/SizeChartController.php';
}
// Guarded for the same reason — also missing on the server right now.
if (is_file(__DIR__ . '/controllers/CompleteLookController.php')) {
    require_once __DIR__ . '/controllers/CompleteLookController.php';
}
require_once __DIR__ . '/controllers/ShopifySyncController.php';
require_once __DIR__ . '/src/ShopifyApi.php';
require_once __DIR__ . '/db/GarmentStudioRepo.php';
require_once __DIR__ . '/controllers/GarmentStudioController.php';
require_once __DIR__ . '/controllers/AccessoryWorkerController.php';
require_once __DIR__ . '/src/InfographicSkillLibrary.php';
require_once __DIR__ . '/src/OpenAIClient.php';
require_once __DIR__ . '/src/S3Client.php';
require_once __DIR__ . '/src/QdrantClient.php';
require_once __DIR__ . '/src/VectorStoreInterface.php';
require_once __DIR__ . '/db/QdrantVectorStore.php';
require_once __DIR__ . '/src/RagIngestor.php';
require_once __DIR__ . '/src/RagRetriever.php';
require_once __DIR__ . '/controllers/RagController.php';
require_once __DIR__ . '/controllers/InfographicController.php';
require_once __DIR__ . '/db/SavedModelRepo.php';
require_once __DIR__ . '/db/GenerationRepo.php';
require_once __DIR__ . '/db/InfographicGenRepo.php';
require_once __DIR__ . '/db/AssetRepo.php';
require_once __DIR__ . '/controllers/StudioV2Controller.php';

use TryFit\Controllers\AnalyticsController;
use TryFit\Controllers\ConversionController;
use TryFit\Controllers\LeadController;
use TryFit\Controllers\MerchantController;
use TryFit\Controllers\PlanController;
use TryFit\Controllers\ProductController;
use TryFit\Controllers\ProductDashboardController;
use TryFit\Controllers\SessionController;
use TryFit\Controllers\SettingsController;
use TryFit\Controllers\ShopController;
use TryFit\Controllers\ShopifySyncController;
use TryFit\Controllers\UploadController;
use TryFit\Controllers\WidgetController;
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
    'POST /session/create'       => [SessionController::class,  'create'],
    'POST /session/track'        => [SessionController::class,  'track'],
    'POST /api/session/create'   => [SessionController::class,  'create'],
    'POST /api/session/track'    => [SessionController::class,  'track'],
    'POST /lead/capture'         => [LeadController::class,     'capture'],
    'POST /api/lead/capture'     => [LeadController::class,     'capture'],
    'GET /lead/list'             => [LeadController::class,     'list'],
    'GET /leads'                 => [LeadController::class,     'listForMerchant'],
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
    'POST /api/tryon'            => [\TryFit\Controllers\TryOnController::class, 'handle'],
    'GET /tryon-status'          => [\TryFit\Controllers\TryOnController::class, 'status'],
    'GET /api/tryon-status'      => [\TryFit\Controllers\TryOnController::class, 'status'],
    'GET /merchant/by-domain'    => [MerchantController::class,        'byDomain'],
    'POST /merchant/register'    => [MerchantController::class,        'register'],
    'POST /merchant/deactivate'  => [MerchantController::class,        'deactivate'],
    'GET /merchant/onboarding'   => [\TryFit\Controllers\OnboardingController::class, 'get'],
    'POST /merchant/onboarding'  => [\TryFit\Controllers\OnboardingController::class, 'save'],
    // Built-in model library for AI Studio (photos generated by generate-default-models.php)
    'GET /studio/default-models'           => [\TryFit\Controllers\DefaultModelsController::class, 'list'],
    'POST /studio/default-models/activate' => [\TryFit\Controllers\DefaultModelsController::class, 'activate'],
    'GET /shop'                  => [ShopController::class,            'get'],
    'GET /shop/products'         => [ProductDashboardController::class, 'get'],
    'GET /api/widget-settings'   => [WidgetController::class,          'publicGet'],
    'POST /api/widget-event'     => [WidgetController::class,          'publicTrackEvent'],
    'GET /widget/settings'       => [WidgetController::class,          'get'],
    'PATCH /widget/settings'     => [WidgetController::class,          'patch'],

    // Size Chart module
    'GET /size-chart'            => [\TryFit\Controllers\SizeChartController::class, 'list'],
    'POST /size-chart'           => [\TryFit\Controllers\SizeChartController::class, 'create'],
    'PATCH /size-chart'          => [\TryFit\Controllers\SizeChartController::class, 'update'],
    'DELETE /size-chart'         => [\TryFit\Controllers\SizeChartController::class, 'delete'],
    'POST /size-chart/assign'    => [\TryFit\Controllers\SizeChartController::class, 'assign'],
    'DELETE /size-chart/assign'  => [\TryFit\Controllers\SizeChartController::class, 'unassign'],
    'POST /size-chart/enabled'   => [\TryFit\Controllers\SizeChartController::class, 'setEnabled'],
    'GET /api/size-chart'        => [\TryFit\Controllers\SizeChartController::class, 'publicGet'],

    // Complete Your Look module
    'GET /complete-look'             => [\TryFit\Controllers\CompleteLookController::class, 'list'],
    'POST /complete-look/pairings'   => [\TryFit\Controllers\CompleteLookController::class, 'setPairings'],
    'POST /complete-look/enabled'    => [\TryFit\Controllers\CompleteLookController::class, 'setEnabled'],
    'GET /api/complete-look'         => [\TryFit\Controllers\CompleteLookController::class, 'publicGet'],
    'POST /shopify/sync'         => [ShopifySyncController::class,     'sync'],
    // Garment Studio (merchant-facing multi-image try-on)
    'POST /studio/generate'       => [\TryFit\Controllers\GarmentStudioController::class, 'generate'],
    'GET /studio/generate-status' => [\TryFit\Controllers\GarmentStudioController::class, 'checkGenerationStatus'],
    'GET /studio/setup-check'     => [\TryFit\Controllers\GarmentStudioController::class, 'setupCheck'],
    'GET /studio/models'          => [\TryFit\Controllers\GarmentStudioController::class, 'getModels'],
    'GET /studio/session'         => [\TryFit\Controllers\GarmentStudioController::class, 'getSession'],
    'GET /studio/sessions'        => [\TryFit\Controllers\GarmentStudioController::class, 'listSessions'],
    // Background worker for accessory try-ons (HMAC-signed loopback only — see AccessoryJobs)
    'POST /accessory-worker'      => [\TryFit\Controllers\AccessoryWorkerController::class, 'run'],
    'POST /studio/save-gallery'   => [\TryFit\Controllers\GarmentStudioController::class, 'saveGallery'],
    'POST /studio/set-model-image'=> [\TryFit\Controllers\GarmentStudioController::class, 'setModelImage'],
    'DELETE /studio/model-image'  => [\TryFit\Controllers\GarmentStudioController::class, 'deleteModelImage'],
    // Infographic (OpenAI GPT key-point extraction + PHP GD composition)
    'POST /infographic/create'         => [\TryFit\Controllers\InfographicController::class, 'create'],
    'POST /infographic/extract-points' => [\TryFit\Controllers\InfographicController::class, 'extract'],
    'POST /infographic/generate'       => [\TryFit\Controllers\InfographicController::class, 'generate'],
    'POST /infographic/edit'           => [\TryFit\Controllers\InfographicController::class, 'edit'],
    // RAG knowledge index (grounds infographic generation — see RagController)
    'POST /rag/reindex' => [\TryFit\Controllers\RagController::class, 'reindex'],
    'GET /rag/status'   => [\TryFit\Controllers\RagController::class, 'status'],
    // Studio v2 (single-flow AI Studio: saved models, FASHN generation, auto OpenAI marketing infographics)
    'POST /studio-v2/models'                      => [\TryFit\Controllers\StudioV2Controller::class, 'uploadSavedModel'],
    'GET /studio-v2/models'                       => [\TryFit\Controllers\StudioV2Controller::class, 'listSavedModels'],
    'DELETE /studio-v2/models'                    => [\TryFit\Controllers\StudioV2Controller::class, 'deleteSavedModel'],
    'POST /studio-v2/generate'                    => [\TryFit\Controllers\StudioV2Controller::class, 'generate'],
    'GET /studio-v2/generate-status'              => [\TryFit\Controllers\StudioV2Controller::class, 'checkGenerationStatus'],
    'POST /studio-v2/regenerate-infographics'     => [\TryFit\Controllers\StudioV2Controller::class, 'regenerateInfographics'],
    'DELETE /studio-v2/generation'                => [\TryFit\Controllers\StudioV2Controller::class, 'deleteGeneration'],
    'GET /studio-v2/generations'                  => [\TryFit\Controllers\StudioV2Controller::class, 'listGenerations'],
    'GET /studio-v2/generation'                   => [\TryFit\Controllers\StudioV2Controller::class, 'getGeneration'],
    'GET /studio-v2/assets'                       => [\TryFit\Controllers\StudioV2Controller::class, 'listAssets'],
];

$key = "{$method} {$route}";

if (isset($routes[$key])) {
    CorsMiddleware::handle();
    [$class, $action] = $routes[$key];
    (new $class())->$action();
    exit;
}

// Dynamic route: PUT /variants/mapping/{id}
if ($method === 'PUT' && preg_match('#^/variants/mapping/\d+$#', $route)) {
    CorsMiddleware::handle();
    (new ProductController())->updateMapping();
    exit;
}

// No route matched — fall through to the original api.php logic
