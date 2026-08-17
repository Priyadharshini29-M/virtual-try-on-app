<?php
header('Content-Type: application/json');
require_once __DIR__ . '/config/AppConfig.php';
require_once __DIR__ . '/db/Database.php';
$pdo = \TryFit\Db\Database::getInstance();
$rows = $pdo->query("SELECT ms.*, m.shopify_domain as m_domain FROM merchant_settings ms LEFT JOIN merchants m ON m.id = ms.merchant_id ORDER BY ms.id")->fetchAll();
echo json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
