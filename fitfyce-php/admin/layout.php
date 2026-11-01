<?php
/** @var \TryFit\Admin\View $view */
/** @var string $_content */
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title><?= $view->e($view->title) ?></title>
  <link rel="preconnect" href="https://cdn.shopify.com/">
  <link rel="stylesheet" href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css">
  <link rel="stylesheet" href="<?= $view->e($view->asset('design-tokens.css')) ?>">
  <link rel="stylesheet" href="<?= $view->e($view->asset('fitsnap-ui.css')) ?>">
  <link rel="stylesheet" href="<?= $view->e($view->asset('fitsnap-dashboard.css')) ?>">
  <link rel="stylesheet" href="<?= $view->e($view->asset('fitsnap-onboarding.css')) ?>">
  <link rel="stylesheet" href="<?= $view->e($view->asset('fitsnap-models.css')) ?>">
  <link rel="stylesheet" href="<?= $view->e($view->asset('admin-shell.css')) ?>">
</head>
<body class="bt-app">
  <aside class="bt-sidebar" id="bt-sidebar">
    <?php $view->include(__DIR__ . '/partials/sidebar.php'); ?>
  </aside>

  <div class="bt-main">
    <header class="bt-topbar">
      <?php $view->include(__DIR__ . '/partials/topbar.php'); ?>
    </header>
    <main class="bt-content">
      <?= $_content ?>
    </main>
  </div>

  <!-- Mobile sidebar backdrop (clickable to close) -->
  <div class="bt-sidebar-backdrop" id="bt-sidebar-backdrop"></div>

  <script>
    (function () {
      var btn = document.getElementById('bt-sidebar-toggle');
      var side = document.getElementById('bt-sidebar');
      var back = document.getElementById('bt-sidebar-backdrop');
      if (!btn || !side) return;
      function open()  { side.classList.add('is-open'); back.classList.add('is-open'); }
      function close() { side.classList.remove('is-open'); back.classList.remove('is-open'); }
      btn.addEventListener('click', function () {
        side.classList.contains('is-open') ? close() : open();
      });
      back.addEventListener('click', close);
    })();
  </script>
</body>
</html>
