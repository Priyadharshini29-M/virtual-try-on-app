<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;

class UploadController
{
    public function uploadTemp(): void
    {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            respondJson(['error' => 'Method not allowed'], 405);
        }

        if (!isset($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
            $code = $_FILES['photo']['error'] ?? UPLOAD_ERR_NO_FILE;
            respondJson(['error' => 'Upload error: ' . $this->uploadErrorMessage($code)], 400);
        }

        $file = $_FILES['photo'];

        $finfo    = new \finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($file['tmp_name']);

        if (!str_starts_with((string)$mimeType, 'image/')) {
            respondJson(['error' => 'Only image files are allowed'], 400);
        }

        if ($file['size'] > AppConfig::UPLOAD_MAX_BYTES) {
            $mb = AppConfig::UPLOAD_MAX_BYTES / 1024 / 1024;
            respondJson(['error' => "File exceeds {$mb}MB limit"], 400);
        }

        $uuid    = $this->generateUuidV4();
        $tempDir = AppConfig::tempDir();
        $metaDir = $tempDir . DIRECTORY_SEPARATOR . '.meta';

        if (!is_dir($tempDir)) {
            @mkdir($tempDir, 0755, true);
        }
        if (!is_dir($metaDir)) {
            @mkdir($metaDir, 0755, true);
        }

        $filename = $uuid . '.jpg';
        $destPath = $tempDir . DIRECTORY_SEPARATOR . $filename;

        $image = @imagecreatefromstring((string)file_get_contents($file['tmp_name']));
        if ($image !== false) {
            imagejpeg($image, $destPath, AppConfig::JPEG_QUALITY);
            imagedestroy($image);
        } else {
            if (!move_uploaded_file($file['tmp_name'], $destPath)) {
                respondJson(['error' => 'Failed to save file'], 500);
            }
        }

        $meta = [
            'uuid'       => $uuid,
            'expires_at' => time() + AppConfig::UPLOAD_TTL_SECONDS,
            'created_at' => time(),
        ];
        file_put_contents($metaDir . DIRECTORY_SEPARATOR . $uuid . '.json', json_encode($meta));

        $tempUrl = baseUrl() . basePath() . '/temp/' . $filename;
        respondJson(['tempUrl' => $tempUrl]);
    }

    private function uploadErrorMessage(int $code): string
    {
        $messages = [
            UPLOAD_ERR_INI_SIZE   => 'File exceeds upload_max_filesize',
            UPLOAD_ERR_FORM_SIZE  => 'File exceeds MAX_FILE_SIZE',
            UPLOAD_ERR_PARTIAL    => 'File was only partially uploaded',
            UPLOAD_ERR_NO_FILE    => 'No file was uploaded',
            UPLOAD_ERR_NO_TMP_DIR => 'Missing temporary folder',
            UPLOAD_ERR_CANT_WRITE => 'Failed to write file to disk',
            UPLOAD_ERR_EXTENSION  => 'A PHP extension stopped the upload',
        ];
        return $messages[$code] ?? 'Unknown error';
    }

    private function generateUuidV4(): string
    {
        $data    = random_bytes(16);
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
