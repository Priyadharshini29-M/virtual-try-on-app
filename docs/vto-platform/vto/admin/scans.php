<?php
require __DIR__ . '/_init.php';
require_login();

$id = (int)($_GET['id'] ?? 0);
if ($id) {
    $scan = DB::one('SELECT sc.*, s.name site_name FROM scans sc JOIN sites s ON s.id = sc.site_id WHERE sc.id = ?', [$id]);
    if (!$scan) { http_response_code(404); exit('Not found'); }
    layout_start('Scan #' . $id, 'scans.php');
    ?>
    <div class="card">
      <p><b><?= e($scan['site_name']) ?></b> · <?= badge($scan['status']) ?> · <?= e($scan['start_url']) ?></p>
      <p class="muted">Queued <?= e($scan['created_at']) ?> · started <?= e($scan['started_at'] ?? '—') ?> · finished <?= e($scan['finished_at'] ?? '—') ?>
        · pages <?= (int)$scan['pages_crawled'] ?> · selectors <?= (int)$scan['selectors_found'] ?></p>
      <pre class="log"><?= e($scan['log'] ?: 'No output yet…') ?></pre>
      <?php if (in_array($scan['status'], ['queued', 'running'], true)): ?><meta http-equiv="refresh" content="5"><?php endif; ?>
      <a href="site.php?id=<?= $scan['site_id'] ?>">← Back to site</a>
    </div>
    <?php
    layout_end();
    exit;
}

$page = max(1, (int)($_GET['page'] ?? 1));
$total = (int)DB::val('SELECT COUNT(*) FROM scans');
$rows = DB::all('SELECT sc.*, s.name site_name FROM scans sc JOIN sites s ON s.id = sc.site_id ORDER BY sc.id DESC LIMIT 30 OFFSET ' . (($page - 1) * 30));

layout_start('Scrapy scans', 'scans.php');
?>
<p class="muted">Scans are processed by <code>scraper/worker.py</code>. If scans stay “queued”, make sure the worker is running.</p>
<div class="card"><table>
<tr><th>#</th><th>Site</th><th>Start URL</th><th>Status</th><th>Pages</th><th>Selectors</th><th>Queued</th></tr>
<?php foreach ($rows as $r): ?>
<tr><td><a href="?id=<?= $r['id'] ?>">#<?= $r['id'] ?></a></td><td><?= e($r['site_name']) ?></td><td class="url"><small><?= e($r['start_url']) ?></small></td>
<td><?= badge($r['status']) ?></td><td><?= (int)$r['pages_crawled'] ?></td><td><?= (int)$r['selectors_found'] ?></td><td><small><?= e($r['created_at']) ?></small></td></tr>
<?php endforeach; ?>
</table><?= paginate($total, 30, $page) ?></div>
<?php layout_end();
