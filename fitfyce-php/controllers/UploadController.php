<?php

declare(strict_types=1);

namespace TryFit\Controllers;

class UploadController
{
    public function uploadTemp(): void
    {
        // No auth — called from browser via Remix proxy

        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            respondJson(['error' => 'Method not allowed'], 405);
        }

        if (!isset($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
            $code = $_FILES['photo']['error'] ?? UPLOAD_ERR_NO_FILE;
            respondJson(['error' => 'Upload error: ' . $this->uploadErrorMessage($code)], 400);
        }

        $file = $_FILES['photo'];

        // Validate MIME type
        $finfo    = new \finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($file['tmp_name']);

        if (!str_starts_with((string)$mimeType, 'image/')) {
            respondJson(['error' => 'Only image files are allowed'], 400);
        }

        // Max 5 MB
        if ($file['size'] > 5 * 1024 * 1024) {
            respondJson(['error' => 'File exceeds 5MB limit'], 400);
        }

        $uuid    = $this->generateUuidV4();
        $tempDir = __DIR__ . '/../temp';
        $metaDir = $tempDir . '/.meta';

        if (!is_dir($tempDir)) {
            @mkdir($tempDir, 0755, true);
        }
        if (!is_dir($metaDir)) {
            @mkdir($metaDir, 0755, true);
        }

        $filename = $uuid . '.jpg';
        $destPath = $tempDir . '/' . $filename;

        // Convert to JPEG if needed
        $image = @imagecreatefromstring((string)file_get_contents($file['tmp_name']));
        if ($image !== false) {
            imagejpeg($image, $destPath, 90);
            imagedestroy($image);
        } else {
            if (!move_uploaded_file($file['tmp_name'], $destPath)) {
                respondJson(['error' => 'Failed to save file'], 500);
            }
        }

        // Write expiry metadata
        $meta = [
            'uuid'       => $uuid,
            'expires_at' => time() + 600,
            'created_at' => time(),
        ];
        file_put_contents($metaDir . '/' . $uuid . '.json', json_encode($meta));

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
