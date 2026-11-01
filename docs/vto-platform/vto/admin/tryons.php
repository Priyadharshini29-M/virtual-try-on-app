<?php
require __DIR__ . '/_init.php';
require_login();
require_post_edit();

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'delete') {
    $row = DB::one('SELECT * FROM tryon_sessions WHERE id = ?', [(int)$_POST['tid']]);
    if ($row) {
        $dir = rtrim(cfg('upload_dir'), '/');
        foreach ([$row['user_image'], $row['result_image']] as $f) if ($f && is_file("$dir/$f")) unlink("$dir/$f");
        DB::run('DELETE FROM tryon_sessions WHERE id = ?', [$row['id']]);
        flash('Try-on and its images deleted');
    }
    redirect('tryons.php?' . http_build_query(array_intersect_key($_GET, array_flip(['site', 'status', 'page']))));
}

$siteId = (int)($_GET['site'] ?? 0);
$status = in_array($_GET['status'] ?? '', ['done', 'failed', 'processing'], true) ? $_GET['status'] : '';
$page = max(1, (int)($_GET['page'] ?? 1));
$per = 24;

$where = ['1=1']; $params = [];
if ($siteId) { $where[] = 't.site_id = ?'; $params[] = $siteId; }
if ($status) { $where[] = 't.status = ?'; $params[] = $status; }
$w = implode(' AND ', $where);

$total = (int)DB::val("SELECT COUNT(*) FROM tryon_sessions t WHERE $w", $params);
$rows = DB::all("SELECT t.*, s.name site_name FROM tryon_sessions t JOIN sites s ON s.id = t.site_id WHERE $w ORDER BY t.id DESC LIMIT $per OFFSET " . (($page - 1) * $per), $params);
$sites = DB::all('SELECT id, name FROM sites ORDER BY name');
$media = cfg('upload_url');
$dir = rtrim(cfg('upload_dir'), '/');

layout_start('Try-on sessions', 'tryons.php');
?>
<form class="filters">
  <select name="site"><option value="0">All sites</option><?php foreach ($sites as $s): ?><option value="<?= $s['id'] ?>" <?= $siteId == $s['id'] ? 'selected' : '' ?>><?= e($s['name']) ?></option><?php endforeach; ?></select>
  <select name="status"><option value="">Any status</option><?php foreach (['done', 'failed', 'processing'] as $s): ?><option <?= $status === $s ? 'selected' : '' ?>><?= $s ?></option><?php endforeach; ?></select>
  <button class="btn ghost">Filter</button> <span class="muted"><?= $total ?> results</span>
</form>

<div class="tiles">
<?php foreach ($rows as $r): ?>
  <div class="card tile">
    <div class="imgs">
      <?php if ($r['user_image'] && is_file("$dir/{$r['user_image']}")): ?><img src="<?= e($media . rawurlencode($r['user_image'])) ?>" alt="shopper" loading="lazy"><?php else: ?><div class="ph">photo expired</div><?php endif; ?>
      <img src="<?= e($r['product_image']) ?>" alt="product" loading="lazy" referrerpolicy="no-referrer">
      <?php if ($r['result_image']): ?><img src="<?= e($media . rawurlencode($r['result_image'])) ?>" alt="result" loading="lazy"><?php else: ?><div class="ph">no result</div><?php endif; ?>
    </div>
    <div><?= badge($r['status']) ?> <?= $r['plan_used'] ? badge($r['plan_used']) : '' ?> <small class="muted"><?= e($r['trigger_from']) ?></small></div>
    <b class="ellip"><?= e($r['product_title'] ?: 'Untitled product') ?></b>
    <small class="muted"><?= e($r['site_name']) ?> · <?= e($r['created_at']) ?> · <?= $r['duration_ms'] ? round($r['duration_ms'] / 1000, 1) . 's' : '' ?> · <?= e($r['provider']) ?></small>
    <?php if ($r['error']): ?><small class="err"><?= e($r['error']) ?></small><?php endif; ?>
    <?php if ($r['product_url']): ?><a class="ellip" href="<?= e($r['product_url']) ?>" target="_blank" rel="noopener noreferrer"><small><?= e($r['product_url']) ?></small></a><?php endif; ?>
    <?php if (can_edit()): ?><form method="post" onsubmit="return confirm('Delete this try-on and images?')"><?= csrf_field() ?><input type="hidden" name="action" value="delete"><input type="hidden" name="tid" value="<?= $r['id'] ?>"><button class="btn sm ghost">Delete</button></form><?php endif; ?>
  </div>
<?php endforeach; if (!$rows): ?><p class="muted">No try-ons yet.</p><?php endif; ?>
</div>
<?= paginate($total, $per, $page, ['site' => $siteId, 'status' => $status]) ?>
<?php layout_end();
