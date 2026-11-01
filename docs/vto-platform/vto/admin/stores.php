<?php
require __DIR__ . '/_init.php';
require __DIR__ . '/../backend/lib/Platform.php';
require_login();
require_post_edit();

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'sync') {
    try {
        $r = Platform::syncAll();
        flash("Synced {$r['stores']} stores from FitFyce, {$r['ledger_added']} new wallet transactions.");
    } catch (Throwable $e) {
        flash('Sync failed: ' . $e->getMessage(), 'err');
    }
    redirect('stores.php');
}

$q = trim((string)($_GET['q'] ?? ''));
$rows = DB::all(
    "SELECT s.*, (SELECT COUNT(*) FROM sites x WHERE x.fitfyce_shop = s.shop_domain) AS vto_sites
       FROM stores s
      WHERE (? = '' OR s.shop_domain LIKE ?)
      ORDER BY s.is_active DESC, COALESCE(s.last_login_at, s.installed_at) DESC",
    [$q, "%$q%"]
);
$t = DB::one('SELECT COUNT(*) n, SUM(is_active) active, COALESCE(SUM(wallet_credits),0) bal, COALESCE(SUM(wallet_total_debited),0) used,
                     COALESCE(SUM(revenue_minor),0) rev FROM stores');

layout_start('Stores', 'stores.php');
?>
<p class="muted">Every merchant that installs or logs in to the FitFyce app appears here instantly, with its wallet.
  FitFyce pushes each login and wallet change; <b>Sync now</b> pulls a full copy if anything was missed.
  <?php if (!Platform::enabled()): ?><span style="color:#b42318">VTO_PLATFORM_SECRET is not set, so FitFyce cannot reach this panel.</span><?php endif; ?></p>

<div class="kpis">
  <div class="card kpi"><small>Stores</small><b><?= (int)$t['n'] ?></b></div>
  <div class="card kpi"><small>Active</small><b><?= (int)$t['active'] ?></b></div>
  <div class="card kpi"><small>Credits in wallets</small><b><?= number_format((int)$t['bal']) ?></b></div>
  <div class="card kpi"><small>Credits used</small><b><?= number_format((int)$t['used']) ?></b></div>
  <div class="card kpi"><small>Top-up revenue</small><b>₹<?= number_format($t['rev'] / 100, 2) ?></b></div>
</div>

<div class="filters" style="display:flex;gap:10px;align-items:center">
  <form style="display:flex;gap:8px"><input name="q" value="<?= e($q) ?>" placeholder="Search shop domain"><button class="btn ghost">Search</button></form>
  <?php if (can_edit()): ?>
  <form method="post" style="margin-left:auto"><?= csrf_field() ?><input type="hidden" name="action" value="sync"><button class="btn">Sync now</button></form>
  <?php endif; ?>
  <small class="muted live-flag" data-live="stores">● live</small>
</div>

<div class="card"><table>
<tr><th>Store</th><th>Status</th><th>Wallet</th><th>Used</th><th>Purchased</th><th>Last login</th><th>Last update</th><th>VTO sites</th><th></th></tr>
<?php foreach ($rows as $r): ?>
<tr>
  <td><b><?= e($r['shop_domain']) ?></b><br><small class="muted"><?= e($r['theme_name'] ?: '–') ?> · installed <?= e(substr((string)$r['installed_at'], 0, 10)) ?></small></td>
  <td><?= badge($r['is_active'] ? 'active' : 'uninstalled') ?><?php if ($r['is_active'] && !$r['app_enabled']): ?> <?= badge('app off') ?><?php endif; ?></td>
  <td><b class="<?= (int)$r['wallet_credits'] <= 5 ? 'low' : '' ?>"><?= number_format((int)$r['wallet_credits']) ?></b> <small class="muted">credits</small></td>
  <td><?= number_format((int)$r['wallet_total_debited']) ?></td>
  <td><?= number_format((int)$r['credits_purchased']) ?></td>
  <td><small><?= e($r['last_login_at'] ?? 'never') ?></small></td>
  <td><small><?= e($r['last_event']) ?> · <?= e($r['synced_at']) ?></small></td>
  <td><?= (int)$r['vto_sites'] ?></td>
  <td><a class="btn sm" href="store.php?id=<?= (int)$r['id'] ?>">Details</a></td>
</tr>
<?php endforeach; if (!$rows): ?><tr><td colspan="9" class="muted">No stores yet. They appear when a merchant logs in to the FitFyce app, or click Sync now.</td></tr><?php endif; ?>
</table></div>
<?php layout_end();
