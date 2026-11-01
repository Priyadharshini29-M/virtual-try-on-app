<?php
/**
 * Base English strings. Any key missing in another locale falls back to this file.
 * Keep keys snake_case and never English-dependent (e.g. 'save_success' not 'settings_saved_toast').
 * Interpolation uses {name} placeholders. Never use em dashes.
 */
return [
    'common' => [
        'ok' => 'OK',
        'error' => 'Something went wrong',
        'unauthorized' => 'Unauthorized',
        'forbidden' => 'Forbidden',
        'not_found' => 'Not found',
        'server_error' => 'Server error',
    ],

    'settings' => [
        'title' => 'Settings',
        'save_success' => 'Settings saved',
        'save_error' => 'Could not save settings: {reason}',
        'locale_updated' => 'Language updated to {locale}',
        'invalid_locale' => 'That language is not supported',
    ],

    'onboarding' => [
        'incomplete' => 'Finish onboarding before using this feature',
    ],

    'plans' => [
        'required' => 'A paid plan is required for this feature',
        'limit_exceeded' => 'You have reached your plan limit of {limit} generations this month',
        'upgrade_prompt' => 'Upgrade your plan to continue',
    ],

    'products' => [
        'sync_started' => 'Product sync started',
        'sync_failed' => 'Product sync failed: {reason}',
        'not_found' => 'Product not found',
    ],

    'studio' => [
        'generation_started' => 'Generation started',
        'generation_failed' => 'Generation failed: {reason}',
        'invalid_prompt' => 'The prompt is invalid',
        'quota_exhausted' => 'Monthly generation quota reached',
    ],

    'garment_studio' => [
        'job_created' => 'Garment Studio job created',
        'invalid_garment' => 'The garment image is invalid or unreadable',
        'invalid_model' => 'The model image is invalid or unreadable',
        'report_title' => 'Garment Studio report',
        'report_generated_on' => 'Generated on {date}',
    ],

    'widget' => [
        'enabled' => 'Widget enabled',
        'disabled' => 'Widget disabled',
        'config_saved' => 'Widget configuration saved',
    ],

    'upload' => [
        'too_large' => 'The file is too large (max {max_mb} MB)',
        'unsupported_type' => 'That file type is not supported',
        'failed' => 'Upload failed: {reason}',
    ],

    'errors' => [
        'plan_limit' => 'You have reached your plan limit of {limit} generations this month',
        'auth_required' => 'Sign in required',
        'invalid_request' => 'The request is invalid',
        'rate_limited' => 'Too many requests. Try again in a moment.',
        'tryon' => [
            'no_face_detected' => 'No face detected in the uploaded photo',
            'invalid_image' => 'The image could not be read',
            'generation_failed' => 'Try-on generation failed: {reason}',
            'model_not_ready' => 'The selected model is not ready',
            'queued' => 'Your try-on is queued',
        ],
        'tryon_disabled' => 'Try-on is disabled for your store',
    ],

    'email' => [
        'cleanup_subject' => 'Your weekly FitFyce usage summary',
        'cleanup_intro' => 'Here is a quick recap of this week on your store.',
    ],
];
