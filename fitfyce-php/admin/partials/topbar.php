<?php
/**
 * @var \TryFit\Admin\View $view
 */

$navTitles = [
    'dashboard'     => 'Dashboard',
    'products'      => 'Products',
    'variants'      => 'Variants',
    'analytics'     => 'Analytics',
    'settings'      => 'Widget Settings',
    'size-chart'    => 'Size Chart',
    'complete-look' => 'Complete Look',
    'wallet'        => 'Credits wallet',
];
$pageTitle = $navTitles[$view->activeNav] ?? '';
$shopHandle = (string)($view->merchant['shopify_domain'] ?? '');
$initials = $shopHandle !== ''
    ? strtoupper(substr(preg_replace('/[^a-zA-Z]/', '', $shopHandle) ?: 'B', 0, 2))
    : 'BT';
?>
<button class="bt-sidebar-toggle" id="bt-sidebar-toggle" aria-label="Toggle navigation">
  <?= $view->fsIcon('menu', 20) ?>
</button>

<div class="bt-topbar-title">
  <h1 class="bt-page-title"><?= $view->e($pageTitle) ?></h1>
  <?php if ($shopHandle !== ''): ?>
    <span class="bt-page-handle"><?= $view->e($shopHandle) ?></span>
  <?php endif; ?>
</div>

<div class="bt-topbar-right">
  <a class="bt-credits-pill" href="<?= $view->e($view->url('admin/wallet')) ?>" title="Credits wallet">
    <span class="bt-credits-icon"><?= $view->fsIcon('bolt', 14) ?></span>
    <span class="bt-credits-value fs-tabular"><?= $view->e(number_format($view->walletBalance)) ?></span>
    <span class="bt-credits-label">credits</span>
  </a>

  <div class="bt-user-menu">
    <button type="button" class="bt-user-chip" aria-haspopup="true">
      <span class="bt-user-initials"><?= $view->e($initials) ?></span>
      <?= $view->fsIcon('chevronRight', 14) ?>
    </button>
    <div class="bt-user-pop">
      <div class="bt-user-meta">
        <div class="bt-user-name"><?= $view->e($shopHandle ?: 'Your store') ?></div>
        <div class="bt-user-sub">Signed in</div>
      </div>
      <form method="post" action="<?= $view->e($view->url('auth/logout')) ?>" style="margin:0;">
        <button type="submit" class="bt-user-logout">
          <?= $view->fsIcon('logout', 16) ?>
          <span>Log out</span>
        </button>
      </form>
    </div>
  </div>
</div>
