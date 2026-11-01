<?php
/**
 * @var \TryFit\Admin\View $view
 * @var array<string,mixed> $settings
 * @var string|null $flash
 */

use TryFit\AppConfig;

$s = $settings;
$checked = static fn($v) => !empty($v) ? 'checked' : '';
$sel     = static fn($v, $target) => (string)$v === (string)$target ? 'selected' : '';

// ─── Setup checklist (derived live from current settings) ──────────
$defaults = AppConfig::WIDGET_DEFAULTS;
$checklist = [
    ['key' => 'button_text',       'label' => 'Custom button text',  'done' => trim((string)$s['button_text']) !== trim((string)$defaults['button_text'])],
    ['key' => 'button_color',      'label' => 'Brand button color',  'done' => strcasecmp((string)$s['button_color'], (string)$defaults['button_color']) !== 0],
    ['key' => 'widget_subtitle',   'label' => 'Supporting subtitle', 'done' => trim((string)$s['widget_subtitle']) !== ''],
    ['key' => 'button_icon',       'label' => 'Button icon',         'done' => (string)$s['button_icon'] !== 'none'],
    ['key' => 'share_whatsapp',    'label' => 'WhatsApp share',      'done' => !empty($s['share_whatsapp_enabled'])],
    ['key' => 'save_image',        'label' => 'Save image',          'done' => !empty($s['save_image_enabled'])],
    ['key' => 'privacy_notice',    'label' => 'Privacy notice',      'done' => !empty($s['privacy_notice_shown'])],
    ['key' => 'before_after',      'label' => 'Before/after slider', 'done' => !empty($s['before_after_enabled'])],
];
$doneCount = 0;
foreach ($checklist as $c) if ($c['done']) $doneCount++;
$total     = count($checklist);
$leftTasks = $total - $doneCount;
?>
<div class="ws-page">

  <?php if ($flash === '1'): ?>
    <div class="ws-flash">
      <span class="ws-flash-dot"><?= $view->fsIcon('check', 14, 3) ?></span>
      Settings saved.
    </div>
  <?php endif; ?>

  <header class="ws-header">
    <div>
      <h1 class="ws-title">Try-on button and modal</h1>
      <p class="ws-sub">Changes appear on your storefront after you save.</p>
    </div>
    <div class="ws-header-right">
      <span class="ws-preview-switch" role="tablist" aria-label="Preview device">
        <button type="button" data-preview-device="desktop" class="is-active" aria-pressed="true" title="Desktop preview">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          Desktop
        </button>
        <button type="button" data-preview-device="mobile" aria-pressed="false" title="Mobile preview">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>
          Mobile
        </button>
      </span>
      <button type="button" class="ws-btn ws-btn--ghost" onclick="document.getElementById('ws-form').reset()">Discard</button>
      <button type="submit" form="ws-form" class="ws-btn ws-btn--primary">Save</button>
    </div>
  </header>

  <div class="ws-layout">

    <!-- ─── LEFT: Collapsible section panel ──────────────────────── -->
    <form id="ws-form" method="post" action="<?= $view->e($view->url('admin/settings')) ?>" class="ws-panel">

      <!-- Button design (open by default) -->
      <details class="ws-section" open>
        <summary class="ws-section-head">
          <span class="ws-section-icon"><?= $view->fsIcon('sliders', 16) ?></span>
          <span class="ws-section-title">Button design</span>
          <svg class="ws-section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="ws-section-body">

          <h4 class="ws-group-title">Button text</h4>
          <p class="ws-group-sub">The label shoppers see on product pages.</p>
          <div class="ws-field">
            <label class="ws-field-head">
              <span>Button title</span>
              <span class="ws-char-count"><span data-count="button_text">0</span> / 60</span>
            </label>
            <input class="ws-input" name="button_text" value="<?= $view->e($s['button_text']) ?>" maxlength="60" data-live="button_text" data-count-target="button_text">
            <span class="ws-help">Short and action-led works best.</span>
          </div>
          <div class="ws-field">
            <label class="ws-field-head">
              <span>Subtitle</span>
              <span class="ws-char-count"><span data-count="widget_subtitle">0</span> / 200</span>
            </label>
            <input class="ws-input" name="widget_subtitle" value="<?= $view->e($s['widget_subtitle']) ?>" maxlength="200" data-live="widget_subtitle" data-count-target="widget_subtitle">
          </div>

          <h4 class="ws-group-title">Colors and shape</h4>
          <div class="ws-grid-2">
            <div class="ws-field">
              <label class="ws-field-head"><span>Button color</span></label>
              <div class="ws-color-input">
                <input type="color" name="button_color" value="<?= $view->e($s['button_color']) ?>" data-live="button_color" data-color-hex="button_color">
                <input type="text" class="ws-input" value="<?= $view->e($s['button_color']) ?>" data-hex-mirror="button_color" readonly>
              </div>
            </div>
            <div class="ws-field">
              <label class="ws-field-head"><span>Text color</span></label>
              <div class="ws-color-input">
                <input type="color" name="button_text_color" value="<?= $view->e($s['button_text_color']) ?>" data-live="button_text_color" data-color-hex="button_text_color">
                <input type="text" class="ws-input" value="<?= $view->e($s['button_text_color']) ?>" data-hex-mirror="button_text_color" readonly>
              </div>
            </div>
          </div>

          <div class="ws-field">
            <label class="ws-field-head"><span>Corner radius</span></label>
            <div class="ws-input-with-unit">
              <input type="number" min="0" max="40" class="ws-input" name="button_border_radius" value="<?= (int)$s['button_border_radius'] ?>" data-live="button_border_radius">
              <span>px</span>
            </div>
            <span class="ws-help">Square &middot; Pill</span>
          </div>

          <div class="ws-field">
            <label class="ws-field-head"><span>Hover background</span></label>
            <div class="ws-color-input">
              <input type="color" name="hover_bg_color" value="<?= $view->e($s['hover_bg_color']) ?>" data-color-hex="hover_bg_color">
              <input type="text" class="ws-input" value="<?= $view->e($s['hover_bg_color']) ?>" data-hex-mirror="hover_bg_color" readonly>
            </div>
          </div>

          <h4 class="ws-group-title">Size</h4>
          <p class="ws-group-sub">Set sizes separately for desktop and mobile.</p>
          <div class="ws-grid-2">
            <div class="ws-field">
              <label class="ws-field-head"><span>Widget width</span></label>
              <div class="ws-input-with-unit">
                <input type="number" min="0" class="ws-input" value="370">
                <span>px</span>
              </div>
            </div>
            <div class="ws-field">
              <label class="ws-field-head"><span>Widget height</span></label>
              <div class="ws-input-with-unit">
                <input type="text" class="ws-input" value="Auto" readonly>
                <span>auto</span>
              </div>
            </div>
          </div>

          <div class="ws-grid-2">
            <div class="ws-field">
              <label class="ws-field-head"><span>Title size (desktop)</span></label>
              <div class="ws-input-with-unit">
                <input type="number" min="10" max="32" class="ws-input" name="title_font_size" value="<?= (int)$s['title_font_size'] ?>" data-live="title_font_size">
                <span>px</span>
              </div>
            </div>
            <div class="ws-field">
              <label class="ws-field-head"><span>Subtitle size</span></label>
              <div class="ws-input-with-unit">
                <input type="number" min="8" max="24" class="ws-input" name="subtitle_font_size" value="<?= (int)$s['subtitle_font_size'] ?>" data-live="subtitle_font_size">
                <span>px</span>
              </div>
            </div>
          </div>

          <div class="ws-field">
            <label class="ws-field-head"><span>Title font weight</span></label>
            <select class="ws-input ws-select" name="title_font_weight">
              <?php foreach (['400','500','600','700','800'] as $w): ?>
                <option value="<?= $w ?>" <?= $sel($s['title_font_weight'], $w) ?>><?= $w ?></option>
              <?php endforeach; ?>
            </select>
          </div>

          <div class="ws-field">
            <label class="ws-field-head"><span>Position</span></label>
            <select class="ws-input ws-select" name="button_position">
              <?php foreach (AppConfig::BUTTON_POSITIONS as $p): ?>
                <option value="<?= $view->e($p) ?>" <?= $sel($s['button_position'], $p) ?>><?= $view->e(str_replace('_', ' ', ucfirst($p))) ?></option>
              <?php endforeach; ?>
            </select>
          </div>
        </div>
      </details>

      <!-- Text & style -->
      <details class="ws-section">
        <summary class="ws-section-head">
          <span class="ws-section-icon"><?= $view->fsIcon('sparkle', 16) ?></span>
          <span class="ws-section-title">Text &amp; style</span>
          <svg class="ws-section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="ws-section-body">
          <div class="ws-field">
            <label class="ws-field-head"><span>Language</span></label>
            <select class="ws-input ws-select" name="widget_language">
              <?php foreach (['en' => 'English','ta' => 'Tamil','hi' => 'Hindi'] as $k => $v): ?>
                <option value="<?= $view->e($k) ?>" <?= $sel($s['widget_language'], $k) ?>><?= $view->e($v) ?></option>
              <?php endforeach; ?>
            </select>
          </div>
        </div>
      </details>

      <!-- Modal content -->
      <details class="ws-section">
        <summary class="ws-section-head">
          <span class="ws-section-icon"><?= $view->fsIcon('info', 16) ?></span>
          <span class="ws-section-title">Modal content</span>
          <svg class="ws-section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="ws-section-body">
          <label class="ws-check">
            <input type="checkbox" name="before_after_enabled" value="1" <?= $checked($s['before_after_enabled']) ?>>
            <span>Show before/after comparison slider in the result</span>
          </label>
          <label class="ws-check">
            <input type="checkbox" name="privacy_notice_shown" value="1" <?= $checked($s['privacy_notice_shown']) ?>>
            <span>Show the privacy notice before each try-on</span>
          </label>
        </div>
      </details>

      <!-- Media -->
      <details class="ws-section">
        <summary class="ws-section-head">
          <span class="ws-section-icon"><?= $view->fsIcon('video', 16) ?></span>
          <span class="ws-section-title">Media</span>
          <svg class="ws-section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="ws-section-body">
          <div class="ws-field">
            <label class="ws-field-head"><span>Promo video URL</span></label>
            <input class="ws-input" type="url" name="promo_video_url" value="<?= $view->e($s['promo_video_url']) ?>" placeholder="https://...">
          </div>
          <label class="ws-check">
            <input type="checkbox" name="example_before_after_enabled" value="1" <?= $checked($s['example_before_after_enabled']) ?>>
            <span>Show a static before/after example on the widget</span>
          </label>
          <div class="ws-grid-2">
            <div class="ws-field">
              <label class="ws-field-head"><span>Before image URL</span></label>
              <input class="ws-input" type="url" name="example_before_image" value="<?= $view->e($s['example_before_image']) ?>">
            </div>
            <div class="ws-field">
              <label class="ws-field-head"><span>After image URL</span></label>
              <input class="ws-input" type="url" name="example_after_image" value="<?= $view->e($s['example_after_image']) ?>">
            </div>
          </div>
        </div>
      </details>

      <!-- Collection icon -->
      <details class="ws-section">
        <summary class="ws-section-head">
          <span class="ws-section-icon"><?= $view->fsIcon('box', 16) ?></span>
          <span class="ws-section-title">Collection icon</span>
          <svg class="ws-section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="ws-section-body">
          <label class="ws-check">
            <input type="checkbox" name="show_on_collection" value="1" <?= $checked($s['show_on_collection']) ?>>
            <span>Show the try-on icon on collection pages</span>
          </label>
          <div class="ws-grid-2">
            <div class="ws-field">
              <label class="ws-field-head"><span>Position</span></label>
              <select class="ws-input ws-select" name="collection_position">
                <?php foreach (AppConfig::COLLECTION_POSITIONS as $p): ?>
                  <option value="<?= $view->e($p) ?>" <?= $sel($s['collection_position'], $p) ?>><?= str_replace('_', ' ', $p) ?></option>
                <?php endforeach; ?>
              </select>
            </div>
            <div class="ws-field">
              <label class="ws-field-head"><span>Icon</span></label>
              <select class="ws-input ws-select" name="button_icon" data-live="button_icon">
                <?php foreach (AppConfig::BUTTON_ICONS as $i): ?>
                  <option value="<?= $view->e($i) ?>" <?= $sel($s['button_icon'], $i) ?>><?= $view->e(ucfirst($i)) ?></option>
                <?php endforeach; ?>
              </select>
            </div>
          </div>
        </div>
      </details>

      <!-- Features -->
      <details class="ws-section">
        <summary class="ws-section-head">
          <span class="ws-section-icon"><?= $view->fsIcon('crown', 16) ?></span>
          <span class="ws-section-title">Features</span>
          <svg class="ws-section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="ws-section-body">
          <label class="ws-check">
            <input type="checkbox" name="show_watermark" value="1" <?= $checked($s['show_watermark']) ?>>
            <span>Show Brix-TryOn watermark</span>
          </label>
          <label class="ws-check">
            <input type="checkbox" name="share_whatsapp_enabled" value="1" <?= $checked($s['share_whatsapp_enabled']) ?>>
            <span>Allow shoppers to share results on WhatsApp</span>
          </label>
          <label class="ws-check">
            <input type="checkbox" name="save_image_enabled" value="1" <?= $checked($s['save_image_enabled']) ?>>
            <span>Allow shoppers to save the result image</span>
          </label>
          <label class="ws-check">
            <input type="checkbox" name="tryon_limit_enabled" value="1" <?= $checked($s['tryon_limit_enabled']) ?>>
            <span>Limit how many try-ons each shopper can run</span>
          </label>
          <div class="ws-grid-2">
            <div class="ws-field">
              <label class="ws-field-head"><span>Count</span></label>
              <input class="ws-input" type="number" min="1" max="100" name="tryon_limit_count" value="<?= (int)$s['tryon_limit_count'] ?>">
            </div>
            <div class="ws-field">
              <label class="ws-field-head"><span>Reset</span></label>
              <select class="ws-input ws-select" name="tryon_limit_reset">
                <?php foreach (['never','day','week','month'] as $r): ?>
                  <option value="<?= $r ?>" <?= $sel($s['tryon_limit_reset'], $r) ?>><?= ucfirst($r) ?></option>
                <?php endforeach; ?>
              </select>
            </div>
          </div>
        </div>
      </details>

    </form>

    <!-- ─── RIGHT: Live preview + checklist ─────────────────────── -->
    <aside class="ws-preview-col">
      <div class="ws-preview-head">
        <span>LIVE PREVIEW</span>
      </div>

      <div class="ws-preview-card" data-preview-root>
        <!-- Browser chrome -->
        <div class="ws-browser">
          <span class="ws-browser-dots"><i></i><i></i><i></i></span>
          <span class="ws-browser-url">yourstore.com/products/silk-banarasi-saree</span>
        </div>

        <!-- Mock product page -->
        <div class="ws-mock" data-preview-stage>
          <div class="ws-mock-image">
            <span class="ws-mock-badge" style="background:<?= $view->e($s['button_color']) ?>;color:<?= $view->e($s['button_text_color']) ?>;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
              Try On
            </span>
            <div class="ws-mock-figure">
              <svg width="140" height="200" viewBox="0 0 140 200" fill="none">
                <circle cx="70" cy="54" r="26" fill="#F3D5D5"/>
                <path d="M34 180 Q70 100 106 180 Z" fill="#C2185B"/>
              </svg>
            </div>
          </div>
          <div class="ws-mock-info">
            <div class="ws-mock-store">YOUR STORE</div>
            <h3 class="ws-mock-title">Silk Banarasi Saree</h3>
            <div class="ws-mock-price">$749.95</div>
            <button type="button" class="ws-mock-cart">Add to cart</button>
            <button type="button" class="ws-mock-tryon"
                    style="background:<?= $view->e($s['button_color']) ?>;color:<?= $view->e($s['button_text_color']) ?>;border-radius:<?= (int)$s['button_border_radius'] ?>px;font-weight:<?= $view->e($s['title_font_weight']) ?>;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-live-icon><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
              <span>
                <strong style="font-size:<?= (int)$s['title_font_size'] ?>px;" data-live-text="button_text"><?= $view->e($s['button_text']) ?></strong>
                <small style="font-size:<?= (int)$s['subtitle_font_size'] ?>px;" data-live-text="widget_subtitle"><?= $view->e($s['widget_subtitle']) ?></small>
              </span>
            </button>
            <div class="ws-mock-foot">Free shipping over $150 &middot; Easy returns</div>
          </div>
        </div>
      </div>

      <!-- Setup checklist card -->
      <div class="ws-checklist">
        <div class="ws-checklist-head">
          <span class="ws-checklist-eyebrow">SETUP CHECKLIST</span>
          <div class="ws-checklist-count"><?= $doneCount ?> of <?= $total ?> done</div>
          <div class="ws-checklist-sub"><?= $leftTasks === 0 ? 'All set.' : $leftTasks . ' quick tweak' . ($leftTasks === 1 ? '' : 's') . ' left' ?></div>
        </div>
        <ul class="ws-checklist-list">
          <?php foreach ($checklist as $c): ?>
            <li class="ws-checklist-item <?= $c['done'] ? 'is-done' : '' ?>">
              <span class="ws-checklist-mark">
                <?php if ($c['done']): ?>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                <?php endif; ?>
              </span>
              <span class="ws-checklist-label"><?= $view->e($c['label']) ?></span>
              <?php if (!$c['done']): ?>
                <span class="ws-checklist-fix">Fix</span>
              <?php endif; ?>
            </li>
          <?php endforeach; ?>
        </ul>
      </div>
    </aside>

  </div>
</div>

<script>
(function () {
  var form   = document.getElementById('ws-form');
  var stage  = document.querySelector('[data-preview-stage]');
  if (!form) return;

  // Character counters
  form.querySelectorAll('[data-count-target]').forEach(function (input) {
    var key   = input.getAttribute('data-count-target');
    var label = document.querySelector('[data-count="' + key + '"]');
    function paint() { if (label) label.textContent = String(input.value.length); }
    input.addEventListener('input', paint); paint();
  });

  // Hex mirror for color inputs
  form.querySelectorAll('[data-color-hex]').forEach(function (input) {
    var key = input.getAttribute('data-color-hex');
    var mir = form.querySelector('[data-hex-mirror="' + key + '"]');
    input.addEventListener('input', function () {
      if (mir) mir.value = input.value.toUpperCase();
    });
  });

  // Live preview — repaint the mock button when any live-tagged input changes
  var btn   = stage.querySelector('.ws-mock-tryon');
  var badge = stage.querySelector('.ws-mock-badge');
  var textEl = stage.querySelector('[data-live-text="button_text"]');
  var subEl  = stage.querySelector('[data-live-text="widget_subtitle"]');
  var titleStrong = stage.querySelector('.ws-mock-tryon strong');
  var titleSmall  = stage.querySelector('.ws-mock-tryon small');

  var ICONS = {
    none:         '',
    eye:          '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    sparkles:     '<path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8z"/>',
    camera:       '<path d="M3 7h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/>',
    'shopping-bag': '<path d="M6 7h12l1 14H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>'
  };

  function val(name) { var el = form.querySelector('[name="' + name + '"]'); return el ? el.value : ''; }
  function paint() {
    var color     = val('button_color')      || '#111827';
    var textColor = val('button_text_color') || '#FFFFFF';
    var radius    = parseInt(val('button_border_radius'), 10) || 0;
    btn.style.background   = color;
    btn.style.color        = textColor;
    btn.style.borderRadius = radius + 'px';
    btn.style.fontWeight   = val('title_font_weight') || '600';
    badge.style.background = color;
    badge.style.color      = textColor;
    textEl.textContent  = val('button_text')     || 'Try On This Look';
    subEl.textContent   = val('widget_subtitle') || '';
    titleStrong.style.fontSize = (parseInt(val('title_font_size'), 10)   || 16) + 'px';
    titleSmall.style.fontSize  = (parseInt(val('subtitle_font_size'), 10) || 12) + 'px';
    var ic = form.querySelector('[name="button_icon"]');
    var svg = btn.querySelector('[data-live-icon]');
    if (ic && svg) svg.innerHTML = ICONS[ic.value] || '';
  }
  form.addEventListener('input',  paint);
  form.addEventListener('change', paint);
  paint();

  // Desktop / mobile preview toggle
  document.querySelectorAll('[data-preview-device]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-preview-device]').forEach(function (b) {
        b.classList.remove('is-active'); b.setAttribute('aria-pressed','false');
      });
      btn.classList.add('is-active'); btn.setAttribute('aria-pressed','true');
      var root = document.querySelector('[data-preview-root]');
      if (!root) return;
      if (btn.getAttribute('data-preview-device') === 'mobile') {
        root.classList.add('is-mobile');
      } else {
        root.classList.remove('is-mobile');
      }
    });
  });
})();
</script>
