<?php
// Usage: require this in webhook endpoints to log events

require_once __DIR__ . '/../config/AppConfig.php';
require_once __DIR__ . '/../db/WebhookLogRepo.php';

use TryFit\Db\WebhookLogRepo;

function log_webhook_event($merchantId, $eventType, $direction, $payload, $headers = [], $responseStatus = null, $errorMessage = null)
{
    $repo = new WebhookLogRepo();
    return $repo->logEvent([
        'merchant_id' => $merchantId,
        'event_type' => $eventType,
        'direction' => $direction,
        'payload' => $payload,
        'headers' => $headers,
        'response_status' => $responseStatus,
        'error_message' => $errorMessage,
    ]);
}

function update_webhook_log_status($logId, $responseStatus = null, $errorMessage = null)
{
    $repo = new WebhookLogRepo();
    $repo->updateStatus($logId, $responseStatus, $errorMessage);
}
