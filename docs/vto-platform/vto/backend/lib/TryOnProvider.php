<?php
declare(strict_types=1);

/**
 * Try-on engines. Swap 'tryon.provider' in config.php.
 *  - MockTryOnProvider : GD composite, no AI – lets you test the full pipeline end-to-end.
 *  - HttpTryOnProvider : sends person + garment image to your model server / VTO API
 *                        (e.g. a self-hosted IDM-VTON / OOTDiffusion service, or a commercial API)
 *                        and expects an image back (raw bytes, or JSON with base64 / url).
 */
interface TryOnProvider
{
    /** @return string binary image (JPEG/PNG) */
    public function generate(string $personImagePath, string $garmentImagePath, array $context): string;
    public function name(): string;
}

final class TryOnFactory
{
    public static function make(): TryOnProvider
    {
        return match (cfg('tryon.provider')) {
            'http'  => new HttpTryOnProvider(cfg('tryon.http')),
            default => new MockTryOnProvider(),
        };
    }
}

final class MockTryOnProvider implements TryOnProvider
{
    public function name(): string { return 'mock'; }

    public function generate(string $personImagePath, string $garmentImagePath, array $context): string
    {
        if (!function_exists('imagecreatefromstring')) throw new RuntimeException('GD extension is required for mock provider');
        $person  = imagecreatefromstring(file_get_contents($personImagePath));
        $garment = imagecreatefromstring(file_get_contents($garmentImagePath));
        if (!$person || !$garment) throw new RuntimeException('Could not decode images');

        $pw = imagesx($person); $ph = imagesy($person);
        $gw = imagesx($garment); $gh = imagesy($garment);

        // Place garment on the torso area (centre, ~45% width, starting ~22% from top)
        $tw = (int)($pw * 0.45);
        $th = (int)($gh * ($tw / max(1, $gw)));
        $dx = (int)(($pw - $tw) / 2);
        $dy = (int)($ph * 0.22);

        $scaled = imagecreatetruecolor($tw, $th);
        imagealphablending($scaled, false); imagesavealpha($scaled, true);
        imagecopyresampled($scaled, $garment, 0, 0, 0, 0, $tw, $th, $gw, $gh);
        imagecopymerge($person, $scaled, $dx, $dy, 0, 0, $tw, $th, 85);

        $label = imagecolorallocate($person, 255, 255, 255);
        imagestring($person, 3, 10, $ph - 20, 'VTO preview (mock engine)', $label);

        ob_start(); imagejpeg($person, null, 88); $out = (string)ob_get_clean();
        imagedestroy($person); imagedestroy($garment); imagedestroy($scaled);
        return $out;
    }
}

final class HttpTryOnProvider implements TryOnProvider
{
    public function __construct(private array $cfg) {}
    public function name(): string { return 'http'; }

    public function generate(string $personImagePath, string $garmentImagePath, array $context): string
    {
        $ch = curl_init($this->cfg['endpoint']);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => (int)($this->cfg['timeout'] ?? 90),
            CURLOPT_HTTPHEADER => array_filter([
                $this->cfg['api_key'] ? 'Authorization: Bearer ' . $this->cfg['api_key'] : null,
            ]),
            CURLOPT_POSTFIELDS => [
                'person'   => new CURLFile($personImagePath),
                'garment'  => new CURLFile($garmentImagePath),
                'category' => $context['category'] ?? 'apparel',
                'title'    => $context['title'] ?? '',
            ],
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $ctype = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($body === false || $code >= 400) throw new RuntimeException("Provider error ($code) $err");

        if (str_starts_with($ctype, 'image/')) return $body;

        $j = json_decode($body, true);
        if (!empty($j['image_base64'])) return base64_decode($j['image_base64']);
        if (!empty($j['image_url']) && preg_match('#^https://#', $j['image_url'])) {
            $img = file_get_contents($j['image_url']);
            if ($img !== false) return $img;
        }
        throw new RuntimeException('Provider returned no image');
    }
}
