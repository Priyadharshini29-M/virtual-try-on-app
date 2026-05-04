<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;
use TryFit\AppConfig;

class Database
{
    private static ?PDO $instance = null;

    public static function getInstance(): PDO
    {
        if (self::$instance === null) {
            self::$instance = new PDO(
                'mysql:host=' . AppConfig::dbHost()
                    . ';dbname=' . AppConfig::dbName()
                    . ';charset=utf8mb4',
                AppConfig::dbUser(),
                AppConfig::dbPass(),
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                ]
            );
        }

        return self::$instance;
    }
}
