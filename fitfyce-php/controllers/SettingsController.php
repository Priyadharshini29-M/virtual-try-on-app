<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\Database;
use TryFit\Middleware\ApiKeyAuth;

class SettingsController
{
    public function get(): void
    {
        $merchant = ApiKeyAuth::handle();
        $db = Database::getInstance();

        $stmt = $db->prepare(
            'SELECT * FROM merchant_settings WHERE merchant_id = ? LIMIT 1'
        );
        $stmt->execute([(int)$merchant['id']]);
        $settings = $stmt->fetch();

        if ($settings === false) {
            // Return defaults
            respondJson([
                'merchant_id'            => (int)$merchant['id'],
                'button_text'            => 'Try On This Look',
                'button_color'           => '#1B3A6B',
                'button_text_color'      => '#FFFFFF',
                'button_position'        => 'below_images',
                'widget_language'        => 'en',
                'show_watermark'         => 1,
                'share_whatsapp_enabled' => 1,
                'save_image_enabled'     => 1,
                'privacy_notice_shown'   => 1,
            ]);
        }

        respondJson($settings);
    }

    public function save(): void
    {
        $merchant = ApiKeyAuth::handle();
        $db = Database::getInstance();

        $body = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);

        $allowedPositions = ['below_images', 'below_atc', 'floating'];
        $allowedLanguages = ['en', 'ta', 'hi'];

        $buttonText       = isset($body['button_text'])       ? substr(trim((string)$body['button_text']), 0, 100) : null;
        $buttonColor      = isset($body['button_color'])      ? $this->sanitizeHex((string)$body['button_color'])  : null;
        $buttonTextColor  = isset($body['button_text_color']) ? $this->sanitizeHex((string)$body['button_text_color']) : null;
        $buttonPosition   = in_array($body['button_position'] ?? '', $allowedPositions, true) ? $body['button_position'] : null;
        $widgetLanguage   = in_array($body['widget_language'] ?? '', $allowedLanguages, true) ? $body['widget_language'] : null;
        $showWatermark    = isset($body['show_watermark'])         ? ((int)(bool)$body['show_watermark']) : null;
        $shareWhatsapp    = isset($body['share_whatsapp_enabled']) ? ((int)(bool)$body['share_whatsapp_enabled']) : null;
        $saveImage        = isset($body['save_image_enabled'])     ? ((int)(bool)$body['save_image_enabled']) : null;
        $privacyNotice    = isset($body['privacy_notice_shown'])   ? ((int)(bool)$body['privacy_notice_shown']) : null;

        $stmt = $db->prepare(
            'INSERT INTO merchant_settings
             (merchant_id, button_text, button_color, button_text_color, button_position,
              widget_language, show_watermark, share_whatsapp_enabled,
              save_image_enabled, privacy_notice_shown)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               button_text            = COALESCE(VALUES(button_text),            button_text),
               button_color           = COALESCE(VALUES(button_color),           button_color),
               button_text_color      = COALESCE(VALUES(button_text_color),      button_text_color),
               button_position        = COALESCE(VALUES(button_position),        button_position),
               widget_language        = COALESCE(VALUES(widget_language),        widget_language),
               show_watermark         = COALESCE(VALUES(show_watermark),         show_watermark),
               share_whatsapp_enabled = COALESCE(VALUES(share_whatsapp_enabled), share_whatsapp_enabled),
               save_image_enabled     = COALESCE(VALUES(save_image_enabled),     save_image_enabled),
               privacy_notice_shown   = COALESCE(VALUES(privacy_notice_shown),   privacy_notice_shown)'
        );

        $stmt->execute([
            (int)$merchant['id'],
            $buttonText      ?? 'Try On This Look',
            $buttonColor     ?? '#1B3A6B',
            $buttonTextColor ?? '#FFFFFF',
            $buttonPosition  ?? 'below_images',
            $widgetLanguage  ?? 'en',
            $showWatermark   ?? 1,
            $shareWhatsapp   ?? 1,
            $saveImage       ?? 1,
            $privacyNotice   ?? 1,
        ]);

        // Return updated row
        $sel = $db->prepare('SELECT * FROM merchant_settings WHERE merchant_id = ? LIMIT 1');
        $sel->execute([(int)$merchant['id']]);
        respondJson($sel->fetch());
    }

    private function sanitizeHex(string $color): ?string
    {
        $color = trim($color);
        if (preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) {
            return $color;
        }
        return null;
    }
}
