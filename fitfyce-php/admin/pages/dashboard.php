<?php
/**
 * @var \TryFit\Admin\View $view
 * @var array<string,mixed> $merchant
 * @var int $balance
 */
?>
<div class="fs-page">
  <div class="fs-card">
    <h2 class="fs-h1">Welcome back</h2>
    <p class="fs-sub">You're signed in as <strong><?= $view->e($merchant['shopify_domain']) ?></strong>.</p>
    <p>Your wallet has <strong><?= $view->e(number_format($balance)) ?></strong> credits.</p>
    <p>
      <a class="fs-btn fs-btn--primary" href="<?= $view->e($view->url('admin/wallet')) ?>">Open Credits</a>
      <a class="fs-btn fs-btn--ghost" href="<?= $view->e($view->url('admin/settings')) ?>">Widget settings</a>
    </p>
    <p class="fs-help" style="margin-top:16px;">
      The remaining admin pages (Products, AI Studio, Widget Settings, Analytics) will be ported from Remix next.
    </p>
  </div>
</div>
