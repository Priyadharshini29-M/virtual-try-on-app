<?php
/**
 * @var \TryFit\Admin\View $view
 * @var array<int,array<string,mixed>> $products
 * @var int $product_id
 * @var array<string,mixed>|null $product
 * @var array<int,array<string,mixed>> $mappings
 * @var array{prev:?array,next:?array} $prev_next
 * @var string $q
 * @var string|null $flash
 */

$imageTypes = [
    'flat_lay'        => 'Flat lay',
    'ghost_mannequin' => 'Ghost mannequin',
    'on_model'        => 'On model',
];
?>
<div class="pm-page">

  <?php if ($flash === '1'): ?>
    <div class="pm-flash">
      <span class="pm-flash-dot"><?= $view->fsIcon('check', 14, 3) ?></span>
      Variant mapping saved.
    </div>
  <?php endif; ?>

  <!-- Breadcrumb -->
  <nav class="pm-crumb" aria-label="Breadcrumb">
    <a href="<?= $view->e($view->url('admin/products')) ?>" class="pm-crumb-link">Products</a>
    <span class="pm-crumb-sep">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
    </span>
    <?php if ($product !== null): ?>
      <a href="<?= $view->e($view->url('admin/products?q=' . rawurlencode((string)$product['title']))) ?>" class="pm-crumb-link"><?= $view->e($product['title']) ?></a>
      <span class="pm-crumb-sep">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
      </span>
      <span class="pm-crumb-now">Variants</span>
    <?php else: ?>
      <span class="pm-crumb-now">Variants</span>
    <?php endif; ?>
  </nav>

  <?php if ($product === null): ?>
    <!-- ─── Pick a product (fallback when no product_id) ─────────── -->
    <header class="pm-hero">
      <div>
        <div class="pm-eyebrow">Products / Variants</div>
        <h1 class="pm-title">Variant mappings</h1>
        <p class="pm-lede">
          Choose a product to edit its per-variant try-on images, prompts, and model
          sex. Variants override the product-level try-on image when a shopper picks
          a specific option.
        </p>
      </div>
      <div class="pm-stats">
        <div class="pm-stat">
          <div class="pm-stat-value fs-tabular"><?= $view->e(number_format(count($products))) ?></div>
          <div class="pm-stat-label">In catalog</div>
        </div>
      </div>
    </header>

    <section class="pm-toolbar">
      <form method="get" class="pm-search">
        <span class="pm-search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        </span>
        <input type="search" name="q" value="<?= $view->e($q) ?>" placeholder="Search products" class="pm-search-input">
        <?php if ($q !== ''): ?>
          <a href="<?= $view->e($view->url('admin/variants')) ?>" class="pm-search-clear" aria-label="Clear search"><?= $view->fsIcon('x', 14, 2) ?></a>
        <?php endif; ?>
      </form>
    </section>

    <?php if (empty($products)): ?>
      <div class="pm-empty">
        <div class="pm-empty-icon"><?= $view->fsIcon('layers', 36) ?></div>
        <h3>No products <?= $q !== '' ? 'match your search' : 'yet' ?></h3>
        <p>Products need to sync from Shopify first. Then come back here to edit per-variant try-on images.</p>
      </div>
    <?php else: ?>
      <div class="pm-table-card">
        <div class="pm-tr pm-tr--head" style="grid-template-columns:minmax(0,2.3fr) minmax(0,1.1fr) 110px 120px;">
          <span class="pm-th">Product</span>
          <span class="pm-th">Collection</span>
          <span class="pm-th">Status</span>
          <span class="pm-th pm-th--right">Action</span>
        </div>
        <?php foreach ($products as $p): $on = (int)$p['is_tryon_enabled'] === 1; ?>
          <div class="pm-tr pm-tr--row" style="grid-template-columns:minmax(0,2.3fr) minmax(0,1.1fr) 110px 120px;">
            <div class="pm-cell-main">
              <span class="pm-thumb"><?= $view->fsIcon('shirt', 18) ?></span>
              <div style="min-width:0;">
                <div class="pm-prod-title"><?= $view->e($p['title']) ?></div>
                <div class="pm-prod-handle">/<?= $view->e($p['handle']) ?></div>
              </div>
            </div>
            <div>
              <?php if (!empty($p['collection_title'])): ?>
                <span class="pm-mini-pill"><?= $view->e($p['collection_title']) ?></span>
              <?php else: ?>
                <span class="pm-dim">No collection</span>
              <?php endif; ?>
            </div>
            <div>
              <span class="pm-pill <?= $on ? 'pm-pill--success' : 'pm-pill--muted' ?>">
                <span class="pm-pill-dot"></span><?= $on ? 'Enabled' : 'Off' ?>
              </span>
            </div>
            <div style="text-align:right;">
              <a class="pm-btn pm-btn--sm pm-btn--ghost" href="<?= $view->e($view->url('admin/variants?product_id=' . (int)$p['id'])) ?>">
                Edit variants
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
              </a>
            </div>
          </div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

  <?php else: ?>
    <!-- ─── Product-context header ───────────────────────────────── -->
    <?php $onProd = (int)$product['is_tryon_enabled'] === 1; ?>
    <header class="pm-hero pm-ctx-hero">
      <div class="pm-ctx-main">
        <span class="pm-thumb pm-thumb--lg"><?= $view->fsIcon('shirt', 22) ?></span>
        <div style="min-width:0;flex:1;">
          <div class="pm-eyebrow">Editing variants</div>
          <h1 class="pm-title" style="font-size:24px;"><?= $view->e($product['title']) ?></h1>
          <div class="pm-ctx-meta">
            <span class="pm-prod-handle">/<?= $view->e($product['handle']) ?></span>
            <?php if (!empty($product['collection_title'])): ?>
              <span class="pm-mini-pill"><?= $view->e($product['collection_title']) ?></span>
            <?php endif; ?>
            <span class="pm-pill <?= $onProd ? 'pm-pill--success' : 'pm-pill--muted' ?>">
              <span class="pm-pill-dot"></span><?= $onProd ? 'Try-on enabled' : 'Try-on off' ?>
            </span>
            <span class="pm-ctx-count"><?= count($mappings) ?> variant mapping<?= count($mappings) === 1 ? '' : 's' ?></span>
          </div>
        </div>
      </div>
      <div class="pm-ctx-nav">
        <?php if ($prev_next['prev']): ?>
          <a class="pm-btn pm-btn--sm pm-btn--plain" href="<?= $view->e($view->url('admin/variants?product_id=' . (int)$prev_next['prev']['id'])) ?>" title="Previous: <?= $view->e($prev_next['prev']['title']) ?>">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>
            Previous
          </a>
        <?php endif; ?>
        <a class="pm-btn pm-btn--sm pm-btn--ghost" href="<?= $view->e($view->url('admin/products')) ?>">Back to Products</a>
        <?php if ($prev_next['next']): ?>
          <a class="pm-btn pm-btn--sm pm-btn--plain" href="<?= $view->e($view->url('admin/variants?product_id=' . (int)$prev_next['next']['id'])) ?>" title="Next: <?= $view->e($prev_next['next']['title']) ?>">
            Next
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
          </a>
        <?php endif; ?>
      </div>
    </header>

    <!-- ─── Mapping cards ────────────────────────────────────────── -->
    <?php if (empty($mappings)): ?>
      <div class="pm-empty">
        <div class="pm-empty-icon"><?= $view->fsIcon('layers', 36) ?></div>
        <h3>No variant mappings yet</h3>
        <p>
          When shoppers select a specific variant, the mapping here decides which image
          and prompt the try-on engine uses. Variants are added by the storefront widget
          when a shopper first tries them on.
        </p>
      </div>
    <?php else: ?>
      <section class="pm-variants">
        <?php foreach ($mappings as $m): ?>
          <article class="pm-variant-card">
            <header class="pm-variant-head">
              <div style="min-width:0;">
                <h3 class="pm-variant-title"><?= $view->e($m['variant_title'] ?? ('Variant #' . $m['shopify_variant_id'])) ?></h3>
                <div class="pm-variant-sub">Shopify variant ID: <?= $view->e((string)$m['shopify_variant_id']) ?></div>
              </div>
              <?php if (!empty($m['tryon_image_url'])): ?>
                <a class="pm-variant-preview" href="<?= $view->e($m['tryon_image_url']) ?>" target="_blank" rel="noopener" title="Open current try-on image">
                  <img src="<?= $view->e($m['tryon_image_url']) ?>" alt="" loading="lazy" onerror="this.closest('.pm-variant-preview').classList.add('is-broken')">
                  <span class="pm-variant-preview-fallback"><?= $view->fsIcon('info', 18) ?></span>
                </a>
              <?php else: ?>
                <span class="pm-variant-preview is-empty">
                  <?= $view->fsIcon('shirt', 20) ?>
                </span>
              <?php endif; ?>
            </header>

            <form method="post" action="<?= $view->e($view->url('admin/variants/save')) ?>" class="pm-variant-form">
              <input type="hidden" name="mapping_id" value="<?= (int)$m['id'] ?>">
              <input type="hidden" name="product_id" value="<?= (int)$product_id ?>">

              <label class="pm-field pm-field--wide">
                <span class="pm-field-label">Try-on image URL</span>
                <input class="pm-input" type="url" name="tryon_image_url" value="<?= $view->e($m['tryon_image_url']) ?>" placeholder="https://cdn.example.com/garment.jpg">
                <span class="pm-field-help">The image fed to the try-on engine for this variant.</span>
              </label>

              <label class="pm-field">
                <span class="pm-field-label">Image type</span>
                <select class="pm-input pm-input--select" name="image_type">
                  <?php foreach ($imageTypes as $k => $label): ?>
                    <option value="<?= $view->e($k) ?>" <?= $m['image_type'] === $k ? 'selected' : '' ?>><?= $view->e($label) ?></option>
                  <?php endforeach; ?>
                </select>
                <span class="pm-field-help">How the garment is photographed.</span>
              </label>

              <label class="pm-field">
                <span class="pm-field-label">Avatar sex</span>
                <select class="pm-input pm-input--select" name="avatar_sex">
                  <option value="">Not set</option>
                  <option value="female" <?= ($m['avatar_sex'] ?? '') === 'female' ? 'selected' : '' ?>>Female</option>
                  <option value="male"   <?= ($m['avatar_sex'] ?? '') === 'male'   ? 'selected' : '' ?>>Male</option>
                </select>
                <span class="pm-field-help">Overrides the model the engine chooses.</span>
              </label>

              <label class="pm-field pm-field--wide">
                <span class="pm-field-label">Clothing prompt</span>
                <input class="pm-input" type="text" name="clothing_prompt" value="<?= $view->e($m['clothing_prompt'] ?? '') ?>" placeholder="e.g. nivi-drape silk saree">
                <span class="pm-field-help">Steers the saree / draped garment router. Leave empty for standard garments.</span>
              </label>

              <div class="pm-variant-foot">
                <span class="pm-dim" style="font-size:12px;">Updated <?= $view->e((string)($m['updated_at'] ?? '')) ?></span>
                <button type="submit" class="pm-btn pm-btn--primary">Save variant</button>
              </div>
            </form>
          </article>
        <?php endforeach; ?>
      </section>
    <?php endif; ?>
  <?php endif; ?>
</div>
