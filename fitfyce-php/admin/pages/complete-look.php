<?php
/**
 * @var \TryFit\Admin\View $view
 * @var array<int,array<string,mixed>> $products
 * @var array<int,array<string,mixed>> $pairings
 * @var bool $enabled
 * @var string|null $flash
 */
?>
<div class="fs-page">
  <?php if ($flash === '1'): ?>
    <div class="fs-banner fs-banner--success"><?= $view->fsIcon('check',16) ?><span>Saved.</span></div>
  <?php endif; ?>

  <div class="fs-card">
    <h2 class="fs-h2">Complete Your Look</h2>
    <p class="fs-card-sub">Pair up to 12 products so shoppers see suggested matches on each product page.</p>
    <form method="post" action="<?= $view->e($view->url('admin/complete-look/save')) ?>" style="margin-top:16px;display:flex;flex-direction:column;gap:14px;align-items:flex-start;">
      <label class="fs-check">
        <input type="checkbox" name="enabled" value="1" <?= $enabled ? 'checked' : '' ?>>
        <span>Enable complete-look suggestions on product pages</span>
      </label>
      <button type="submit" class="fs-btn fs-btn--primary">Save</button>
    </form>
  </div>

  <div class="fs-card">
    <h3 class="fs-h3">Pairings</h3>
    <?php if (empty($pairings)): ?>
      <div style="padding:24px 0;text-align:center;color:var(--fs-muted);">
        <?= $view->fsIcon('info',24) ?>
        <p style="margin-top:8px;">No pairings yet. Pairings are set per-product; use your widget admin or API to add them.</p>
      </div>
    <?php else: ?>
      <div class="fs-table">
        <div class="fs-tr fs-tr--head" style="grid-template-columns:1fr 1fr;"><span>Product</span><span>Paired count</span></div>
        <?php foreach ($pairings as $p): ?>
          <div class="fs-tr" style="grid-template-columns:1fr 1fr;">
            <span>#<?= $view->e($p['shopify_product_id'] ?? '-') ?></span>
            <span class="fs-tabular"><?= $view->e(is_string($p['paired_ids'] ?? null) ? count(explode(',', $p['paired_ids'])) : '0') ?></span>
          </div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </div>

  <div class="fs-card">
    <h3 class="fs-h3">Catalog</h3>
    <p class="fs-card-sub">Your <?= $view->e(number_format(count($products))) ?> synced product(s). Use the Shopify widget admin to assign pairings per product.</p>
  </div>
</div>
