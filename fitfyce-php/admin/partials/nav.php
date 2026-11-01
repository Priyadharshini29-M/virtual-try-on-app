<?php
/** @var \TryFit\Admin\View $view */
$links = [
    ['href' => 'admin',               'label' => 'Dashboard',       'key' => 'dashboard'],
    ['href' => 'admin/products',      'label' => 'Products',        'key' => 'products'],
    ['href' => 'admin/variants',      'label' => 'Variants',        'key' => 'variants'],
    ['href' => 'admin/settings',      'label' => 'Widget Settings', 'key' => 'settings'],
    ['href' => 'admin/analytics',     'label' => 'Analytics',       'key' => 'analytics'],
    ['href' => 'admin/size-chart',    'label' => 'Size Chart',      'key' => 'size-chart'],
    ['href' => 'admin/complete-look', 'label' => 'Complete Look',   'key' => 'complete-look'],
    ['href' => 'admin/wallet',        'label' => 'Credits',         'key' => 'wallet'],
];
?>
<nav class="fs-app-nav" aria-label="Admin">
  <?php foreach ($links as $l): ?>
    <a
      href="<?= $view->e($view->url($l['href'])) ?>"
      class="fs-app-nav-link<?= $view->activeNav === $l['key'] ? ' is-active' : '' ?>"
      <?= $view->activeNav === $l['key'] ? 'aria-current="page"' : '' ?>
    ><?= $view->e($l['label']) ?></a>
  <?php endforeach; ?>
</nav>
