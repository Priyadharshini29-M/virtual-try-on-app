<?php
header('Content-Type: application/json');
$base = __DIR__ . '/';
$files = [
    'shared/helpers.php','config/AppConfig.php','db/Database.php',
    'db/MerchantRepo.php','db/SessionRepo.php','db/ProductRepo.php',
    'db/AnalyticsRepo.php','db/ShopRepo.php','db/ProductSummaryRepo.php',
    'db/WidgetSettingsRepo.php','middleware/CorsMiddleware.php',
    'middleware/ApiKeyAuth.php','middleware/PlanLimitCheck.php',
    'src/Config.php','src/ImageUtils.php','src/TryOnDiffusionClient.php',
    'controllers/SessionController.php','controllers/SettingsController.php',
    'controllers/ProductController.php','controllers/AnalyticsController.php',
    'controllers/ConversionController.php','controllers/PlanController.php',
    'controllers/UploadController.php','controllers/MerchantController.php',
    'controllers/TryOnController.php','controllers/ShopController.php',
    'controllers/ProductDashboardController.php','controllers/WidgetController.php',
];
$out = [];
foreach ($files as $f) {
    $out[$f] = file_exists($base . $f) ? 'exists' : 'MISSING';
}
echo json_encode($out, JSON_PRETTY_PRINT);
