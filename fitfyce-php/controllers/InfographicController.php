<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\AppConfig;
use TryFit\Db\MerchantRepo;
use TryFit\Db\WidgetSettingsRepo;
use VTON\ImageUtils;
use VTON\InfographicSkillLibrary;
use VTON\OpenAIClient;
use VTON\RagRetriever;

/**
 * Infographic generation — OpenAI only, no Fashn involved anywhere in this
 * flow. Pipeline per docs/skill.md's architecture:
 *  Step 1 — OpenAI (gpt-4o-mini vision) looks at the source photo itself and
 *           picks which of 11 categories (see InfographicSkillLibrary) it is,
 *           then which of that category's 3 named layouts suits it — this
 *           replaces the old merchant-picked style/category dropdowns.
 *  Step 2 — OpenAI (gpt-4o-mini) extracts and ranks this category's real
 *           attributes into Priority 1/2/3, selecting the top 3-4 as short
 *           verbatim phrases (category-tuned copy_pattern).
 *  Step 3 — OpenAI (gpt-4o-mini) assigns each selected item a semantic
 *           position/orientation/visual_connection within the chosen layout
 *           — the structured "Visual Generation Plan".
 *  Step 4 — OpenAI (gpt-image-1) composes the final infographic image from
 *           the source photo + the ranked items + the plan.
 *  Step 5 — OpenAI (gpt-4o-mini vision) scores the result on 6 metrics; a
 *           score below 8 triggers exactly one bounded auto-regenerate.
 *
 * SYNCHRONOUS DELIVERY — create()/generate()/edit() validate input,
 * download the source image(s), run the full pipeline above inline, and
 * respond with the finished result in one request/response cycle. Target
 * budget: ~60s end to end. Non-compose steps (classification, extraction,
 * scene/layout planning, QC) are fast — a few seconds each — so the
 * gpt-image-1 compose call is what the whole budget rides on; earlier live
 * testing measured a single compose call at quality 'medium' taking
 * 60-115s, i.e. sometimes the entire budget on its own with zero margin
 * left for anything else. RETRY_TIME_BUDGET_SECONDS (see
 * composeWithQualityGate()) keeps a low-scoring first attempt from
 * doubling that cost. If 60s can't be hit reliably at the current quality
 * tier/size once live-tested, the next lever is quality (currently
 * 'medium' in buildImageEditHandle()) — not attempted here since it's a
 * visible quality trade-off, not a free win. If synchronous delivery
 * becomes unworkable again regardless, the fix is an async submit-then-poll
 * job queue (this class briefly had one); deliberately not reintroduced
 * here per explicit request to revert to the simpler synchronous flow.
 */
class InfographicController
{
    // Maps a merchant-facing size choice to the literal dimensions gpt-image-1
    // accepts. Left unspecified (null), the caller falls back to the existing
    // category-based default (square for fmcg-like categories, portrait
    // otherwise) — category itself comes from the vision classification, not
    // a merchant picker.
    private const SIZE_MAP = [
        'square'    => '1024x1024',
        'portrait'  => '1024x1536',
        'landscape' => '1536x1024',
    ];

    // ── Public entry points ────────────────────────────────────────────────────

    /** Runs a full create pipeline (extract key points + compose) inline and responds with the finished result. */
    public function create(): void
    {
        try { $this->doCreate(); }
        catch (\Throwable $e) { $this->logAndRespond('create', $e); }
    }

    /** Step 1 only — extract key points via OpenAI. Fast (no image generation). */
    public function extract(): void
    {
        try { $this->doExtract(); }
        catch (\Throwable $e) { $this->logAndRespond('extract', $e); }
    }

    /** Runs a generate/regenerate pipeline from pre-extracted key points inline and responds with the finished result. */
    public function generate(): void
    {
        try { $this->doGenerate(); }
        catch (\Throwable $e) { $this->logAndRespond('generate', $e); }
    }

    /** Applies a merchant-written edit prompt to an already-generated infographic and responds with the finished result. */
    public function edit(): void
    {
        try { $this->doEdit(); }
        catch (\Throwable $e) { $this->logAndRespond('edit', $e); }
    }

    private function logAndRespond(string $action, \Throwable $e): void
    {
        writeLog('ERROR', "Infographic {$action} failed", [
            'message' => $e->getMessage(),
            'class'   => get_class($e),
            'file'    => $e->getFile() . ':' . $e->getLine(),
        ]);
        respondJson(['error' => $e->getMessage()], 500);
    }

    // ── /infographic/create ─────────────────────────────────────────────────────

    private function doCreate(): void
    {
        // Runs the whole pipeline inline — classification, extraction,
        // scene/layout planning, compose, QC — so this needs real headroom,
        // not just enough for validation/download. See RETRY_TIME_BUDGET_SECONDS
        // for how the bounded QC retry avoids blowing past an external
        // proxy/tunnel timeout on top of this.
        @set_time_limit(200);

        $openai   = $this->requireOpenAI();
        $merchant = $this->resolveMerchant();
        if ($merchant === null) { return; }
        $merchantId = (int)$merchant['id'];

        $payload         = $this->readJson();
        $description     = trim((string)($payload['description'] ?? ''));
        $imageUrl        = trim((string)($payload['product_image_url'] ?? ''));
        $referenceUrl    = trim((string)($payload['reference_image_url'] ?? ''));
        $customStyle     = trim((string)($payload['custom_style_prompt'] ?? ''));
        $size            = $this->resolveSize((string)($payload['size'] ?? ''));
        $productId       = $this->readProductId($payload);
        $collage         = (bool)($payload['collage'] ?? false);

        // A selected product supplies its own facts — free-text description
        // becomes optional supplementary notes once product_id is set.
        if ($description === '' && $productId === null) { respondJson(['error' => 'description is required'], 400); return; }
        if ($imageUrl    === '') { respondJson(['error' => 'product_image_url is required'], 400); return; }

        $tempPath = $this->downloadImage($imageUrl);
        if ($tempPath === null) {
            respondJson(['error' => 'Could not load the product image. Check the URL and try again.'], 400);
            return;
        }

        $referenceTempPath = null;
        if ($referenceUrl !== '') {
            $referenceTempPath = $this->downloadImage($referenceUrl);
            if ($referenceTempPath === null) {
                @unlink($tempPath);
                respondJson(['error' => 'Could not load the reference image. Check the URL and try again.'], 400);
                return;
            }
        }

        try {
            $result = $this->runCreatePipeline($openai, $merchantId, [
                'description'  => $description,
                'custom_style' => $customStyle,
                'size'         => $size,
                'product_id'   => $productId,
                'collage'      => $collage,
            ], $tempPath, $referenceTempPath, microtime(true));
        } finally {
            @unlink($tempPath);
            if ($referenceTempPath !== null) { @unlink($referenceTempPath); }
        }

        respondJson($result);
    }

    // ── /infographic/extract-points (unchanged, synchronous — no image generation) ──

    private function doExtract(): void
    {
        $openai   = $this->requireOpenAI();
        $merchant = $this->resolveMerchant();
        if ($merchant === null) { return; }
        $merchantId = (int)$merchant['id'];

        $payload     = $this->readJson();
        $description = trim((string)($payload['description'] ?? ''));
        $productId   = $this->readProductId($payload);
        if ($description === '' && $productId === null) { respondJson(['error' => 'description is required'], 400); return; }

        $knowledge = $this->buildKnowledge($openai, $merchantId, $productId);
        $keyPoints = $openai->extractKeyPointsGrounded($description, $knowledge);
        if (empty($keyPoints)) {
            respondJson(['error' => 'Could not extract key points — try rephrasing the description.'], 422);
            return;
        }
        respondJson(['key_points' => $keyPoints, 'sources' => $this->toSources($knowledge)]);
    }

    // ── /infographic/generate ───────────────────────────────────────────────────

    private function doGenerate(): void
    {
        @set_time_limit(200); // see doCreate() — runs the whole pipeline inline

        $merchant = $this->resolveMerchant();
        if ($merchant === null) { return; }
        $merchantId = (int)$merchant['id'];
        $openai = $this->requireOpenAI();

        $payload      = $this->readJson();
        $imageUrl     = trim((string)($payload['product_image_url'] ?? ''));
        $referenceUrl = trim((string)($payload['reference_image_url'] ?? ''));
        $description  = trim((string)($payload['description'] ?? ''));
        $customStyle  = trim((string)($payload['custom_style_prompt'] ?? ''));
        $variation    = max(1, min(5, (int)($payload['variation'] ?? 1)));
        $size         = $this->resolveSize((string)($payload['size'] ?? ''));
        $collage      = (bool)($payload['collage'] ?? false);
        $keyPoints = array_values(array_filter(
            array_map(fn($p) => is_string($p) ? trim($p) : null, (array)($payload['key_points'] ?? [])),
            fn($p) => $p !== null && $p !== ''
        ));
        // "Regenerate" variety — layout ids already shown for this exact
        // product earlier in this gallery session, so the Vision Agent picks
        // a genuinely different one instead of re-styling the same pick.
        $excludeLayouts = array_values(array_filter(
            array_map(fn($p) => is_string($p) ? trim($p) : null, (array)($payload['exclude_archetypes'] ?? [])),
            fn($p) => $p !== null && $p !== ''
        ));

        if ($imageUrl    === '') { respondJson(['error' => 'product_image_url is required'], 400); return; }
        if (empty($keyPoints)) { respondJson(['error' => 'key_points array is required'], 400); return; }

        $tempPath = $this->downloadImage($imageUrl);
        if ($tempPath === null) {
            respondJson(['error' => 'Could not load the product image. Check the URL and try again.'], 400);
            return;
        }

        $referenceTempPath = null;
        if ($referenceUrl !== '') {
            $referenceTempPath = $this->downloadImage($referenceUrl);
            if ($referenceTempPath === null) {
                @unlink($tempPath);
                respondJson(['error' => 'Could not load the reference image. Check the URL and try again.'], 400);
                return;
            }
        }

        try {
            $result = $this->runGeneratePipeline($openai, $merchantId, [
                'description'     => $description,
                'custom_style'    => $customStyle,
                'variation'       => $variation,
                'size'            => $size,
                'collage'         => $collage,
                'key_points'      => $keyPoints,
                'exclude_layouts' => $excludeLayouts,
            ], $tempPath, $referenceTempPath, microtime(true));
        } finally {
            @unlink($tempPath);
            if ($referenceTempPath !== null) { @unlink($referenceTempPath); }
        }

        respondJson($result);
    }

    // ── /infographic/edit ───────────────────────────────────────────────────────

    private function doEdit(): void
    {
        @set_time_limit(200); // see doCreate() — runs the whole pipeline inline

        $openai   = $this->requireOpenAI();
        $merchant = $this->resolveMerchant();
        if ($merchant === null) { return; }
        $merchantId = (int)$merchant['id'];

        $payload      = $this->readJson();
        $imageUrl     = trim((string)($payload['image_url'] ?? ''));
        $editPrompt   = trim((string)($payload['edit_prompt'] ?? ''));
        $bgImageUrl   = trim((string)($payload['background_image_url'] ?? ''));

        if ($imageUrl   === '') { respondJson(['error' => 'image_url is required'], 400); return; }
        if ($editPrompt === '') { respondJson(['error' => 'edit_prompt is required'], 400); return; }

        $tempPath = $this->downloadImage($imageUrl);
        if ($tempPath === null) {
            respondJson(['error' => 'Could not load the image to edit. Check the URL and try again.'], 400);
            return;
        }

        $bgTempPath = null;
        if ($bgImageUrl !== '') {
            $bgTempPath = $this->downloadImage($bgImageUrl);
            if ($bgTempPath === null) {
                @unlink($tempPath);
                respondJson(['error' => 'Could not load the background image. Check the URL and try again.'], 400);
                return;
            }
        }

        try {
            $result = $this->runEditPipeline($openai, $merchantId, ['edit_prompt' => $editPrompt], $tempPath, $bgTempPath);
        } finally {
            @unlink($tempPath);
            if ($bgTempPath !== null) { @unlink($bgTempPath); }
        }

        respondJson($result);
    }

    /**
     * Diagnostic timing instrumentation — logs elapsed time since
     * $requestStartedAt at each pipeline checkpoint. Added specifically to
     * pinpoint which step consumes the time in a slow generation
     * (classification vs extraction vs scene/layout planning vs the compose
     * call itself vs QC checking) without having to guess — search
     * logs/app.log for 'Infographic pipeline stage' to see the timeline of
     * a given request.
     */
    private function logStage(string $stage, float $requestStartedAt): void
    {
        writeLog('INFO', 'Infographic pipeline stage', [
            'stage'       => $stage,
            'elapsed_sec' => round(microtime(true) - $requestStartedAt, 1),
        ]);
    }

    /** The pipeline behind doCreate() — validates/downloads happen in the caller; this runs classification → extraction → scene/layout planning → compose+QC and returns the finished result array for doCreate() to respondJson(). */
    private function runCreatePipeline(OpenAIClient $openai, int $merchantId, array $params, string $tempPath, ?string $referenceTempPath, float $requestStartedAt): array
    {
        $description = (string)($params['description'] ?? '');
        $customStyle = (string)($params['custom_style'] ?? '');
        $size        = isset($params['size']) && is_string($params['size']) ? $params['size'] : null;
        $productId   = isset($params['product_id']) ? (int)$params['product_id'] : null;
        $collage     = (bool)($params['collage'] ?? false);

        $knowledge = $this->buildKnowledge($openai, $merchantId, $productId);

        // Reference mode — merchant supplied an example infographic to
        // replicate, instead of asking the Vision Agent to pick one of
        // InfographicSkillLibrary's layouts. Takes priority over collage
        // (a reference image implies a single matched image, not 4 panels).
        // Keeps today's flag-only quality behavior (no bounded QC retry) —
        // "closer to my exact reference" doesn't map onto a numeric score
        // the same way a layout-driven generation does.
        if ($referenceTempPath !== null) {
            $refPlan = $this->resolveReferenceGuide($openai, $referenceTempPath);

            $structured = $this->resolveStructuredInfo($openai, $description, $knowledge, $refPlan['category']);
            $keyPoints  = $structured['key_points'];
            if (empty($keyPoints)) {
                throw new \RuntimeException('Could not extract key points — try rephrasing the description.');
            }

            $scenePlan = $this->planScene($openai, $keyPoints, $refPlan['layout_name'], 'reference');
            $composed  = $this->composeFromPath($openai, $merchantId, $tempPath, $keyPoints, $refPlan, $description, $customStyle, $refPlan['category'], 1, $size, null, $scenePlan, $referenceTempPath);
            $quality   = $this->checkQuality($openai, $composed['bytes'], $keyPoints);

            return [
                'results'    => $this->toResults($composed['url'], 'reference-match', 'Reference Match', 1),
                'key_points' => $keyPoints,
                'sources'    => $this->toSources($knowledge),
                'quality'    => $quality,
                'archetype'  => ['category' => null, 'id' => 'reference-match', 'name' => 'Reference Match'],
            ];
        }

        // Collage mode produces 4 separate images (see composeCollageFromPath)
        // instead of running the layout-driven single-image pipeline below —
        // it uses fixed named palettes rather than a per-generation category
        // classification, so key points are extracted without a category hint.
        if ($collage) {
            $keyPoints = $openai->extractKeyPointsGrounded($description, $knowledge);
            if (empty($keyPoints)) {
                throw new \RuntimeException('Could not extract key points — try rephrasing the description.');
            }
            $results = $this->composeCollageFromPath($openai, $merchantId, $tempPath, $keyPoints, $description, $customStyle, $size);
            return ['results' => $results, 'key_points' => $keyPoints, 'sources' => $this->toSources($knowledge)];
        }

        // Step 1 — Vision Agent: look at the actual photo and pick which
        // real category + named layout suits it (see planVisualGeneration()).
        // Runs before extraction — category detection only needs the
        // photo, not the ranked items yet.
        $plan = $this->resolveVisualPlan($openai, $tempPath, $description);
        $this->logStage('classification_done', $requestStartedAt);

        // Step 2 — Research + Ranking Agent: extract and priority-rank
        // this category's real attributes (see InfographicSkillLibrary),
        // tuned to its copy_pattern — e.g. FMCG reads as a benefit-led
        // claim, apparel as a construction-detail noun phrase.
        $structured = $this->resolveStructuredInfo($openai, $description, $knowledge, $plan['category']);
        $keyPoints  = $structured['key_points'];
        if (empty($keyPoints)) {
            throw new \RuntimeException('Could not extract key points — try rephrasing the description.');
        }
        $this->logStage('extraction_done', $requestStartedAt);

        // Step 3 — Layout Planning Agent (structured): assign each
        // ranked item a position/orientation/visual_connection within
        // the chosen layout (the Visual Generation Plan), run
        // CONCURRENTLY with Step 4's scene plan — see
        // resolveSceneAndLayout()/OpenAIClient::planSceneAndLayout().
        $brandColors    = $this->buildBrandColors($merchantId);
        $sceneAndLayout = $this->resolveSceneAndLayout($openai, $keyPoints, $structured['ranked'], $plan['category'], $plan['layout_id'], $plan['layout_name']);
        $plan['information'] = $sceneAndLayout['information'];
        $scenePlan            = $sceneAndLayout['scenePlan'];
        $this->logStage('scene_and_layout_done', $requestStartedAt);

        // Step 4 — render + validate with the bounded QC retry gate.
        $gated = $this->composeWithQualityGate($openai, $merchantId, $tempPath, $keyPoints, $plan, $description, $customStyle, $plan['category'], 1, $size, $brandColors, $scenePlan, $requestStartedAt);
        $this->logStage('compose_and_qc_done', $requestStartedAt);

        return [
            'results'    => $this->toResults($gated['composed']['url'], $plan['layout_id'], $plan['layout_name'], 1),
            'key_points' => $keyPoints,
            'sources'    => $this->toSources($knowledge),
            'quality'    => $gated['quality'],
            'archetype'  => [
                'category' => $plan['category'],
                'id'       => $plan['layout_id'],
                'name'     => $plan['layout_name'],
            ],
        ];
    }

    /** The pipeline behind doGenerate() — same treatment as runCreatePipeline(). */
    private function runGeneratePipeline(OpenAIClient $openai, int $merchantId, array $params, string $tempPath, ?string $referenceTempPath, float $requestStartedAt): array
    {
        $description    = (string)($params['description'] ?? '');
        $customStyle    = (string)($params['custom_style'] ?? '');
        $variation      = (int)($params['variation'] ?? 1);
        $size           = isset($params['size']) && is_string($params['size']) ? $params['size'] : null;
        $collage        = (bool)($params['collage'] ?? false);
        $keyPoints      = is_array($params['key_points'] ?? null) ? array_values($params['key_points']) : [];
        $excludeLayouts = is_array($params['exclude_layouts'] ?? null) ? array_values($params['exclude_layouts']) : [];

        if ($referenceTempPath !== null) {
            $refPlan   = $this->resolveReferenceGuide($openai, $referenceTempPath);
            $scenePlan = $this->planScene($openai, $keyPoints, $refPlan['layout_name'], 'reference');
            $composed  = $this->composeFromPath($openai, $merchantId, $tempPath, $keyPoints, $refPlan, $description, $customStyle, $refPlan['category'], $variation, $size, null, $scenePlan, $referenceTempPath);
            $quality   = $this->checkQuality($openai, $composed['bytes'], $keyPoints);

            return [
                'results'    => $this->toResults($composed['url'], 'reference-match', 'Reference Match', $variation),
                'key_points' => $keyPoints,
                'quality'    => $quality,
                'archetype'  => ['category' => null, 'id' => 'reference-match', 'name' => 'Reference Match'],
            ];
        }

        if ($collage) {
            $results = $this->composeCollageFromPath($openai, $merchantId, $tempPath, $keyPoints, $description, $customStyle, $size);
            return ['results' => $results, 'key_points' => $keyPoints];
        }

        // Vision Agent runs fresh on every generate call (including
        // "Regenerate") rather than trusting stale client-side state.
        // $excludeLayouts (already-shown layout ids this session) is a
        // hard filter, not just a hint — see
        // OpenAIClient::planVisualGeneration() — so each "Regenerate"
        // click is structurally forced to try a genuinely different
        // named layout instead of just re-styling the same one
        // gpt-4o-mini would otherwise reliably re-pick.
        $plan = $this->resolveVisualPlan($openai, $tempPath, $description, $excludeLayouts);

        // key_points are already given by the client for regenerate — no
        // re-extraction here (that would risk producing different text
        // than what the client already has, which annotateInformation()
        // would then just fail to match anyway). Ranked metadata is
        // rebuilt directly from the given key_points instead, with a
        // generic priority/type (assignInformationLayout() only needs
        // 'type' to decide whether a label should get a visual_connection
        // at all — without it, every label just gets position/orientation).
        $ranked = array_map(fn($t) => ['text' => $t, 'priority' => 1, 'type' => null], $keyPoints);

        // Design Agent context — same brand-color/scene-plan grounding as
        // runCreatePipeline(), run CONCURRENTLY with the layout assignment
        // (see resolveSceneAndLayout()).
        $brandColors    = $this->buildBrandColors($merchantId);
        $sceneAndLayout = $this->resolveSceneAndLayout($openai, $keyPoints, $ranked, $plan['category'], $plan['layout_id'], $plan['layout_name']);
        $plan['information'] = $sceneAndLayout['information'];
        $scenePlan            = $sceneAndLayout['scenePlan'];

        $gated = $this->composeWithQualityGate($openai, $merchantId, $tempPath, $keyPoints, $plan, $description, $customStyle, $plan['category'], $variation, $size, $brandColors, $scenePlan, $requestStartedAt);

        return [
            'results'    => $this->toResults($gated['composed']['url'], $plan['layout_id'], $plan['layout_name'], $variation),
            'key_points' => $keyPoints,
            'quality'    => $gated['quality'],
            'archetype'  => [
                'category' => $plan['category'],
                'id'       => $plan['layout_id'],
                'name'     => $plan['layout_name'],
            ],
        ];
    }

    /** The pipeline behind doEdit(). */
    private function runEditPipeline(OpenAIClient $openai, int $merchantId, array $params, string $tempPath, ?string $bgTempPath): array
    {
        $editPrompt = (string)($params['edit_prompt'] ?? '');
        $imageBytes = $openai->editInfographicImage($tempPath, $editPrompt, $bgTempPath);
        $resultUrl  = $this->saveGenerated($imageBytes, $merchantId);
        return ['results' => $this->toResults($resultUrl, 'edited', 'Edited', 1)];
    }

    /**
     * The frontend (InfographicAddon + the standalone Marketing Infographic
     * workflow) renders a gallery of `{key, label, image}` entries — this
     * endpoint only ever produces one image per request, so wrap it as a
     * single-element array to match that contract. $variation is folded into
     * `key` so repeated "Regenerate" calls produce unique React keys when the
     * frontend appends results into the same gallery array. $slug is a stable
     * id (the layout id "{category}-{A|B|C}", or 'edited'/'reference-match')
     * used only for key uniqueness — the frontend also parses it back out to
     * build the "Regenerate" exclude-list (see archetypeIdFromResultKey() in
     * app.studio.create.jsx). $label is the human-readable name shown in the UI.
     */
    private function toResults(string $resultUrl, string $slug, string $label, int $variation): array
    {
        return [[
            'key'   => $slug . '-v' . $variation,
            'label' => $variation > 1 ? "Variation {$variation}" : $label,
            'image' => $resultUrl,
        ]];
    }

    // ── OpenAI infographic composer ───────────────────────────────────────────

    /**
     * Vision Agent — resolves which category + named layout suits
     * $tempPath's actual photo (see OpenAIClient::planVisualGeneration()).
     * Never throws; falls back to a safe generic apparel guide so a
     * classification hiccup (network error, unparseable response) never
     * blocks generation outright.
     */
    private function resolveVisualPlan(OpenAIClient $openai, string $tempPath, string $description, array $excludeLayoutIds = []): array
    {
        try {
            $result = $openai->planVisualGeneration($tempPath, $description, $excludeLayoutIds);
        } catch (\Throwable $e) {
            // Swallowed by design (falls back to a safe generic plan below,
            // never blocks generation) — but logged, not silent, so a real
            // OpenAI failure (rate limit, timeout, malformed response) is
            // diagnosable instead of just quietly downgrading to the fallback.
            writeLog('WARN', 'planVisualGeneration failed, using fallback plan', ['message' => $e->getMessage()]);
            $result = [];
        }
        if (!empty($result)) {
            return $result;
        }

        return [
            'category'       => 'clothing',
            'layout_id'      => 'clothing-A',
            'layout_name'    => 'Garment Hero + Callouts',
            'look'           => 'a clean studio background with a soft gradient and generous negative space around the product',
            'labels'         => 'clean sans-serif callout labels, each connected to a specific point on the product with a thin straight leader line',
            'extra_elements' => '',
        ];
    }

    /**
     * Research + Ranking Agent — resolves this category's priority-ranked
     * information (see OpenAIClient::extractStructuredInfo()). Never
     * throws; falls back to an empty ranked/key_points pair, which callers
     * treat as "could not extract key points" (extractStructuredInfo()
     * itself already falls back to the plain flat extraction internally on
     * an empty/unusable model response, so this catch only fires for a hard
     * failure of the underlying OpenAI call itself — a rate limit, timeout,
     * or network error, not "the description had nothing extractable").
     * That distinction matters: this is the one step whose failure directly
     * surfaces to the merchant as "Could not extract key points — try
     * rephrasing the description", which is misleading if the real cause
     * was an API/network hiccup — so it's logged here rather than silently
     * swallowed, to make that distinguishable after the fact.
     */
    private function resolveStructuredInfo(OpenAIClient $openai, string $description, array $knowledge, string $category): array
    {
        try {
            return $openai->extractStructuredInfo($description, $knowledge, $category);
        } catch (\Throwable $e) {
            // $e's CLASS is the fastest way to tell apart a genuine OpenAI
            // failure (\RuntimeException — rate limit, timeout, network) from
            // a code/deploy mismatch (\Error, e.g. "Call to undefined method
            // InfographicSkillLibrary::extractionFields()" — meaning this
            // request landed on a NEW OpenAIClient.php calling a method that
            // doesn't exist on an OLD, not-yet-updated InfographicSkillLibrary.php
            // still on the server; all changed infographic files must be
            // uploaded together, never partially).
            writeLog('ERROR', 'extractStructuredInfo failed (will surface as "Could not extract key points")', [
                'class'    => get_class($e),
                'message'  => $e->getMessage(),
                'file'     => $e->getFile() . ':' . $e->getLine(),
                'category' => $category,
            ]);
            return ['ranked' => [], 'key_points' => []];
        }
    }

    /**
     * Layout Planning Agent, structured variant — resolves each ranked
     * item's position/orientation/visual_connection AND the scene's
     * headline/reading-order plan in ONE dispatch, run CONCURRENTLY via
     * OpenAIClient::planSceneAndLayout() instead of two sequential calls
     * (the old resolveInformationLayout() + planScene() pair) — pure
     * latency trim, same two underlying OpenAI calls either way. Never
     * throws; falls back to null scene plan / [] information (identical to
     * what calling the two old methods separately would produce on
     * failure — generateInfographicImage() already treats an empty/absent
     * 'information' array as "no per-item enrichment").
     *
     * @return array{scenePlan: ?array, information: array}
     */
    private function resolveSceneAndLayout(OpenAIClient $openai, array $keyPoints, array $ranked, string $category, string $layoutId, string $layoutName): array
    {
        if (empty($ranked)) return ['scenePlan' => $this->planScene($openai, $keyPoints, $layoutName, $category), 'information' => []];
        try {
            $result = $openai->planSceneAndLayout($keyPoints, $ranked, $category, $layoutId, $layoutName);
        } catch (\Throwable $e) {
            writeLog('WARN', 'planSceneAndLayout failed, falling back to no scene plan / unenriched information', ['message' => $e->getMessage()]);
            return ['scenePlan' => null, 'information' => []];
        }
        $scenePlan   = !empty($result['scenePlan']) ? $result['scenePlan'] : null;
        $information = is_array($result['information'] ?? null) ? $result['information'] : [];
        return ['scenePlan' => $scenePlan, 'information' => $information];
    }

    /**
     * "Match a reference" mode — transcribes $referenceTempPath's actual
     * visual design into the same {look, labels, extra_elements} shape
     * resolveVisualPlan() produces (see OpenAIClient::analyzeReferenceDesign()),
     * instead of picking a layout from InfographicSkillLibrary. Never
     * throws; falls back to a safe generic guide on any failure.
     */
    private function resolveReferenceGuide(OpenAIClient $openai, string $referenceTempPath): array
    {
        try {
            $result = $openai->analyzeReferenceDesign($referenceTempPath);
        } catch (\Throwable $e) {
            writeLog('WARN', 'analyzeReferenceDesign failed, using fallback reference guide', ['message' => $e->getMessage()]);
            $result = [];
        }
        if (!empty($result)) {
            return $result;
        }

        return [
            'category'       => 'clothing',
            'layout_id'      => 'reference-match',
            'layout_name'    => 'Reference Match',
            'look'           => 'a clean studio background matching the reference image as closely as possible',
            'labels'         => 'callout labels matching the reference image\'s label shape and connector style as closely as possible',
            'extra_elements' => '',
        ];
    }

    /**
     * $tempPath is a locally-downloaded copy of either the Fashn-generated
     * model/result photo from one of the try-on workflows, or a photo the
     * merchant uploaded directly — both are just a source image handed to
     * OpenAI's image model. Fashn is never called from this class. Caller
     * owns $tempPath's lifecycle (download + cleanup) since the same
     * download is reused across classification, extraction, and this
     * composition step. $referenceImagePath (optional, "match a reference"
     * mode only) is passed straight through to generateInfographicImage() as
     * secondary visual corroboration alongside $plan's text spec.
     *
     * @return array{url: string, bytes: string} bytes are returned too so callers can run checkInfographicQuality() without re-reading the saved file.
     */
    private function composeFromPath(
        OpenAIClient $openai,
        int $merchantId,
        string $tempPath,
        array $keyPoints,
        array $plan,
        string $description = '',
        string $customStylePrompt = '',
        string $category = 'clothing',
        int $variation = 1,
        ?string $size = null,
        ?array $brandColors = null,
        ?array $scenePlan = null,
        ?string $referenceImagePath = null
    ): array {
        $imageBytes = $openai->generateInfographicImage(
            $tempPath, $keyPoints, $plan, $description, $customStylePrompt, $category, $variation, $size,
            $brandColors, $scenePlan, $referenceImagePath
        );

        return ['url' => $this->saveGenerated($imageBytes, $merchantId), 'bytes' => $imageBytes];
    }

    /**
     * QC Agent gate — runs composeFromPath()+checkQuality(), and if the
     * score comes back below 8, regenerates EXACTLY ONCE more (never an
     * unbounded loop) and keeps whichever of the two attempts scored higher.
     * Only used by the layout-driven (non-reference, non-collage) path — see
     * runCreatePipeline()/runGeneratePipeline()'s docblocks for why
     * reference/collage skip this.
     *
     * $requestStartedAt (microtime(true) from the top of doCreate()/
     * doGenerate()) gates the retry via RETRY_TIME_BUDGET_SECONDS so a
     * second gpt-image-1 compose call never risks pushing this synchronous
     * request past the ~60s target (see class docblock) on top of the first
     * attempt's own cost — a single compose+QC cycle alone has measured
     * 60-115s at quality 'medium' in earlier live testing, i.e. often the
     * ENTIRE budget by itself. Set low (not 35s as in the old async-era
     * version, where a second external timeout was the only real ceiling)
     * so a retry only ever fires when the first attempt finished unusually
     * fast, leaving genuine headroom — never as a routine "try again"
     * against a tight wall-clock target. Optional/nullable so any future
     * caller that doesn't track a start time still gets the old
     * always-retry behavior.
     *
     * @return array{composed: array{url: string, bytes: string}, quality: array}
     */
    private const RETRY_TIME_BUDGET_SECONDS = 15.0;

    private function composeWithQualityGate(
        OpenAIClient $openai,
        int $merchantId,
        string $tempPath,
        array $keyPoints,
        array $plan,
        string $description,
        string $customStylePrompt,
        string $category,
        int $variation,
        ?string $size,
        ?array $brandColors,
        ?array $scenePlan,
        ?float $requestStartedAt = null
    ): array {
        if ($requestStartedAt !== null) { $this->logStage('compose_1_start', $requestStartedAt); }
        $composed = $this->composeFromPath($openai, $merchantId, $tempPath, $keyPoints, $plan, $description, $customStylePrompt, $category, $variation, $size, $brandColors, $scenePlan);
        if ($requestStartedAt !== null) { $this->logStage('compose_1_done', $requestStartedAt); }
        $quality  = $this->checkQuality($openai, $composed['bytes'], $keyPoints);
        if ($requestStartedAt !== null) { $this->logStage('qc_1_done', $requestStartedAt); }

        if ($quality['checked'] && (float)($quality['overall_score'] ?? 10.0) < 8.0) {
            $elapsed = $requestStartedAt !== null ? (microtime(true) - $requestStartedAt) : 0.0;
            if ($requestStartedAt === null || $elapsed < self::RETRY_TIME_BUDGET_SECONDS) {
                if ($requestStartedAt !== null) { $this->logStage('compose_2_start', $requestStartedAt); }
                $retryComposed = $this->composeFromPath($openai, $merchantId, $tempPath, $keyPoints, $plan, $description, $customStylePrompt, $category, $variation + 1, $size, $brandColors, $scenePlan);
                if ($requestStartedAt !== null) { $this->logStage('compose_2_done', $requestStartedAt); }
                $retryQuality  = $this->checkQuality($openai, $retryComposed['bytes'], $keyPoints);
                if ($requestStartedAt !== null) { $this->logStage('qc_2_done', $requestStartedAt); }
                if ((float)($retryQuality['overall_score'] ?? 0.0) >= (float)($quality['overall_score'] ?? 0.0)) {
                    $composed = $retryComposed;
                    $quality  = $retryQuality;
                }
            } else {
                writeLog('INFO', 'Skipped QC bounded retry — already over time budget', ['elapsed_seconds' => round($elapsed, 1)]);
            }
        }

        return ['composed' => $composed, 'quality' => $quality];
    }

    /**
     * Collage mode produces 4 separate standalone images (hero, two detail
     * zooms, features) instead of one — this saves each and returns 4
     * gallery entries instead of the single-element array toResults() makes.
     * Same $tempPath-reuse contract as composeFromPath().
     */
    private function composeCollageFromPath(
        OpenAIClient $openai,
        int $merchantId,
        string $tempPath,
        array $keyPoints,
        string $description,
        string $customStylePrompt,
        ?string $size = null
    ): array {
        $panels = $openai->generateCollagePanels($tempPath, $keyPoints, $description, $customStylePrompt, $size);

        $labels = [
            'hero'     => 'Hero Shot',
            'detail1'  => 'Detail 1',
            'detail2'  => 'Detail 2',
            'features' => 'Features',
        ];

        $results = [];
        foreach ($panels as $key => $bytes) {
            $results[] = [
                'key'   => 'collage-' . $key . '-' . uniqid('', true),
                'label' => $labels[$key] ?? ucfirst($key),
                'image' => $this->saveGenerated($bytes, $merchantId),
            ];
        }
        return $results;
    }

    /**
     * Writes a generated infographic to EPHEMERAL storage
     * (AppConfig::resultsDir()) so the merchant's browser has a real URL to
     * load — not permanent, not S3, not recorded in the asset library. Per
     * explicit merchant direction: the Studio module's infographic flow
     * should just run the RAG-grounded generation pipeline and show the
     * result, without any persistent-storage machinery — auto-cleaned after
     * AppConfig::resultsTtlHours() by cron/cleanup_results.php, the same
     * TTL-cleanup path every other ephemeral result in this app already
     * uses. $merchantId is unused here (kept in the signature only to
     * match every caller/overload of composeFromPath()/
     * composeCollageFromPath(), which still need it for other bookkeeping).
     */
    private function saveGenerated(string $imageBytes, int $merchantId): string
    {
        $dir = AppConfig::resultsDir();
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }

        $filename = 'infographic_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.png';
        $outPath  = $dir . DIRECTORY_SEPARATOR . $filename;
        if (!ImageUtils::saveImageBytes($imageBytes, $outPath)) {
            throw new \RuntimeException('Failed to save the generated infographic.');
        }

        return baseUrl() . basePath() . '/results/' . $filename;
    }

    // ── Shared helpers ─────────────────────────────────────────────────────────

    /** Fails fast with a real HTTP response (respondJson()+exit) if OpenAI isn't configured. */
    private function requireOpenAI(): OpenAIClient
    {
        $key = AppConfig::openAiApiKey();
        if ($key === '') {
            respondJson(['error' => 'OpenAI API key is not configured.'], 503);
            exit;
        }
        return new OpenAIClient($key);
    }

    /** Auth check, returning the merchant row so callers can get merchant_id for RAG/brand/asset-library lookups. */
    private function resolveMerchant(): ?array
    {
        $shop = trim((string)($_GET['shop'] ?? ''));
        if ($shop === '') { respondJson(['error' => 'shop parameter is required'], 400); return null; }
        $mRepo    = new MerchantRepo();
        $merchant = $mRepo->findByDomain($shop) ?? $mRepo->findByDomainLike($shop);
        if ($merchant === null || (int)$merchant['is_active'] !== 1) {
            respondJson(['error' => 'Unauthorized'], 401);
            return null;
        }
        return $merchant;
    }

    /**
     * Research Agent — retrieves grounded product facts when $productId is
     * given. Always returns [] (never throws) on any failure, so callers'
     * fallback to the plain ungrounded flow is unconditional.
     */
    private function buildKnowledge(OpenAIClient $openai, int $merchantId, ?int $productId): array
    {
        if ($productId === null) return [];
        try {
            return (new RagRetriever($openai))->retrieve($merchantId, $productId);
        } catch (\Throwable $e) {
            return [];
        }
    }

    /** Dedupe knowledge chunks down to the source list the wizard shows as provenance. */
    private function toSources(array $knowledge): array
    {
        $seen = [];
        $sources = [];
        foreach ($knowledge as $k) {
            $key = ($k['source_type'] ?? '') . ':' . ($k['source_id'] ?? '');
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            $sources[] = ['title' => $k['title'] ?? '', 'source_type' => $k['source_type'] ?? ''];
        }
        return $sources;
    }

    private function readProductId(array $payload): ?int
    {
        $raw = $payload['product_id'] ?? null;
        return ($raw !== null && $raw !== '') ? (int)$raw : null;
    }

    /**
     * Design Agent context, sourced directly from SQL (WidgetSettingsRepo)
     * rather than a vector search — the merchant's brand colors are a single
     * row, not a retrieval problem. Never throws.
     */
    private function buildBrandColors(int $merchantId): array
    {
        try {
            return (new WidgetSettingsRepo())->getButtonConfig($merchantId);
        } catch (\Throwable $e) {
            return [];
        }
    }

    /** Layout Planning Agent (emphasis/order, not position) — only called from the non-collage path. Never throws. */
    private function planScene(OpenAIClient $openai, array $keyPoints, string $layoutName, string $category): ?array
    {
        if (empty($keyPoints)) return null;
        try {
            $plan = $openai->planInfographicScene($keyPoints, $layoutName, $category);
            return !empty($plan) ? $plan : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * QC Agent — scored quality check (see OpenAIClient::checkInfographicQuality()).
     * Only called from the non-collage path. Never throws — a failed check must not
     * block the result, and defaults to a permissive passing score so it can never
     * itself trigger composeWithQualityGate()'s retry.
     */
    private function checkQuality(OpenAIClient $openai, string $imageBytes, array $keyPoints): array
    {
        try {
            $q = $openai->checkInfographicQuality($imageBytes, $keyPoints);
            return ['checked' => true] + $q;
        } catch (\Throwable $e) {
            return ['checked' => false, 'pass' => true, 'overall_score' => 10.0, 'issues' => []];
        }
    }

    /** Returns null (meaning "use the category-based default") for anything not a recognized size key. */
    private function resolveSize(string $raw): ?string
    {
        $s = strtolower(trim($raw));
        return self::SIZE_MAP[$s] ?? null;
    }

    private function readJson(): array
    {
        $decoded = json_decode((string)file_get_contents('php://input'), true);
        return is_array($decoded) ? $decoded : [];
    }

    private function downloadImage(string $url): ?string
    {
        if ($url === '') return null;

        if (!str_starts_with($url, 'http')) {
            $local = dirname(__DIR__) . '/' . ltrim($url, '/');
            return is_readable($local) ? $local : null;
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        $bytes = curl_exec($ch);
        $code  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if (!$bytes || $code >= 400) return null;

        $ext  = preg_match('/\.(jpe?g|png|webp)$/i', $url, $m) ? '.' . $m[1] : '.jpg';
        $path = sys_get_temp_dir() . '/infographic_' . uniqid('', true) . $ext;
        file_put_contents($path, $bytes);
        return $path;
    }
}
