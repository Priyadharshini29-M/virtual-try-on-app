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
}
