<?php
/**
 * Generates the built-in AI Studio model library with OpenAI gpt-image-1.
 *
 *   Review page:     https://tryonapp.digifyce.com/generate-default-models.php?key=migrate2025
 *   Start/continue:  …&run=1          (2 models per page load, auto-continues until done)
 *   Redo one model:  …&regen=f-amara  (e.g. if you don't like how it came out)
 *
 * Cost: gpt-image-1, high quality, 1024×1536 — roughly US$0.25 per image,
 * about US$25 for all 100 (check current OpenAI pricing).
 * DELETE this file from the server once the library looks right.
 */
declare(strict_types=1);

if (($_GET['key'] ?? '') !== 'migrate2025') {
    http_response_code(403);
    exit('Forbidden');
}

// .env loader (same as router.php / migrate.php)
$envFile = __DIR__ . '/.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || strpos($line, '=') === false) continue;
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        if (!isset($_ENV[$k]) && getenv($k) === false) {
            putenv("{$k}=" . trim($v));
            $_ENV[$k] = trim($v);
        }
    }
}

require_once __DIR__ . '/shared/helpers.php';
require_once __DIR__ . '/config/AppConfig.php';
require_once __DIR__ . '/db/Database.php';
require_once __DIR__ . '/src/ImageUtils.php';
require_once __DIR__ . '/src/OpenAIClient.php';
require_once __DIR__ . '/db/DefaultModelCatalog.php';
require_once __DIR__ . '/controllers/DefaultModelsController.php';

use TryFit\Controllers\DefaultModelsController;
use TryFit\Db\Database;

$key    = 'migrate2025';
$run    = isset($_GET['run']);
$regen  = isset($_GET['regen']) ? preg_replace('/[^a-z0-9-]/', '', (string)$_GET['regen']) : null;
$result = null;
$error  = null;

try {
    if ($regen) {
        $result = DefaultModelsController::generateBatch(1, $regen);
    } elseif ($run) {
        $result = DefaultModelsController::generateBatch(2);
    } else {
        DefaultModelsController::seedCatalog();
    }
    $counts = DefaultModelsController::counts();
    $rows   = Database::getInstance()->query('SELECT model_key, name, gender, look, skin_tone, body_type, age_group, status, attempts, last_error, image_path, thumb_path FROM default_models ORDER BY sort_order')->fetchAll();
} catch (\Throwable $e) {
    $error  = $e->getMessage();
    $counts = ['pending' => 0, 'generating' => 0, 'ready' => 0, 'failed' => 0];
    $rows   = [];
}

$total     = array_sum($counts);
$remaining = $counts['pending'] + $counts['generating'] + count(array_filter($rows, fn ($r) => $r['status'] === 'failed' && (int)$r['attempts'] < 3));
$continue  = $run && !$regen && !$error && $remaining > 0;
$h = fn ($s) => htmlspecialchars((string)$s, ENT_QUOTES);
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Default model library</title>
<?php if ($continue): ?><meta http-equiv="refresh" content="1;url=?key=<?= $key ?>&run=1"><?php endif; ?>
<style>
  body { font-family: Inter, system-ui, sans-serif; background: #F6F6F7; color: #111827; margin: 0; padding: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; } p { color: #5F6673; margin: 0 0 16px; }
  .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 16px 0 24px; }
  .pill { background: #fff; border: 1px solid #E3E3E3; border-radius: 999px; padding: 6px 14px; font-size: 13px; }
  .btn { background: #111827; color: #fff; text-decoration: none; padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; }
  .btn.ghost { background: #fff; color: #111827; border: 1px solid #D4D4D8; }
  .progress { height: 8px; background: #E5E7EB; border-radius: 999px; overflow: hidden; max-width: 520px; }
  .progress span { display: block; height: 100%; background: #5B4BF5; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }
  .card { background: #fff; border: 1px solid #E3E3E3; border-radius: 12px; overflow: hidden; font-size: 12px; }
  .img { aspect-ratio: 3/4; background: #F3F4F6; display: flex; align-items: center; justify-content: center; color: #9CA3AF; }
  .img img { width: 100%; height: 100%; object-fit: cover; }
  .meta { padding: 10px 12px; } .meta b { font-size: 13px; }
  .st { display: inline-block; margin-top: 6px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
  .ready { background: #E7F8F1; color: #047857; } .failed { background: #FEF2F2; color: #B91C1C; }
  .pending, .generating { background: #F3F4F6; color: #4B5563; }
  .err { color: #B91C1C; margin-top: 4px; word-break: break-word; } .log { background: #fff; border: 1px solid #E3E3E3; border-radius: 10px; padding: 12px 16px; margin-bottom: 20px; font-size: 13px; }
</style>
</head>
<body>
  <h1>Default model library</h1>
  <p>60 women + 40 men generated with OpenAI gpt-image-1 (high quality, portrait) · about US$0.25 each.</p>

  <?php if ($error): ?><div class="log err"><b>Error:</b> <?= $h($error) ?> — did you run migrate.php (018a/018b)?</div><?php endif; ?>

  <div class="bar">
    <span class="pill">Ready <b><?= $counts['ready'] ?></b> / <?= $total ?></span>
    <span class="pill">Pending <?= $counts['pending'] ?></span>
    <span class="pill">Failed <?= $counts['failed'] ?></span>
    <?php if ($continue): ?>
      <span class="pill">Generating… this page continues automatically</span>
      <a class="btn ghost" href="?key=<?= $key ?>">Pause</a>
    <?php elseif ($remaining > 0): ?>
      <a class="btn" href="?key=<?= $key ?>&run=1"><?= $counts['ready'] ? 'Continue generating' : 'Start generating' ?> (<?= $remaining ?> left)</a>
    <?php else: ?>
      <span class="pill" style="color:#047857">All done ✓</span>
    <?php endif; ?>
  </div>
  <div class="progress"><span style="width: <?= $total ? round($counts['ready'] / $total * 100) : 0 ?>%"></span></div>
  <br>

  <?php if ($result && $result['processed']): ?>
    <div class="log"><b>Last batch:</b>
      <?php foreach ($result['processed'] as $p): ?>
        <div><?= $p['ok'] ? '✓' : '✗' ?> <?= $h($p['name'] ?? $p['model_key']) ?><?= $p['ok'] ? '' : ' — ' . $h($p['error'] ?? '') ?></div>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>

  <div class="grid">
    <?php foreach ($rows as $r): ?>
      <div class="card">
        <div class="img">
          <?php if ($r['thumb_path'] || $r['image_path']): ?>
            <a href="<?= $h(DefaultModelsController::publicUrl($r['image_path'])) ?>" target="_blank"><img src="<?= $h(DefaultModelsController::publicUrl($r['thumb_path'] ?: $r['image_path'])) ?>?v=<?= $h($r['attempts']) ?>" alt=""></a>
          <?php else: ?>not generated<?php endif; ?>
        </div>
        <div class="meta">
          <b><?= $h($r['name']) ?></b> · <?= $h($r['gender']) ?><br>
          <?= $h($r['look']) ?> · <?= $h($r['skin_tone']) ?> · <?= $h($r['body_type']) ?> · <?= $h($r['age_group']) ?><br>
          <span class="st <?= $h($r['status']) ?>"><?= $h($r['status']) ?></span>
          <?php if ($r['status'] === 'ready' || $r['status'] === 'failed'): ?>
            · <a href="?key=<?= $key ?>&regen=<?= $h($r['model_key']) ?>">Regenerate</a>
          <?php endif; ?>
          <?php if ($r['last_error']): ?><div class="err"><?= $h($r['last_error']) ?></div><?php endif; ?>
        </div>
      </div>
    <?php endforeach; ?>
  </div>
</body>
</html>
