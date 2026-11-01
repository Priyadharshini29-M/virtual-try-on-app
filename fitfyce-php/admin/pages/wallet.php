<?php
/**
 * @var \TryFit\Admin\View $view
 * @var array<string,mixed> $merchant
 * @var int $balance
 * @var int $used
 * @var array<string,array<string,mixed>> $packs
 * @var array<int,array<string,mixed>> $recent
 * @var bool $topup_success
 * @var string $razorpay_key
 */

$reasonLabels = [
    'tryon'         => 'Try-on',
    'studio'        => 'AI Studio',
    'infographic'   => 'Infographic',
    'purchase'      => 'Top-up',
    'welcome_bonus' => 'Welcome bonus',
    'refund'        => 'Refund',
    'admin_grant'   => 'Admin grant',
    'admin_debit'   => 'Admin adjustment',
    'release'       => 'Refund (failed job)',
];

$popularPack = null;
foreach ($packs as $pid => $p) {
    if (!empty($p['popular'])) { $popularPack = ['id' => $pid] + $p; break; }
}
if ($popularPack === null) {
    $firstPackId = array_key_first($packs);
    $popularPack = ['id' => $firstPackId] + $packs[$firstPackId];
}
$money = static function (int $minor, string $cur): string {
    return number_format($minor / 100, 0) . ' ' . $cur;
};
?>
<div class="fs-page">
  <?php if ($topup_success): ?>
    <div class="fs-banner fs-banner--success">
      <?= $view->fsIcon('check', 18) ?><span>Credits added to your wallet.</span>
    </div>
  <?php endif; ?>

  <div style="text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 0;">
    <span class="fs-pill fs-pill--primary">Wallet</span>
    <h2 class="fs-h1">Credits power every try-on</h2>
    <p class="fs-sub" style="margin:0;max-width:560px;">
      1 credit = 1 try-on or AI generation. Pay as you go: no monthly commitments, no feature limits.
    </p>
  </div>

  <div class="fs-card">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;">
      <div>
        <div style="font-size:13px;color:var(--fs-muted);">Current balance</div>
        <div class="fs-tabular" style="font-size:44px;font-weight:700;letter-spacing:-0.03em;line-height:1;">
          <?= $view->e(number_format($balance)) ?>
        </div>
        <div style="font-size:13px;color:var(--fs-muted);margin-top:4px;">
          <?= $view->e(number_format($used)) ?> credits used lifetime
        </div>
      </div>
      <button
        type="button"
        class="fs-btn fs-btn--primary"
        data-pack-id="<?= $view->e($popularPack['id']) ?>"
        data-wallet-topup
        style="height:44px;padding:0 24px;"
      >
        Top up <?= $view->e(number_format((int)$popularPack['credits'])) ?> credits
      </button>
    </div>
  </div>

  <h3 class="fs-h2">Credit packs</h3>
  <div class="fs-plan-grid">
    <?php foreach ($packs as $pid => $p): ?>
      <?php
        $pricePerCredit = ($p['amount_minor'] / $p['credits']) / 100;
        $isPopular = !empty($p['popular']);
      ?>
      <div class="fs-card fs-plan<?= $isPopular ? ' is-featured' : '' ?>">
        <div class="fs-plan-top">
          <span class="fs-plan-name"><?= $view->e($p['label']) ?></span>
          <?php if ($isPopular): ?><span class="fs-pill fs-pill--primary">Most popular</span><?php endif; ?>
        </div>
        <div class="fs-plan-price">
          <span class="fs-tabular"><?= $view->e(number_format((int)$p['credits'])) ?></span>
          <small>credits</small>
        </div>
        <p class="fs-plan-desc">
          <?= $view->e($money((int)$p['amount_minor'], (string)$p['currency'])) ?> ·
          <?= $view->e($p['currency']) ?> <?= $view->e(number_format($pricePerCredit, 2)) ?> / credit
        </p>
        <div class="fs-plan-meta">
          <span><?= $view->fsIcon('bolt', 14) ?> <?= $view->e(number_format((int)$p['credits'])) ?> try-ons or AI generations</span>
        </div>
        <button
          type="button"
          class="fs-btn fs-btn--<?= $isPopular ? 'primary' : 'dark' ?>"
          style="width:100%;height:42px;"
          data-pack-id="<?= $view->e($pid) ?>"
          data-wallet-topup
        >Buy <?= $view->e($p['label']) ?></button>
        <p class="fs-plan-trial">Credits never expire</p>
      </div>
    <?php endforeach; ?>
  </div>

  <div class="fs-card">
    <h3 class="fs-h3">Recent activity</h3>
    <p class="fs-card-sub">Latest 20 wallet movements.</p>
    <?php if (empty($recent)): ?>
      <div style="padding:32px 0;text-align:center;color:var(--fs-muted);">
        <?= $view->fsIcon('clock', 24) ?>
        <p style="margin-top:8px;">No activity yet.</p>
      </div>
    <?php else: ?>
      <div class="fs-table">
        <div class="fs-tr fs-tr--head">
          <span>When</span>
          <span>Reason</span>
          <span style="text-align:right;">Change</span>
          <span style="text-align:right;">Balance</span>
        </div>
        <?php foreach ($recent as $t): ?>
          <?php
            $delta = (int)($t['delta'] ?? 0);
            $positive = $delta >= 0;
            $ts = strtotime((string)($t['created_at'] ?? ''));
            $when = $ts ? date('M j, g:i a', $ts) : (string)($t['created_at'] ?? '');
          ?>
          <div class="fs-tr">
            <span><?= $view->e($when) ?></span>
            <span><?= $view->e($reasonLabels[$t['reason']] ?? $t['reason']) ?></span>
            <span class="fs-tabular" style="text-align:right;color:<?= $positive ? 'var(--fs-success-ink)' : 'var(--fs-ink)' ?>;">
              <?= $positive ? '+' : '' ?><?= $view->e(number_format($delta)) ?>
            </span>
            <span class="fs-tabular" style="text-align:right;"><?= $view->e(number_format((int)$t['balance_after'])) ?></span>
          </div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </div>

  <div id="fs-wallet-banner" class="fs-banner fs-banner--critical" role="alert" style="display:none;">
    <?= $view->fsIcon('info', 18) ?><span id="fs-wallet-banner-text"></span>
  </div>
</div>

<script src="https://checkout.razorpay.com/v1/checkout.js" defer></script>
<script>
(function () {
  var CREATE_URL = <?= json_encode($view->url('admin/wallet/create-order')) ?>;
  var VERIFY_URL = <?= json_encode($view->url('admin/wallet/verify')) ?>;
  var BANNER     = document.getElementById('fs-wallet-banner');
  var BANNER_TXT = document.getElementById('fs-wallet-banner-text');

  function showError(msg) {
    if (!BANNER || !BANNER_TXT) return;
    BANNER_TXT.textContent = msg;
    BANNER.style.display = 'flex';
    BANNER.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function postJson(url, body) {
    var resp = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await resp.json().catch(function () { return {}; });
    return { ok: resp.ok && data.ok !== false, status: resp.status, data: data };
  }

  async function startTopup(packId, btn) {
    btn.disabled = true;
    var original = btn.textContent;
    btn.textContent = 'Opening payment...';
    try {
      var r = await postJson(CREATE_URL, { pack_id: packId });
      if (!r.ok) {
        showError(r.data.error || 'Could not start payment.');
        return;
      }
      if (typeof window.Razorpay !== 'function') {
        showError('Payment widget is still loading. Please try again in a moment.');
        return;
      }
      var rzp = new window.Razorpay({
        key: r.data.key_id,
        amount: r.data.amount,
        currency: r.data.currency,
        order_id: r.data.order_id,
        name: 'Brix-TryOn credits',
        description: r.data.credits + ' credits',
        theme: { color: '#111827' },
        handler: async function (resp) {
          var v = await postJson(VERIFY_URL, {
            order_id: resp.razorpay_order_id,
            payment_id: resp.razorpay_payment_id,
            signature: resp.razorpay_signature
          });
          if (v.ok) {
            window.location.href = window.location.pathname + '?topup=1';
          } else {
            showError(v.data.error || 'Payment verification failed.');
          }
        },
        modal: { ondismiss: function () { btn.disabled = false; btn.textContent = original; } }
      });
      rzp.open();
    } catch (err) {
      showError('Could not start payment: ' + (err && err.message || 'network error'));
    } finally {
      // Button is re-enabled by the Razorpay modal ondismiss handler, or
      // the page navigates on success.
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-wallet-topup]');
    if (!btn) return;
    var packId = btn.getAttribute('data-pack-id');
    if (!packId) return;
    e.preventDefault();
    startTopup(packId, btn);
  });
})();
</script>
