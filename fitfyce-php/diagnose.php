<?php
// Temporary diagnostic — delete after fixing.
header('Content-Type: text/plain');

echo "PHP " . PHP_VERSION . "\n\n";

$files = [
    'config/AppConfig.php',
    'shared/helpers.php',
    'db/Database.php',
    'db/MerchantRepo.php',
    'db/SessionRepo.php',
    'db/ProductRepo.php',
    'db/AnalyticsRepo.php',
    'db/ShopRepo.php',
    'db/ProductSummaryRepo.php',
    'db/WidgetSettingsRepo.php',
    'middleware/CorsMiddleware.php',
    'middleware/ApiKeyAuth.php',
    'middleware/PlanLimitCheck.php',
    'src/Config.php',
    'src/ImageUtils.php',
    'src/TryOnDiffusionClient.php',
    'controllers/SessionController.php',
    'controllers/SettingsController.php',
    'controllers/ProductController.php',
    'controllers/AnalyticsController.php',
    'controllers/ConversionController.php',
    'controllers/PlanController.php',
    'controllers/UploadController.php',
    'controllers/MerchantController.php',
    'controllers/TryOnController.php',
    'controllers/ShopController.php',
    'controllers/ProductDashboardController.php',
    'controllers/WidgetController.php',
];

$missing = [];
$present = [];
foreach ($files as $f) {
    $path = __DIR__ . '/' . $f;
    if (file_exists($path)) {
        $present[] = $f;
    } else {
        $missing[] = $f;
    }
}

echo "PRESENT (" . count($present) . "):\n";
foreach ($present as $f) echo "  OK  $f\n";

echo "\nMISSING (" . count($missing) . "):\n";
foreach ($missing as $f) echo "  !! $f\n";

// Try loading the chain
echo "\n--- LOAD TEST ---\n";
set_error_handler(function($errno, $errstr, $errfile, $errline) {
    echo "ERROR [$errno] $errstr in $errfile:$errline\n";
    return true;
});

foreach (['config/AppConfig.php', 'shared/helpers.php'] as $f) {
    $path = __DIR__ . '/' . $f;
    if (file_exists($path)) {
        try {
            require_once $path;
            echo "LOADED: $f\n";
        } catch (\Throwable $e) {
            echo "FAILED: $f — " . $e->getMessage() . "\n";
        }
    }
}

echo "\nDone.\n";
