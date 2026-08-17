<?php
header('Content-Type: application/json');
try {
    require_once __DIR__ . '/config/AppConfig.php';
    require_once __DIR__ . '/db/Database.php';
    $pdo = \TryFit\Db\Database::getInstance();

    $result = ['database' => $pdo->query("SELECT DATABASE()")->fetchColumn(), 'tables' => []];

    $tables = $pdo->query("SHOW TABLES")->fetchAll(\PDO::FETCH_COLUMN);

    foreach ($tables as $table) {
        $columns = $pdo->query("SHOW FULL COLUMNS FROM `$table`")->fetchAll();
        $result['tables'][$table] = array_map(fn($c) => [
            'field'   => $c['Field'],
            'type'    => $c['Type'],
            'null'    => $c['Null'],
            'key'     => $c['Key'],
            'default' => $c['Default'],
            'extra'   => $c['Extra'],
        ], $columns);
    }

    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (\Throwable $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
