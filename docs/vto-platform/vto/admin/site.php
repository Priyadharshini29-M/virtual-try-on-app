<?php
require __DIR__ . '/_init.php';
require __DIR__ . '/../backend/lib/FitfyceSettings.php';
require_login();
require_post_edit();

$id = (int)($_GET['id'] ?? $_POST['id'] ?? 0);
$site = DB::one('SELECT * FROM sites WHERE id = ?', [$id]);
if (!$site) { http_response_code(404); exit('Site not found'); }

$TARGETS = [
    'product'    => ['add_to_cart' => 'Add-to-cart button (Try-On button goes after it)', 'product_image' => 'Main product image (icon overlay)', 'product_title' => 'Product title (fallback anchor)'],
    'collection' => ['card' => 'Product card (repeated)', 'card_image' => 'Image inside card – relative to card', 'card_link' => 'Link inside card – relative to card'],
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    switch ($action) {
        case 'save':
            $order = array_values(array_unique(array_intersect((array)($_POST['plan_order'] ?? []), ['scrapy', 'block', 'inspect'])));
            foreach (['scrapy', 'block', 'inspect'] as $p) if (!in_array($p, $order, true)) $order[] = $p;
            foreach (['product_url_pattern', 'collection_url_pattern'] as $f) {
                if (($_POST[$f] ?? '') !== '' && @preg_match('#' . str_replace('#', '\#', $_POST[$f]) . '#', '') === false) {
                    flash("Invalid regex in $f", 'err'); redirect("site.php?id=$id");
                }
            }
            $shop = strtolower(trim(preg_replace('#^https?://#i', '', (string)($_POST['fitfyce_shop'] ?? '')), '/ '));
            if ($shop !== '' && !preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $shop)) {
                flash('FitFyce shop must be a domain like store.myshopify.com', 'err'); redirect("site.php?id=$id");
            }
            DB::update('sites', [
                'name'            => trim($_POST['name']) ?: $site['name'],
                'allowed_origins' => trim((string)$_POST['allowed_origins']),
                'start_url'       => trim((string)$_POST['start_url']),
                'category'        => $_POST['category'],
                'status'          => in_array($_POST['status'], ['active', 'paused', 'pending'], true) ? $_POST['status'] : 'pending',
                'plan_order'      => implode(',', $order),
                'fitfyce_shop'    => $shop ?: null,
                'product_url_pattern'    => trim((string)$_POST['product_url_pattern']) ?: null,
                'collection_url_pattern' => trim((string)$_POST['collection_url_pattern']) ?: null,
                'daily_tryon_limit' => max(0, (int)$_POST['daily_tryon_limit']),
            ], 'id = ?', [$id]);
            flash('Rules saved');
            break;

        case 'regen_key':
            DB::update('sites', ['api_key' => new_api_key()], 'id = ?', [$id]);
            flash('New API key generated – the merchant must update the embed code!', 'warn');
            break;

        case 'scan':
            if (DB::val("SELECT id FROM scans WHERE site_id = ? AND status IN ('queued','running')", [$id])) {
                flash('A scan is already queued/running', 'warn');
            } else {
                DB::insert('scans', ['site_id' => $id, 'start_url' => $_POST['scan_url'] ?: ($site['start_url'] ?: 'https://' . $site['domain'] . '/'), 'requested_by' => admin()['id']]);
                flash('Scan queued. The worker will pick it up within a few seconds.');
            }
            break;

        case 'add_selector':
            $pt = $_POST['page_type'] ?? '';
            $tg = $_POST['target'] ?? '';
            $sel = trim((string)($_POST['selector'] ?? ''));
            if (!isset($TARGETS[$pt][$tg]) || !valid_selector($sel)) { flash('Invalid selector', 'err'); break; }
            DB::run(
                "INSERT INTO selectors (site_id, page_type, target, selector, source, confidence, status)
                 VALUES (?, ?, ?, ?, 'manual', 0.99, 'active')
                 ON DUPLICATE KEY UPDATE source = 'manual', status = 'active', confidence = 0.99",
                [$id, $pt, $tg, $sel]
            );
            flash('Manual selector added – it now has top priority in Plan A');
            break;

        case 'selector_status':
            $st = $_POST['status'] ?? '';
            if ($st === 'delete') {
                DB::run('DELETE FROM selectors WHERE id = ? AND site_id = ?', [(int)$_POST['sid'], $id]);
            } elseif (in_array($st, ['active', 'pending', 'disabled'], true)) {
                DB::run('UPDATE selectors SET status = ?, misses = IF(? = "active", 0, misses) WHERE id = ? AND site_id = ?', [$st, $st, (int)$_POST['sid'], $id]);
            }
            flash('Selector updated');
            break;

        case 'delete_site':
            if (admin()['role'] !== 'super') { flash('Only super admins can delete sites', 'err'); break; }
            DB::run('DELETE FROM sites WHERE id = ?', [$id]);
            flash('Site deleted');
            redirect('sites.php');
    }
    redirect("site.php?id=$id");
}

$selectors = DB::all('SELECT * FROM selectors WHERE site_id = ? ORDER BY page_type, target, FIELD(status,"active","pending","disabled"), (source="manual") DESC, confidence DESC', [$id]);
$scans = DB::all('SELECT * FROM scans WHERE site_id = ? ORDER BY id DESC LIMIT 5', [$id]);
$planStats = DB::all("SELECT plan, page_type, COUNT(*) n FROM events WHERE site_id = ? AND type IN ('inject_ok','inject_fail') AND created_at >= NOW() - INTERVAL 30 DAY GROUP BY plan, page_type", [$id]);
$events = DB::all('SELECT * FROM events WHERE site_id = ? ORDER BY id DESC LIMIT 15', [$id]);

$base = rtrim(cfg('base_url'), '/');
$embed = '<script async src="' . $base . '/widget/vto.js" data-vto-key="' . $site['api_key'] . '" data-api="' . $base . '/backend/api"></script>';
$bookmarklet = "javascript:(function(){var s=document.createElement('script');s.src='" . $base . "/widget/vto.js?'+Date.now();s.dataset.vtoKey='" . $site['api_key'] . "';s.dataset.api='" . $base . "/backend/api';s.dataset.debug='1';document.head.appendChild(s);})();";
$order = explode(',', $site['plan_order']);
$fitfyce = $site['fitfyce_shop'] ? FitfyceSettings::fetch($site['fitfyce_shop']) : null;
$ui = $fitfyce ? FitfyceSettings::toUi($fitfyce) : null;

layout_start($site['name'], 'sites.php');
?>
<p class="muted"><?= e($site['domain']) ?> · <?= badge($site['status']) ?> · created <?= e($site['created_at']) ?></p>

<div class="card">
  <h3>1 · Embed code</h3>
  <p class="muted">The merchant pastes this once in the &lt;head&gt; of every page (theme file, GTM “Custom HTML” tag, or their CMS script area). Works on any platform.</p>
  <textarea readonly rows="2" class="code" onclick="this.select()"><?= e($embed) ?></textarea>
  <p class="muted" style="margin-top:10px">Preview before the merchant installs it: drag this to your bookmarks bar, open the store in your browser and click it (debug logs appear in the console).
     <a class="btn sm ghost" href="<?= e($bookmarklet) ?>">⭑ VTO preview: <?= e($site['name']) ?></a></p>
  <form method="post" style="display:inline" onsubmit="return confirm('Generate a new key? The current embed code will stop working.')">
    <?= csrf_field() ?><input type="hidden" name="id" value="<?= $id ?>"><input type="hidden" name="action" value="regen_key">
    <small class="muted">API key: <code><?= e($site['api_key']) ?></code></small> <button class="btn sm ghost">Regenerate key</button>
  </form>
</div>

<div class="grid2">
<div class="card">
  <h3>2 · Rules</h3>
  <p class="muted">Where and how the widget runs. Button design is managed in the FitFyce app.</p>
  <form method="post" class="form-grid one">
    <?= csrf_field() ?><input type="hidden" name="id" value="<?= $id ?>"><input type="hidden" name="action" value="save">
    <label>Store name<input name="name" value="<?= e($site['name']) ?>"></label>
    <label>Status<select name="status"><?php foreach (['active','paused','pending'] as $s): ?><option <?= $site['status']===$s?'selected':'' ?>><?= $s ?></option><?php endforeach; ?></select></label>
    <label>Category<select name="category"><?php foreach (['apparel','eyewear','beauty','jewellery','footwear','other'] as $c): ?><option <?= $site['category']===$c?'selected':'' ?>><?= $c ?></option><?php endforeach; ?></select></label>
    <label>Extra allowed origins <small>(one per line, e.g. m.nykaa.com)</small><textarea name="allowed_origins" rows="2"><?= e($site['allowed_origins']) ?></textarea></label>
    <label>Scan start URL<input name="start_url" value="<?= e($site['start_url']) ?>"></label>

    <fieldset><legend>Fallback loop order</legend>
      <?php for ($i = 0; $i < 3; $i++): ?>
        <select name="plan_order[]"><?php foreach (['scrapy' => 'A · Scrapy selectors', 'block' => 'B · Block detection', 'inspect' => 'C · Auto inspect'] as $k => $v): ?>
          <option value="<?= $k ?>" <?= ($order[$i] ?? '') === $k ? 'selected' : '' ?>><?= ($i + 1) . '. ' . $v ?></option><?php endforeach; ?></select>
      <?php endfor; ?>
    </fieldset>

    <label>FitFyce shop <small>(button &amp; icon design comes from this shop's Widget Settings in the FitFyce app)</small><input name="fitfyce_shop" list="fitfyce-stores" value="<?= e($site['fitfyce_shop']) ?>" placeholder="store.myshopify.com"></label>
    <datalist id="fitfyce-stores"><?php foreach (DB::all('SELECT shop_domain FROM stores WHERE is_active = 1 ORDER BY shop_domain') as $st): ?><option value="<?= e($st['shop_domain']) ?>"><?php endforeach; ?></datalist>
    <?php if ($site['fitfyce_shop'] && ($linked = DB::one('SELECT id, wallet_credits FROM stores WHERE shop_domain = ?', [$site['fitfyce_shop']]))): ?>
      <div class="muted" style="font-size:13px">Try-ons on this site are charged to <a href="store.php?id=<?= (int)$linked['id'] ?>"><?= e($site['fitfyce_shop']) ?></a> (wallet: <?= (int)$linked['wallet_credits'] ?> credits).</div>
    <?php endif; ?>
    <div class="muted" style="font-size:13px">
      <?php if ($ui): ?>
        Synced from FitFyce:
        <span style="display:inline-flex;flex-direction:column;vertical-align:middle;margin:4px 6px;padding:8px 14px;border-radius:<?= (int)$ui['radius'] ?>px;background:<?= e($ui['color']) ?>;color:<?= e($ui['textColor']) ?>">
          <b><?= e($ui['text']) ?></b><?php if ($ui['subtitle'] !== ''): ?><small><?= e($ui['subtitle']) ?></small><?php endif; ?>
        </span>
        · collection icons <?= $ui['cardIcon'] ? 'on' : 'off' ?>. To change it, edit Widget Settings in the FitFyce app.
      <?php elseif ($site['fitfyce_shop']): ?>
        <span style="color:#b42318">Could not load Widget Settings for this shop from FitFyce (unknown shop or FitFyce unreachable). The widget uses the default black button until it loads.</span>
      <?php else: ?>
        No FitFyce shop linked: the widget uses the default black “Virtual Try-On” button.
      <?php endif; ?>
    </div>
    <label>Product URL regex <small>(optional, e.g. <code>/p/|/product/</code>)</small><input name="product_url_pattern" value="<?= e($site['product_url_pattern']) ?>"></label>
    <label>Collection URL regex <small>(optional)</small><input name="collection_url_pattern" value="<?= e($site['collection_url_pattern']) ?>"></label>
    <label>Daily try-on limit<input type="number" name="daily_tryon_limit" value="<?= (int)$site['daily_tryon_limit'] ?>"></label>
    <?php if (can_edit()): ?><button class="btn">Save rules</button><?php endif; ?>
  </form>
</div>

<div>
  <div class="card">
    <h3>3 · Plan A — Scrapy scan</h3>
    <form method="post" class="inline">
      <?= csrf_field() ?><input type="hidden" name="id" value="<?= $id ?>"><input type="hidden" name="action" value="scan">
      <input name="scan_url" placeholder="<?= e($site['start_url'] ?: 'https://' . $site['domain'] . '/') ?>">
      <button class="btn">Run scan</button>
    </form>
    <table><tr><th>#</th><th>Status</th><th>Pages</th><th>Selectors</th><th>When</th></tr>
    <?php foreach ($scans as $s): ?><tr><td><a href="scans.php?id=<?= $s['id'] ?>">#<?= $s['id'] ?></a></td><td><?= badge($s['status']) ?></td><td><?= (int)$s['pages_crawled'] ?></td><td><?= (int)$s['selectors_found'] ?></td><td><small><?= e($s['created_at']) ?></small></td></tr><?php endforeach; ?>
    <?php if (!$scans): ?><tr><td colspan="5" class="muted">No scans yet</td></tr><?php endif; ?></table>
  </div>

  <div class="card">
    <h3>Plan performance (30 days)</h3>
    <table><tr><th>Plan</th><th>Zone</th><th>Page views</th></tr>
    <?php foreach ($planStats as $p): ?><tr><td><?= badge((string)$p['plan']) ?></td><td><?= e($p['page_type']) ?></td><td><?= (int)$p['n'] ?></td></tr><?php endforeach; ?>
    <?php if (!$planStats): ?><tr><td colspan="3" class="muted">Waiting for the widget to report.</td></tr><?php endif; ?></table>
  </div>
</div>
</div>

<div class="card">
  <h3>4 · Selectors (used by Plan A, learned from Plans B &amp; C)</h3>
  <p class="muted">Manual selectors always win. Browser-learned selectors start as <b>pending</b> and auto-activate after 3 confirmations. Selectors that keep missing auto-disable.</p>
  <?php if (can_edit()): ?>
  <form method="post" class="inline">
    <?= csrf_field() ?><input type="hidden" name="id" value="<?= $id ?>"><input type="hidden" name="action" value="add_selector">
    <select name="page_type" id="pt" onchange="syncTargets()"><option value="product">product</option><option value="collection">collection</option></select>
    <select name="target" id="tg"></select>
    <input name="selector" placeholder="CSS selector, e.g. button.pdp-add-to-bag" required style="flex:2">
    <button class="btn">Add manual</button>
  </form>
  <?php endif; ?>
  <table>
  <tr><th>Page</th><th>Target</th><th>Selector</th><th>Source</th><th>Conf.</th><th>Hits / misses</th><th>Status</th><th></th></tr>
  <?php foreach ($selectors as $s): ?>
  <tr>
    <td><?= e($s['page_type']) ?></td><td><?= e($s['target']) ?></td>
    <td><code class="sel" title="<?= e($s['sample_url']) ?>"><?= e($s['selector']) ?></code></td>
    <td><?= badge($s['source']) ?></td><td><?= number_format((float)$s['confidence'], 2) ?></td>
    <td><?= (int)$s['hits'] ?> / <?= (int)$s['misses'] ?></td><td><?= badge($s['status']) ?></td>
    <td class="nowrap"><?php if (can_edit()): foreach (['active' => '✓', 'disabled' => '⏸', 'delete' => '🗑'] as $st => $icon): if ($st === $s['status']) continue; ?>
      <form method="post" style="display:inline" <?= $st === 'delete' ? 'onsubmit="return confirm(\'Delete selector?\')"' : '' ?>>
        <?= csrf_field() ?><input type="hidden" name="id" value="<?= $id ?>"><input type="hidden" name="action" value="selector_status">
        <input type="hidden" name="sid" value="<?= $s['id'] ?>"><input type="hidden" name="status" value="<?= $st ?>">
        <button class="btn sm ghost" title="<?= $st ?>"><?= $icon ?></button></form>
    <?php endforeach; endif; ?></td>
  </tr>
  <?php endforeach; if (!$selectors): ?><tr><td colspan="8" class="muted">No selectors yet – run a scan, or let Plans B/C learn them from live traffic.</td></tr><?php endif; ?>
  </table>
</div>

<div class="card"><h3>Recent widget events</h3>
<table><tr><th>Time</th><th>Type</th><th>Plan</th><th>Page</th><th>URL</th></tr>
<?php foreach ($events as $ev): ?><tr><td><small><?= e($ev['created_at']) ?></small></td><td><?= badge($ev['type']) ?></td><td><?= $ev['plan'] ? badge($ev['plan']) : '' ?></td><td><?= e($ev['page_type']) ?></td><td class="url"><small><?= e($ev['url']) ?></small></td></tr><?php endforeach; ?>
</table><a href="events.php?site=<?= $id ?>">All events →</a></div>

<?php if (admin()['role'] === 'super'): ?>
<form method="post" onsubmit="return confirm('Delete this site and ALL its data?')" style="margin-top:20px">
  <?= csrf_field() ?><input type="hidden" name="id" value="<?= $id ?>"><input type="hidden" name="action" value="delete_site">
  <button class="btn danger">Delete site</button>
</form>
<?php endif; ?>

<script>
const TARGETS = <?= json_encode(array_map('array_keys', $TARGETS)) ?>;
function syncTargets(){ const pt=document.getElementById('pt'), tg=document.getElementById('tg'); if(!pt) return;
  tg.innerHTML = TARGETS[pt.value].map(t => `<option>${t}</option>`).join(''); }
syncTargets();
</script>
<?php layout_end();
