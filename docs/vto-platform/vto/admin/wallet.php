<?php
require __DIR__ . '/_init.php';
require __DIR__ . '/../backend/lib/Platform.php';
$me = require_login();
require_post_edit();

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'save_rules') {
    if ($me['role'] !== 'super') { flash('Only super admins can change wallet prices', 'err'); redirect('wallet.php'); }
    $packs = [];
    foreach ((array)($_POST['packs'] ?? []) as $i => $p) {
        if (!empty($p['remove']) || trim((string)($p['id'] ?? '')) === '') continue;
        $packs[] = [
            'id'           => trim((string)$p['id']),
            'label'        => trim((string)($p['label'] ?? '')),
            'credits'      => (int)($p['credits'] ?? 0),
            'amount_minor' => (int)round((float)str_replace(',', '', (string)($p['price'] ?? '0')) * 100),
            'currency'     => 'INR',
            'popular'      => (string)($_POST['popular'] ?? '') === (string)$i,
        ];
    }
    $costs = array_map('intval', (array)($_POST['costs'] ?? []));
    try {
        [$ok, $res] = Platform::saveWalletSettings($packs, $costs, $me['email']);
        flash($ok ? 'Wallet rules saved. They are live in the FitFyce app now.' : 'Not saved: ' . $res, $ok ? 'ok' : 'err');
    } catch (Throwable $e) {
        flash('Not saved, FitFyce could not be reached: ' . $e->getMessage(), 'err');
    }
    redirect('wallet.php');
}

$rules = Platform::enabled() ? Platform::walletSettings() : null;
$t = DB::one('SELECT COUNT(*) n, COALESCE(SUM(wallet_credits),0) bal, COALESCE(SUM(wallet_total_debited),0) used,
                     COALESCE(SUM(credits_purchased),0) bought, COALESCE(SUM(revenue_minor),0) rev FROM stores');
$recent = DB::all('SELECT l.*, s.shop_domain FROM wallet_ledger l JOIN stores s ON s.id = l.store_id ORDER BY l.id DESC LIMIT 40');
$labels = ['tryon' => 'Try-on (Shopify widget and VTO websites)', 'studio' => 'AI Studio generation', 'infographic' => 'Infographic generation'];

layout_start('Wallet', 'wallet.php');
?>
<div class="kpis">
  <div class="card kpi"><small>Credits in all wallets</small><b><?= number_format((int)$t['bal']) ?></b></div>
  <div class="card kpi"><small>Credits used</small><b><?= number_format((int)$t['used']) ?></b></div>
  <div class="card kpi"><small>Credits purchased</small><b><?= number_format((int)$t['bought']) ?></b></div>
  <div class="card kpi"><small>Top-up revenue</small><b>₹<?= number_format($t['rev'] / 100, 2) ?></b></div>
</div>

<div class="card">
  <h3>Wallet rules</h3>
  <?php if (!$rules): ?>
    <p style="color:#b42318">Cannot load the wallet rules from FitFyce<?= Platform::enabled() ? ' (FitFyce unreachable)' : ' (VTO_PLATFORM_SECRET is not set)' ?>.</p>
  <?php else: ?>
  <p class="muted">Applied by the FitFyce app on the next request: merchants see these packs on their Credits page,
    and every try-on or generation is charged at these costs. <?php if (!empty($rules['stale'])): ?><b style="color:#b42318">FitFyce is unreachable, showing the last saved copy.</b><?php endif; ?>
    <?php if (empty($rules['customised']) && empty($rules['stale'])): ?>Currently the built-in defaults.<?php endif; ?></p>
  <form method="post">
    <?= csrf_field() ?><input type="hidden" name="action" value="save_rules">
    <h4>Credit packs</h4>
    <table id="packs">
      <tr><th>Pack id</th><th>Label</th><th>Credits</th><th>Price (₹)</th><th>₹ / credit</th><th>Popular</th><th>Remove</th></tr>
      <?php foreach ($rules['packs'] as $i => $p): ?>
      <tr>
        <td><input name="packs[<?= $i ?>][id]" value="<?= e($p['id']) ?>" size="10" readonly title="Pack ids stay fixed: the app sends them back at checkout"></td>
        <td><input name="packs[<?= $i ?>][label]" value="<?= e($p['label']) ?>" size="12" required></td>
        <td><input type="number" min="1" name="packs[<?= $i ?>][credits]" value="<?= (int)$p['credits'] ?>" style="width:100px" required></td>
        <td><input type="number" min="1" step="0.01" name="packs[<?= $i ?>][price]" value="<?= e(number_format($p['amount_minor'] / 100, 2, '.', '')) ?>" style="width:120px" required></td>
        <td><small class="muted"><?= number_format($p['amount_minor'] / 100 / max(1, $p['credits']), 2) ?></small></td>
        <td><input type="radio" name="popular" value="<?= $i ?>" <?= !empty($p['popular']) ? 'checked' : '' ?>></td>
        <td><input type="checkbox" name="packs[<?= $i ?>][remove]" value="1"></td>
      </tr>
      <?php endforeach; $n = count($rules['packs']); ?>
      <tr class="new-pack">
        <td><input name="packs[<?= $n ?>][id]" placeholder="new id" size="10" pattern="[a-z0-9_-]{2,30}"></td>
        <td><input name="packs[<?= $n ?>][label]" placeholder="Label" size="12"></td>
        <td><input type="number" min="1" name="packs[<?= $n ?>][credits]" style="width:100px"></td>
        <td><input type="number" min="1" step="0.01" name="packs[<?= $n ?>][price]" style="width:120px"></td>
        <td><small class="muted">new pack (optional)</small></td>
        <td><input type="radio" name="popular" value="<?= $n ?>"></td><td></td>
      </tr>
    </table>

    <h4 style="margin-top:18px">Cost per action (credits)</h4>
    <div class="form-grid">
      <?php foreach ($labels as $k => $label): ?>
        <label><?= e($label) ?><input type="number" min="0" max="1000" name="costs[<?= $k ?>]" value="<?= (int)($rules['costs'][$k] ?? 1) ?>" required></label>
      <?php endforeach; ?>
    </div>
    <?php if ($me['role'] === 'super'): ?>
      <button class="btn" style="margin-top:14px">Save wallet rules</button>
    <?php else: ?>
      <p class="muted">Only super admins can change wallet prices.</p>
    <?php endif; ?>
  </form>
  <?php endif; ?>
</div>

<div class="card"><h3>Latest wallet activity, all stores <small class="live-flag" data-live="wallet">● live</small></h3>
<table>
<tr><th>When</th><th>Store</th><th>Change</th><th>Reason</th><th>Balance after</th><th>Note</th></tr>
<?php foreach ($recent as $l): ?>
<tr>
  <td><small><?= e($l['created_at']) ?></small></td>
  <td><a href="store.php?id=<?= (int)$l['store_id'] ?>"><?= e($l['shop_domain']) ?></a></td>
  <td><b style="color:<?= $l['delta'] < 0 ? '#b42318' : '#067647' ?>"><?= $l['delta'] > 0 ? '+' : '' ?><?= (int)$l['delta'] ?></b></td>
  <td><?= e($l['reason']) ?><?= $l['reference_type'] === 'vto' ? ' <small class="muted">(VTO site)</small>' : '' ?></td>
  <td><?= (int)$l['balance_after'] ?></td>
  <td><small><?= e($l['note'] ?? '') ?></small></td>
</tr>
<?php endforeach; if (!$recent): ?><tr><td colspan="6" class="muted">No wallet activity yet.</td></tr><?php endif; ?>
</table></div>
<?php layout_end();
