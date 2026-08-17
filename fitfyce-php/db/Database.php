<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

// Self-heal: load AppConfig if router.php on the server is an older version
// that doesn't require it before this file is included.
if (!class_exists('TryFit\AppConfig', false)) {
    require_once dirname(__DIR__) . '/config/AppConfig.php';
}

use TryFit\AppConfig;

class Database
{
    private static ?PDO $instance = null;

    /**
     * Self-healing singleton — a single request can run long enough (the
     * synchronous infographic pipeline in particular: InfographicController's
     * doCreate()/doGenerate()/doEdit() can spend 60-200s+ across several
     * OpenAI HTTP calls with no query in between) to outlive MySQL's own
     * connection `wait_timeout`, which shared hosting often sets fairly
     * short. The server silently drops the idle connection; the NEXT query
     * on it then fails with "MySQL server has gone away" (SQLSTATE HY000,
     * error 2006) instead of a normal catchable app-level error. Rather than
     * push reconnect-handling into every caller, this method verifies the
     * cached connection is actually alive (a trivial `SELECT 1`) before
     * handing it out, and transparently reconnects if not — callers that
     * fetch a fresh instance right before they need it are fully covered; a
     * repo that caches the PDO object from a much earlier `getInstance()`
     * call is not helped by this alone (the check only runs when
     * getInstance() itself is called).
     */
    public static function getInstance(): PDO
    {
        if (self::$instance === null) {
            self::$instance = self::connect();
            return self::$instance;
        }

        try {
            self::$instance->query('SELECT 1');
        } catch (\Throwable $e) {
            self::$instance = self::connect();
        }

        return self::$instance;
    }

    private static function connect(): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;dbname=%s;charset=%s',
            AppConfig::dbHost(),
            AppConfig::dbName(),
            AppConfig::dbCharset()
        );

        $pdo = new PDO(
            $dsn,
            AppConfig::dbUser(),
            AppConfig::dbPass(),
            [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]
        );

        $pdo->exec("SET time_zone = '+05:30'");

        return $pdo;
    }
}
