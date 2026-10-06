<?php

declare(strict_types=1);

namespace VTON;

use TryFit\AppConfig;

/**
 * Routes saree try-ons to the hosted Fashn.ai API; every other garment keeps
 * using the RunPod FASHN VTON 1.5 endpoint (RunpodVtonClient) untouched.
 *
 * The engine is encoded in the job ID itself — Fashn jobs carry an 'fs_'
 * prefix, RunPod jobs have none — so the stateless poll endpoints and the
 * Studio tables (which already store the ID in fashn_prediction_id) can tell
 * which engine to ask without any schema or widget change. Jobs submitted to
 * RunPod before this existed have no prefix and keep resolving as before.
 */
final class SareeRouting
{
    public const JOB_PREFIX = 'fs_';

    /** Job-ID prefix for accessory try-ons on the dedicated RunPod accessory endpoint. */
    public const ACCESSORY_JOB_PREFIX = 'rpa_';

    /** Job-ID prefix for accessory try-ons running on the Hugging Face Space (see AccessoryJobs). */
    public const HF_ACCESSORY_JOB_PREFIX = 'hf_';

    private const RETRY_DELAY_US = 1_500_000;

    /**
     * tryon-max has no category / garment_photo_type params and auto-detects
     * the garment, so the drape has to be spelled out in the prompt — without
     * it a saree tends to come out as a plain dress.
     *
     * Structural and specific on purpose: a looser "nivi style, pleats, pallu
     * over the left shoulder" prompt gave a different pallu placement on every
     * run, while spelling out the tuck, pleat count and pallu path gave the
     * classic drape. Never name a colour here — tryon-max follows the text over
     * the photo and will recolour the saree.
     */
    private const DRAPE_PROMPT = 'Wear the saree in the photo as a properly draped traditional nivi saree. '
        . 'Wrap it once around the waist and tuck the top edge in at the navel. Form 6 to 7 neat, '
        . 'crisp, evenly spaced knife pleats at the front centre, tucked in at the navel and falling '
        . 'straight to the ankles. Bring the remaining length diagonally across the chest and over the '
        . 'LEFT shoulder as the pallu, hanging to knee length at the back, with its decorative border '
        . 'and motifs clearly visible. Fitted blouse in a matching color. Keep the exact fabric color, '
        . 'pattern, border and motifs from the photo.';

    /** True when any of the given texts (prompt, product title…) mentions a saree/sari. */
    public static function isSaree(?string ...$texts): bool
    {
        foreach ($texts as $text) {
            if ($text !== null && $text !== '' && preg_match('/\b(sarees?|saris?)\b/i', $text)) {
                return true;
            }
        }
        return false;
    }

    /**
     * True for any saree. Strict: a saree is never sent to RunPod, even when
     * Fashn isn't configured or fails — submitFashn() then returns an error
     * instead, because RunPod can only render a saree as a stitched dress.
     */
    public static function shouldUseFashn(?string ...$texts): bool
    {
        return self::isSaree(...$texts);
    }

    public static function isFashnJob(string $jobId): bool
    {
        return str_starts_with($jobId, self::JOB_PREFIX);
    }

    /**
     * Prompt telling the accessory image-edit worker exactly where to put an
     * accessory, that it must be fully visible and faithful to the product
     * photo, and to leave everything else in the model photo alone. Without
     * one, a garment-style pass paints the accessory over the clothing.
     *
     * $category is the wizard's accessory type (watch, necklace…), $placement
     * its label ("Wrist (Left)"). Left/right always mean the wearer's own side.
     */
    public static function buildAccessoryPrompt(string $category, string $placement): string
    {
        $category  = strtolower(trim($category));
        $placement = trim($placement);
        $p         = strtolower($placement);

        $side = match (true) {
            str_contains($p, 'left')  => "the person's LEFT",
            str_contains($p, 'right') => "the person's RIGHT",
            default                   => null,
        };

        $where = match ($category) {
            'watch'      => 'Put the watch from the product image on ' . ($side ?? "the person's left") . ' wrist, '
                          . 'fastened snugly on the wrist bone with the dial facing outward, and the strap wrapping '
                          . 'naturally around the wrist',
            'bracelet'   => str_contains($p, 'stacked')
                          ? 'Put the bracelet(s) from the product image on the person\'s wrist, stacked together'
                          : 'Put the bracelet from the product image on ' . ($side ?? "the person's left") . ' wrist',
            'necklace'   => match (true) {
                                str_contains($p, 'layer')      => 'Put the necklace from the product image around the person\'s neck as a layered piece hanging at different lengths over the chest',
                                str_contains($p, 'collarbone') => 'Put the necklace from the product image around the person\'s neck, resting on the collarbone',
                                default                        => 'Put the necklace from the product image around the person\'s neck, centered on the chest',
                            },
            'earring'    => match (true) {
                                str_contains($p, 'left')  => 'Put the earring from the product image on the person\'s LEFT ear only',
                                str_contains($p, 'right') => 'Put the earring from the product image on the person\'s RIGHT ear only',
                                default                   => 'Put the earrings from the product image on both of the person\'s ears as a matching pair',
                            },
            // Bags are the accessory most often hidden behind an arm or cropped
            // small, so each variant spells out where the WHOLE bag hangs.
            'handbag'    => match (true) {
                                str_contains($p, 'held')      => 'Have the person hold the bag from the product image by its handle in one hand, arm slightly bent, '
                                                               . 'so the entire bag hangs clearly in front of the body at hip level, facing the camera',
                                str_contains($p, 'crossbody') => 'Have the person wear the bag from the product image crossbody, the strap running diagonally '
                                                               . 'across the torso and the entire bag resting at the opposite hip in front of the body, facing the camera',
                                default                       => 'Have the person carry the bag from the product image on ' . ($side ?? "their left") . ' shoulder, '
                                                               . 'the strap over the shoulder and the entire bag hanging at the front of the hip, in front of the arm '
                                                               . 'and torso rather than behind them, facing the camera',
                            },
            'sunglasses' => str_contains($p, 'held')
                          ? 'Have the person hold the sunglasses from the product image in their hand'
                          : 'Put the sunglasses from the product image on the person\'s face, resting on the nose and ears',
            'ring'       => str_contains($p, 'index')
                          ? 'Put the ring from the product image on the index finger of the person\'s visible hand'
                          : 'Put the ring from the product image on the ring finger of ' . ($side ?? "the person's left") . ' hand',
            default      => 'Put the accessory from the product image on the person in its natural, correct place'
                          . ($placement !== '' ? " ({$placement})" : ''),
        };

        return $where . '. Add ONLY this accessory. Keep the person\'s face, hair, skin, clothing, background and '
            . 'framing exactly as in the model photo, and keep the whole person fully inside the frame — only the '
            . 'arm or hand that holds or wears the accessory may shift as needed. '
            . 'The accessory must be FULLY VISIBLE and unobstructed: never hidden behind an arm, hand, hair or '
            . 'clothing, never cropped by the frame, and big enough that its key details (hardware, clasp, handle or '
            . 'strap, stones, pendant, dial, texture) are clearly readable. '
            . 'Reproduce the accessory EXACTLY as in the product image — same shape, proportions, color, material, '
            . 'pattern and every detail; never simplify, redraw or substitute it. '
            . 'Realistic real-world scale, natural perspective, contact shadows and lighting matching the photo.';
    }

    /**
     * Submits a saree try-on to Fashn. Takes the same array the caller would
     * hand RunpodVtonClient::submitRun() (person_image, garment_image,
     * garment_photo_type, seed) and returns the same
     * {status_code, prediction_id, error_details} shape, with prediction_id
     * already prefixed for later routing.
     *
     * Uses tryon-max with a nivi-drape prompt by default (FASHN_SAREE_MODEL=
     * tryon-v1.6 switches back to the category-based model, which can't be
     * told how to drape).
     *
     * Retries once on a transient failure (network error, 429, 5xx).
     *
     * @return array{status_code:int, prediction_id:?string, error_details:?string}
     */
    // Re-enabled 2026-10-01 — CatVTON RunPod worker testing is done; saree
    // try-ons go back through Fashn.ai. NOTE: nothing falls back to RunPod for
    // sarees when this is true — RunPod VTON 1.5 can't drape a saree correctly
    // (see the 'saree' category note further down).
    private const FASHN_TEMP_DISABLED = false;

    public static function submitFashn(array $params): array
    {
        if (self::FASHN_TEMP_DISABLED) {
            writeLog('INFO', 'Saree try-on blocked: Fashn.ai temporarily disabled in code (SareeRouting::FASHN_TEMP_DISABLED)');
            return [
                'status_code'   => 503,
                'prediction_id' => null,
                'error_details' => 'Saree try-on is temporarily disabled for testing.',
            ];
        }

        if (!AppConfig::useFashn()) {
            writeLog('ERROR', 'Saree try-on blocked: FASHN_API_KEY is not set (sarees never fall back to RunPod)');
            return [
                'status_code'   => 503,
                'prediction_id' => null,
                'error_details' => 'Saree try-on is not configured. Add FASHN_API_KEY to .env.',
            ];
        }

        $client = self::fashnClient();

        if (AppConfig::fashnSareeModel() === 'tryon-max') {
            $inputs = [
                'product_image'   => $params['garment_image'],
                'model_image'     => $params['person_image'],
                'generation_mode' => 'quality',
                'output_format'   => 'jpeg',
                'prompt'          => self::DRAPE_PROMPT,
            ];
            $submit = fn(): array => $client->submitModelRun('tryon-max', $inputs);
        } else {
            $fashnParams = [
                'model_image'   => $params['person_image'],
                'garment_image' => $params['garment_image'],
                // Fashn has no saree category; one-pieces is the full-length drape.
                'category'      => 'one-pieces',
            ];
            if (!empty($params['garment_photo_type'])) {
                $fashnParams['garment_photo_type'] = $params['garment_photo_type'];
            }
            if (isset($params['seed'])) {
                $fashnParams['seed'] = (int) $params['seed'];
            }
            $submit = fn(): array => $client->submitRun($fashnParams);
        }

        $result = $submit();

        $status = (int) $result['status_code'];
        if ($status === 0 || $status === 429 || $status >= 500) {
            usleep(self::RETRY_DELAY_US);
            $result = $submit();
        }

        if ($result['status_code'] === 200 && !empty($result['prediction_id'])) {
            $result['prediction_id'] = self::JOB_PREFIX . $result['prediction_id'];
            writeLog('INFO', 'Saree try-on routed to Fashn', ['job_id' => $result['prediction_id']]);
        }

        return $result;
    }

    /**
     * Single status check for either engine, chosen by the job ID prefix.
     * Same return shape from both clients: {job_status, image_bytes, error_details}.
     *
     * @return array{job_status:string, image_bytes:?string, error_details:?string}
     */
    public static function checkStatus(string $jobId): array
    {
        if (str_starts_with($jobId, self::HF_ACCESSORY_JOB_PREFIX)) {
            return AccessoryJobs::status(substr($jobId, strlen(self::HF_ACCESSORY_JOB_PREFIX)));
        }

        if (str_starts_with($jobId, self::ACCESSORY_JOB_PREFIX)) {
            return self::accessoryClient()->checkStatus(substr($jobId, strlen(self::ACCESSORY_JOB_PREFIX)));
        }

        if (self::isFashnJob($jobId)) {
            return self::fashnClient()->checkStatus(substr($jobId, strlen(self::JOB_PREFIX)));
        }

        return (new RunpodVtonClient(AppConfig::runpodApiKey(), AppConfig::runpodEndpointId()))->checkStatus($jobId);
    }

    /**
     * Submits an accessory try-on to the main FASHN VTON 1.5 RunPod endpoint
     * (RUNPOD_ENDPOINT_ID) — the same one garments use. That model only has
     * tops/bottoms/one-pieces/saree categories (confirmed against the live
     * endpoint via fashn-vton-test/app.py; there's no 'accessory' category,
     * and passing one crashes the handler with "'NoneType' object is not
     * iterable"), so the accessory photo rides in as a 'tops' garment_image
     * with garment_photo_type 'flat-lay' (it's a standalone product shot, not
     * a worn photo) and the placement prompt passed through as-is. Results
     * depend on the model treating the accessory like a redrawn garment
     * region rather than a fused object — there's no dedicated accessory
     * support on this model.
     *
     * Returns the usual {status_code, prediction_id, error_details} shape.
     * The job id is unprefixed, same as a garment job, so it polls through
     * checkStatus()'s default RunPod branch unchanged.
     *
     * Falls back to the old Hugging Face Space / dedicated RunPod accessory
     * endpoint pipeline only when the main RunPod endpoint isn't configured.
     *
     * @param array{person_image:string, accessory_image:string, prompt:string} $params
     * @return array{status_code:int, prediction_id:?string, error_details:?string}
     */
    public static function submitAccessory(array $params): array
    {
        if (AppConfig::useRunpod()) {
            $result = self::mainVtonClient()->submitRun([
                'person_image'       => $params['person_image'],
                'garment_image'      => $params['accessory_image'],
                'category'           => 'tops',
                'garment_photo_type' => 'flat-lay',
                'prompt'             => (string) $params['prompt'],
                'seed'               => (int) ($params['seed'] ?? 42),
            ]);

            if ($result['status_code'] === 200 && !empty($result['prediction_id'])) {
                writeLog('INFO', 'Accessory try-on routed to FASHN VTON RunPod endpoint', ['job_id' => $result['prediction_id']]);
            }

            return $result;
        }

        // Fallback: Hugging Face Space first (when HF_TOKEN is set), else the
        // dedicated RunPod accessory endpoint.
        if (AppConfig::useHfAccessory()) {
            try {
                $jobId = AccessoryJobs::create(
                    $params['person_image'],
                    $params['accessory_image'],
                    (string)$params['prompt'],
                    (int)($params['seed'] ?? 42)
                );
            } catch (\Throwable $e) {
                writeLog('ERROR', 'Accessory job creation failed', ['message' => $e->getMessage()]);
                return ['status_code' => 500, 'prediction_id' => null, 'error_details' => 'Could not start accessory try-on: ' . $e->getMessage()];
            }
            writeLog('INFO', 'Accessory try-on routed to Hugging Face Space', ['job_id' => $jobId]);
            return ['status_code' => 200, 'prediction_id' => self::HF_ACCESSORY_JOB_PREFIX . $jobId, 'error_details' => null];
        }

        if (!AppConfig::useRunpodAccessory()) {
            writeLog('ERROR', 'Accessory try-on blocked: neither HF_TOKEN nor RUNPOD_ACCESSORY_ENDPOINT_ID is set');
            return [
                'status_code'   => 503,
                'prediction_id' => null,
                'error_details' => 'Accessory try-on is not configured. Add HF_TOKEN (or RUNPOD_ACCESSORY_ENDPOINT_ID) to .env.',
            ];
        }

        $result = self::accessoryClient()->submitAccessoryRun($params);

        if ($result['status_code'] === 200 && !empty($result['prediction_id'])) {
            $result['prediction_id'] = self::ACCESSORY_JOB_PREFIX . $result['prediction_id'];
            writeLog('INFO', 'Accessory try-on routed to RunPod accessory endpoint', ['job_id' => $result['prediction_id']]);
        }

        return $result;
    }

    private static function mainVtonClient(): RunpodVtonClient
    {
        return new RunpodVtonClient(AppConfig::runpodApiKey(), AppConfig::runpodEndpointId());
    }

    private static function accessoryClient(): RunpodVtonClient
    {
        return new RunpodVtonClient(AppConfig::runpodApiKey(), AppConfig::runpodAccessoryEndpointId());
    }

    private static function fashnClient(): FashnClient
    {
        return new FashnClient(AppConfig::fashnApiKey(), AppConfig::fashnMode());
    }
}
