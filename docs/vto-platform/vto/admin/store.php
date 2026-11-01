<?php
require __DIR__ . '/_init.php';
require_login();
require_post_edit();

$id = (int)($_GET['id'] ?? $_POST['id'] ?? 0);
$store = DB::one('SELECT * FROM stores WHERE id = ?', [$id]);
if (!$store) { http_response_code(404); exit('Store not found'); }

// Connect a non-Shopify website to this store: its VTO try-ons use this store's design and wallet
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'add_site') {
    $domain = normalize_host((string)$_POST['domain']);
    $name = trim((string)$_POST['name']) ?: $domain;
    if (!preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $domain) && $domain !== 'localhost') {
        flash('Enter a valid website domain, e.g. shop.example.com', 'err');
    } elseif ($existing = DB::one('SELECT id, fitfyce_shop FROM sites WHERE domain = ?', [$domain])) {
        DB::update('sites', ['fitfyce_shop' => $store['shop_domain']], 'id = ?', [$existing['id']]);
        flash("Existing site $domain is now linked to this store.");
    } else {
        $sid = DB::insert('sites', ['name' => $name, 'domain' => $domain, 'api_key' => new_api_key(),
            'start_url' => 'https://' . $domain . '/', 'fitfyce_shop' => $store['shop_domain']]);
        flash('Site created and linked. Copy its embed code below.');
        redirect('site.php?id=' . $sid);
    }
    redirect('store.php?id=' . $id);
}

$sites = DB::all('SELECT id, name, domain, status FROM sites WHERE fitfyce_shop = ? ORDER BY id', [$store['shop_domain']]);
$ledger = DB::all('SELECT * FROM wallet_ledger WHERE store_id = ? ORDER BY id DESC LIMIT 100', [$id]);
$vtoTries = (int)DB::val(
    'SELECT COALESCE(SUM(t.credits_charged),0) FROM tryon_sessions t JOIN sites s ON s.id = t.site_id WHERE s.fitfyce_shop = ?',
    [$store['shop_domain']]
);

layout_start($store['shop_domain'], 'stores.php');
?>
<p class="muted"><?= badge($store['is_active'] ? 'active' : 'uninstalled') ?> <?= $store['app_enabled'] ? '' : badge('app off') ?>
  · FitFyce store #<?= (int)$store['id'] ?> · installed <?= e($store['installed_at']) ?> · last login <?= e($store['last_login_at'] ?? 'never') ?>
  · updated <?= e($store['synced_at']) ?> (<?= e($store['last_event']) ?>) <small class="live-flag" data-live="store:<?= (int)$id ?>">● live</small></p>

<div class="kpis">
  <div class="card kpi"><small>Wallet balance</small><b><?= number_format((int)$store['wallet_credits']) ?></b></div>
  <div class="card kpi"><small>Credits used</small><b><?= number_format((int)$store['wallet_total_debited']) ?></b></div>
  <div class="card kpi"><small>Credits purchased</small><b><?= number_format((int)$store['credits_purchased']) ?></b></div>
  <div class="card kpi"><small>Payments · revenue</small><b><?= (int)$store['payments_captured'] ?> · ₹<?= number_format($store['revenue_minor'] / 100, 2) ?></b></div>
  <div class="card kpi"><small>Used by VTO sites</small><b><?= number_format($vtoTries) ?></b></div>
</div>

<div class="grid2">
<div class="card"><h3>Store details</h3>
  <table>
    <tr><th>Shop domain</th><td><?= e($store['shop_domain']) ?></td></tr>
    <tr><th>Shopify plan</th><td><?= e($store['shopify_plan'] ?: '–') ?></td></tr>
    <tr><th>Theme</th><td><?= e($store['theme_name'] ?: '–') ?></td></tr>
    <tr><th>App</th><td><?= $store['is_active'] ? ($store['app_enabled'] ? 'Installed, enabled' : 'Installed, switched off by merchant') : 'Uninstalled' ?></td></tr>
    <tr><th>Button design</th><td>From this store's Widget Settings in FitFyce</td></tr>
  </table>
</div>
<div class="card"><h3>Linked VTO websites</h3>
  <p class="muted">Non-Shopify websites using this store's button design and wallet.</p>
  <table>
  <?php foreach ($sites as $s): ?>
    <tr><td><b><?= e($s['name']) ?></b><br><small class="muted"><?= e($s['domain']) ?></small></td><td><?= badge($s['status']) ?></td><td><a class="btn sm" href="site.php?id=<?= (int)$s['id'] ?>">Manage</a></td></tr>
  <?php endforeach; if (!$sites): ?><tr><td class="muted">None yet.</td></tr><?php endif; ?>
  </table>
  <?php if (can_edit()): ?>
  <form method="post" class="form-grid" style="margin-top:12px">
    <?= csrf_field() ?><input type="hidden" name="id" value="<?= (int)$id ?>"><input type="hidden" name="action" value="add_site">
    <label>Website domain<input name="domain" required placeholder="shop.example.com"></label>
    <label>Name<input name="name" placeholder="Brand website"></label>
    <div><button class="btn">Link website</button></div>
  </form>
  <?php endif; ?>
</div>
</div>

<div class="card"><h3>Wallet transactions</h3>
<table>
<tr><th>#</th><th>When</th><th>Change</th><th>Reason</th><th>Reference</th><th>Balance after</th><th>Note</th></tr>
<?php foreach ($ledger as $l): ?>
<tr>
  <td><small><?= (int)$l['id'] ?></small></td>
  <td><small><?= e($l['created_at']) ?></small></td>
  <td><b style="color:<?= $l['delta'] < 0 ? '#b42318' : '#067647' ?>"><?= $l['delta'] > 0 ? '+' : '' ?><?= (int)$l['delta'] ?></b></td>
  <td><?= e($l['reason']) ?></td>
  <td><small><?= e(trim(($l['reference_type'] ?? '') . ' ' . ($l['reference_id'] ?? ''))) ?: '–' ?></small></td>
  <td><?= (int)$l['balance_after'] ?></td>
  <td><small><?= e($l['note'] ?? '') ?></small></td>
</tr>
<?php endforeach; if (!$ledger): ?><tr><td colspan="7" class="muted">No transactions yet.</td></tr><?php endif; ?>
</table></div>
<?php layout_end();
