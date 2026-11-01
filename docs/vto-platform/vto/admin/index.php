<?php
require __DIR__ . '/_init.php';
require_login();

$siteId = (int)($_GET['site'] ?? 0);
$where = $siteId ? 'site_id = ' . $siteId : '1=1';
$sites = DB::all('SELECT id, name FROM sites ORDER BY name');

$kpi = [
    'Active sites'      => DB::val("SELECT COUNT(*) FROM sites WHERE status='active'"),
    'Try-ons today'     => DB::val("SELECT COUNT(*) FROM tryon_sessions WHERE $where AND created_at >= CURDATE()"),
    'Try-ons (30 days)' => DB::val("SELECT COUNT(*) FROM tryon_sessions WHERE $where AND created_at >= NOW() - INTERVAL 30 DAY"),
    'Clicks (30 days)'  => DB::val("SELECT COUNT(*) FROM events WHERE $where AND type='click' AND created_at >= NOW() - INTERVAL 30 DAY"),
    'Success rate'      => (function () use ($where) {
        $r = DB::one("SELECT SUM(status='done') ok, COUNT(*) n FROM tryon_sessions WHERE $where AND created_at >= NOW() - INTERVAL 30 DAY");
        return $r['n'] ? round($r['ok'] / $r['n'] * 100) . '%' : '—';
    })(),
];

$daily = DB::all("SELECT DATE(created_at) d, COUNT(*) n FROM tryon_sessions WHERE $where AND created_at >= CURDATE() - INTERVAL 13 DAY GROUP BY d ORDER BY d");
$byDay = array_column($daily, 'n', 'd');
$max = max(1, ...array_map('intval', array_values($byDay) ?: [0]));

$plans = DB::all("SELECT plan, COUNT(*) n FROM events WHERE $where AND type='inject_ok' AND created_at >= NOW() - INTERVAL 30 DAY GROUP BY plan ORDER BY n DESC");
$fails = DB::all("SELECT s.name, COUNT(*) n FROM events e JOIN sites s ON s.id = e.site_id
                   WHERE e.type='inject_fail' AND e.created_at >= NOW() - INTERVAL 7 DAY GROUP BY s.id ORDER BY n DESC LIMIT 8");
$triggers = DB::all("SELECT trigger_from t, COUNT(*) n FROM tryon_sessions WHERE $where AND created_at >= NOW() - INTERVAL 30 DAY GROUP BY t");

layout_start('Dashboard', 'index.php');
?>
<form class="filters"><select name="site" onchange="this.form.submit()"><option value="0">All sites</option>
<?php foreach ($sites as $s): ?><option value="<?= $s['id'] ?>" <?= $siteId == $s['id'] ? 'selected' : '' ?>><?= e($s['name']) ?></option><?php endforeach; ?>
</select></form>

<div class="kpis"><?php foreach ($kpi as $k => $v): ?><div class="card kpi"><small><?= e($k) ?></small><b><?= e($v) ?></b></div><?php endforeach; ?></div>

<div class="grid2">
  <div class="card"><h3>Try-ons, last 14 days</h3>
    <div class="bars"><?php for ($i = 13; $i >= 0; $i--):
        $d = date('Y-m-d', strtotime("-$i day")); $n = (int)($byDay[$d] ?? 0); ?>
      <div class="bar" title="<?= $d ?>: <?= $n ?>"><span style="height:<?= max(2, $n / $max * 100) ?>%"></span><em><?= date('d', strtotime($d)) ?></em></div>
    <?php endfor; ?></div>
  </div>
  <div class="card"><h3>Which plan injected (30 days)</h3>
    <?php $tot = array_sum(array_column($plans, 'n')) ?: 1; foreach ($plans as $p): ?>
      <div class="hbar"><span><?= badge((string)$p['plan']) ?></span><div><i style="width:<?= $p['n'] / $tot * 100 ?>%"></i></div><b><?= (int)$p['n'] ?></b></div>
    <?php endforeach; if (!$plans): ?><p class="muted">No injections reported yet.</p><?php endif; ?>
    <h3 style="margin-top:18px">Try-on entry point</h3>
    <?php foreach ($triggers as $t): ?><div class="hbar"><span><?= e($t['t'] ?? 'unknown') ?></span><div><i style="width:<?= $t['n'] / max(1, array_sum(array_column($triggers, 'n'))) * 100 ?>%"></i></div><b><?= (int)$t['n'] ?></b></div><?php endforeach; ?>
  </div>
</div>

<div class="card"><h3>Sites where all 3 plans failed (7 days)</h3>
<?php if ($fails): ?><table><tr><th>Site</th><th>Failed page views</th></tr>
<?php foreach ($fails as $f): ?><tr><td><?= e($f['name']) ?></td><td><?= (int)$f['n'] ?></td></tr><?php endforeach; ?></table>
<p class="muted">Tip: run a Scrapy scan or add a manual selector for these sites.</p>
<?php else: ?><p class="muted">No failures 🎉</p><?php endif; ?></div>
<?php layout_end();
