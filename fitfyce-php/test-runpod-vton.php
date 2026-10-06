<?php

declare(strict_types=1);

/**
 * Standalone browser test page for the RunPod-hosted FASHN VTON 1.5
 * serverless endpoint (src/RunpodVtonClient.php).
 *
 * Upload a person photo + garment photo, tune the same parameters as
 * the RunPod handler accepts, and see the generated try-on result.
 *
 * Config: reads RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID from .env (same
 * simple parser used by standalone-tryon.php) or real env vars.
 */

@set_time_limit(180);

// ── Load .env (same directory) if present ──────────────────────────────────
$envFile = __DIR__ . '/.env';
if (is_file($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
            continue;
        }
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v);
        if (getenv($k) === false) {
            putenv("{$k}={$v}");
            $_ENV[$k] = $v;
        }
    }
}

$apiKey     = (string)(getenv('RUNPOD_API_KEY') ?: '');
$endpointId = (string)(getenv('RUNPOD_ENDPOINT_ID') ?: '');

$resultImages = [];
$errorMessage = null;

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if ($apiKey === '' || $endpointId === '') {
        $errorMessage = 'Server not configured: set RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID in .env';
    } else {
        $personFile  = $_FILES['person_image'] ?? null;
        $garmentFile = $_FILES['garment_image'] ?? null;

        if (!is_array($personFile) || ($personFile['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            $errorMessage = 'Please upload a person image.';
        } elseif (!is_array($garmentFile) || ($garmentFile['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            $errorMessage = 'Please upload a garment image.';
        } else {
            $personBytes  = (string)file_get_contents($personFile['tmp_name']);
            $garmentBytes = (string)file_get_contents($garmentFile['tmp_name']);

            require_once __DIR__ . '/src/RunpodVtonClient.php';
            $client = new VTON\RunpodVtonClient($apiKey, $endpointId);

            $result = $client->tryOn([
                'person_image'       => base64_encode($personBytes),
                'garment_image'      => base64_encode($garmentBytes),
                'prompt'             => trim((string)($_POST['prompt'] ?? '')),
                'category'           => (string)($_POST['category'] ?? 'tops'),
                'garment_photo_type' => (string)($_POST['garment_photo_type'] ?? 'model'),
                'num_samples'        => (int)($_POST['num_samples'] ?? 1),
                'num_timesteps'      => (int)($_POST['num_timesteps'] ?? 30),
                'guidance_scale'     => (float)($_POST['guidance_scale'] ?? 1.5),
                'seed'               => (int)($_POST['seed'] ?? 42),
                'segmentation_free'  => isset($_POST['segmentation_free']),
            ]);

            if ($result['status_code'] !== 200 || $result['images'] === null) {
                $errorMessage = $result['error_details'] ?? 'Try-on generation failed';
            } else {
                $resultsDir = __DIR__ . '/results';
                if (!is_dir($resultsDir)) {
                    @mkdir($resultsDir, 0755, true);
                }
                foreach ($result['images'] as $index => $base64Image) {
                    $bytes    = base64_decode($base64Image);
                    $filename = 'runpod_vton_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.png';
                    file_put_contents($resultsDir . DIRECTORY_SEPARATOR . $filename, $bytes);
                    $resultImages[] = [
                        'data_uri' => 'data:image/png;base64,' . $base64Image,
                        'url'      => 'results/' . $filename,
                    ];
                }
            }
        }
    }
}

?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>RunPod FASHN VTON 1.5 — Test</title>
<style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { font-size: 1.4rem; }
    fieldset { border: 1px solid #ddd; border-radius: 8px; margin-bottom: 1rem; }
    label { display: block; margin: 0.6rem 0 0.2rem; font-weight: 600; font-size: 0.9rem; }
    input, select, textarea { width: 100%; padding: 0.4rem; box-sizing: border-box; }
    .row { display: flex; gap: 1rem; }
    .row > div { flex: 1; }
    button { margin-top: 1rem; padding: 0.7rem 1.2rem; font-size: 1rem; cursor: pointer; }
    .error { background: #fdecea; color: #611a15; padding: 0.8rem; border-radius: 6px; margin-bottom: 1rem; }
    .results { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 1rem; }
    .results img { max-width: 300px; border-radius: 8px; border: 1px solid #ddd; }
    .endpoint { color: #666; font-size: 0.85rem; margin-top: 2rem; }
</style>
</head>
<body>

<h1>RunPod FASHN VTON 1.5 — Test</h1>
<p>AI Virtual Try-On powered by RunPod Serverless (PHP test harness)</p>

<?php if ($errorMessage !== null): ?>
    <div class="error"><?= htmlspecialchars($errorMessage) ?></div>
<?php endif; ?>

<form method="POST" enctype="multipart/form-data">
    <div class="row">
        <div>
            <label>Person Image</label>
            <input type="file" name="person_image" accept="image/*" required>
        </div>
        <div>
            <label>Garment Image</label>
            <input type="file" name="garment_image" accept="image/*" required>
        </div>
    </div>

    <label>Optional prompt</label>
    <textarea name="prompt" rows="2" placeholder="realistic virtual try-on, natural fit, preserve the person's appearance"></textarea>

    <fieldset>
        <legend>Generation Settings</legend>
        <div class="row">
            <div>
                <label>Category</label>
                <select name="category">
                    <option value="tops">tops</option>
                    <option value="bottoms">bottoms</option>
                    <option value="one-pieces">one-pieces</option>
                    <option value="saree">saree</option>
                </select>
            </div>
            <div>
                <label>Garment Photo Type</label>
                <select name="garment_photo_type">
                    <option value="model">model</option>
                    <option value="flat-lay">flat-lay</option>
                </select>
            </div>
        </div>
        <div class="row">
            <div>
                <label>Number of Samples</label>
                <input type="number" name="num_samples" min="1" max="4" value="1">
            </div>
            <div>
                <label>Timesteps</label>
                <input type="number" name="num_timesteps" min="1" max="100" value="30">
            </div>
        </div>
        <div class="row">
            <div>
                <label>Guidance Scale</label>
                <input type="number" step="0.1" name="guidance_scale" min="0" max="10" value="1.5">
            </div>
            <div>
                <label>Seed</label>
                <input type="number" name="seed" min="0" max="999999999" value="42">
            </div>
        </div>
        <label style="display:flex;align-items:center;gap:0.4rem;margin-top:0.8rem;">
            <input type="checkbox" name="segmentation_free" style="width:auto;" checked>
            Segmentation Free
        </label>
    </fieldset>

    <button type="submit">Generate Virtual Try-On</button>
</form>

<?php if (!empty($resultImages)): ?>
    <h2>Result</h2>
    <div class="results">
        <?php foreach ($resultImages as $i => $img): ?>
            <div>
                <img src="<?= htmlspecialchars($img['data_uri']) ?>" alt="Result <?= $i + 1 ?>">
                <div><a href="<?= htmlspecialchars($img['url']) ?>" download>Save Result <?= $i + 1 ?></a></div>
            </div>
        <?php endforeach; ?>
    </div>
<?php endif; ?>

<div class="endpoint">
    RunPod endpoint: <code><?= htmlspecialchars($endpointId !== '' ? "https://api.runpod.ai/v2/{$endpointId}/runsync" : '(not configured)') ?></code>
</div>

</body>
</html>
