<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use VTON\AccessoryJobs;

/**
 * POST /accessory-worker — runs one queued accessory try-on job.
 *
 * Only ever called by AccessoryJobs itself (a fire-and-forget loopback
 * request), and only with a valid HMAC of the job id, so it can't be used from
 * outside to spend Hugging Face quota. It deliberately outlives the caller's
 * connection: the Space generation takes far longer than the caller waits.
 */
final class AccessoryWorkerController
{
    public function run(): void
    {
        ignore_user_abort(true);
        @set_time_limit(0);

        $id  = preg_replace('/[^a-f0-9]/', '', (string)($_POST['job'] ?? ''));
        $sig = (string)($_POST['sig'] ?? '');

        if (!AccessoryJobs::verify($id, $sig)) {
            respondJson(['error' => 'Forbidden'], 403);
            return;
        }

        AccessoryJobs::process($id);
        respondJson(['ok' => true]);
    }
}
