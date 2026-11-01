<?php

declare(strict_types=1);

namespace VTON;

final class ImageUtils
{
    public static function ensureJpeg(string $sourcePath): string
    {
        $type = @exif_imagetype($sourcePath);
        if ($type === IMAGETYPE_JPEG || $type === false) {
            return $sourcePath;
        }

        if (!function_exists('imagecreatefromstring')) {
            return $sourcePath;
        }

        $data = @file_get_contents($sourcePath);
        if ($data === false) {
            return $sourcePath;
        }

        $img = @imagecreatefromstring($data);
        if ($img === false) {
            return $sourcePath;
        }

        $tempPath = tempnam(sys_get_temp_dir(), 'vton_');
        if ($tempPath === false) {
            imagedestroy($img);
            return $sourcePath;
        }

        $jpegPath = $tempPath . '.jpg';
        @imagejpeg($img, $jpegPath, 95);
        imagedestroy($img);

        return is_file($jpegPath) ? $jpegPath : $sourcePath;
    }

    /**
     * Upscale $path so both dimensions are at least $minW x $minH.
     * Aspect ratio is preserved; both sides are scaled up by the same factor.
     * Returns the original path unchanged when already large enough or when GD
     * is unavailable.  Any new temp file is appended to $tempFiles.
     */
    public static function ensureMinimumSize(
        string $path,
        int    $minW,
        int    $minH,
        array  &$tempFiles
    ): string {
        if (!function_exists('imagecreatefromstring') ||
            !function_exists('imagecopyresampled')) {
            return $path;
        }

        $data = @file_get_contents($path);
        if ($data === false) {
            return $path;
        }

        $src = @imagecreatefromstring($data);
        if ($src === false) {
            return $path;
        }

        $w = imagesx($src);
        $h = imagesy($src);

        if ($w >= $minW && $h >= $minH) {
            imagedestroy($src);
            return $path;
        }

        // Scale factor: make the smaller side reach its minimum
        $scale = max($minW / max($w, 1), $minH / max($h, 1));
        $newW  = (int) ceil($w * $scale);
        $newH  = (int) ceil($h * $scale);

        $dst = imagecreatetruecolor($newW, $newH);
        if ($dst === false) {
            imagedestroy($src);
            return $path;
        }

        imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $w, $h);
        imagedestroy($src);

        $base = tempnam(sys_get_temp_dir(), 'vton_');
        if ($base === false) {
            imagedestroy($dst);
            return $path;
        }
        $newPath   = $base . '.jpg';
        $tempFiles[] = $base;
        $tempFiles[] = $newPath;

        if (!@imagejpeg($dst, $newPath, 95)) {
            imagedestroy($dst);
            return $path;
        }

        imagedestroy($dst);
        return is_file($newPath) ? $newPath : $path;
    }

    /**
     * Re-encodes any image as JPEG, shrinking the longest side to $maxEdge when it is larger — keeps large uploads
     * within GD's memory and the request size of external image APIs. Null when the bytes are not a decodable image.
     */
    public static function jpegBytesMaxEdge(string $bytes, int $maxEdge = 2048): ?string
    {
        @ini_set('memory_limit', '1024M');
        $src = @imagecreatefromstring($bytes);
        if ($src === false) {
            return null;
        }
        $w = imagesx($src);
        $h = imagesy($src);
        if (max($w, $h) > $maxEdge) {
            $scale   = $maxEdge / max($w, $h);
            $resized = imagescale($src, max(1, (int) round($w * $scale)), max(1, (int) round($h * $scale)));
            imagedestroy($src);
            if ($resized === false) {
                return null;
            }
            $src = $resized;
        }
        ob_start();
        imagejpeg($src, null, 92);
        $out = (string) ob_get_clean();
        imagedestroy($src);
        return $out !== '' ? $out : null;
    }

    /**
     * Enlarges a small try-on result for display and sharpens it lightly.
     * The FASHN VTON 1.5 worker renders at roughly 576x864, which looks soft
     * when shown at catalogue size. This is a bicubic resample plus a mild
     * sharpen, not AI super-resolution: it restores crispness, it can't
     * invent detail the engine never produced. Overwrites $path in place;
     * returns false (leaving the file untouched) when GD can't do it.
     */
    public static function upscaleForDisplay(string $path, int $targetLongEdge = 1728): bool
    {
        if (!function_exists('imagecreatefromstring') || !function_exists('imageconvolution')) {
            return false;
        }
        @ini_set('memory_limit', '1024M');
        $src = @imagecreatefromstring((string) @file_get_contents($path));
        if ($src === false) {
            return false;
        }

        $w    = imagesx($src);
        $h    = imagesy($src);
        $long = max($w, $h);
        if ($long >= $targetLongEdge) {
            imagedestroy($src);
            return false;
        }

        $scale = min(3.0, $targetLongEdge / max($long, 1));
        imagesetinterpolation($src, IMG_BICUBIC);
        $dst = imagescale($src, (int) round($w * $scale), (int) round($h * $scale), IMG_BICUBIC);
        imagedestroy($src);
        if ($dst === false) {
            return false;
        }

        // Mild sharpen (centre 12, cross -1, divisor 8) to offset the resample softening.
        imageconvolution($dst, [[0, -1, 0], [-1, 12, -1], [0, -1, 0]], 8, 0);

        $ok = @imagejpeg($dst, $path, 95);
        imagedestroy($dst);
        return $ok;
    }

    public static function saveImageBytes(string $bytes, string $outputPath): bool
    {
        $dir = dirname($outputPath);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        return file_put_contents($outputPath, $bytes) !== false;
    }

    public static function detectMimeType(string $filePath): string
    {
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($filePath);

        return $mime ?: 'image/jpeg';
    }

    /**
     * Read a local image file and return it as a base64 data URI.
     * Required by APIs (e.g. Fashn.ai) that accept data URIs instead of file uploads.
     */
    public static function fileToBase64Uri(string $filePath): string
    {
        $bytes = (string)file_get_contents($filePath);
        $mime  = self::detectMimeType($filePath);
        return 'data:' . $mime . ';base64,' . base64_encode($bytes);
    }

    /**
     * Scale $bytes (contain, centred) onto a $size x $size white canvas and
     * re-encode as PNG. Used to normalise gpt-image-1's native 1024x1024
     * output (it has no 1080x1080 size option) to the requested 1080x1080
     * commercial-quality infographic dimensions.
     */
    public static function padToSquare(string $bytes, int $size = 1080): string
    {
        if (!function_exists('imagecreatefromstring') || !function_exists('imagecreatetruecolor')) {
            return $bytes;
        }

        $src = @imagecreatefromstring($bytes);
        if ($src === false) {
            return $bytes;
        }

        $srcW = imagesx($src);
        $srcH = imagesy($src);

        $canvas = imagecreatetruecolor($size, $size);
        if ($canvas === false) {
            imagedestroy($src);
            return $bytes;
        }

        $white = imagecolorallocate($canvas, 255, 255, 255);
        imagefill($canvas, 0, 0, $white);

        $scale = min($size / max($srcW, 1), $size / max($srcH, 1));
        $newW  = (int) round($srcW * $scale);
        $newH  = (int) round($srcH * $scale);
        $offX  = (int) floor(($size - $newW) / 2);
        $offY  = (int) floor(($size - $newH) / 2);

        imagecopyresampled($canvas, $src, $offX, $offY, 0, 0, $newW, $newH, $srcW, $srcH);
        imagedestroy($src);

        ob_start();
        imagepng($canvas);
        $out = (string) ob_get_clean();
        imagedestroy($canvas);

        return $out !== '' ? $out : $bytes;
    }

    /**
     * Generate a scaled-down JPEG thumbnail of $sourcePath at $destPath, for
     * fast-loading Asset Library grids. Returns false (and leaves $destPath
     * untouched) when GD is unavailable or the source can't be read.
     */
    public static function makeThumbnail(string $sourcePath, string $destPath, int $maxDim = 320): bool
    {
        if (!function_exists('imagecreatefromstring') || !function_exists('imagecopyresampled')) {
            return false;
        }

        $data = @file_get_contents($sourcePath);
        if ($data === false) {
            return false;
        }

        $src = @imagecreatefromstring($data);
        if ($src === false) {
            return false;
        }

        $w = imagesx($src);
        $h = imagesy($src);
        $scale = min($maxDim / max($w, 1), $maxDim / max($h, 1), 1.0);
        $newW  = max(1, (int) round($w * $scale));
        $newH  = max(1, (int) round($h * $scale));

        $dst = imagecreatetruecolor($newW, $newH);
        if ($dst === false) {
            imagedestroy($src);
            return false;
        }

        imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $w, $h);
        imagedestroy($src);

        $dir = dirname($destPath);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        $ok = @imagejpeg($dst, $destPath, 80);
        imagedestroy($dst);

        return (bool) $ok;
    }
}
