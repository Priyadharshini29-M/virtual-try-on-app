<?php
/**
 * @var \TryFit\Admin\View $view
 * @var array<string,mixed> $merchant
 * @var array<int,array<string,mixed>> $products
 * @var array<int,int> $variant_counts
 * @var array<string,array<int,array<string,mixed>>> $grouped
 * @var array<int,array<string,mixed>> $collections
 * @var string $q
 * @var string $filter
 * @var string $col_filter
 * @var string $col_search
 * @var string $view_mode
 * @var int $page
 * @var int $page_count
 * @var int $page_size
 * @var int $filtered_total
 * @var int $total_products
 * @var int $enabled
 * @var string|null $flash
 */

$enabledPct = $total_products > 0 ? (int)round(100 * $enabled / $total_products) : 0;
$offCount   = max(0, $total_products - $enabled);
$shopDomain = (string)($merchant['shopify_domain'] ?? '');

$qs = static function (array $overrides = []) use ($q, $filter, $view_mode, $page, $col_filter, $col_search): string {
    $base = ['q' => $q, 'filter' => $filter, 'view' => $view_mode, 'page' => $page, 'col' => $col_filter, 'cq' => $col_search];
    $merged = array_merge($base, $overrides);
    $parts = [];
    foreach ($merged as $k => $v) {
        if ($v === '' || $v === null) continue;
        $parts[] = $k . '=' . rawurlencode((string)$v);
    }
    return '?' . implode('&', $parts);
};
?>
<div class="px-page">

  <?php if ($flash === '1' || $flash === 'bulk'): ?>
    <div class="px-flash">
      <span class="px-flash-dot"><?= $view->fsIcon('check', 14, 3) ?></span>
      <?= $flash === 'bulk' ? 'Bulk change saved.' : 'Saved.' ?>
    </div>
  <?php endif; ?>

  <!-- ─── Header ─────────────────────────────────────────────────── -->
  <header class="px-header">
    <div>
      <h1 class="px-title">Products</h1>
      <p class="px-sub">Choose which products show the try-on button in your store.</p>
    </div>
    <?php if ($shopDomain !== ''): ?>
      <a class="px-btn px-btn--ghost" href="https://<?= $view->e($shopDomain) ?>" target="_blank" rel="noopener">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><path d="M10 14 21 3"/></svg>
        View store
      </a>
    <?php endif; ?>
  </header>

  <!-- ─── Collections card (top) ─────────────────────────────────── -->
  <?php if (!empty($collections) || $col_search !== ''): ?>
    <section class="px-card px-collections">
      <div class="px-collections-head">
        <div>
          <h2 class="px-section-title">Collections</h2>
          <p class="px-section-sub">Switch on a whole collection at once, every product in it gets try-on.</p>
        </div>
        <form method="get" class="px-mini-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" name="cq" value="<?= $view->e($col_search) ?>" placeholder="Search collections">
          <input type="hidden" name="q" value="<?= $view->e($q) ?>">
          <input type="hidden" name="filter" value="<?= $view->e($filter) ?>">
          <input type="hidden" name="view" value="<?= $view->e($view_mode) ?>">
        </form>
      </div>

      <?php if (!empty($collections)): ?>
        <div class="px-coll-grid-head">
          <span>Collection</span>
          <span>Products</span>
          <span>Try-on coverage</span>
          <span></span>
          <span style="text-align:right;">Try-on</span>
        </div>
        <?php foreach ($collections as $c): ?>
          <?php
            $cEnabled = (int)$c['enabled'];
            $cTotal   = (int)$c['total'];
            $cPct     = $cTotal > 0 ? ($cEnabled / $cTotal) * 100 : 0;
            $allOn    = $cEnabled === $cTotal;
            $allOff   = $cEnabled === 0;
          ?>
          <div class="px-coll-row">
            <div class="px-coll-cell-main">
              <span class="px-coll-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              </span>
              <div style="min-width:0;">
                <div class="px-coll-title"><?= $view->e($c['collection_title']) ?></div>
                <?php if (!empty($c['collection_handle'])): ?>
                  <div class="px-coll-handle">/<?= $view->e($c['collection_handle']) ?></div>
                <?php endif; ?>
              </div>
            </div>
            <div class="px-coll-count"><?= $view->e(number_format($cTotal)) ?> product<?= $cTotal === 1 ? '' : 's' ?></div>
            <div class="px-coll-cov">
              <div class="px-coll-cov-bar"><div class="px-coll-cov-fill" style="width:<?= number_format($cPct, 1) ?>%"></div></div>
            </div>
            <div class="px-coll-cov-label"><?= $cEnabled ?> of <?= $cTotal ?></div>
            <div class="px-coll-actions">
              <a class="px-link" href="<?= $view->e($qs(['col' => (string)$c['collection_title'], 'page' => 1])) ?>">View products</a>
              <form method="post" action="<?= $view->e($view->url('admin/products/bulk-toggle')) ?>" style="margin:0;">
                <input type="hidden" name="scope" value="collection">
                <input type="hidden" name="collection" value="<?= $view->e($c['collection_title']) ?>">
                <input type="hidden" name="enabled" value="<?= $allOn ? '0' : '1' ?>">
                <button type="submit" class="px-switch<?= $allOn ? ' is-on' : ($allOff ? '' : ' is-partial') ?>" aria-label="Toggle collection try-on">
                  <span class="px-switch-knob"></span>
                </button>
              </form>
              <span class="px-switch-label"><?= $allOn ? 'On' : 'Off' ?></span>
            </div>
          </div>
        <?php endforeach; ?>
      <?php else: ?>
        <div class="px-dim" style="padding:16px 0;">No collections match "<?= $view->e($col_search) ?>".</div>
      <?php endif; ?>
    </section>
  <?php endif; ?>

  <!-- ─── Toolbar: search + chip filters + collection dropdown ────── -->
  <section class="px-toolbar">
    <form method="get" class="px-search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="search" name="q" value="<?= $view->e($q) ?>" placeholder="Search products or vendors">
      <input type="hidden" name="filter" value="<?= $view->e($filter) ?>">
      <input type="hidden" name="view"   value="<?= $view->e($view_mode) ?>">
      <input type="hidden" name="col"    value="<?= $view->e($col_filter) ?>">
    </form>

    <div class="px-chips" role="tablist">
      <?php foreach ([['', 'All', $total_products], ['enabled', 'Try-on active', $enabled], ['off', 'Not enabled', $offCount]] as [$val, $label, $count]): ?>
        <a href="<?= $view->e($qs(['filter' => $val, 'page' => 1])) ?>"
           class="px-chip<?= $filter === $val ? ' is-active' : '' ?>">
          <?= $view->e($label) ?><span class="px-chip-count"><?= $view->e(number_format((int)$count)) ?></span>
        </a>
      <?php endforeach; ?>
    </div>

    <?php if (!empty($collections)): ?>
      <form method="get" class="px-coll-filter">
        <input type="hidden" name="q" value="<?= $view->e($q) ?>">
        <input type="hidden" name="filter" value="<?= $view->e($filter) ?>">
        <input type="hidden" name="view" value="<?= $view->e($view_mode) ?>">
        <select name="col" onchange="this.form.submit()">
          <option value="">All collections</option>
          <?php foreach ($collections as $c): ?>
            <option value="<?= $view->e($c['collection_title']) ?>" <?= $col_filter === $c['collection_title'] ? 'selected' : '' ?>>
              <?= $view->e($c['collection_title']) ?> (<?= (int)$c['total'] ?>)
            </option>
          <?php endforeach; ?>
        </select>
      </form>
    <?php endif; ?>
  </section>

  <?php if (empty($products)): ?>
    <div class="px-empty">
      <div class="px-empty-icon"><?= $view->fsIcon('box', 36) ?></div>
      <h3>No products <?= $q !== '' || $col_filter !== '' ? 'match your filters' : 'yet' ?></h3>
      <p>
        <?php if ($q !== '' || $filter !== '' || $col_filter !== ''): ?>
          <a href="<?= $view->e($view->url('admin/products')) ?>">Clear filters</a>
        <?php else: ?>
          Products appear here once your catalog syncs from Shopify.
        <?php endif; ?>
      </p>
    </div>
  <?php else: ?>
    <!-- ─── Product table ─────────────────────────────────────────── -->
    <form id="px-sel" method="post" action="<?= $view->e($view->url('admin/products/bulk-toggle')) ?>" class="px-card px-table">
      <input type="hidden" name="scope"  value="selected">
      <input type="hidden" name="q"      value="<?= $view->e($q) ?>">
      <input type="hidden" name="filter" value="<?= $view->e($filter) ?>">
      <input type="hidden" name="view"   value="<?= $view->e($view_mode) ?>">
      <input type="hidden" name="col"    value="<?= $view->e($col_filter) ?>">
      <input type="hidden" name="page"   value="<?= (int)$page ?>">

      <div class="px-tr px-tr--head">
        <label class="px-cell-check">
          <input type="checkbox" id="px-check-all" aria-label="Select all">
        </label>
        <span class="px-th">Product</span>
        <span class="px-th">Status</span>
        <span class="px-th">Variants</span>
        <span class="px-th" style="text-align:right;">Try-on</span>
      </div>

      <div class="px-bulk-bar" data-bulk-bar hidden>
        <span class="px-bulk-count" data-bulk-count>0 selected</span>
        <button type="submit" name="enabled" value="1" class="px-btn px-btn--sm px-btn--primary">Enable selected</button>
        <button type="submit" name="enabled" value="0" class="px-btn px-btn--sm px-btn--ghost">Disable selected</button>
      </div>

      <?php foreach ($products as $p): ?>
        <?php $on = (int)$p['is_tryon_enabled'] === 1; $vc = (int)($variant_counts[(int)$p['id']] ?? 0); ?>
        <div class="px-tr px-tr--row<?= $on ? ' is-on' : '' ?>">
          <label class="px-cell-check">
            <input type="checkbox" name="ids[]" value="<?= (int)$p['id'] ?>" data-row-check>
          </label>

          <div class="px-cell-main">
            <span class="px-thumb"><?= $view->fsIcon('shirt', 20) ?></span>
            <div style="min-width:0;">
              <div class="px-prod-title"><?= $view->e($p['title']) ?></div>
              <div class="px-prod-sub">
                <?= $shopDomain !== '' ? $view->e($shopDomain) : '/' . $view->e($p['handle']) ?>
                <?php if (!empty($p['collection_title'])): ?>
                  <span class="px-mini-pill"><?= $view->e($p['collection_title']) ?></span>
                <?php endif; ?>
              </div>
            </div>
          </div>

          <div>
            <span class="px-pill <?= $on ? 'px-pill--success' : 'px-pill--muted' ?>">
              <span class="px-pill-dot"></span><?= $on ? 'Try-on active' : 'Off' ?>
            </span>
          </div>

          <div>
            <?php if ($vc > 0): ?>
              <a class="px-mini-pill px-mini-pill--brand" href="<?= $view->e($view->url('admin/variants?product_id=' . (int)$p['id'])) ?>">
                <?= $view->fsIcon('layers', 11) ?> <?= $vc ?> mapped
              </a>
            <?php else: ?>
              <a class="px-mini-link" href="<?= $view->e($view->url('admin/variants?product_id=' . (int)$p['id'])) ?>">+ Add</a>
            <?php endif; ?>
          </div>

          <div class="px-cell-actions">
            <?php if ($shopDomain !== ''): ?>
              <a class="px-icon-btn" href="https://<?= $view->e($shopDomain) ?>/products/<?= $view->e($p['handle']) ?>" target="_blank" rel="noopener" title="View on storefront" aria-label="View on storefront">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
              </a>
            <?php endif; ?>
            <a class="px-icon-btn" href="<?= $view->e($view->url('admin/variants?product_id=' . (int)$p['id'])) ?>" title="Edit variants" aria-label="Edit variants">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>
            </a>
            <!-- Toggle switch has its own form so it doesn't post the selection -->
            <form method="post" action="<?= $view->e($view->url('admin/products/toggle')) ?>" style="margin:0;">
              <input type="hidden" name="product_id" value="<?= (int)$p['id'] ?>">
              <input type="hidden" name="enabled"    value="<?= $on ? '0' : '1' ?>">
              <input type="hidden" name="q"      value="<?= $view->e($q) ?>">
              <input type="hidden" name="filter" value="<?= $view->e($filter) ?>">
              <input type="hidden" name="view"   value="<?= $view->e($view_mode) ?>">
              <input type="hidden" name="col"    value="<?= $view->e($col_filter) ?>">
              <input type="hidden" name="page"   value="<?= (int)$page ?>">
              <button type="submit" class="px-switch<?= $on ? ' is-on' : '' ?>" aria-label="Toggle try-on">
                <span class="px-switch-knob"></span>
              </button>
            </form>
          </div>
        </div>
      <?php endforeach; ?>
    </form>

    <?php if ($page_count > 1): ?>
      <nav class="px-pager">
        <div class="px-pager-info">
          Showing <?= (($page - 1) * $page_size) + 1 ?>&ndash;<?= min($page * $page_size, $filtered_total) ?>
          of <?= $view->e(number_format($filtered_total)) ?>
        </div>
        <div class="px-pager-actions">
          <?php if ($page > 1): ?>
            <a class="px-btn px-btn--sm px-btn--ghost" href="<?= $view->e($qs(['page' => $page - 1])) ?>">&larr; Previous</a>
          <?php endif; ?>
          <span class="px-pager-page">Page <?= $page ?> of <?= $page_count ?></span>
          <?php if ($page < $page_count): ?>
            <a class="px-btn px-btn--sm px-btn--primary" href="<?= $view->e($qs(['page' => $page + 1])) ?>">Next &rarr;</a>
          <?php endif; ?>
        </div>
      </nav>
    <?php endif; ?>
  <?php endif; ?>
</div>

<script>
(function () {
  var form = document.getElementById('px-sel');
  if (!form) return;
  var all   = document.getElementById('px-check-all');
  var rows  = form.querySelectorAll('[data-row-check]');
  var bar   = form.querySelector('[data-bulk-bar]');
  var count = form.querySelector('[data-bulk-count]');
  function refresh() {
    var n = 0;
    rows.forEach(function (c) { if (c.checked) n += 1; });
    if (bar)   bar.hidden = n === 0;
    if (count) count.textContent = n === 1 ? '1 selected' : n + ' selected';
    if (all)   all.checked = n === rows.length && n > 0;
  }
  if (all) all.addEventListener('change', function () {
    rows.forEach(function (c) { c.checked = all.checked; });
    refresh();
  });
  rows.forEach(function (c) { c.addEventListener('change', refresh); });
})();
</script>
