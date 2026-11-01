<?php
/**
 * @var \TryFit\Admin\View $view
 * @var array<string,mixed> $p
 * @var array<int,int> $variant_counts
 * @var string $q
 * @var string $filter
 * @var string $view_mode
 * @var int $page
 */
$on = (int)$p['is_tryon_enabled'] === 1;
$vc = (int)($variant_counts[(int)$p['id']] ?? 0);
?>
<div class="bt-prod-tile<?= $on ? ' is-on' : '' ?>">
  <div class="bt-prod-tile-head">
    <span class="bt-prod-thumb bt-prod-thumb--lg" aria-hidden="true"><?= $view->fsIcon('shirt', 20) ?></span>
    <span class="fs-pill <?= $on ? 'fs-pill--success' : '' ?>"><?= $on ? 'Enabled' : 'Off' ?></span>
  </div>
  <div class="bt-prod-tile-body">
    <div class="bt-prod-title"><?= $view->e($p['title']) ?></div>
    <div class="bt-prod-handle">/<?= $view->e($p['handle']) ?></div>
  </div>
  <div class="bt-prod-tile-meta">
    <?php if ($vc > 0): ?>
      <a class="bt-mini-pill bt-mini-pill--brand" href="<?= $view->e($view->url('admin/variants?product_id=' . (int)$p['id'])) ?>">
        <?= $view->fsIcon('layers', 12) ?> <?= $vc ?> variant<?= $vc === 1 ? '' : 's' ?>
      </a>
    <?php else: ?>
      <a class="bt-mini-link" href="<?= $view->e($view->url('admin/variants?product_id=' . (int)$p['id'])) ?>">Add variant mapping</a>
    <?php endif; ?>
  </div>
  <form method="post" action="<?= $view->e($view->url('admin/products/toggle')) ?>" style="margin:0;">
    <input type="hidden" name="product_id" value="<?= (int)$p['id'] ?>">
    <input type="hidden" name="enabled"    value="<?= $on ? '0' : '1' ?>">
    <input type="hidden" name="q"          value="<?= $view->e($q) ?>">
    <input type="hidden" name="filter"     value="<?= $view->e($filter) ?>">
    <input type="hidden" name="view"       value="<?= $view->e($view_mode) ?>">
    <input type="hidden" name="page"       value="<?= (int)$page ?>">
    <button type="submit" class="fs-btn fs-btn--sm fs-btn--<?= $on ? 'ghost' : 'primary' ?>" style="width:100%;">
      <?= $on ? 'Disable try-on' : 'Enable try-on' ?>
    </button>
  </form>
</div>
