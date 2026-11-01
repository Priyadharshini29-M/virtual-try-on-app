<?php
// Usage: php backend/cli/create_admin.php "Full Name" email@domain.com 'StrongPassword' [super|manager|viewer]
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require __DIR__ . '/../lib/bootstrap.php';

[$_, $name, $email, $pass] = array_pad($argv, 4, null);
$role = $argv[4] ?? 'super';
if (!$name || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen((string)$pass) < 10) {
    exit("Usage: php create_admin.php \"Name\" email password(min 10 chars) [role]\n");
}
DB::run(
    'INSERT INTO admins (name, email, password_hash, role) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), role = VALUES(role)',
    [$name, strtolower($email), password_hash($pass, PASSWORD_DEFAULT), $role]
);
echo "Admin $email saved with role $role\n";
