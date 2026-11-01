<?php
require __DIR__ . '/_init.php';
require_login();
require_post_edit();

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'create') {
    $domain = normalize_host((string)$_POST['domain']);
    $name = trim((string)$_POST['name']);
    $start = trim((string)$_POST['start_url']) ?: 'https://' . $domain . '/';
    if ($name === '' || !preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $domain)) {
        flash('Enter a name and a valid domain (e.g. vilvah.com)', 'err');
    } elseif (DB::val('SELECT id FROM sites WHERE domain = ?', [$domain])) {
        flash('That domain already exists', 'err');
    } else {
        $id = DB::insert('sites', [
            'name' => $name, 'domain' => $domain, 'api_key' => new_api_key(),
            'start_url' => $start, 'category' => $_POST['category'] ?? 'apparel',
        ]);
        if (!empty($_POST['scan_now'])) {
            DB::insert('scans', ['site_id' => $id, 'start_url' => $start, 'requested_by' => admin()['id']]);
        }
        flash('Site created. Copy the embed code below and send it to the merchant.');
        redirect('site.php?id=' . $id);
    }
    redirect('sites.php');
}

$q = trim((string)($_GET['q'] ?? ''));
$rows = DB::all(
    "SELECT s.*,
            (SELECT COUNT(*) FROM selectors x WHERE x.site_id = s.id AND x.status='active') sel_active,
            (SELECT COUNT(*) FROM tryon_sessions t WHERE t.site_id = s.id AND t.created_at >= NOW() - INTERVAL 30 DAY) tries,
            (SELECT MAX(created_at) FROM events v WHERE v.site_id = s.id) last_seen
       FROM sites s
      WHERE (? = '' OR s.name LIKE ? OR s.domain LIKE ?)
      ORDER BY s.created_at DESC",
    [$q, "%$q%", "%$q%"]
);

layout_start('Sites', 'sites.php');
?>
<?php if (can_edit()): ?>
<details class="card"><summary><b>+ Add a store</b></summary>
<form method="post" class="form-grid">
  <?= csrf_field() ?><input type="hidden" name="action" value="create">
  <label>Store name<input name="name" required placeholder="Vilvah Store"></label>
  <label>Domain<input name="domain" required placeholder="vilvah.com"></label>
  <label>Scan start URL<input name="start_url" placeholder="https://www.vilvah.com/collections/all"></label>
  <label>Category<select name="category"><?php foreach (['apparel','eyewear','beauty','jewellery','footwear','other'] as $c): ?><option><?= $c ?></option><?php endforeach; ?></select></label>
  <label class="check"><input type="checkbox" name="scan_now" value="1" checked> Queue a Scrapy scan now (Plan A)</label>
  <div><button class="btn">Create site</button></div>
</form></details>
<?php endif; ?>

<form class="filters"><input name="q" value="<?= e($q) ?>" placeholder="Search name or domain"><button class="btn ghost">Search</button></form>

<div class="card"><table>
<tr><th>Store</th><th>Status</th><th>Plan order</th><th>Active selectors</th><th>Try-ons 30d</th><th>Last widget ping</th><th></th></tr>
<?php foreach ($rows as $r): ?>
<tr>
  <td><b><?= e($r['name']) ?></b><br><small class="muted"><?= e($r['domain']) ?></small></td>
  <td><?= badge($r['status']) ?></td>
  <td><code><?= e($r['plan_order']) ?></code></td>
  <td><?= (int)$r['sel_active'] ?></td>
  <td><?= (int)$r['tries'] ?></td>
  <td><small><?= e($r['last_seen'] ?? 'never') ?></small></td>
  <td><a class="btn sm" href="site.php?id=<?= $r['id'] ?>">Manage</a></td>
</tr>
<?php endforeach; if (!$rows): ?><tr><td colspan="7" class="muted">No sites yet.</td></tr><?php endif; ?>
</table></div>
<?php layout_end();
