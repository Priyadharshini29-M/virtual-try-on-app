<?php
declare(strict_types=1);

require_once 'Database.php';
require_once 'AppConfig.php';
require_once 'WidgetSettingsRepo.php';

use TryFit\Db\WidgetSettingsRepo;

try {
    $repo = new WidgetSettingsRepo();

    // 1. Mock data exactly as it comes from app.settings.jsx
    $testData = [
        'widget_title' => 'Test TryOn',
        'widget_subtitle' => 'Test Subtitle',
        'css' => [
            'button_color' => '#FF0000',
            'button_text_color' => '#FFFFFF',
            'button_border_radius' => 15,
            'title_font_size' => 22,
        ],
        'widget_language' => 'en',
        'show_on_collection' => true,
        'shopify_domain' => 'test.myshopify.com',
    ];

    // Use merchant_id 1 (exists in tryon_app.sql)
    $merchantId = 1;
    echo "Testing save for merchant_id: $merchantId...\n";

    $updated = $repo->patchButtonConfig($merchantId, $testData);

    echo "Saved successfully. Verifying DB content...\n";

    // 2. Verify the DB content directly via a raw query
    $db = \TryFit\Db\Database::getInstance();
    $stmt = $db->prepare("SELECT widget_config FROM merchant_settings WHERE merchant_id = ?");
    $stmt->execute([$merchantId]);
    $row = $stmt->fetch();

    if ($row) {
        echo "DB Value: " . $row['widget_config'] . "\n";

        $decoded = json_decode($row['widget_config'], true);
        if (isset($decoded['css']['button_color']) && $decoded['css']['button_color'] === '#FF0000') {
            echo "\n✅ SUCCESS: CSS is correctly stored in JSON format within widget_config.\n";
        } else {
            echo "\n❌ FAILURE: CSS not found in the expected JSON format.\n";
        }
    } else {
        echo "❌ FAILURE: No row found in database.\n";
    }

} catch (\Exception $e) {
    echo "❌ ERROR: " . $e->getMessage() . "\n";
}
