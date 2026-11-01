<?php
/**
 * @var \TryFit\Admin\View $view
 * @var array<int,array<string,mixed>> $charts
 * @var bool $enabled
 * @var string|null $flash
 */
?>
<div class="fs-page">
  <?php if ($flash === '1'): ?>
    <div class="fs-banner fs-banner--success"><?= $view->fsIcon('check',16) ?><span>Saved.</span></div>
  <?php endif; ?>

  <div class="fs-card">
    <h2 class="fs-h2">Size Chart</h2>
    <p class="fs-card-sub">Toggle the size-chart feature for your widget. Charts themselves are managed via your product metadata.</p>

    <form method="post" action="<?= $view->e($view->url('admin/size-chart/save')) ?>" style="margin-top:16px;display:flex;flex-direction:column;gap:14px;align-items:flex-start;">
      <label class="fs-check">
        <input type="checkbox" name="enabled" value="1" <?= $enabled ? 'checked' : '' ?>>
        <span>Show size chart on product pages</span>
      </label>
      <button type="submit" class="fs-btn fs-btn--primary">Save</button>
    </form>
  </div>

  <div class="fs-card">
    <h3 class="fs-h3">Saved charts</h3>
    <?php if (empty($charts)): ?>
      <div style="padding:24px 0;text-align:center;color:var(--fs-muted);">
        <?= $view->fsIcon('info',24) ?>
        <p style="margin-top:8px;">No saved charts yet.</p>
      </div>
    <?php else: ?>
      <div class="fs-table">
        <div class="fs-tr fs-tr--head" style="grid-template-columns:1fr 1fr;"><span>Name</span><span>ID</span></div>
        <?php foreach ($charts as $c): ?>
          <div class="fs-tr" style="grid-template-columns:1fr 1fr;">
            <span><?= $view->e($c['name'] ?? $c['title'] ?? ('Chart #' . $c['id'])) ?></span>
            <span class="fs-tabular">#<?= (int)$c['id'] ?></span>
          </div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </div>
</div>
