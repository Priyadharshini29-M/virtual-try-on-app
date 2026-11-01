<?php
/**
 * @var \TryFit\Admin\View $view
 * @var array<string,mixed> $merchant
 * @var int $balance
 * @var int $used
 * @var array{items:array,done:int,total:int,pct:int} $checklist
 * @var array{enabled_products:int,total_products:int,tryons:int,orders:int} $counts
 * @var array $week
 * @var bool $app_enabled
 * @var array<int,array<string,mixed>> $recent_credits
 * @var array<int,array<string,mixed>> $recent_days
 */

$shopName    = (string)($merchant['shopify_domain'] ?? '');
$shopShort   = $shopName !== '' ? preg_replace('/\.myshopify\.com$/', '', $shopName) : '';
$walletTotal = $balance + $used;
$walletPct   = $walletTotal > 0 ? $balance / $walletTotal : ($balance > 0 ? 1 : 0);
$walletLow   = $balance <= 10;
$arc         = M_PI * 96;

$cartRate  = $week['tryons'] > 0 ? ($week['carts']  / $week['tryons']) * 100 : 0;
$purchRate = $week['tryons'] > 0 ? ($week['orders'] / $week['tryons']) * 100 : 0;

$pct      = (int)$checklist['pct'];
$doneLeft = (int)$checklist['total'] - (int)$checklist['done'];

$sparkline = static function (array $values, string $color = '#4F46E5'): string {
    if (count($values) === 0) return '';
    $max = max($values); $min = min($values);
    $range = ($max - $min) ?: 1;
    $w = 120; $h = 36;
    $step = count($values) > 1 ? $w / (count($values) - 1) : $w;
    $pts = $fillPts = [];
    foreach (array_values($values) as $i => $v) {
        $x = $i * $step;
        $y = $h - (($v - $min) / $range) * ($h - 4) - 2;
        $pts[]     = sprintf('%.1f,%.1f', $x, $y);
        $fillPts[] = sprintf('%.1f,%.1f', $x, $y);
    }
    $fillPath = 'M0,' . $h . ' L' . implode(' L', $fillPts) . ' L' . $w . ',' . $h . ' Z';
    return sprintf(
        '<svg width="%d" height="%d" viewBox="0 0 %d %d" aria-hidden="true">
           <path d="%s" fill="%s" opacity="0.08" />
           <polyline fill="none" stroke="%s" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="%s" />
         </svg>',
        $w, $h, $w, $h, $fillPath, $color, $color, implode(' ', $pts)
    );
};

$reasonLabel = [
    'tryon'         => 'Try-on',
    'studio'        => 'AI Studio',
    'infographic'   => 'Infographic',
    'purchase'      => 'Top-up',
    'welcome_bonus' => 'Welcome bonus',
    'refund'        => 'Refund',
    'release'       => 'Auto-refund',
    'admin_grant'   => 'Admin grant',
    'admin_debit'   => 'Admin adjustment',
];
?>
<div class="bt-dashboard">

  <!-- Hero welcome -->
  <section class="bt-hero">
    <div class="bt-hero-main">
      <span class="bt-hero-greeting"><?= $view->e(date('l, F j')) ?></span>
      <h1 class="bt-hero-title">
        Welcome back<?= $shopShort !== '' ? ', <span class="bt-hero-name">' . $view->e(ucfirst($shopShort)) . '</span>' : '' ?>
      </h1>
      <p class="bt-hero-sub">
        <?php if ($week['tryons'] > 0): ?>
          <strong><?= $view->e(number_format($week['tryons'])) ?></strong> try-ons this week, <strong><?= $view->e(number_format($week['carts'])) ?></strong> added to cart.
        <?php elseif ($counts['tryons'] > 0): ?>
          No try-ons yet this week. Keep the widget visible to drive new ones.
        <?php else: ?>
          Let's get your first shoppers trying on your products.
        <?php endif; ?>
      </p>
      <div class="bt-hero-actions">
        <a class="fs-btn fs-btn--primary" href="<?= $view->e($view->url('admin/products')) ?>">Enable products</a>
        <a class="fs-btn fs-btn--ghost" href="<?= $view->e($view->url('admin/analytics')) ?>">View analytics</a>
      </div>
    </div>
    <div class="bt-hero-status">
      <div class="bt-hero-status-row">
        <span class="fs-status-dot <?= $app_enabled ? 'is-on' : '' ?>"></span>
        <div style="flex:1;min-width:0;">
          <div class="bt-hero-status-title"><?= $app_enabled ? 'Try-on is live' : 'Try-on is paused' ?></div>
          <div class="bt-hero-status-sub">
            <?= $app_enabled
              ? 'Shoppers see the try-on button on enabled products.'
              : "Shoppers won't see the try-on button on any product." ?>
          </div>
        </div>
      </div>
      <form method="post" action="<?= $view->e($view->url('admin/toggle-app')) ?>" style="margin:0;">
        <input type="hidden" name="enabled" value="<?= $app_enabled ? '0' : '1' ?>">
        <button type="submit" class="fs-btn fs-btn--<?= $app_enabled ? 'ghost' : 'primary' ?> fs-btn--sm" style="width:100%;">
          <?= $app_enabled ? 'Pause try-on' : 'Resume try-on' ?>
        </button>
      </form>
    </div>
  </section>

  <!-- Primary stat strip -->
  <section class="bt-stat-strip">
    <a class="bt-stat" href="<?= $view->e($view->url('admin/wallet')) ?>">
      <div class="bt-stat-label">Wallet credits</div>
      <div class="bt-stat-value fs-tabular"><?= $view->e(number_format($balance)) ?></div>
      <div class="bt-stat-sub">
        <?= $walletLow ? '<span style="color:#C2410C;font-weight:600;">Running low</span>' : $view->e(number_format($used) . ' used lifetime') ?>
      </div>
    </a>
    <a class="bt-stat" href="<?= $view->e($view->url('admin/products')) ?>">
      <div class="bt-stat-label">Products enabled</div>
      <div class="bt-stat-value fs-tabular"><?= $view->e(number_format($counts['enabled_products'])) ?><span class="bt-stat-value-of">/ <?= $view->e(number_format($counts['total_products'])) ?></span></div>
      <div class="bt-stat-sub">In your catalog</div>
    </a>
    <a class="bt-stat" href="<?= $view->e($view->url('admin/analytics')) ?>">
      <div class="bt-stat-label">Try-ons this week</div>
      <div class="bt-stat-value fs-tabular"><?= $view->e(number_format((int)$week['tryons'])) ?></div>
      <div class="bt-stat-sub">Last 7 days</div>
    </a>
    <a class="bt-stat" href="<?= $view->e($view->url('admin/analytics')) ?>">
      <div class="bt-stat-label">Orders attributed</div>
      <div class="bt-stat-value fs-tabular"><?= $view->e(number_format((int)$week['orders'])) ?></div>
      <div class="bt-stat-sub">₹<?= $view->e(number_format((float)$week['revenue'], 0)) ?> revenue</div>
    </a>
  </section>

  <!-- Setup checklist + credits gauge -->
  <section class="bt-row-2col">
    <div class="fs-card bt-checklist-card">
      <div class="fs-card-head">
        <div>
          <h3 class="bt-card-title">Setup checklist</h3>
          <p class="fs-card-sub">
            <?php if ($doneLeft === 0): ?>
              All done: your try-on is fully set up.
            <?php else: ?>
              <?= (int)$checklist['done'] ?> of <?= (int)$checklist['total'] ?> complete, <?= $doneLeft ?> step<?= $doneLeft === 1 ? '' : 's' ?> left
            <?php endif; ?>
          </p>
        </div>
        <span class="bt-progress-badge fs-tabular"><?= $pct ?>%</span>
      </div>
      <div class="fs-progress"><div class="fs-progress-bar" style="width:<?= $pct ?>%"></div></div>
      <div class="bt-checklist">
        <?php foreach ($checklist['items'] as $c): ?>
          <div class="bt-checklist-row <?= $c['done'] ? 'is-done' : '' ?>">
            <span class="bt-check-mark"><?= $c['done'] ? $view->fsIcon('check', 14, 3) : '' ?></span>
            <div style="flex:1;min-width:0;">
              <div class="bt-check-title"><?= $view->e($c['title']) ?></div>
              <div class="bt-check-desc"><?= $view->e($c['done'] ? $c['done_text'] : $c['todo']) ?></div>
            </div>
            <div>
              <?php if ($c['done']): ?>
                <span class="bt-check-done">Done</span>
              <?php elseif (!empty($c['to'])): ?>
                <a class="fs-btn fs-btn--primary fs-btn--sm" href="<?= $view->e($view->url(ltrim($c['to'], '/'))) ?>">Open</a>
              <?php else: ?>
                <span class="bt-check-waiting">Waiting</span>
              <?php endif; ?>
            </div>
          </div>
        <?php endforeach; ?>
      </div>
    </div>

    <div class="fs-card bt-credits-card">
      <div class="fs-card-head">
        <div><h3 class="bt-card-title">Try-on credits</h3><p class="fs-card-sub">Wallet balance</p></div>
      </div>
      <div class="bt-gauge">
        <svg width="100%" height="150" viewBox="0 0 240 136" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
          <path d="M24 124 A96 96 0 0 1 216 124" fill="none" stroke="#E5E7EB" stroke-width="18" stroke-linecap="round"/>
          <path d="M24 124 A96 96 0 0 1 216 124" fill="none" stroke="<?= $walletLow ? '#F59E0B' : '#4F46E5' ?>" stroke-width="18" stroke-linecap="round" stroke-dasharray="<?= number_format($walletPct * $arc, 2) ?> <?= number_format($arc, 2) ?>"/>
        </svg>
        <div class="bt-gauge-center">
          <span class="bt-gauge-value fs-tabular"><?= $view->e(number_format($balance)) ?></span>
          <span class="bt-gauge-label">credits remaining</span>
        </div>
      </div>
      <div class="bt-credits-rows">
        <div><span>Used lifetime</span><span class="fs-tabular"><?= $view->e(number_format($used)) ?></span></div>
        <div><span>Status</span><span style="color:<?= $walletLow ? '#C2410C' : '#16A34A' ?>;font-weight:600;"><?= $walletLow ? 'Running low' : 'Healthy' ?></span></div>
      </div>
      <a class="fs-btn fs-btn--primary" href="<?= $view->e($view->url('admin/wallet')) ?>" style="width:100%;"><?= $walletLow ? 'Top up credits' : 'Buy more credits' ?></a>
    </div>
  </section>

  <!-- KPIs this week -->
  <section class="fs-card">
    <div class="fs-card-head">
      <div><h3 class="bt-card-title">This week's performance</h3><p class="fs-card-sub">Last 7 days of shopper activity</p></div>
      <a class="fs-btn fs-btn--ghost fs-btn--sm" href="<?= $view->e($view->url('admin/analytics')) ?>">Open analytics</a>
    </div>
    <div class="bt-kpi-grid">
      <div class="bt-kpi">
        <div class="bt-kpi-head">
          <span class="bt-kpi-label">Try-ons</span>
        </div>
        <div class="bt-kpi-value fs-tabular"><?= $view->e(number_format((int)$week['tryons'])) ?></div>
        <div class="bt-kpi-note">Started by shoppers</div>
        <div class="bt-kpi-spark"><?= $sparkline($week['charts']['tryons']) ?></div>
      </div>
      <div class="bt-kpi">
        <div class="bt-kpi-head">
          <span class="bt-kpi-label">Cart rate</span>
        </div>
        <div class="bt-kpi-value fs-tabular"><?= number_format($cartRate, 1) ?>%</div>
        <div class="bt-kpi-note"><?= $view->e(number_format((int)$week['carts'])) ?> added to cart</div>
        <div class="bt-kpi-spark"><?= $sparkline($week['charts']['cart_rate'], '#16A34A') ?></div>
      </div>
      <div class="bt-kpi">
        <div class="bt-kpi-head">
          <span class="bt-kpi-label">Purchase rate</span>
        </div>
        <div class="bt-kpi-value fs-tabular"><?= number_format($purchRate, 1) ?>%</div>
        <div class="bt-kpi-note"><?= $view->e(number_format((int)$week['orders'])) ?> orders</div>
        <div class="bt-kpi-spark"><?= $sparkline($week['charts']['purch_rate'], '#9333EA') ?></div>
      </div>
      <div class="bt-kpi">
        <div class="bt-kpi-head">
          <span class="bt-kpi-label">Revenue</span>
        </div>
        <div class="bt-kpi-value fs-tabular">₹<?= $view->e(number_format((float)$week['revenue'], 0)) ?></div>
        <div class="bt-kpi-note">Attributed to try-on</div>
        <div class="bt-kpi-spark"><?= $sparkline($week['charts']['revenue'], '#F59E0B') ?></div>
      </div>
    </div>
  </section>

  <!-- Recent activity + quick actions -->
  <section class="bt-row-2col">
    <div class="fs-card">
      <div class="fs-card-head">
        <div><h3 class="bt-card-title">Recent activity</h3><p class="fs-card-sub">Latest wallet movements and shopper events</p></div>
        <a class="fs-btn fs-btn--ghost fs-btn--sm" href="<?= $view->e($view->url('admin/wallet')) ?>">Full ledger</a>
      </div>
      <?php if (empty($recent_credits) && empty($recent_days)): ?>
        <div class="bt-empty">
          <?= $view->fsIcon('clock', 24) ?>
          <p>Nothing yet. As shoppers try things on, you'll see it here.</p>
        </div>
      <?php else: ?>
        <ul class="bt-activity">
          <?php foreach (array_slice($recent_credits, 0, 5) as $t): ?>
            <?php
              $delta = (int)($t['delta'] ?? 0);
              $positive = $delta >= 0;
              $when = ($ts = strtotime((string)($t['created_at'] ?? ''))) ? date('M j, g:i a', $ts) : (string)($t['created_at'] ?? '');
            ?>
            <li class="bt-activity-row">
              <span class="bt-activity-dot bt-activity-dot--<?= $positive ? 'pos' : 'neg' ?>">
                <?= $view->fsIcon($positive ? 'bolt' : 'sparkle', 14) ?>
              </span>
              <div style="flex:1;min-width:0;">
                <div class="bt-activity-title"><?= $view->e($reasonLabel[$t['reason']] ?? $t['reason']) ?></div>
                <div class="bt-activity-sub"><?= $view->e($when) ?></div>
              </div>
              <span class="bt-activity-delta fs-tabular" style="color:<?= $positive ? '#16A34A' : '#334155' ?>;">
                <?= $positive ? '+' : '' ?><?= $view->e(number_format($delta)) ?>
              </span>
            </li>
          <?php endforeach; ?>
          <?php foreach (array_slice($recent_days, 0, 3) as $d): ?>
            <li class="bt-activity-row">
              <span class="bt-activity-dot bt-activity-dot--neutral"><?= $view->fsIcon('chart', 14) ?></span>
              <div style="flex:1;min-width:0;">
                <div class="bt-activity-title"><?= $view->e(number_format((int)$d['tryon_initiated'])) ?> try-ons, <?= $view->e(number_format((int)$d['order_count'])) ?> orders</div>
                <div class="bt-activity-sub"><?= $view->e($d['date']) ?></div>
              </div>
            </li>
          <?php endforeach; ?>
        </ul>
      <?php endif; ?>
    </div>

    <div class="fs-card">
      <div class="fs-card-head">
        <div><h3 class="bt-card-title">Quick actions</h3><p class="fs-card-sub">Jump straight to what you need</p></div>
      </div>
      <div class="bt-quick-grid">
        <a class="bt-quick" href="<?= $view->e($view->url('admin/products')) ?>">
          <span class="bt-quick-icon bt-quick-icon--indigo"><?= $view->fsIcon('box', 18) ?></span>
          <span><span class="bt-quick-title">Enable products</span>
          <span class="bt-quick-sub">Manage your try-on catalog</span></span>
        </a>
        <a class="bt-quick" href="<?= $view->e($view->url('admin/settings')) ?>">
          <span class="bt-quick-icon bt-quick-icon--green"><?= $view->fsIcon('sliders', 18) ?></span>
          <span><span class="bt-quick-title">Customize widget</span>
          <span class="bt-quick-sub">Colors, text, placement</span></span>
        </a>
        <a class="bt-quick" href="<?= $view->e($view->url('admin/analytics')) ?>">
          <span class="bt-quick-icon bt-quick-icon--amber"><?= $view->fsIcon('chart', 18) ?></span>
          <span><span class="bt-quick-title">Track performance</span>
          <span class="bt-quick-sub">Try-ons, carts and orders</span></span>
        </a>
        <a class="bt-quick" href="<?= $view->e($view->url('admin/wallet')) ?>">
          <span class="bt-quick-icon bt-quick-icon--purple"><?= $view->fsIcon('bolt', 18) ?></span>
          <span><span class="bt-quick-title">Top up credits</span>
          <span class="bt-quick-sub"><?= $view->e(number_format($balance)) ?> credits remaining</span></span>
        </a>
        <a class="bt-quick" href="<?= $view->e($view->url('admin/variants')) ?>">
          <span class="bt-quick-icon bt-quick-icon--rose"><?= $view->fsIcon('layers', 18) ?></span>
          <span><span class="bt-quick-title">Variant mappings</span>
          <span class="bt-quick-sub">Per-variant try-on images</span></span>
        </a>
        <a class="bt-quick" href="<?= $view->e($view->url('admin/analytics')) ?>">
          <span class="bt-quick-icon bt-quick-icon--teal"><?= $view->fsIcon('users', 18) ?></span>
          <span><span class="bt-quick-title">Captured leads</span>
          <span class="bt-quick-sub">Shoppers who left details</span></span>
        </a>
      </div>
    </div>
  </section>

  <?php $view->include(__DIR__ . '/../partials/onboarding.php'); ?>
</div>
