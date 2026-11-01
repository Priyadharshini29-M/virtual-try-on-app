<?php
require __DIR__ . '/_init.php';
$me = require_login('super');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    $action = $_POST['action'] ?? '';
    if ($action === 'save') {
        $email = strtolower(trim((string)$_POST['email']));
        $role = in_array($_POST['role'] ?? '', ['super', 'manager', 'viewer'], true) ? $_POST['role'] : 'viewer';
        $pass = (string)($_POST['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || trim($_POST['name']) === '') {
            flash('Name and valid email required', 'err');
        } elseif ($existing = DB::one('SELECT id FROM admins WHERE email = ?', [$email])) {
            $data = ['name' => trim($_POST['name']), 'role' => $role];
            if ($pass !== '') {
                if (strlen($pass) < 10) { flash('Password must be at least 10 characters', 'err'); redirect('admins.php'); }
                $data['password_hash'] = password_hash($pass, PASSWORD_DEFAULT);
            }
            DB::update('admins', $data, 'id = ?', [$existing['id']]);
            flash('Admin updated');
        } else {
            if (strlen($pass) < 10) { flash('Password must be at least 10 characters', 'err'); redirect('admins.php'); }
            DB::insert('admins', ['name' => trim($_POST['name']), 'email' => $email, 'role' => $role, 'password_hash' => password_hash($pass, PASSWORD_DEFAULT)]);
            flash('Admin created');
        }
    } elseif ($action === 'delete' && (int)$_POST['aid'] !== (int)$me['id']) {
        DB::run('DELETE FROM admins WHERE id = ?', [(int)$_POST['aid']]);
        flash('Admin removed');
    }
    redirect('admins.php');
}

$rows = DB::all('SELECT id, name, email, role, last_login_at, created_at FROM admins ORDER BY id');
layout_start('Admin users', 'admins.php');
?>
<div class="card"><h3>Add or update admin</h3>
<form method="post" class="form-grid">
  <?= csrf_field() ?><input type="hidden" name="action" value="save">
  <label>Name<input name="name" required></label>
  <label>Email<input type="email" name="email" required></label>
  <label>Role<select name="role"><option value="viewer">viewer – read only</option><option value="manager">manager – edit sites</option><option value="super">super – everything</option></select></label>
  <label>Password <small>(leave blank to keep when updating)</small><input type="password" name="password" minlength="10"></label>
  <div><button class="btn">Save</button></div>
</form></div>
<div class="card"><table><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th></th></tr>
<?php foreach ($rows as $r): ?><tr><td><?= e($r['name']) ?></td><td><?= e($r['email']) ?></td><td><?= e($r['role']) ?></td><td><small><?= e($r['last_login_at'] ?? 'never') ?></small></td>
<td><?php if ($r['id'] != $me['id']): ?><form method="post" onsubmit="return confirm('Remove admin?')"><?= csrf_field() ?><input type="hidden" name="action" value="delete"><input type="hidden" name="aid" value="<?= $r['id'] ?>"><button class="btn sm ghost">Remove</button></form><?php endif; ?></td></tr><?php endforeach; ?>
</table></div>
<?php layout_end();
