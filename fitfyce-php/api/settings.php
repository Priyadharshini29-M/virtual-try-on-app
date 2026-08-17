<?php



require_once __DIR__ . '/../config/AppConfig.php';

require_once __DIR__ . '/../controllers/SettingsController.php';

use TryFit\Controllers\SettingsController;

$controller = new SettingsController();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $controller->get();
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $controller->save();
} else {
    http_response_code(405);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Method Not Allowed']);
}
