<?php
/** @var \TryFit\Admin\View $view */

$sections = [
    [
        'label' => 'Workspace',
        'links' => [
            ['href' => 'admin',               'icon' => 'dashboard', 'label' => 'Dashboard',       'key' => 'dashboard'],
            ['href' => 'admin/products',      'icon' => 'box',       'label' => 'Products',        'key' => 'products'],
            ['href' => 'admin/analytics',     'icon' => 'chart',     'label' => 'Analytics',       'key' => 'analytics'],
        ],
    ],
    [
        'label' => 'Experience',
        'links' => [
            ['href' => 'admin/settings',      'icon' => 'sliders',   'label' => 'Widget Settings', 'key' => 'settings'],
            ['href' => 'admin/size-chart',    'icon' => 'ruler',     'label' => 'Size Chart',      'key' => 'size-chart',    'locked' => true],
            ['href' => 'admin/complete-look', 'icon' => 'shirt',     'label' => 'Complete Look',   'key' => 'complete-look', 'locked' => true],
        ],
    ],
    [
        'label' => 'Billing',
        'links' => [
            ['href' => 'admin/wallet',        'icon' => 'wallet',    'label' => 'Credits wallet',  'key' => 'wallet'],
        ],
    ],
];
?>
<a class="bt-brand" href="<?= $view->e($view->url('admin')) ?>">
  <span class="bt-brand-mark">BT</span>
  <span class="bt-brand-name">Brix-TryOn</span>
</a>

<nav class="bt-nav" aria-label="Primary">
  <?php foreach ($sections as $section): ?>
    <div class="bt-nav-section">
      <div class="bt-nav-section-label"><?= $view->e($section['label']) ?></div>
      <?php foreach ($section['links'] as $l): ?>
        <?php
          $isActive = $view->activeNav === $l['key'];
          $isLocked = !empty($l['locked']);
        ?>
        <a
          href="<?= $view->e($view->url($l['href'])) ?>"
          class="bt-nav-link<?= $isActive ? ' is-active' : '' ?><?= $isLocked ? ' is-locked' : '' ?>"
          <?= $isActive ? 'aria-current="page"' : '' ?>
          <?= $isLocked ? 'title="Coming soon"' : '' ?>
        >
          <span class="bt-nav-icon"><?= $view->fsIcon($l['icon'], 18) ?></span>
          <span class="bt-nav-label"><?= $view->e($l['label']) ?></span>
          <?php if ($isLocked): ?>
            <span class="bt-nav-badge">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
              Soon
            </span>
          <?php endif; ?>
        </a>
      <?php endforeach; ?>
    </div>
  <?php endforeach; ?>
</nav>

<div class="bt-sidebar-foot">
  <a class="bt-nav-link" href="https://help.example.com" target="_blank" rel="noopener noreferrer">
    <span class="bt-nav-icon"><?= $view->fsIcon('help', 18) ?></span>
    <span class="bt-nav-label">Help & docs</span>
  </a>
</div>
