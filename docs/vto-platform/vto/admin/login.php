<?php
require __DIR__ . '/_init.php';

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    $_SESSION['login_tries'] = ($_SESSION['login_tries'] ?? 0) + 1;
    if ($_SESSION['login_tries'] > 8) {
        $error = 'Too many attempts. Try again later.';
    } else {
        $row = DB::one('SELECT * FROM admins WHERE email = ?', [strtolower(trim($_POST['email'] ?? ''))]);
        if ($row && password_verify($_POST['password'] ?? '', $row['password_hash'])) {
            session_regenerate_id(true);
            $_SESSION['admin_id'] = (int)$row['id'];
            $_SESSION['login_tries'] = 0;
            DB::run('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [$row['id']]);
            if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
                DB::run('UPDATE admins SET password_hash = ? WHERE id = ?', [password_hash($_POST['password'], PASSWORD_DEFAULT), $row['id']]);
            }
            redirect('index.php');
        }
        $error = 'Wrong email or password.';
    }
}
?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · <?= e(cfg('app_name')) ?></title><link rel="stylesheet" href="assets/admin.css"></head>
<body class="login"><form method="post" class="card loginbox">
  <div class="brand">◐ <?= e(cfg('app_name')) ?></div>
  <?php if ($error): ?><div class="flash err"><?= e($error) ?></div><?php endif; ?>
  <?= csrf_field() ?>
  <label>Email<input type="email" name="email" required autofocus></label>
  <label>Password<input type="password" name="password" required></label>
  <button class="btn">Sign in</button>
</form></body></html>
