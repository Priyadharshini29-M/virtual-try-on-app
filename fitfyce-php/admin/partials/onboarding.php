<?php
/**
 * @var \TryFit\Admin\View $view
 * @var array<string,mixed> $merchant
 *
 * 7-step onboarding overlay. State is kept in localStorage (per-browser);
 * when the merchant finishes or skips, we POST to /admin/onboarding/save
 * so other devices know the wizard is done.
 */
?>
<!-- Hard-hide with inline style AND hidden attr so a slow stylesheet never
     flashes the wizard contents as inline block before the JS swaps the
     display back on. -->
<div id="fs-ob-root" hidden style="display:none !important;">
  <div class="fs-ob-backdrop">
    <div class="fs-ob-shell">
      <div class="fs-ob-top">
        <span class="fs-ob-brand">Welcome to Brix-TryOn</span>
        <span class="fs-ob-count">Step <span data-ob-step>1</span> of 7</span>
      </div>
      <ol class="fs-ob-steps" data-ob-track></ol>
      <div class="fs-ob" role="dialog" aria-modal="true" aria-labelledby="fs-ob-title">
        <div class="fs-ob-body" data-ob-body></div>
        <div class="fs-ob-foot">
          <button type="button" class="fs-ob-secondary" data-ob-back>Back</button>
          <div style="flex:1"></div>
          <button type="button" class="fs-ob-link" data-ob-skip>Skip setup</button>
          <button type="button" class="fs-ob-primary" data-ob-next>Continue</button>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
(function () {
  var KEY = 'fitfyce_ob_v1';
  var state;
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { state = {}; }
  if (state.completed || state.skipped) return;

  var STEPS = [
    { key: 'goals',    label: 'Goals',    title: 'What do you want try-on to do?', body: '<p>Pick what matters: more sales, fewer returns, or standing out.</p><div class="fs-ob-grid-3" data-goals></div>' },
    { key: 'store',    label: 'Store',    title: 'Tell us about your store',       body: '<label class="fs-label">Store type <select class="fs-select" data-store><option value="">Pick one</option><option>Fashion</option><option>Ethnic</option><option>Jewellery</option><option>Eyewear</option><option>Other</option></select></label>' },
    { key: 'products', label: 'Products', title: 'Which products need try-on?',    body: '<p>Enable try-on on all products or by collection. Open the Products page any time to change this.</p>' },
    { key: 'theme',    label: 'Theme',    title: 'Add try-on to your storefront',  body: '<p>In your theme editor, enable the Brix-TryOn app embed and drop the try-on button on your product page template.</p>' },
    { key: 'contact',  label: 'Alerts',   title: 'Who should we alert?',           body: '<label class="fs-label">Email<input class="fs-input" type="email" data-email></label>' },
    { key: 'credits',  label: 'Credits',  title: 'You have 25 welcome credits',    body: '<p>1 credit = 1 try-on. Top up anytime from the Credits page.</p>' },
    { key: 'done',     label: 'Launch',   title: "You're ready to launch!",        body: '<p>Everything is wired up. Jump into any module from the nav.</p>' },
  ];

  var root  = document.getElementById('fs-ob-root');
  if (!root) return;
  var track = root.querySelector('[data-ob-track]');
  var body  = root.querySelector('[data-ob-body]');
  var stepEl = root.querySelector('[data-ob-step]');
  var btnBack = root.querySelector('[data-ob-back]');
  var btnNext = root.querySelector('[data-ob-next]');
  var btnSkip = root.querySelector('[data-ob-skip]');

  var step = Number(state.step) || 0;

  function save(extra) {
    state = Object.assign({}, state, extra || {}, { step: step });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
    fetch(<?= json_encode($view->url('admin/onboarding/save')) ?>, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    }).catch(function () {});
  }

  function render() {
    stepEl.textContent = String(step + 1);
    track.innerHTML = STEPS.map(function (s, i) {
      var cls = i < step ? 'is-done' : (i === step ? 'is-current' : 'is-locked');
      return '<li class="fs-ob-step ' + cls + '"><span class="fs-ob-step-dot">' + (i + 1) + '</span><span class="fs-ob-step-label">' + s.label + '</span></li>';
    }).join('');
    var cur = STEPS[step];
    body.innerHTML = '<div class="fs-ob-title"><h2 id="fs-ob-title">' + cur.title + '</h2></div>' + cur.body;
    btnBack.disabled = step === 0;
    btnNext.textContent = step === STEPS.length - 1 ? 'Finish' : 'Continue';
    root.hidden = false;
    root.style.display = 'block';
  }

  function hide() { root.hidden = true; root.style.display = 'none'; }
  btnNext.addEventListener('click', function () {
    if (step === STEPS.length - 1) { save({ completed: true }); hide(); return; }
    step += 1; save(); render();
  });
  btnBack.addEventListener('click', function () {
    if (step > 0) { step -= 1; save(); render(); }
  });
  btnSkip.addEventListener('click', function () { save({ skipped: true }); hide(); });

  render();
})();
</script>
