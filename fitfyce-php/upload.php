<?php
declare(strict_types=1);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error'=>'Method not allowed']);
    exit;
}

$payload = json_decode(file_get_contents('php://input'), true);
if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(['error'=>'Invalid JSON']);
    exit;
}

$clothing = trim((string)($payload['clothing_image'] ?? ''));
$avatar   = trim((string)($payload['avatar_image'] ?? ''));

if ($clothing === '' || $avatar === '') {
    http_response_code(400);
    echo json_encode(['error'=>'Missing images']);
    exit;
}

if (str_starts_with($clothing, '//')) {
    $clothing = 'https:' . $clothing;
}

/* ---------- SAVE IMAGES ---------- */

$dir = __DIR__ . '/uploads';
$urlBase = 'https://tryon.digifyce.com/uploads';

if (!is_dir($dir)) mkdir($dir, 0755, true);

function save(string $input, string $prefix, string $dir, string $urlBase): string {
    $name = $prefix.'_'.time().'_'.bin2hex(random_bytes(3)).'.jpg';
    $path = $dir.'/'.$name;

    // base64
    if (str_starts_with($input, 'data:image')) {
        $data = preg_replace('/^data:image\/\w+;base64,/', '', $input);
        file_put_contents($path, base64_decode($data));
        return $urlBase.'/'.$name;
    }

    // url
    $img = file_get_contents($input);
    if ($img === false) throw new Exception('Download failed');
    file_put_contents($path, $img);
    return $urlBase.'/'.$name;
}

try {
    $clothUrl  = save($clothing, 'cloth', $dir, $urlBase);
    $avatarUrl = save($avatar, 'avatar', $dir, $urlBase);
} catch (Throwable $e) {
    http_response_code(400);
    echo json_encode(['error'=>$e->getMessage()]);
    exit;
}

/* ---------- FORWARD TO api.php ---------- */

$ch = curl_init('https://tryon.digifyce.com/api.php');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode([
        'clothing_image' => $clothUrl,
        'avatar_image'   => $avatarUrl
    ])
]);

$response = curl_exec($ch);
$status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($status ?: 500);
echo $response;
