<?php
/**
 * @var \TryFit\Admin\View $view
 */
$error = (string)($_GET['error'] ?? '');
?>
<div class="fs-page">
  <div class="fs-card" style="max-width:420px;margin:48px auto;">
    <h2 class="fs-h1">Log in</h2>
    <p class="fs-sub">Enter your Shopify store domain to continue.</p>
    <?php if ($error !== ''): ?>
      <div class="fs-banner fs-banner--critical" role="alert">
        <?= $view->fsIcon('info', 18) ?><span><?= $view->e($error) ?></span>
      </div>
    <?php endif; ?>
    <form method="get" action="<?= $view->e($view->url('auth/install')) ?>" style="display:flex;flex-direction:column;gap:12px;">
      <label class="fs-label" for="shop">Shop domain</label>
      <input
        class="fs-input"
        id="shop" name="shop" required
        placeholder="example.myshopify.com"
        pattern="[a-z0-9][a-z0-9\-]*\.myshopify\.com"
        autocomplete="off"
      >
      <button type="submit" class="fs-btn fs-btn--primary" style="height:42px;">Log in with Shopify</button>
    </form>
  </div>
</div>
