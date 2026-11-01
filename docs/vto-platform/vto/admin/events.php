<?php
require __DIR__ . '/_init.php';
require_login();

$types = ['load', 'inject_ok', 'inject_fail', 'plan_fallback', 'click', 'tryon_ok', 'tryon_fail'];
$siteId = (int)($_GET['site'] ?? 0);
$type = in_array($_GET['type'] ?? '', $types, true) ? $_GET['type'] : '';
$page = max(1, (int)($_GET['page'] ?? 1));
$per = 50;

$where = ['1=1']; $params = [];
if ($siteId) { $where[] = 'e.site_id = ?'; $params[] = $siteId; }
if ($type) { $where[] = 'e.type = ?'; $params[] = $type; }
$w = implode(' AND ', $where);

if (($_GET['export'] ?? '') === 'csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="vto-events.csv"');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['id', 'site', 'type', 'plan', 'page_type', 'url', 'meta', 'created_at']);
    $st = DB::run("SELECT e.id, s.name, e.type, e.plan, e.page_type, e.url, e.meta, e.created_at FROM events e JOIN sites s ON s.id = e.site_id WHERE $w ORDER BY e.id DESC LIMIT 50000", $params);
    while ($r = $st->fetch(PDO::FETCH_NUM)) fputcsv($out, $r);
    exit;
}

$total = (int)DB::val("SELECT COUNT(*) FROM events e WHERE $w", $params);
$rows = DB::all("SELECT e.*, s.name site_name FROM events e JOIN sites s ON s.id = e.site_id WHERE $w ORDER BY e.id DESC LIMIT $per OFFSET " . (($page - 1) * $per), $params);
$sites = DB::all('SELECT id, name FROM sites ORDER BY name');

layout_start('Widget events', 'events.php');
?>
<form class="filters">
  <select name="site"><option value="0">All sites</option><?php foreach ($sites as $s): ?><option value="<?= $s['id'] ?>" <?= $siteId == $s['id'] ? 'selected' : '' ?>><?= e($s['name']) ?></option><?php endforeach; ?></select>
  <select name="type"><option value="">All types</option><?php foreach ($types as $t): ?><option <?= $type === $t ? 'selected' : '' ?>><?= $t ?></option><?php endforeach; ?></select>
  <button class="btn ghost">Filter</button>
  <a class="btn ghost" href="?<?= e(http_build_query(['site' => $siteId, 'type' => $type, 'export' => 'csv'])) ?>">Export CSV</a>
  <span class="muted"><?= $total ?> events</span>
</form>
<div class="card"><table>
<tr><th>Time</th><th>Site</th><th>Type</th><th>Plan</th><th>Page</th><th>URL</th><th>Details</th></tr>
<?php foreach ($rows as $r): ?>
<tr><td class="nowrap"><small><?= e($r['created_at']) ?></small></td><td><?= e($r['site_name']) ?></td><td><?= badge($r['type']) ?></td>
<td><?= $r['plan'] ? badge($r['plan']) : '' ?></td><td><?= e($r['page_type']) ?></td>
<td class="url"><small><?= e($r['url']) ?></small></td><td><small><code><?= e($r['meta']) ?></code></small></td></tr>
<?php endforeach; ?>
</table><?= paginate($total, $per, $page, ['site' => $siteId, 'type' => $type]) ?></div>
<?php layout_end();
