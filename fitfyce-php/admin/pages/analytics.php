<?php
/**
 * @var \TryFit\Admin\View $view
 * @var array<string,mixed> $merchant
 * @var string $range
 * @var string $from
 * @var string $to
 * @var int    $period_days
 * @var array  $kpis
 * @var array  $funnel
 * @var array  $actions
 * @var array  $daily
 * @var array  $devices
 * @var int    $device_total
 * @var array  $top_products
 * @var array  $leads
 * @var int    $lead_total
 * @var string $lead_filter
 * @var string $lead_q
 * @var bool   $has_any_data
 * @var float  $revenue
 */

// Compact helpers ---------------------------------------------------------
$spark = static function (array $values, string $color = '#2A2E3A'): string {
    if (count($values) === 0) return '';
    $max = max($values); $min = min($values);
    $range = ($max - $min) ?: 1;
    $w = 280; $h = 44;
    $step = count($values) > 1 ? $w / (count($values) - 1) : $w;
    $pts = [];
    foreach (array_values($values) as $i => $v) {
        $x = $i * $step;
        $y = $h - (($v - $min) / $range) * ($h - 6) - 3;
        $pts[] = sprintf('%.1f,%.1f', $x, $y);
    }
    return '<svg class="ax-spark" viewBox="0 0 ' . $w . ' ' . $h . '" preserveAspectRatio="none"><polyline fill="none" stroke="' . $color . '" stroke-width="1.5" points="' . implode(' ', $pts) . '" /></svg>';
};
$deltaBadge = static function (float $delta): string {
    $sign = $delta > 0 ? '+' : ($delta < 0 ? '' : '+');
    $cls  = $delta > 0 ? 'is-up' : ($delta < 0 ? 'is-down' : 'is-flat');
    return '<span class="ax-badge ' . $cls . '">' . $sign . number_format($delta, 1) . '%</span>';
};
$pct = static function (int|float $num, int|float $denom): float {
    return $denom > 0 ? ($num / $denom) * 100 : 0;
};

// Daily arrays as number lists for sparklines
$dTryons   = array_column($daily, 'tryons');
$dCarts    = array_column($daily, 'carts');
$dOrders   = array_column($daily, 'orders');
$dRevenue  = array_column($daily, 'revenue');

// Conversion funnel steps (all expressed vs tryons, except Orders vs carts)
$totalTryons = (int)$funnel['tryons'];
$totalCarts  = (int)$funnel['carts'];
$funnelSteps = [
    ['label' => 'Try-ons',        'value' => $totalTryons,         'pct' => 100.0,                             'note' => 'Starting point'],
    ['label' => 'Saved image',    'value' => (int)$funnel['saves'],  'pct' => $pct((int)$funnel['saves'],  $totalTryons), 'note' => 'of try-ons'],
    ['label' => 'WhatsApp shares','value' => (int)$funnel['shares'], 'pct' => $pct((int)$funnel['shares'], $totalTryons), 'note' => 'of try-ons'],
    ['label' => 'Add to cart',    'value' => $totalCarts,            'pct' => $pct($totalCarts,          $totalTryons), 'note' => 'of try-ons'],
    ['label' => 'Orders',         'value' => (int)$funnel['orders'], 'pct' => $pct((int)$funnel['orders'], $totalCarts),   'note' => 'of add to carts'],
];
$tryonToOrder = $pct((int)$funnel['orders'], $totalTryons);

// Device split percentages
$dPct = [
    'mobile'  => $device_total > 0 ? ($devices['mobile']  / $device_total) * 100 : 0,
    'desktop' => $device_total > 0 ? ($devices['desktop'] / $device_total) * 100 : 0,
    'tablet'  => $device_total > 0 ? ($devices['tablet']  / $device_total) * 100 : 0,
];

// Donut math — three stacked arcs
$R = 46; $C = 2 * M_PI * $R;
$donutOffsets = [0, 0, 0];
$cumulative = 0;
foreach (['mobile', 'desktop', 'tablet'] as $i => $k) {
    $donutOffsets[$i] = $cumulative;
    $cumulative += $dPct[$k];
}

$qs = static function (array $overrides = []) use ($range, $from, $to, $lead_filter, $lead_q): string {
    $base = ['range' => $range, 'from' => $from, 'to' => $to, 'leads' => $lead_filter, 'lq' => $lead_q];
    $merged = array_merge($base, $overrides);
    $parts = [];
    foreach ($merged as $k => $v) {
        if ($v === '' || $v === null) continue;
        $parts[] = $k . '=' . rawurlencode((string)$v);
    }
    return '?' . implode('&', $parts);
};
?>
<div class="ax-page">

  <!-- ─── Header ─────────────────────────────────────────────────── -->
  <header class="ax-header">
    <div class="ax-header-main">
      <h1 class="ax-title">Try-on performance</h1>
      <p class="ax-sub">How shoppers use virtual try-on, and what it earns you.</p>
    </div>
    <div class="ax-header-right">
      <div class="ax-range" role="group" aria-label="Date range">
        <?php foreach ([['7d','7D'],['30d','30D'],['90d','90D']] as [$v,$label]): ?>
          <a href="<?= $view->e($qs(['range' => $v, 'from' => null, 'to' => null])) ?>"
             class="ax-range-btn<?= $range === $v ? ' is-active' : '' ?>"><?= $view->e($label) ?></a>
        <?php endforeach; ?>
      </div>
      <form method="get" class="ax-datepicker">
        <input type="hidden" name="range" value="custom">
        <input type="hidden" name="leads" value="<?= $view->e($lead_filter) ?>">
        <?= $view->fsIcon('clock', 14) ?>
        <span class="ax-datepicker-range"><?= $view->e(date('M j', strtotime($from))) ?> &ndash; <?= $view->e(date('M j, Y', strtotime($to))) ?></span>
        <input type="date" name="from" value="<?= $view->e($from) ?>" aria-label="From">
        <input type="date" name="to"   value="<?= $view->e($to)   ?>" aria-label="To">
      </form>
      <a class="ax-btn ax-btn--primary" href="<?= $view->e($view->url('admin/analytics/leads.csv')) ?>">
        <?= $view->fsIcon('download', 14) ?> Export
      </a>
    </div>
  </header>

  <!-- ─── Empty-state hero (when nothing happened in range) ───────── -->
  <?php if (!$has_any_data): ?>
    <div class="ax-empty-hero">
      <div class="ax-empty-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M8 16v-4M13 16V8M18 16v-7"/></svg>
      </div>
      <h3>No try-ons between <?= $view->e(date('M j', strtotime($from))) ?> &ndash; <?= $view->e(date('M j, Y', strtotime($to))) ?>.</h3>
      <p>Try a longer range, or make sure try-on is enabled on your products.</p>
      <a class="ax-btn ax-btn--primary" href="<?= $view->e($view->url('admin/products')) ?>">Enable products</a>
    </div>
  <?php endif; ?>

  <!-- ─── KPI row ────────────────────────────────────────────────── -->
  <section class="ax-kpi-row">
    <?php
      $kpiDefs = [
        ['label' => 'Try-ons',       'value' => number_format((int)$kpis['tryons']['value']),            'delta' => $kpis['tryons']['delta'],  'note' => 'Shoppers who started a try-on', 'series' => $dTryons],
        ['label' => 'Cart rate',     'value' => number_format($kpis['carts']['value'], 1) . '%',         'delta' => $kpis['carts']['delta'],   'note' => (int)$funnel['carts'] . ' of ' . (int)$funnel['tryons'] . ' try-ons', 'series' => $dCarts],
        ['label' => 'Purchase rate', 'value' => number_format($kpis['orders']['value'], 1) . '%',        'delta' => $kpis['orders']['delta'],  'note' => (int)$funnel['orders'] . ' orders after a try-on', 'series' => $dOrders],
        ['label' => 'Attributed revenue', 'value' => '$' . number_format((float)$revenue, 2),           'delta' => $kpis['revenue']['delta'], 'note' => 'From try-on orders', 'series' => $dRevenue],
      ];
    ?>
    <?php foreach ($kpiDefs as $k): ?>
      <div class="ax-kpi">
        <div class="ax-kpi-head">
          <span class="ax-kpi-label"><?= $view->e($k['label']) ?></span>
          <?= $deltaBadge((float)$k['delta']) ?>
        </div>
        <div class="ax-kpi-value fs-tabular"><?= $view->e($k['value']) ?></div>
        <?= $spark($k['series']) ?>
        <div class="ax-kpi-note"><?= $view->e($k['note']) ?></div>
      </div>
    <?php endforeach; ?>
  </section>

  <!-- ─── Row: Conversion funnel + Device split ──────────────────── -->
  <section class="ax-row-2">
    <article class="ax-card ax-funnel">
      <header class="ax-card-head">
        <div>
          <h2 class="ax-card-title">Conversion funnel</h2>
          <p class="ax-card-sub">From try-on to order &middot; step conversion on the right</p>
        </div>
        <span class="ax-pill"><?= number_format($tryonToOrder, 1) ?>% try-on to order</span>
      </header>
      <ul class="ax-funnel-list">
        <?php foreach ($funnelSteps as $i => $step): ?>
          <?php
            $barPct = max(2, (float)$step['pct']); // keep tiny bars visible
            $isFirst = $i === 0;
          ?>
          <li class="ax-funnel-row">
            <span class="ax-funnel-label"><?= $view->e($step['label']) ?></span>
            <div class="ax-funnel-track">
              <div class="ax-funnel-bar" style="width:<?= number_format($barPct, 1) ?>%;">
                <span class="ax-funnel-value fs-tabular"><?= $view->e(number_format((int)$step['value'])) ?></span>
              </div>
            </div>
            <span class="ax-funnel-right">
              <?php if ($isFirst): ?>
                <span class="ax-funnel-pct">100%</span>
                <span class="ax-funnel-note"><?= $view->e($step['note']) ?></span>
              <?php elseif ($step['value'] === 0 && $totalTryons === 0): ?>
                <span class="ax-funnel-pct ax-dim">&mdash;</span>
                <span class="ax-funnel-note"><?= $view->e($step['note']) ?></span>
              <?php else: ?>
                <span class="ax-funnel-pct"><?= number_format((float)$step['pct'], 1) ?>%</span>
                <span class="ax-funnel-note"><?= $view->e($step['note']) ?></span>
              <?php endif; ?>
            </span>
          </li>
        <?php endforeach; ?>
      </ul>
    </article>

    <article class="ax-card ax-devices">
      <header class="ax-card-head">
        <h2 class="ax-card-title">Device split</h2>
      </header>
      <div class="ax-donut-wrap">
        <svg class="ax-donut" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="46" fill="none" stroke="#EEF0F3" stroke-width="14"/>
          <?php
            $colors = ['mobile' => '#111827', 'desktop' => '#4F46E5', 'tablet' => '#C7D2FE'];
            foreach (['mobile','desktop','tablet'] as $i => $k):
              $slice = $dPct[$k];
              if ($slice <= 0) continue;
              $dash = ($slice / 100) * $C;
              $offset = -($donutOffsets[$i] / 100) * $C;
          ?>
            <circle cx="60" cy="60" r="<?= $R ?>" fill="none" stroke="<?= $colors[$k] ?>" stroke-width="14"
                    stroke-dasharray="<?= number_format($dash, 2) ?> <?= number_format($C, 2) ?>"
                    stroke-dashoffset="<?= number_format($offset, 2) ?>"
                    transform="rotate(-90 60 60)"/>
          <?php endforeach; ?>
        </svg>
        <div class="ax-donut-center">
          <span class="ax-donut-value fs-tabular"><?= $view->e(number_format($device_total)) ?></span>
          <span class="ax-donut-label">try-ons</span>
        </div>
      </div>
      <ul class="ax-legend">
        <li><span class="ax-legend-dot" style="background:#111827;"></span>Mobile <span class="ax-legend-pct fs-tabular"><?= number_format($dPct['mobile'], 0) ?>%</span></li>
        <li><span class="ax-legend-dot" style="background:#4F46E5;"></span>Desktop <span class="ax-legend-pct fs-tabular"><?= number_format($dPct['desktop'], 0) ?>%</span></li>
        <li><span class="ax-legend-dot" style="background:#C7D2FE;"></span>Tablet <span class="ax-legend-pct fs-tabular"><?= number_format($dPct['tablet'], 0) ?>%</span></li>
      </ul>
    </article>
  </section>

  <!-- ─── Row: Engagement funnel (locked) + Top products ──────────── -->
  <section class="ax-row-2">
    <article class="ax-card ax-engage">
      <header class="ax-card-head">
        <div>
          <h2 class="ax-card-title">Engagement Funnel</h2>
          <p class="ax-card-sub">From the first widget open through to cart</p>
        </div>
        <span class="ax-badge ax-badge--pro">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          Pro
        </span>
      </header>
      <div class="ax-engage-chart">
        <?php
          $bars = [
            ['label' => 'Widget Opens',    'h' => 90],
            ['label' => 'Camera Granted',  'h' => 70],
            ['label' => 'Try-on Attempted','h' => 55],
            ['label' => 'Looks Saved',     'h' => 38],
            ['label' => 'Add to Cart',     'h' => 24],
          ];
        ?>
        <svg class="ax-engage-line" viewBox="0 0 400 110" preserveAspectRatio="none">
          <polyline fill="none" stroke="#8B8FA3" stroke-width="1.5" stroke-dasharray="0" stroke-linecap="round"
                    points="<?php foreach ($bars as $i => $b) { $x = ($i + 0.5) * (400 / count($bars)); echo $x . ',' . (110 - $b['h']) . ' '; } ?>"/>
          <?php foreach ($bars as $i => $b): $x = ($i + 0.5) * (400 / count($bars)); ?>
            <circle cx="<?= number_format($x, 1) ?>" cy="<?= 110 - $b['h'] ?>" r="2.5" fill="#8B8FA3"/>
          <?php endforeach; ?>
        </svg>
        <div class="ax-engage-bars">
          <?php foreach ($bars as $b): ?>
            <div class="ax-engage-col">
              <div class="ax-engage-bar" style="height:<?= $b['h'] ?>px;">
                <span class="ax-engage-blur">0000</span>
              </div>
              <span class="ax-engage-label"><?= $view->e($b['label']) ?></span>
            </div>
          <?php endforeach; ?>
        </div>
      </div>
      <div class="ax-engage-upsell">
        See your full engagement funnel &rarr; <a href="<?= $view->e($view->url('admin/wallet')) ?>">Upgrade to Pro</a>
      </div>
    </article>

    <article class="ax-card ax-topprod">
      <header class="ax-card-head">
        <div>
          <h2 class="ax-card-title">Top products</h2>
          <p class="ax-card-sub">Ranked by try-ons in this period</p>
        </div>
        <a class="ax-link" href="<?= $view->e($view->url('admin/products')) ?>">All products</a>
      </header>
      <?php if (empty($top_products)): ?>
        <div class="ax-topprod-empty">
          <div class="ax-topprod-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>
          </div>
          <p>Your best-performing products will rank here after the first try-ons.</p>
          <a class="ax-btn ax-btn--primary" href="<?= $view->e($view->url('admin/products')) ?>">Enable products</a>
        </div>
      <?php else: ?>
        <ol class="ax-topprod-list">
          <?php foreach ($top_products as $i => $p): ?>
            <li>
              <span class="ax-topprod-rank"><?= $i + 1 ?></span>
              <div class="ax-topprod-main">
                <div class="ax-topprod-title"><?= $view->e($p['title']) ?></div>
                <div class="ax-topprod-handle">/<?= $view->e($p['handle']) ?></div>
              </div>
              <span class="ax-topprod-count fs-tabular"><?= $view->e(number_format((int)$p['n_tryons'])) ?></span>
            </li>
          <?php endforeach; ?>
        </ol>
      <?php endif; ?>
    </article>
  </section>

  <!-- ─── What shoppers did after trying on ──────────────────────── -->
  <section>
    <h2 class="ax-section-title">What shoppers did after trying on</h2>
    <div class="ax-action-row">
      <?php
        $actionDefs = [
          ['label' => 'Add to cart',    'icon' => '<path d="M6 7h12l1 14H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',  'value' => $actions['carts']['value'],  'delta' => $actions['carts']['delta'],  'cls' => 'ax-ico--neutral'],
          ['label' => 'Save image',     'icon' => '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',       'value' => $actions['saves']['value'],  'delta' => $actions['saves']['delta'],  'cls' => 'ax-ico--green'],
          ['label' => 'WhatsApp share', 'icon' => '<path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-6A8 8 0 1 1 21 12z"/>', 'value' => $actions['shares']['value'], 'delta' => $actions['shares']['delta'], 'cls' => 'ax-ico--teal'],
          ['label' => 'Orders',         'icon' => '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6"/>', 'value' => $actions['orders']['value'], 'delta' => $actions['orders']['delta'], 'cls' => 'ax-ico--dark'],
        ];
      ?>
      <?php foreach ($actionDefs as $a): ?>
        <div class="ax-action">
          <span class="ax-ico <?= $a['cls'] ?>">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><?= $a['icon'] ?></svg>
          </span>
          <div class="ax-action-main">
            <div class="ax-action-label"><?= $view->e($a['label']) ?></div>
            <div class="ax-action-value fs-tabular"><?= $view->e(number_format((int)$a['value'])) ?></div>
          </div>
          <?= $deltaBadge((float)$a['delta']) ?>
        </div>
      <?php endforeach; ?>
    </div>
  </section>

  <!-- ─── Captured leads ─────────────────────────────────────────── -->
  <article class="ax-card ax-leads">
    <header class="ax-leads-head">
      <div>
        <h2 class="ax-card-title">Captured leads <span class="ax-count-pill"><?= $view->e(number_format($lead_total)) ?></span></h2>
        <p class="ax-card-sub">Shoppers who left their email or phone to unlock their try-on</p>
      </div>
      <div class="ax-leads-tools">
        <form method="get" class="ax-leads-search">
          <?= $view->fsIcon('info', 14, 2, 'ax-leads-search-ico') ?>
          <input type="search" name="lq" value="<?= $view->e($lead_q) ?>" placeholder="Search email or phone">
          <input type="hidden" name="range" value="<?= $view->e($range) ?>">
          <input type="hidden" name="leads" value="<?= $view->e($lead_filter) ?>">
        </form>
        <div class="ax-leads-seg">
          <?php foreach ([['all','All'],['opted','Opted in'],['not_given','Not given']] as [$v,$l]): ?>
            <a href="<?= $view->e($qs(['leads' => $v])) ?>" class="ax-leads-seg-btn<?= $lead_filter === $v ? ' is-active' : '' ?>"><?= $view->e($l) ?></a>
          <?php endforeach; ?>
        </div>
        <a class="ax-btn ax-btn--ghost" href="<?= $view->e($view->url('admin/analytics/leads.csv')) ?>">
          <?= $view->fsIcon('download', 14) ?> Export CSV
        </a>
      </div>
    </header>

    <?php if (empty($leads)): ?>
      <div class="ax-leads-empty">
        <div class="ax-leads-empty-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/></svg>
        </div>
        <p>Leads show up here when shoppers leave their email to see their try-on.</p>
        <a class="ax-btn ax-btn--primary" href="<?= $view->e($view->url('admin/settings')) ?>">Turn on lead capture</a>
      </div>
    <?php else: ?>
      <div class="ax-leads-table">
        <div class="ax-leads-tr ax-leads-tr--head">
          <span>Email</span><span>Phone</span><span>Consent</span><span>Captured</span>
        </div>
        <?php foreach ($leads as $l): ?>
          <div class="ax-leads-tr">
            <span><?= $view->e($l['email'] ?? '-') ?></span>
            <span><?= $view->e($l['phone'] ?? '-') ?></span>
            <span><?= (int)$l['consent_marketing'] === 1 ? '<span class="ax-pill ax-pill--success">Opted in</span>' : '<span class="ax-pill ax-pill--muted">Not given</span>' ?></span>
            <span class="ax-dim"><?= $view->e(date('M j, Y g:i a', strtotime((string)$l['created_at']))) ?></span>
          </div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </article>

</div>
