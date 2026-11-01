<?php
/**
 * @var \TryFit\Admin\View $view
 * @var string $title
 * @var string $sub
 * @var string $body
 * @var string $icon
 * @var array<int,string> $features
 */
?>
<div class="cs-page">
  <section class="cs-card">
    <div class="cs-badge">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      Coming soon
    </div>

    <div class="cs-icon-ring">
      <span class="cs-icon">
        <?= $view->fsIcon($icon, 28) ?>
      </span>
    </div>

    <h1 class="cs-title"><?= $view->e($title) ?></h1>
    <p class="cs-sub"><?= $view->e($sub) ?></p>
    <p class="cs-body"><?= $view->e($body) ?></p>

    <ul class="cs-features">
      <?php foreach ($features as $f): ?>
        <li>
          <span class="cs-feature-check">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </span>
          <?= $view->e($f) ?>
        </li>
      <?php endforeach; ?>
    </ul>

    <div class="cs-actions">
      <a class="cs-btn cs-btn--primary" href="<?= $view->e($view->url('admin')) ?>">Back to dashboard</a>
      <a class="cs-btn cs-btn--ghost" href="<?= $view->e($view->url('admin/products')) ?>">Open Products</a>
    </div>
  </section>

  <div class="cs-foot">
    This module is being finalised. The sidebar entry will unlock automatically when it's ready, no update required on your side.
  </div>
</div>
