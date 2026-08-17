<?php

declare(strict_types=1);

namespace VTON;

/**
 * Client for the OpenAI API (chat completions + image generation).
 * Base URL   : https://api.openai.com/v1
 * Chat model : gpt-4o-mini   (key-point extraction, ranking, layout planning)
 * Image model: gpt-image-1   (infographic composition — no Fashn involved)
 */
class OpenAIClient
{
    private const BASE_URL       = 'https://api.openai.com/v1';
    private const CHAT_MODEL     = 'gpt-4o-mini';
    private const IMAGE_MODEL    = 'gpt-image-1';
    private const EMBEDDING_MODEL = 'text-embedding-3-small';

    // Each "Regenerate" variation should still feel like a genuinely
    // different composition, but ONLY by varying the product photo's own
    // scale/position within the frame — never by prescribing how the labels
    // are arranged, shaped, or connected. That used to be hardcoded here too
    // (e.g. "connected to the product with a horizontal connector line"),
    // which reliably WON over the softer prose design-direction description
    // whenever the two disagreed — a layout/reference calling for no
    // connector line, or a ring/grid/scatter arrangement, kept coming out as
    // this hardcoded column-with-lines layout regardless. Label arrangement,
    // shape, and connector style are 100% owned by $labels (from
    // planVisualGeneration()/analyzeReferenceDesign()) now — these hints
    // only ever get to say where the PHOTO sits.
    private const VARIATION_HINTS = [
        'Shrink the product photo to occupy roughly the center 55% of the frame width, leaving open space around ' .
            'it for the labels — their exact arrangement, shape, and connector style are governed entirely by the ' .
            'design direction above, not by this instruction.',
        'Shrink the product photo to occupy roughly the top 60-65% of the frame height, leaving more open space ' .
            'below it for the labels — their exact arrangement, shape, and connector style are governed entirely ' .
            'by the design direction above, not by this instruction.',
        'Keep the product photo centered and roughly life-size within the frame, per the design direction above.',
        'Shrink the product photo to occupy roughly the center 60% of the frame, positioned slightly toward one ' .
            'side, leaving open space on both sides for the labels — their exact arrangement, shape, and ' .
            'connector style are governed entirely by the design direction above, not by this instruction.',
        'Keep the product photo large, filling most of the frame height, per the design direction above.',
    ];

    private string $apiKey;

    /**
     * Per-instance token usage log, one entry per OpenAI call this client
     * made — a fresh OpenAIClient is constructed per pipeline run (see
     * InfographicController::requireOpenAI()), so this naturally scopes to
     * "usage for this one generation". Populated by recordUsage(), read via
     * getUsageSummary(). Every chat-completions AND images/edits response
     * already includes a `usage` object (gpt-image-1 bills by tokens, not a
     * flat per-image rate) — this was simply never captured before.
     */
    private array $usageLog = [];

    public function __construct(string $apiKey)
    {
        $this->apiKey = $apiKey;
    }

    /** Appends one call's token usage to the log, tagged with which pipeline stage made it. No-op if $usage is missing (a malformed/error response). */
    private function recordUsage(string $stage, ?array $usage): void
    {
        if (!is_array($usage)) return;
        $this->usageLog[] = ['stage' => $stage] + $usage;
    }

    /**
     * Aggregates every OpenAI call this client instance has made so far into
     * input/output/total token totals, plus the full per-stage breakdown
     * (useful for seeing which step — e.g. the gpt-image-1 compose call —
     * actually dominates cost). Chat-completions usage uses prompt_tokens/
     * completion_tokens; images/edits (gpt-image-1) usage uses input_tokens/
     * output_tokens — both normalized into the same input/output/total shape
     * here so callers don't need to know which shape a given stage returned.
     */
    public function getUsageSummary(): array
    {
        $totals = ['input_tokens' => 0, 'output_tokens' => 0, 'total_tokens' => 0, 'calls' => count($this->usageLog)];
        foreach ($this->usageLog as $entry) {
            $input  = $entry['input_tokens']  ?? $entry['prompt_tokens']     ?? 0;
            $output = $entry['output_tokens'] ?? $entry['completion_tokens'] ?? 0;
            $total  = $entry['total_tokens']  ?? ($input + $output);
            $totals['input_tokens']  += (int)$input;
            $totals['output_tokens'] += (int)$output;
            $totals['total_tokens']  += (int)$total;
        }
        return ['totals' => $totals, 'by_stage' => $this->usageLog];
    }

    /**
     * Extract up to 4 short, de-duplicated key-point phrases from a product
     * description paragraph. Uses OpenAI chat completions (gpt-4o-mini).
     * Returns array of short phrases (2–5 words), never full sentences.
     *
     * $category (one of InfographicSkillLibrary::categoryIds()), when known,
     * tunes which facts get selected and how they're phrased to that
     * category's copy_pattern — e.g. FMCG reads as a benefit-led claim,
     * apparel as a construction/material noun phrase. The structural rules
     * (word count, no sentences/verbs) stay fixed regardless, since exact-
     * verbatim label rendering downstream depends on short, punctuation-free
     * phrases. This is the plain/flat extraction path — extractStructuredInfo()
     * is the richer, priority-ranked variant used by the main archetype-driven
     * generation flow; this one stays as the fallback for categories with no
     * resolved extraction model (e.g. 'other') and for collage/doExtract().
     */
    public function extractKeyPoints(string $paragraph, ?string $category = null): array
    {
        $system =
            'You are a product copywriter. Extract 3 to 4 key selling points from the product description. ' .
            'Rules: each point must be 2–5 words only — no full sentences, no verbs, no punctuation. Each point ' .
            'must be about a genuinely different attribute — never list the same feature twice using different ' .
            'wording (e.g. do not return both "Zari Border" and "Luxurious Zari Border"). ' .
            'Focus on materials, features, benefits, or quality markers.' .
            $this->copyPatternHint($category) .
            ' Return ONLY a JSON array of strings, nothing else. ' .
            'Example: ["Pure Silk Fabric","Hand Embroidered","Machine Washable","Free Size"]';

        $response = $this->chatCompletion([
            ['role' => 'system', 'content' => $system],
            ['role' => 'user',   'content' => $paragraph],
        ], 150, 'extract_key_points');

        $raw = $response['choices'][0]['message']['content'] ?? '[]';
        return $this->cleanKeyPoints($raw);
    }

    /**
     * Grounded variant of extractKeyPoints() — facts come from $knowledge
     * (RagRetriever chunks: real product title/vendor/type/tags/description),
     * not the merchant's free-text paragraph, which becomes secondary/
     * optional context. Falls back to the plain ungrounded extraction when
     * $knowledge is empty, so callers never need their own fallback branch.
     * Same return contract as extractKeyPoints() (array of short phrases);
     * same $category copy_pattern tuning.
     */
    public function extractKeyPointsGrounded(string $description, array $knowledge, ?string $category = null): array
    {
        $context = $this->buildContextBlock($knowledge);
        if ($context === '') {
            return $this->extractKeyPoints($description, $category);
        }

        $system =
            'You are a product copywriter. Extract 3 to 4 key selling points using ONLY the facts in CONTEXT ' .
            'below — never invent a material, feature, or claim that is not present there. Rules: each point ' .
            'must be 2–5 words only — no full sentences, no verbs, no punctuation. Each point must be about a ' .
            'genuinely different attribute — never list the same feature twice using different wording. Prefer ' .
            'specific, verifiable facts (materials, care, origin, certifications) over generic praise ("High ' .
            'Quality", "Great Fit").' .
            $this->copyPatternHint($category) .
            ' Return ONLY a JSON array of strings, nothing else.' .
            "\n\nCONTEXT:\n{$context}";

        $userMsg = $description !== ''
            ? "Merchant notes (secondary — use only where consistent with CONTEXT): {$description}"
            : 'No additional merchant notes.';

        $response = $this->chatCompletion([
            ['role' => 'system', 'content' => $system],
            ['role' => 'user',   'content' => $userMsg],
        ], 150, 'extract_key_points_grounded');

        $clean = $this->cleanKeyPoints($response['choices'][0]['message']['content'] ?? '[]');

        // Grounded extraction produced nothing usable (e.g. the model found
        // no groundable facts) — fall back rather than return an empty result.
        return !empty($clean) ? $clean : $this->extractKeyPoints($description, $category);
    }

    /**
     * Research + Ranking Agent — per docs/skill.md's structured extraction
     * model: instead of a single flat list of short phrases, extracts THIS
     * category's real attributes (InfographicSkillLibrary::extractionFields())
     * and ranks each into Priority 1 (must-have), 2 (useful supporting), or 3
     * (never put in the image) before compressing the top ones into short
     * verbatim phrases. Same CONTEXT-only grounding contract as
     * extractKeyPointsGrounded() (never invent beyond $knowledge/description),
     * and the same defensive fallback: falls back to the plain flat
     * extraction (wrapped into this shape) on any failure, empty result, or
     * when this category has no resolved extraction model (e.g. 'other').
     *
     * @return array{ranked: array<array{text: string, priority: int, type: ?string}>, key_points: string[]}
     */
    public function extractStructuredInfo(string $description, array $knowledge, string $category): array
    {
        $fields = InfographicSkillLibrary::extractionFields($category);
        if (empty($fields)) {
            return $this->flatToStructured($this->extractKeyPointsGrounded($description, $knowledge, $category));
        }

        $tiers = InfographicSkillLibrary::priorityTiers($category);
        $context = $this->buildContextBlock($knowledge);
        $grounding = $context !== ''
            ? "Extract using ONLY the facts in CONTEXT below — never invent a material, feature, ingredient, or " .
              "claim that is not present there.\n\nCONTEXT:\n{$context}"
            : 'No indexed product facts are available for this product — use only the merchant notes below, and ' .
              'do not invent facts beyond what they state.';

        $system =
            "You are a product copywriter and information architect for a \"{$category}\" product infographic. " .
            "{$grounding}\n\n" .
            "This category's attributes to consider: " . implode(', ', $fields) . ".\n" .
            "Rank every fact you find into exactly one tier:\n" .
            "Priority 1 (must-have visual information): " . implode(', ', $tiers[1]) . "\n" .
            "Priority 2 (useful supporting information): " . implode(', ', $tiers[2]) . "\n" .
            "Priority 3 (do NOT put in the image — skip these entirely): " . implode(', ', $tiers[3]) . "\n\n" .
            "Select 3 to 4 items total for the final infographic, Priority 1 first, filling any remaining slots " .
            "from Priority 2 only — never select a Priority 3 item. Each selected item must be 2-6 words, a " .
            "short noun phrase — no full sentences, no verbs, no punctuation — and about a genuinely different " .
            "attribute than any other selected item." . $this->copyPatternHint($category) . "\n\n" .
            "Return ONLY this JSON shape, nothing else: {\"ranked\": [{\"text\": \"<short phrase>\", " .
            "\"priority\": 1|2, \"type\": \"<which attribute from the list above this is>\"}, ...]}";

        $userMsg = $description !== ''
            ? "Merchant notes (secondary — use only where consistent with CONTEXT): {$description}"
            : 'No additional merchant notes.';

        $response = $this->chatCompletion([
            ['role' => 'system', 'content' => $system],
            ['role' => 'user',   'content' => $userMsg],
        ], 250, 'extract_structured_info');

        $raw = $response['choices'][0]['message']['content'] ?? '{}';
        $raw = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', trim($raw));
        $result = json_decode($raw, true);
        $ranked = is_array($result['ranked'] ?? null) ? $result['ranked'] : [];

        $clean = $this->cleanRankedInfo($ranked);
        if (empty($clean)) {
            return $this->flatToStructured($this->extractKeyPointsGrounded($description, $knowledge, $category));
        }

        return ['ranked' => $clean, 'key_points' => array_column($clean, 'text')];
    }

    /**
     * Layout Planning Agent, structured variant — per docs/skill.md's
     * "Visual Generation Plan": assigns each ranked info item a semantic
     * position, orientation, and (only when genuinely applicable) which real
     * object/material it should visually connect to. Text-only — reasons
     * about abstract layout given the already-chosen layout's name/
     * description and the item list, not the photo itself — so this stays
     * cheap on top of planVisualGeneration()'s one vision call.
     * $visualConnection values that name a known fabric/ingredient get
     * resolved through InfographicSkillLibrary::materialVisual() at prompt-
     * build time (see buildQualityRulesBlock()), not here — this only
     * decides WHAT each label should visually reference, not HOW that thing
     * looks.
     *
     * Falls back to $ranked with all three new keys set to null on any
     * failure or a count mismatch (never risk misattributing one label's
     * placement to another's text) — degrades to exactly the flat, no-
     * per-item-enrichment behavior this feature adds on top of.
     *
     * @param array $ranked extractStructuredInfo()'s ['ranked']
     * @return array same shape, each item additionally carrying {position, orientation, visual_connection}
     */
    public function assignInformationLayout(array $ranked, string $category, string $layoutId, string $layoutName): array
    {
        if (empty($ranked)) return [];

        try {
            $response = $this->chatCompletion($this->buildInformationLayoutMessages($ranked, $category, $layoutId, $layoutName), 300, 'assign_information_layout');
        } catch (\Throwable $e) {
            return $this->withNullLayout($ranked);
        }

        return $this->parseInformationLayoutResponse($response, $ranked);
    }

    /** Message-building half of assignInformationLayout() — split out so planSceneAndLayout() can fire this alongside planInfographicScene()'s request over curl_multi instead of sequentially. */
    private function buildInformationLayoutMessages(array $ranked, string $category, string $layoutId, string $layoutName): array
    {
        $layout = InfographicSkillLibrary::layout($category, $this->layoutShortId($layoutId));
        $layoutDesc = trim((string)($layout['description'] ?? ''));

        $itemLines = implode("\n", array_map(
            fn($item, $i) => ($i + 1) . '. "' . $item['text'] . '" (attribute: ' . ($item['type'] ?? 'unspecified') . ')',
            $ranked,
            array_keys($ranked)
        ));

        $system =
            "You are a layout planner for a product marketing infographic using the \"{$layoutName}\" layout" .
            ($layoutDesc !== '' ? " ({$layoutDesc})" : '') . ". Given the labels below, assign each one a " .
            "semantic position, orientation, and (only when genuinely applicable) what real object it should " .
            "visually connect to.\n\nLabels:\n{$itemLines}\n\n" .
            "For \"position\", use one of: upper_left, upper_right, lower_left, lower_right, center_left, " .
            "center_right, top, bottom. Spread labels across different positions — never assign the same " .
            "position to two labels. For \"orientation\", use one of: horizontal, slightly_diagonal, vertical. " .
            "Prefer horizontal for most labels; use slightly_diagonal sparingly for visual interest, never " .
            "randomly on every label. For \"visual_connection\": if a label's own \"attribute\" names a real " .
            "material, fabric, or ingredient (e.g. hero_ingredients, fabric, print), name that exact thing in a " .
            "few words (e.g. \"Himalayan Shilajit\", \"linen\"); for a label that's a benefit/claim/pack-info " .
            "with no specific object to point at, use null.\n\n" .
            "Return ONLY this JSON shape, nothing else: {\"positions\": [{\"position\": \"...\", " .
            "\"orientation\": \"...\", \"visual_connection\": \"...\"|null}, ...]} — exactly one entry per " .
            "label above, same order.";

        return [
            ['role' => 'system', 'content' => $system],
            ['role' => 'user',   'content' => 'Assign positions now.'],
        ];
    }

    /** Response-parsing half of assignInformationLayout() — see buildInformationLayoutMessages(). */
    private function parseInformationLayoutResponse(array $response, array $ranked): array
    {
        $raw = $response['choices'][0]['message']['content'] ?? '{}';
        $raw = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', trim($raw));
        $result = json_decode($raw, true);
        $positions = is_array($result['positions'] ?? null) ? $result['positions'] : [];

        if (count($positions) !== count($ranked)) {
            return $this->withNullLayout($ranked);
        }

        $information = [];
        foreach ($ranked as $i => $item) {
            $pos = is_array($positions[$i] ?? null) ? $positions[$i] : [];
            $information[] = $item + [
                'position'          => is_string($pos['position'] ?? null) ? $pos['position'] : null,
                'orientation'       => is_string($pos['orientation'] ?? null) ? $pos['orientation'] : null,
                'visual_connection' => is_string($pos['visual_connection'] ?? null) ? trim($pos['visual_connection']) : null,
            ];
        }
        return $information;
    }

    private function withNullLayout(array $ranked): array
    {
        return array_map(fn($item) => $item + ['position' => null, 'orientation' => null, 'visual_connection' => null], $ranked);
    }

    /** "fmcg-B" -> "B" (planVisualGeneration()'s layout_id is the full "{category}-{A|B|C}" slug; InfographicSkillLibrary::layout() wants the bare letter). */
    private function layoutShortId(string $layoutId): string
    {
        $pos = strrpos($layoutId, '-');
        return $pos !== false ? substr($layoutId, $pos + 1) : $layoutId;
    }

    /**
     * Pulls the category's copy_pattern principle straight from
     * InfographicSkillLibrary and phrases it as a system-prompt addendum —
     * empty string (no-op) when $category is null/unrecognized, so callers
     * that don't yet know the category (e.g. doExtract()'s standalone,
     * image-less endpoint) get the same behavior as before this existed.
     */
    private function copyPatternHint(?string $category): string
    {
        if ($category === null) return '';
        $pattern = InfographicSkillLibrary::copyPattern($category);
        if ($pattern === '') return '';
        return " This product is in the \"{$category}\" category — within the word-count/format rules above, " .
            "lean the phrasing toward how real {$category} marketing infographics write their claims: {$pattern}";
    }

    /**
     * Layout Planning Agent — decides which key point is the strongest
     * ("headline") and a natural reading order for the rest. gpt-image-1
     * takes prose, not pixel coordinates, so this plan is folded into the
     * generation prompt as emphasis/ordering guidance (see
     * buildScenePlanHint()), not literal element positions. Distinct from
     * assignInformationLayout() — that assigns each label its own spot in
     * the frame; this decides which ONE label should read as visually
     * strongest regardless of where any of them sit.
     */
    public function planInfographicScene(array $keyPoints, string $layoutName, string $category): array
    {
        if (empty($keyPoints)) return [];
        $response = $this->chatCompletion($this->buildScenePlanMessages($keyPoints, $layoutName, $category), 150, 'plan_scene');
        return $this->parseScenePlanResponse($response);
    }

    /** Message-building half of planInfographicScene() — split out so planSceneAndLayout() can fire this alongside assignInformationLayout()'s request over curl_multi instead of sequentially. */
    private function buildScenePlanMessages(array $keyPoints, string $layoutName, string $category): array
    {
        $system =
            'You are a layout planner for a product marketing infographic. Given the key-point labels that will ' .
            'appear on the image, decide which single one is the strongest selling point (the headline) and a ' .
            'natural reading order for all of them. Return ONLY JSON: {"headline_point": "<one of the given ' .
            'points, verbatim>", "section_order": [<all given points, verbatim, reading order, headline first>]}.';

        return [
            ['role' => 'system', 'content' => $system],
            ['role' => 'user',   'content' => "Design: {$layoutName}. Category: {$category}. Points: " . implode('; ', $keyPoints)],
        ];
    }

    /** Response-parsing half of planInfographicScene() — see buildScenePlanMessages(). */
    private function parseScenePlanResponse(array $response): array
    {
        $raw = $response['choices'][0]['message']['content'] ?? '{}';
        $raw = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', trim($raw));
        $plan = json_decode($raw, true);
        return is_array($plan) ? $plan : [];
    }

    /**
     * Runs planInfographicScene() and assignInformationLayout() CONCURRENTLY
     * via curl_multi instead of back-to-back — both are independent
     * text-only chat-completion calls (neither's input depends on the
     * other's output), so paying their latency sequentially bought nothing.
     * Added to trim wall-clock time off doCreate()/doGenerate() now that the
     * pipeline chains enough sequential OpenAI calls to risk the hosting
     * server's own connection timeout (observed ~120s, independent of this
     * class's own request timeouts) — especially once the QC gate's bounded
     * retry doubles the single most expensive step (gpt-image-1 generation).
     * Each half degrades to its own documented fallback independently on
     * failure — a bad/missing response for one does not affect the other.
     *
     * @return array{scenePlan: array, information: array}
     */
    public function planSceneAndLayout(array $keyPoints, array $ranked, string $category, string $layoutId, string $layoutName): array
    {
        $needScene  = !empty($keyPoints);
        $needLayout = !empty($ranked);

        if (!$needScene && !$needLayout) {
            return ['scenePlan' => [], 'information' => []];
        }
        if (!$needLayout) {
            return ['scenePlan' => $this->planInfographicScene($keyPoints, $layoutName, $category), 'information' => []];
        }
        if (!$needScene) {
            return ['scenePlan' => [], 'information' => $this->assignInformationLayout($ranked, $category, $layoutId, $layoutName)];
        }

        $jobs = [
            'scene'  => ['messages' => $this->buildScenePlanMessages($keyPoints, $layoutName, $category), 'maxTokens' => 150],
            'layout' => ['messages' => $this->buildInformationLayoutMessages($ranked, $category, $layoutId, $layoutName), 'maxTokens' => 300],
        ];

        $responses = $this->runParallelChatCompletions($jobs);

        $scenePlan   = isset($responses['scene']) ? $this->parseScenePlanResponse($responses['scene']) : [];
        $information = isset($responses['layout']) ? $this->parseInformationLayoutResponse($responses['layout'], $ranked) : $this->withNullLayout($ranked);

        return ['scenePlan' => $scenePlan, 'information' => $information];
    }

    /**
     * Rendering/QC Agent — per docs/skill.md's scored quality-control layer:
     * 6 metrics (0-10 each) instead of a flag-only pass/fail.
     * InfographicController uses `overall_score` to decide whether to
     * auto-regenerate once (capped at one retry, not an unbounded loop,
     * since this endpoint already runs close to its 200s budget).
     *
     * @return array{pass: bool, overall_score: float, product_dominance: float,
     *   text_readability: float, information_density: float, layout_quality: float,
     *   visual_hierarchy: float, category_accuracy: float, issues: string[]}
     */
    public function checkInfographicQuality(string $imageBytes, array $expectedKeyPoints): array
    {
        $system =
            'You are a quality checker for a generated marketing infographic image. Score it 0-10 on each of ' .
            'these 6 metrics: product_dominance (is the product/garment still the clear visual focus?), ' .
            'text_readability (is every label legible, correctly spelled, not cut off?), information_density ' .
            '(not overcrowded, not sparse — 3-6 clean callouts), layout_quality (composition feels intentional ' .
            'and premium, not haphazard), visual_hierarchy (the strongest claim reads as visually stronger than ' .
            'the rest), category_accuracy (the overall style genuinely suits this type of product). Also look ' .
            'for concrete rendering defects: misspelled words, missing or cut-off text, an expected label ' .
            'rendered MORE THAN ONCE anywhere in the frame (count each expected label\'s occurrences — flag any ' .
            'that appear twice, even reworded/shortened), two labels overlapping/colliding, or a connector line ' .
            'pointing at nothing recognizable. Return ONLY this JSON shape, nothing else: {"product_dominance": ' .
            '0-10, "text_readability": 0-10, "information_density": 0-10, "layout_quality": 0-10, ' .
            '"visual_hierarchy": 0-10, "category_accuracy": 0-10, "issues": ["<short factual description>", ' .
            '...]} — empty issues array when nothing is wrong.';

        $b64 = base64_encode($imageBytes);
        try {
            $response = $this->chatCompletion([
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => [
                    ['type' => 'text', 'text' => 'Expected labels (exactly once each): ' . implode(', ', $expectedKeyPoints)],
                    ['type' => 'image_url', 'image_url' => ['url' => "data:image/png;base64,{$b64}"]],
                ]],
            ], 350, 'check_quality');
        } catch (\Throwable $e) {
            return $this->defaultQualityScore();
        }

        $raw = $response['choices'][0]['message']['content'] ?? '{}';
        $raw = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', trim($raw));
        $result = json_decode($raw, true);
        if (!is_array($result)) {
            return $this->defaultQualityScore();
        }

        $metricKeys = ['product_dominance', 'text_readability', 'information_density', 'layout_quality', 'visual_hierarchy', 'category_accuracy'];
        $metrics = [];
        foreach ($metricKeys as $key) {
            $val = $result[$key] ?? null;
            $metrics[$key] = is_numeric($val) ? max(0.0, min(10.0, (float)$val)) : 10.0;
        }
        $overall = array_sum($metrics) / count($metrics);

        return $metrics + [
            'overall_score' => round($overall, 1),
            'pass'          => $overall >= 8.0,
            'issues'        => is_array($result['issues'] ?? null) ? array_values(array_map('strval', $result['issues'])) : [],
        ];
    }

    /** Permissive default when the checker itself fails to run/parse — never blocks generation on a broken check. */
    private function defaultQualityScore(): array
    {
        return [
            'product_dominance' => 10.0, 'text_readability' => 10.0, 'information_density' => 10.0,
            'layout_quality' => 10.0, 'visual_hierarchy' => 10.0, 'category_accuracy' => 10.0,
            'overall_score' => 10.0, 'pass' => true, 'issues' => [],
        ];
    }

    /**
     * Embeds a batch of texts (text-embedding-3-small, 1536 dims). Used by
     * RagIngestor (product facts) and RagRetriever (query embedding).
     *
     * @return float[][] One embedding vector per input, same order.
     */
    public function embedTexts(array $texts): array
    {
        if (empty($texts)) return [];

        $response = $this->jsonRequest('POST', '/embeddings', [
            'model' => self::EMBEDDING_MODEL,
            'input' => array_values($texts),
        ]);

        $data = $response['data'] ?? [];
        usort($data, static fn($a, $b) => ($a['index'] ?? 0) <=> ($b['index'] ?? 0));
        return array_map(static fn($d) => $d['embedding'] ?? [], $data);
    }

    /** Shared CONTEXT: block builder for extractKeyPointsGrounded()/extractStructuredInfo() — [] knowledge returns ''. */
    private function buildContextBlock(array $knowledge): string
    {
        if (empty($knowledge)) return '';
        return implode("\n", array_map(
            fn($k, $i) => '[' . ($i + 1) . '] (' . $k['source_type'] . ') ' . $k['title'] . ' — ' . $k['chunk_text'],
            $knowledge,
            array_keys($knowledge)
        ));
    }

    /** Shared cleanup for extractKeyPoints()/extractKeyPointsGrounded() raw JSON output. */
    private function cleanKeyPoints(string $raw): array
    {
        $raw = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', trim($raw));
        $points = json_decode($raw, true);
        if (!is_array($points)) {
            return [];
        }

        // Cap at 4 (not 5) — fewer labels means more breathing room on the
        // canvas and less chance of gpt-image-1 crowding/duplicating one.
        $clean = [];
        $seen  = [];
        foreach (array_slice($points, 0, 6) as $p) {
            if (count($clean) >= 4) {
                break;
            }
            if (!is_string($p)) {
                continue;
            }
            $p = trim($p, " \t\n\r\0.,;:\"'");
            if ($p === '' || str_word_count($p) > 6) {
                continue;
            }
            // De-dupe near-identical points (e.g. the same phrase mentioned
            // twice in the source description) — sending a duplicate into
            // the image prompt guarantees a duplicate label in the image.
            $key = strtolower(preg_replace('/[^a-z0-9]+/i', '', $p));
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $clean[] = $p;
        }
        return $clean;
    }

    /** Wraps a flat string[] (the pre-structured extraction fallback) into extractStructuredInfo()'s return shape. */
    private function flatToStructured(array $flat): array
    {
        $ranked = array_map(fn($t) => ['text' => $t, 'priority' => 1, 'type' => null], $flat);
        return ['ranked' => $ranked, 'key_points' => $flat];
    }

    /** Shared cleanup for extractStructuredInfo()'s raw {"ranked": [...]} output — same word-count/dedup/cap rules as cleanKeyPoints(), plus priority validation. Result is sorted priority-ascending. */
    private function cleanRankedInfo(array $ranked): array
    {
        $clean = [];
        $seen = [];
        foreach (array_slice($ranked, 0, 8) as $item) {
            if (count($clean) >= 4) {
                break;
            }
            if (!is_array($item)) {
                continue;
            }
            $text = is_string($item['text'] ?? null) ? trim($item['text'], " \t\n\r\0.,;:\"'") : '';
            if ($text === '' || str_word_count($text) > 6) {
                continue;
            }
            $key = strtolower(preg_replace('/[^a-z0-9]+/i', '', $text));
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $priority = (int)($item['priority'] ?? 1);
            $clean[] = [
                'text'     => $text,
                'priority' => $priority >= 1 && $priority <= 3 ? $priority : 1,
                'type'     => is_string($item['type'] ?? null) ? trim($item['type']) : null,
            ];
        }
        usort($clean, fn($a, $b) => $a['priority'] <=> $b['priority']);
        return $clean;
    }

    /**
     * Vision Agent — looks at the actual product photo and decides which
     * real category (11, per docs/skill.md — was 3) and which of that
     * category's 3 named layouts (was ~20 flat archetypes) suit it, then
     * authors this generation's composition ('look') and callout mechanic
     * ('labels'). Categories without their own layouts (everything except
     * fmcg/clothing) fall back to whichever of those two their
     * InfographicSkillLibrary 'layout_bucket' points at.
     *
     * Deliberately does NOT see the ranked information items yet (extraction
     * runs afterward, using the category this call returns — see
     * InfographicController::doCreate()) — its "look"/"labels" prose doesn't
     * need item-level content, only composition/mechanic guidance. Per-item
     * position/orientation/visual_connection is assigned afterward by
     * assignInformationLayout() once the ranked items exist, as a separate
     * cheap text-only call — keeping this to one vision call total, same
     * cost as the old (pre-skill.md-rewrite) system.
     *
     * $excludeLayoutIds (used by "Regenerate") is a hard filter, not just a
     * soft suggestion — those layout ids ("{category}-{A|B|C}") are removed
     * from the candidate list shown to the model entirely, so a repeat pick
     * is structurally impossible rather than merely discouraged (a plain
     * instruction like "avoid these if possible" was tried first and
     * routinely ignored — see [[project_ai_studio_module]]). If excluding
     * would leave a category with zero options, that category's full list
     * is shown again rather than left empty.
     *
     * Returns [] on any failure — callers must fall back to a safe default
     * plan, never block generation on this.
     */
    public function planVisualGeneration(string $imagePath, string $description = '', array $excludeLayoutIds = []): array
    {
        $categories = InfographicSkillLibrary::categories();
        if (empty($categories)) {
            return [];
        }

        $categoryLines = [];
        foreach ($categories as $id => $cat) {
            $hint = trim((string)($cat['detection_hint'] ?? ''));
            $categoryLines[] = "- \"{$id}\" (" . ($cat['display_name'] ?? $id) . "): typically shows {$hint}.";
        }

        $layoutBlocks = [];
        $anyExhausted = false;
        foreach ($categories as $catId => $cat) {
            $layouts = InfographicSkillLibrary::layouts($catId);
            if (empty($layouts)) {
                $layoutBlocks[] = "Layouts available under category \"{$catId}\": (none named for this category " .
                    "— invent a clean, appropriate composition yourself, following the general principle that " .
                    "the product stays visually dominant with a handful of short callouts around it)";
                continue;
            }
            $entries = [];
            $unfiltered = [];
            foreach ($layouts as $layoutId => $layout) {
                $slug = "{$catId}-{$layoutId}";
                $line = "  * \"{$slug}\" — {$layout['name']}: {$layout['description']}";
                $unfiltered[] = $line;
                if (!in_array($slug, $excludeLayoutIds, true)) {
                    $entries[] = $line;
                }
            }
            if (empty($entries)) {
                $entries = $unfiltered;
                $anyExhausted = true;
            }
            $layoutBlocks[] = "Layouts available under category \"{$catId}\":\n" . implode("\n", $entries);
        }

        $variationNote = !empty($excludeLayoutIds)
            ? (' Note: this is a "Regenerate" — some layouts already used for this exact product in this ' .
               'session have been removed from the lists below to force a genuinely different design this time' .
               ($anyExhausted ? ' (one category has cycled through all its layouts, so its full list is shown again)' : '') .
               '.')
            : '';

        $system =
            "You are a visual merchandising art director. Look at the attached product photo and decide which " .
            "real infographic design pattern fits it best.{$variationNote}\n\n" .
            "STEP 1 — Category: choose exactly one category id based ONLY on what the photo actually shows " .
            "(ignore the text description for this step if it conflicts with the photo):\n" .
            implode("\n", $categoryLines) . "\n\n" .
            "STEP 2 — Layout: from that category's list ONLY, choose the single named layout (its full slug, " .
            "\"{category}-{A|B|C}\") whose composition pattern most naturally fits this exact photo:\n" .
            implode("\n\n", $layoutBlocks) . "\n\n" .
            "STEP 3 — Compose: describe THIS generation's background/composition and callout mechanic for that " .
            "layout, grounded in what you can actually see (real colors, real product/garment type) — never " .
            "invent a different product than what's in the photo.\n\n" .
            "Return ONLY this JSON shape, nothing else, no markdown fences:\n" .
            "{\"category\": \"<one of the category ids above, exactly>\", \"layout_id\": \"<the full slug from " .
            "STEP 2, e.g. \\\"fmcg-B\\\", exactly>\", \"look\": \"<2-4 sentences describing ONLY the background, " .
            "composition, palette, texture and mood for this generation — how the product photo should be " .
            "placed and what surrounds it; do not mention the callout labels here>\", \"labels\": \"<1-2 " .
            "sentences describing ONLY how the callouts/captions should be rendered per this layout's own " .
            "pattern — connector style (straight leader line / dotted squiggle arrow / hand-drawn arrow / " .
            "curved line / none), shape (pill badge / rectangular chip / numbered marker / plain caption / " .
            "label tag), and typography feel>\", \"extra_elements\": \"<any additional on-image element this " .
            "layout specifically calls for beyond the product photo and the callouts — e.g. a short headline, a " .
            "size chart, color swatches, a price badge, a brand wordmark; empty string if none>\"}";

        $mime = @mime_content_type($imagePath) ?: 'image/jpeg';
        $bytes = @file_get_contents($imagePath);
        if ($bytes === false || $bytes === '') {
            return [];
        }
        $b64 = base64_encode($bytes);

        try {
            $response = $this->chatCompletion([
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => [
                    ['type' => 'text', 'text' => $description !== ''
                        ? "Product description (secondary context, use only where it doesn't contradict the photo): {$description}"
                        : 'No additional product description given — rely on the photo.'],
                    ['type' => 'image_url', 'image_url' => ['url' => "data:{$mime};base64,{$b64}"]],
                ]],
            ], 700);
        } catch (\Throwable $e) {
            return [];
        }

        $raw = $response['choices'][0]['message']['content'] ?? '{}';
        $raw = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', trim($raw));
        $result = json_decode($raw, true);
        if (!is_array($result)) {
            return [];
        }

        $category = strtolower(trim((string)($result['category'] ?? '')));
        $layoutId = trim((string)($result['layout_id'] ?? ''));
        if (!in_array($category, InfographicSkillLibrary::categoryIds(), true)) {
            return [];
        }

        $layoutName = $this->resolveLayoutName($category, $layoutId);
        if ($layoutName === null) {
            // Missing/mismatched layout id — fall back to a sane default for
            // this category rather than discarding the (usually correct)
            // category classification.
            [$layoutId, $layoutName] = $this->defaultLayoutFor($category);
        }

        $look   = trim((string)($result['look'] ?? ''));
        $labels = trim((string)($result['labels'] ?? ''));
        if ($look === '' || $labels === '') {
            return [];
        }

        return [
            'category'       => $category,
            'layout_id'      => $layoutId,
            'layout_name'    => $layoutName,
            'look'           => $look,
            'labels'         => $labels,
            'extra_elements' => trim((string)($result['extra_elements'] ?? '')),
        ];
    }

    /** Resolves a "{category}-{A|B|C}" slug back to its human name, only if it actually belongs to $category. Null if not found. */
    private function resolveLayoutName(string $category, string $layoutSlug): ?string
    {
        foreach (InfographicSkillLibrary::layouts($category) as $layoutId => $layout) {
            if ("{$category}-{$layoutId}" === $layoutSlug) {
                return $layout['name'] ?? $layoutId;
            }
        }
        return null;
    }

    /** @return array{0: string, 1: string} [slug, name] — first available layout for $category, or a generic placeholder for categories with none (e.g. 'other'). */
    private function defaultLayoutFor(string $category): array
    {
        $layouts = InfographicSkillLibrary::layouts($category);
        if (!empty($layouts)) {
            $firstId = array_key_first($layouts);
            return ["{$category}-{$firstId}", $layouts[$firstId]['name'] ?? $firstId];
        }
        return ["{$category}-generic", 'Generic Product Infographic'];
    }

    /**
     * Composes the final infographic image from a source product/model photo
     * plus the extracted key points, entirely via OpenAI's image model
     * (gpt-image-1, images/edits). Returns raw PNG image bytes.
     *
     * $plan is the output of planVisualGeneration() or analyzeReferenceDesign()
     * (or a safe fallback of the same shape) — 'look' drives the background/
     * composition/palette, 'labels' drives the callout/connector-line
     * mechanic, 'extra_elements' (optional) is any additional on-image
     * element the layout specifically calls for, and 'information' (optional
     * — present for the archetype-driven flow via assignInformationLayout(),
     * absent for reference mode and the generic fallback) carries each
     * label's position/orientation/visual_connection, matched back to
     * $keyPoints by text (see annotateInformation()) so a count/order
     * mismatch degrades gracefully rather than misattributing one label's
     * placement to another's text. $category (one of
     * InfographicSkillLibrary::categoryIds()) picks the overall frame:
     * 'fmcg' (and its bucketed categories) centers the pack in a square
     * frame, everything else places the photo prominently in a tall
     * portrait frame. Both keep the source photo completely untouched — no
     * re-illustration.
     *
     * $referenceImagePath (optional, "match a reference" mode only) attaches
     * a second image purely as secondary visual corroboration alongside the
     * $plan text spec that analyzeReferenceDesign() already transcribed from
     * it — the text spec is authoritative; the raw image is a pixel-level
     * backup, not the primary mechanism (see analyzeReferenceDesign()'s
     * docblock for why relying on raw pixels alone is unreliable).
     */
    public function generateInfographicImage(
        string $imagePath,
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
    ): string {
        $layoutName    = $plan['layout_name'] ?? 'suited-to-photo';
        $look          = $plan['look'] ?? 'a clean, uncluttered studio background with generous negative space and a soft natural shadow beneath the product';
        $labels        = $plan['labels'] ?? 'simple caption-style text placed beside the product, each connected by a thin straight leader line';
        $extraElements = trim((string)($plan['extra_elements'] ?? ''));
        $information   = is_array($plan['information'] ?? null) ? $plan['information'] : [];

        // Names the chosen design pattern explicitly and tells the model NOT
        // to fall back to a generic plain-caption look — gpt-image-1 kept
        // converging every generation toward the same "safe" serif-caption
        // treatment regardless of what was actually requested unless the
        // label mechanic is called out this directly.
        $designDirection =
            "DESIGN DIRECTION — this infographic uses the \"{$layoutName}\" layout, chosen specifically " .
            "because it suits this product photo. Its label mechanic is: {$labels}. Use exactly that mechanic " .
            "and nothing else — do not default to a generic plain serif-caption look regardless of how clean or " .
            "elegant it seems. " .
            ($referenceImagePath !== null
                ? 'IMAGE 2 below is the reference infographic the design direction above was transcribed from — ' .
                  'use it only to corroborate exact colors, shapes, and proportions; the written design direction ' .
                  'above (not your own independent reading of IMAGE 2) governs what to render. Do not copy IMAGE ' .
                  '2\'s own product, brand name, or literal text. '
                : '');

        // "Match a reference" mode ($referenceImagePath given, or the plan
        // came from analyzeReferenceDesign()) wants literal reproduction of
        // the transcribed layout, not the generic per-variation layout
        // shuffle — see buildQualityRulesBlock()'s $literalMatch docblock.
        $literalMatch = $referenceImagePath !== null || ($plan['layout_id'] ?? null) === 'reference-match';
        $shared = $this->buildQualityRulesBlock(
            $this->annotateInformation($keyPoints, $information), $labels, $extraElements, $customStylePrompt,
            $variation, $description, $brandColors, $scenePlan, $literalMatch
        ) . $this->buildCategoryPrinciplesHint($category);

        // FMCG (and its bucketed categories) packs are roughly square; a
        // full-length garment/model photo needs a taller frame — the extra
        // vertical room also gives labels more breathing space, which helps
        // avoid the crowding/duplication a cramped square canvas
        // encouraged. An explicit $size (from the merchant's Square/
        // Portrait/Landscape picker) overrides this category-based default.
        $isFmcgLike = $category === 'fmcg' || (InfographicSkillLibrary::category($category)['layout_bucket'] ?? null) === 'fmcg';
        $size = $size ?? ($isFmcgLike ? '1024x1024' : '1024x1536');

        $composition = $isFmcgLike
            // No hardcoded shape/placement suggestion here on purpose — $look
            // is now always authored per-generation (either matched from
            // InfographicSkillLibrary or transcribed from a reference image)
            // and is the single source of truth for composition, including
            // exactly how/where the product sits and whether any background
            // shape (circle, quadrant, etc.) is wanted. A generic "circular
            // background shape works well" suggestion used to sit here from
            // the old fixed-STYLE_GUIDES days; it actively fought $look on
            // any layout/reference that doesn't call for a circle (e.g. a
            // flat-lay ingredient scatter), forcing an unwanted vignette
            // into the render.
            ? 'Design a polished, visually rich marketing infographic for a packaged FMCG/wellness product built ' .
              "around this exact product photo — follow this background/composition description precisely, " .
              "including exactly how the product is placed and sized within the frame: {$look} If that " .
              'description mentions specific real objects, props, or ingredients in the scene, render actual ' .
              'photorealistic depictions of each one, positioned as described — they are required content, not ' .
              'optional atmosphere; do not simplify them away into a plain background. Square 1:1 composition. ' .
              $shared
            : 'Design a polished, visually rich marketing infographic for a product photo built around this ' .
              "exact photo — follow this background/composition description precisely, including exactly how " .
              "the product is placed and sized within the frame: {$look} If that description mentions specific " .
              'real objects, props, or ingredients in the scene, render actual photorealistic depictions of ' .
              'each one, positioned as described — they are required content, not optional atmosphere; do not ' .
              'simplify them away into a plain background. Tall portrait composition. ' . $shared;

        $prompt = $designDirection . $composition;
        $imagePaths = $referenceImagePath !== null ? [$imagePath, $referenceImagePath] : [$imagePath];
        return $this->requestGeneratedImage($imagePaths, $prompt, $size);
    }

    /**
     * Normalizes $keyPoints (the authoritative, verbatim label text — always
     * the single source of truth for count/content) into the richer
     * per-label shape buildQualityRulesBlock() renders, enriched with
     * $information's position/orientation/visual_connection when
     * assignInformationLayout() supplied it (matched by trimmed/case-
     * insensitive text, not array position, so a count/order mismatch
     * degrades gracefully to no enrichment rather than misattributing one
     * label's placement to another's text). $information is empty for
     * reference mode and the generic fallback guide — every entry then just
     * carries its text with no extra placement detail, identical to the
     * flat behavior this replaces.
     */
    private function annotateInformation(array $keyPoints, array $information): array
    {
        $byText = [];
        foreach ($information as $item) {
            $key = strtolower(trim((string)($item['text'] ?? '')));
            if ($key !== '') {
                $byText[$key] = $item;
            }
        }
        return array_map(function (string $text) use ($byText) {
            $match = $byText[strtolower(trim($text))] ?? [];
            return [
                'text'              => $text,
                'position'          => $match['position'] ?? null,
                'orientation'       => $match['orientation'] ?? null,
                'visual_connection' => $match['visual_connection'] ?? null,
            ];
        }, $keyPoints);
    }

    /**
     * Deterministic (not LLM-authored) typography/visual-rules hint pulled
     * straight from InfographicSkillLibrary for $category — per docs/skill.md's
     * architecture, typography scale/density/rotation-range/max-callouts and
     * general visual composition rules are fully known once the category is
     * picked, so these are applied directly here rather than asking the
     * vision call in planVisualGeneration() to freely (and less reliably)
     * author them itself. Empty string when the category has neither (should
     * not happen for a resolved category, since 'other' still falls through
     * to the generic default guide before ever reaching this method).
     */
    private function buildCategoryPrinciplesHint(string $category): string
    {
        $typo  = InfographicSkillLibrary::typography($category);
        $rules = InfographicSkillLibrary::visualRules($category);
        if (empty($typo) && empty($rules)) {
            return '';
        }

        $bits = [];
        if (!empty($typo['notes'])) {
            $bits[] = (string)$typo['notes'];
        }
        $rotation = $typo['rotation_range_deg'] ?? null;
        if (is_array($rotation) && count($rotation) === 2) {
            [$min, $max] = $rotation;
            $bits[] = "Any intentional text rotation must stay within {$min}\u{b0} to {$max}\u{b0}, never applied randomly to every label.";
        }
        if (!empty($typo['max_callouts'])) {
            $bits[] = "Never exceed {$typo['max_callouts']} callouts total (the label count already given above respects this).";
        }
        $typoText = !empty($bits) ? 'Category typography principles — ' . implode(' ', $bits) . ' ' : '';

        $rulesText = !empty($rules) ? 'Category composition principles — ' . implode('; ', $rules) . '. ' : '';

        return $typoText . $rulesText;
    }

    /**
     * "Match a reference" mode, step 1 — instead of picking a layout from
     * InfographicSkillLibrary, TRANSCRIBE the merchant's uploaded reference
     * infographic into the same {look, labels, extra_elements} shape
     * planVisualGeneration() produces, by direct observation of what's
     * actually in the image (not by matching it to a fixed pattern library —
     * there may be no matching entry).
     *
     * This intentionally does NOT try to replicate the reference by handing
     * both images straight to gpt-image-1's images/edits and hoping it
     * infers the layout from pixel comparison — that endpoint is built for
     * edits (inpaint/composite/background-swap), not layout cloning, and in
     * practice falls back to "something plausible in the same vein" rather
     * than the reference's actual structure. Transcribing the design into
     * explicit prose first and running it through the same
     * generateInfographicImage() pipeline the layout system already proves
     * out is far more reliable. generateInfographicImage() can still
     * additionally attach the raw reference image alongside for secondary
     * pixel-level corroboration (see its $referenceImagePath param) — belt
     * and suspenders, but the text spec is what's doing the real work.
     *
     * 'category' here is only a loose composition-frame cue (square/
     * centered vs. tall/prominent — reused to pick generateInfographicImage()'s
     * fmcg-like/apparel-like composition branch), not an InfographicSkillLibrary
     * lookup key.
     */
    public function analyzeReferenceDesign(string $referenceImagePath): array
    {
        $system =
            "You are a visual design analyst. Look at the attached reference infographic image and transcribe " .
            "its actual visual design in exhaustive, literal detail — you are describing what is ACTUALLY THERE, " .
            "not suggesting improvements or matching it to a known style name.\n\n" .
            "Return ONLY this JSON shape, nothing else, no markdown fences:\n" .
            "{\"category\": \"<'fmcg' if the product sits centered in a roughly square/centered packaged-goods " .
            "framing, otherwise 'clothing' if it's a taller/more prominent apparel-style framing>\", " .
            "\"look\": \"<4-6 sentences describing EXACTLY the background AND scene of this reference — its " .
            "literal color(s) or gradient, any texture/pattern/surface visible, where the product sits in the " .
            "frame and how large it is relative to the frame, any shadow/lighting treatment. CRITICAL — if there " .
            "are any additional real/photographed objects, props, or ingredients arranged in the frame around the " .
            "product (e.g. scattered herbs, fruit, spices, fabric swatches, flowers, tools — anything beyond a " .
            "plain or textured backdrop), you MUST list what each one is, roughly how many, and where each sits " .
            "relative to the product — these are load-bearing content, not decoration, and must not be omitted " .
            "or summarized away. If the background is genuinely plain with no such objects, say so explicitly " .
            "instead of leaving this out>\", " .
            "\"labels\": \"<2-3 sentences describing EXACTLY how the callouts/labels are rendered in this " .
            "reference — their shape (rounded pill, rectangular chip, plain text, numbered marker, circular icon " .
            "badge, hand-drawn tag, etc.), their fill/border color, the connector style linking them to the " .
            "product (straight leader line, dotted arrow, curved line, hand-drawn arrow, or none), their " .
            "approximate arrangement (e.g. 'stacked vertically down the left side', 'scattered around the product " .
            "at varying distances', 'arranged in a ring'), and the typography style (font weight, case, serif vs " .
            "sans-serif)>\", \"extra_elements\": \"<any additional on-image element present beyond the product " .
            "photo and the callouts — e.g. a headline, a size chart, color swatches, a price badge, a brand " .
            "wordmark — described generically (its style/position), not its literal text; empty string if none>\"}";

        $mime = @mime_content_type($referenceImagePath) ?: 'image/jpeg';
        $bytes = @file_get_contents($referenceImagePath);
        if ($bytes === false || $bytes === '') {
            return [];
        }
        $b64 = base64_encode($bytes);

        try {
            $response = $this->chatCompletion([
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => [
                    ['type' => 'text', 'text' => 'Transcribe this reference infographic\'s design.'],
                    ['type' => 'image_url', 'image_url' => ['url' => "data:{$mime};base64,{$b64}"]],
                ]],
            ], 700);
        } catch (\Throwable $e) {
            return [];
        }

        $raw = $response['choices'][0]['message']['content'] ?? '{}';
        $raw = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', trim($raw));
        $result = json_decode($raw, true);
        if (!is_array($result)) {
            return [];
        }

        $look   = trim((string)($result['look'] ?? ''));
        $labels = trim((string)($result['labels'] ?? ''));
        if ($look === '' || $labels === '') {
            return [];
        }

        $category = strtolower(trim((string)($result['category'] ?? '')));

        return [
            'category'       => $category === 'fmcg' ? 'fmcg' : 'clothing',
            'layout_id'      => 'reference-match',
            'layout_name'    => 'Reference Match',
            'look'           => $look,
            'labels'         => $labels,
            'extra_elements' => trim((string)($result['extra_elements'] ?? '')),
        ];
    }

    /**
     * Shared quality-guardrail prose reused by generateInfographicImage()
     * regardless of whether $plan came from planVisualGeneration() (layout-
     * library-driven) or analyzeReferenceDesign() (reference-image-driven)
     * — everything that's true regardless of which design mechanic is in
     * play: photo/face preservation, exact label count and text, layout
     * variation per regenerate, typo/spacing/contrast rules, and the
     * optional brand-color / scene-plan / extra-element hints.
     *
     * $information is the normalized per-label array from
     * annotateInformation() — always one entry per label with 'text' set;
     * 'position'/'orientation'/'visual_connection' are null when no
     * enrichment is available (reference mode, generic fallback, or a
     * degraded assignInformationLayout() call), in which case that label
     * gets no bracketed placement hint and falls back to the general
     * composition/label-mechanic rules below, identical to this feature's
     * pre-existing behavior.
     */
    private function buildQualityRulesBlock(
        array $information,
        string $labelMechanic,
        string $extraElements,
        string $customStylePrompt,
        int $variation,
        string $description,
        ?array $brandColors,
        ?array $scenePlan,
        bool $literalMatch = false
    ): string {
        // Numbered list, not a flat comma-separated string — gives the model
        // an explicit slot per label instead of one blob of text to parse,
        // which measurably reduces it losing count and duplicating one. Each
        // item optionally carries a bracketed [position: ..., orientation:
        // ..., visually connect to: ... (how it looks)] hint from the Visual
        // Generation Plan — this is the concrete fix for labels connecting
        // to visually unrelated props: the object drawn next to a label is
        // now explicitly tied to that label's own claim, not improvised.
        $points = implode('; ', array_map(
            function (array $item, int $i) {
                $bits = [];
                if (!empty($item['position']))    $bits[] = "position: {$item['position']}";
                if (!empty($item['orientation'])) $bits[] = "orientation: {$item['orientation']}";
                if (!empty($item['visual_connection'])) {
                    $conn = (string)$item['visual_connection'];
                    $visual = InfographicSkillLibrary::materialVisual($conn);
                    $bits[] = $visual !== null
                        ? "visually connect to {$conn} ({$visual})"
                        : "visually connect to {$conn}";
                }
                $suffix = !empty($bits) ? ' [' . implode(', ', $bits) . ']' : '';
                return ($i + 1) . '. "' . $item['text'] . '"' . $suffix;
            },
            $information,
            array_keys($information)
        ));
        $pointCount = count($information);

        // $literalMatch ("match a reference" mode) skips VARIATION_HINTS
        // entirely — those are hardcoded, very literal staging directions
        // ("shrink the product to 55% width, stack labels in a column,
        // connect with a horizontal line") meant to force visual variety
        // across "Regenerate" clicks of the SAME freely-invented style. In
        // reference mode the whole point is to reproduce the transcribed
        // reference's actual layout; being far more concrete than the
        // prose design direction, a VARIATION_HINTS instruction reliably
        // overrides and replaces it instead of coexisting with it — e.g. a
        // reference with no connector lines came out with a hardcoded
        // "connect with a horizontal line" clause winning anyway.
        $compositionClause = $literalMatch
            ? 'Composition — follow the design direction above literally and precisely for the product\'s exact ' .
              'placement, scale, and surrounding scene; do not shrink, reposition, recolor, or rearrange it into a ' .
              'different generic layout — reproduce the transcribed reference\'s actual composition as closely as ' .
              'possible. '
            : 'Composition for this variation: ' . self::VARIATION_HINTS[($variation - 1) % count(self::VARIATION_HINTS)] . ' ';

        return
            "CRITICAL — the photographed pixels of the product/model themselves must never be redrawn, restyled, " .
            "re-illustrated, or reinterpreted — reuse the exact same photograph, unaltered. The photo's SIZE and " .
            "POSITION within the frame should follow the arrangement instructions below (they intentionally vary " .
            "between creative variations), but the content of the photo itself must not change. " .
            "If a person appears in the photo, their face, identity, skin tone, expression, and hair must stay " .
            "completely identical to the source photo — do not regenerate, beautify, reinterpret, or subtly " .
            "change the face in any way; treat the person exactly like the rest of the untouched photograph. " .
            "Render exactly {$pointCount} labels as {$labelMechanic} — one label per numbered item below, each " .
            "shown verbatim, each appearing in the image exactly once and nowhere else: {$points}. Where a " .
            "numbered item includes a bracketed hint, follow it for exactly that label's placement, angle, and " .
            "the specific real object/material it should sit near and visually reference — render an actual " .
            "photorealistic depiction of anything named there. Items with no bracketed hint have no specific " .
            "placement requirement beyond the general composition and label-mechanic rules here. These " .
            "{$pointCount} numbered items are the ONLY pieces of callout text permitted anywhere in the image — " .
            "never repeat, duplicate, or partially re-render the same or a similar label a second time anywhere " .
            "in the frame, even smaller, faded, in the background, or in a shortened/truncated form — each " .
            "numbered item corresponds to exactly one label and no more. This holds even if the layout's overall " .
            "pattern visually suggests more symmetric slots or positions than there are labels (for example, a " .
            "layout whose callouts orbit all four corners of the product, but only 3 genuinely distinct labels " .
            "are given): in that case it is CORRECT and EXPECTED to leave the extra slot(s) with no text at all " .
            "— fill them with pure decorative negative space, a subtle prop, or nothing, never by repeating, " .
            "renaming, or splitting an existing label just to make the composition feel symmetric. A visually " .
            "asymmetric result with the exact right label count is always correct; a symmetric result achieved by " .
            "duplicating a label is always wrong. If the design direction above calls for scattered props/" .
            "ingredients as scene texture, draw AT MOST {$pointCount} distinct prop clusters — never more than " .
            "one prop per label. If you naturally want fewer props than labels, that's fine: connect the " .
            "remaining label(s) directly to a clear point on the product instead. Under no circumstances invent " .
            "an extra prop and then repeat an existing label's text on it just to give every prop a label — a " .
            "missing prop is fine, a duplicated label is not. Before finishing, count the labels you have drawn " .
            "and confirm the total is exactly {$pointCount}, with zero repeats. " .
            $compositionClause .
            ($customStylePrompt !== '' ? "Merchant's background/theme request — follow this closely: {$customStylePrompt}. " : '') .
            ($variation > 1 && !$literalMatch ? "This is a fresh creative variation — it must look structurally different from a " .
                "typical or previous layout of the same product (different label arrangement and photo " .
                "size/position per the composition instruction above, AND a freshly invented color palette and " .
                "background scenario per the design direction above — do not reuse the same colors as a " .
                "previous variation). Keep the same label mechanic (per the design direction above) and the " .
                "same label text. " : '') .
            ($variation > 1 && $literalMatch ? "This is a regeneration of the same reference match — keep the " .
                "same overall composition and design faithful to the reference described above; only natural " .
                "stochastic variation in the exact render is expected, not a structurally different layout. " : '') .
            'PRODUCTION QUALITY — this must be indistinguishable from a real, professionally shot and composited ' .
            'e-commerce marketing asset — photorealistic, seamless, and polished throughout, with natural lighting ' .
            'and shadow continuity between the photo and the design elements around it. Avoid any flat, uncanny, ' .
            'or "obviously AI-generated" look. Triple-check the spelling of every single rendered word against the ' .
            'key points given above, letter by letter — zero typos, zero misspellings, zero invented words. Use a ' .
            'clear, consistent typographic hierarchy — all key-point labels the same readable size as each other ' .
            '(never one label huge and another tiny), a headline (if any) modestly larger than the labels, ' .
            'generous line-height so wrapped text never looks cramped. Use at most two font families total across ' .
            'the whole image. Keep a generous safe margin on all four ' .
            'edges of the frame — no label text, connector line, badge, or icon may be cut off, clipped, or touch ' .
            'the frame border. Leave clear empty space between every label and the next so nothing overlaps or ' .
            'collides. Ensure every piece of text has strong, comfortably legible contrast against whatever sits ' .
            'directly behind it. If any icons are used, every icon in the image must share the same stroke width, ' .
            'the same visual style (all line-icons or all filled-icons, never mixed), and consistent sizing ' .
            'relative to each other — never distorted or stretched. ' .
            ($extraElements !== ''
                ? "Additional element this design specifically calls for — include exactly this, and nothing " .
                  "more beyond it and the {$pointCount} labels: {$extraElements}. "
                : "Do NOT add any headline, title, subtitle, tagline, banner text, product name, or any other " .
                  "text beyond exactly the {$pointCount} labels — the image must contain only the product photo " .
                  "and those labels, nothing else written anywhere in the frame. ") .
            'Every label (its full text box, badge, or chip) must sit entirely in open, uncluttered space — ' .
            'never on top of the product/model photo itself, never overlapping the garment, skin, or hair, and ' .
            'never overlapping any other prop/ingredient object in the scene. Only the thin connector line (and ' .
            'its small dot, if the design uses one) may cross into the product photo OR extend to another scene ' .
            'element (e.g. a scattered ingredient/prop) to reach its point of reference — follow whichever the ' .
            'design direction above actually describes; the label text itself always stays clear of anything it ' .
            'points to. If the design direction describes scattered real objects/ingredients/props as visual ' .
            'texture and a label has no bracketed visual-connection hint above, do NOT invent a false one-to-one ' .
            'pairing between one exact prop and that label — position it and its connector line to whichever ' .
            'nearby prop or point on the product reads cleanly and legibly, without implying a specific ' .
            'correspondence the underlying facts don\'t support. ' .
            ($description !== '' ? "Product context for tone only, do not add extra body text: {$description}. " : '') .
            (!empty($brandColors) ? $this->buildBrandColorHint($brandColors) : '') .
            (!empty($scenePlan) ? $this->buildScenePlanHint($scenePlan) : '') .
            'High-quality commercial marketing look, no watermarks, no extra logos.';
    }

    /**
     * Anchors the invented palette to the merchant's actual storefront brand
     * colors (from WidgetSettingsRepo::getButtonConfig) instead of leaving it
     * fully unconstrained — real "Design RAG" grounding, sourced from SQL
     * rather than a vector search since it's a single row per merchant.
     */
    private function buildBrandColorHint(array $brandColors): string
    {
        $primary   = $brandColors['button_color']    ?? null;
        $secondary = $brandColors['hover_bg_color']   ?? null;
        $accent    = $brandColors['icon_color']       ?? null;

        $parts = array_filter([
            $primary   ? "primary brand color {$primary}"   : null,
            $secondary ? "secondary tone {$secondary}"      : null,
            $accent    ? "accent color {$accent}"           : null,
        ]);
        if (empty($parts)) return '';

        $list = implode(', ', $parts);
        return "Brand color anchor — this merchant's storefront uses {$list}; build the palette you invent for " .
            "this generation around those colors (you may still add complementary neutrals) rather than an " .
            "unrelated palette, so the result feels visually consistent with their brand. ";
    }

    /**
     * Folds the Layout Planning Agent's structural plan (see
     * OpenAIClient::planInfographicScene()) into prose — gpt-image-1 takes
     * natural language, not pixel-coordinate JSON, so "plan before render"
     * here means emphasis + ordering guidance, not literal element positions.
     */
    private function buildScenePlanHint(array $scenePlan): string
    {
        $headline = trim((string)($scenePlan['headline_point'] ?? ''));
        $order    = $scenePlan['section_order'] ?? [];

        $hint = '';
        if ($headline !== '') {
            $hint .= "Content emphasis — give the label \"{$headline}\" slightly more visual weight (larger or " .
                "bolder, while still matching the style's overall label mechanic) than the other labels, since " .
                "it is this product's single strongest selling point. ";
        }
        if (!empty($order) && is_array($order)) {
            $orderList = implode(' → ', array_map('strval', $order));
            $hint .= "Arrange the labels so a viewer's eye naturally moves through them in this order: {$orderList}. ";
        }
        return $hint;
    }

    // Fixed named palettes for the 'collage' style — one is picked at random
    // per generation and its literal hex values are embedded in all four
    // panel prompts identically. The other styles leave color "invent fresh
    // each generation" to gpt-image-1 on purpose, but that only works
    // within a single API call; four independent calls each inventing
    // their own palette would produce four images that don't visually
    // belong together. Picking one fixed palette in PHP and quoting the
    // exact hex codes into every call keeps the set coherent while still
    // varying between different generations/regenerations.
    private const COLLAGE_PALETTES = [
        ['background' => 'warm cream (#F3EEE4)',       'accent' => 'deep forest green (#1F5C3E)', 'text' => 'near-black charcoal (#1A1A1A)'],
        ['background' => 'soft blush pink (#F7E9E6)',  'accent' => 'deep rose (#8C3B4A)',          'text' => 'near-black charcoal (#1A1A1A)'],
        ['background' => 'pale sage grey-green (#E7EAE2)', 'accent' => 'warm terracotta clay (#B5622F)', 'text' => 'near-black charcoal (#1A1A1A)'],
        ['background' => 'soft powder blue (#E7EEF3)', 'accent' => 'deep navy (#1E3A5C)',          'text' => 'near-black charcoal (#1A1A1A)'],
        ['background' => 'warm ivory (#F6F1E8)',       'accent' => 'deep burgundy (#5C2331)',      'text' => 'near-black charcoal (#1A1A1A)'],
    ];

    /**
     * Generates the 'collage' style as FOUR separate standalone images (a
     * hero shot + two close-up detail shots with zoom-circle callouts + a
     * second features shot) rather than one stitched grid image — matching
     * how the reference social-media carousels are actually separate slide
     * images, not one composited picture. All four reuse the same single
     * source photo (re-cropped/re-zoomed per image, never a genuinely new
     * angle) and the same fixed color palette so they read as one matching
     * set. Returns ['hero' => bytes, 'detail1' => bytes, 'detail2' => bytes,
     * 'features' => bytes].
     */
    public function generateCollagePanels(
        string $imagePath,
        array $keyPoints,
        string $description = '',
        string $customStylePrompt = '',
        ?string $size = null
    ): array {
        // Portrait by default — matches how the reference social-media
        // carousel slides are usually framed. An explicit $size (from the
        // merchant's Square/Portrait/Landscape picker) overrides this for
        // all four panels so the set stays consistent with itself.
        $size = $size ?? '1024x1536';

        // Split in PHP, not left for the model to improvise — an earlier
        // single-grid-image version of this style left the distribution
        // ambiguous and produced a duplicated label, a truncated label, and
        // one panel with no callout at all. Fixed slices per image avoid
        // that; reuse of the same point across images is fine (the
        // reference creatives repeat claims across slides too).
        $half   = (int) ceil(count($keyPoints) / 2);
        $heroPoints     = array_slice($keyPoints, 0, $half);
        $featurePoints  = array_slice($keyPoints, $half) ?: $heroPoints;
        $detail1Label   = $heroPoints[0];
        $detail2Label   = $featurePoints[0];

        $palette = self::COLLAGE_PALETTES[array_rand(self::COLLAGE_PALETTES)];

        // All 4 panels are independent requests against the same source
        // photo, so they run concurrently via curl_multi rather than one
        // after another — see requestGeneratedImagesParallel().
        return $this->requestGeneratedImagesParallel([
            'hero'     => [
                'imagePaths' => [$imagePath],
                'prompt'     => $this->buildCollageBadgePrompt(1, $heroPoints, $palette, $description, $customStylePrompt),
                'size'       => $size,
            ],
            'detail1'  => [
                'imagePaths' => [$imagePath],
                'prompt'     => $this->buildCollageDetailPrompt(2, $detail1Label, $palette, $customStylePrompt),
                'size'       => $size,
            ],
            'detail2'  => [
                'imagePaths' => [$imagePath],
                'prompt'     => $this->buildCollageDetailPrompt(3, $detail2Label, $palette, $customStylePrompt),
                'size'       => $size,
            ],
            'features' => [
                'imagePaths' => [$imagePath],
                'prompt'     => $this->buildCollageBadgePrompt(4, $featurePoints, $palette, $description, $customStylePrompt),
                'size'       => $size,
            ],
        ]);
    }

    /** Shared fidelity/quality rules reused by every collage panel prompt. */
    private function collageSharedRules(int $imageNum, array $palette, string $customStylePrompt): string
    {
        return
            "This is image {$imageNum} of 4 in a matching product-creative set (a hero shot, two close-up detail " .
            "shots, and a features shot) — even though each is generated separately, they must all look like they " .
            "belong to the same set: identical background color, identical badge/label design, identical " .
            "typography style. Use EXACTLY this palette, no deviation: background {$palette['background']}, " .
            "badge/accent color {$palette['accent']}, text color {$palette['text']}. " .
            "CRITICAL — reuse the exact same source photograph, unaltered pixels, for the product/model — never " .
            "redraw, re-illustrate, or reinterpret it, only crop/zoom into it. Never invent a different angle or " .
            "pose that isn't actually visible in the source photo (no true back view if the source is a " .
            "front-facing photo, for example). If a person's face is visible, their face, identity, skin tone, " .
            "expression, and hair must stay completely identical to the source photo. " .
            ($customStylePrompt !== '' ? "Merchant's background/theme request — follow this closely: {$customStylePrompt}. " : '') .
            'PRODUCTION QUALITY — indistinguishable from a real, professionally shot and composited e-commerce ' .
            'social-media creative — photorealistic, seamless, polished. Avoid any flat, uncanny, or "obviously ' .
            'AI-generated" look. Triple-check the spelling of every rendered word, letter by letter — zero typos, ' .
            'zero misspellings, zero invented words. Keep a generous safe margin on all four edges of the frame — ' .
            'no text, line, badge, icon, or zoom-circle may be cut off, clipped, or touch the frame border. Use at ' .
            'most two font families total. Ensure text has strong, comfortably legible contrast against whatever ' .
            'sits behind it. Every icon must share the same stroke width, the same visual style (all line-icons or ' .
            'all filled-icons, never mixed), and consistent sizing — never distorted or stretched. ' .
            'High-quality commercial marketing look, no watermarks, no extra logos.';
    }

    /** Prompt for the two "hero"/"features" collage panels — a wide crop + a stack of icon badges. */
    private function buildCollageBadgePrompt(int $imageNum, array $points, array $palette, string $description, string $customStylePrompt): string
    {
        $list = implode('; ', array_map(
            fn($p, $i) => ($i + 1) . '. "' . $p . '"',
            $points,
            array_keys($points)
        ));

        return
            "Design a clean product marketing shot. Place the source photo off-center, filling most of the frame, " .
            "on a plain {$palette['background']} background. Add a compact vertical stack of small rounded icon " .
            "badges beside the product. Render exactly " . count($points) . " badge(s), no more and no fewer, one " .
            "badge per numbered item below, each badge holding its ENTIRE quoted phrase as one single indivisible " .
            "unit of text — never split one quoted item across two badges, never merge two items into one badge, " .
            "never shorten a multi-word phrase down to one word: {$list}. Tall portrait composition. Do NOT add " .
            "any headline, title, or extra text beyond these badges. " .
            "Every badge must sit entirely in open background space, never on top of the product/model photo " .
            "itself. " .
            $this->collageSharedRules($imageNum, $palette, $customStylePrompt) .
            ($description !== '' ? " Product context for tone only, do not add extra body text: {$description}." : '');
    }

    /** Prompt for the two detail-zoom collage panels — a tight crop + one zoom-circle callout. */
    private function buildCollageDetailPrompt(int $imageNum, string $label, array $palette, string $customStylePrompt): string
    {
        return
            "Design a close-up product detail shot. Crop and zoom tightly into one specific region of the garment " .
            "from the source photo (e.g. a sleeve, collar, seam, or waistband — whichever is actually visible), " .
            "filling most of the frame, with a plain {$palette['background']} background around the edges where " .
            "needed. Add exactly ONE small circular zoom-inset bubble showing an extreme close-up magnification " .
            "of that exact spot, linked by a short thin dashed leader line directly to exactly ONE text label box " .
            "attached to that same line. That label must show the complete phrase \"{$label}\" as one single " .
            "indivisible unit of text — not split, not shortened to a single word from it — and it must not " .
            "appear anywhere else in the image as a separate freestanding badge. Do NOT add any other text. " .
            $this->collageSharedRules($imageNum, $palette, $customStylePrompt);
    }

    /**
     * Applies a merchant-provided free-text edit to an already-generated
     * infographic image (background swap, label tweak, color change, etc.)
     * via the same OpenAI image model, iterating on the existing artwork
     * instead of starting over.
     *
     * $backgroundImagePath, if given, is sent as a second reference image —
     * gpt-image-1's edits endpoint accepts multiple input images and can
     * composite them, so the merchant's uploaded photo becomes the new
     * background while the product/labels come from the first image.
     */
    public function editInfographicImage(string $imagePath, string $editPrompt, ?string $backgroundImagePath = null): string
    {
        $prompt =
            'This is a marketing infographic that was generated for an e-commerce product (the first image). ' .
            'Apply the following edit request while keeping everything else in the image — the product, the ' .
            'other labels, the headline — unchanged unless the request says otherwise: ' . $editPrompt . '. ' .
            ($backgroundImagePath !== null
                ? 'A second reference image is provided — use it as the new background for the infographic ' .
                  '(crop/extend it to fill the frame naturally). Keep the product photo and all labels from the ' .
                  'first image exactly as they are, just composited onto this new background. '
                : '') .
            'CRITICAL — the product/model photo itself must stay pixel-for-pixel exactly as it currently appears: ' .
            'the exact same scale, crop, framing, and position within the frame. Do not zoom, re-crop, resize, or ' .
            'reposition it, even slightly, while applying this edit. If a person appears in the photo, their face, ' .
            'identity, skin tone, expression, and hair must stay completely identical to how they appear right ' .
            'now — never regenerate, beautify, or alter the face. ' .
            'PRODUCTION QUALITY — this must remain indistinguishable from a real, professionally shot and ' .
            'composited e-commerce marketing asset — photorealistic and seamless, not flat or "AI-generated" ' .
            'looking. Never repeat, duplicate, or partially re-render any label a second time anywhere in the ' .
            'frame. Triple-check the spelling of every rendered word, letter by letter, against the existing ' .
            'label text — zero typos, zero misspellings. Keep a generous safe margin on all four edges of the ' .
            'frame — no text, line, badge, or icon may be cut off, clipped, or touch the frame border. Keep all ' .
            'label text the same consistent, readable size as each other unless the edit specifically asks to ' .
            'change sizing. Keep all existing text crisp, legible, and correctly spelled.';

        $imagePaths = $backgroundImagePath !== null ? [$imagePath, $backgroundImagePath] : [$imagePath];

        // Match the output size to whatever aspect the image being edited
        // already has, so an edit never squashes a portrait infographic
        // back into a square (or vice versa).
        $size = $this->detectPortraitSize($imagePath);

        return $this->requestGeneratedImage($imagePaths, $prompt, $size);
    }

    /** Portrait (1024x1536) if $imagePath is taller than it is wide, otherwise square (1024x1024). */
    private function detectPortraitSize(string $imagePath): string
    {
        $dims = @getimagesize($imagePath);
        return ($dims && $dims[1] > $dims[0]) ? '1024x1536' : '1024x1024';
    }

    private function requestGeneratedImage(array $imagePaths, string $prompt, string $size = '1024x1024'): string
    {
        $ch = $this->buildImageEditHandle($imagePaths, $prompt, $size);
        $raw      = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        return $this->decodeImageResponse($this->parseImageEditResponse($raw, $httpCode, $curlErr));
    }

    /**
     * Runs several images/edits requests concurrently via curl_multi instead
     * of one after another — the 'collage' style needs 4 separate gpt-image-1
     * calls per generation, and each can individually take up to a minute or
     * more at high quality/portrait size, so running them sequentially risked
     * a 2-4 minute round trip and real timeout failures. $jobs is keyed
     * ['key' => ['imagePaths' => [...], 'prompt' => string, 'size' => string]];
     * returns ['key' => raw PNG bytes] in the same keys. Throws if any job
     * fails (mirrors the single-request behaviour — a partial collage isn't a
     * useful result).
     */
    private function requestGeneratedImagesParallel(array $jobs): array
    {
        $mh      = curl_multi_init();
        $handles = [];
        foreach ($jobs as $key => $job) {
            $ch = $this->buildImageEditHandle($job['imagePaths'], $job['prompt'], $job['size']);
            curl_multi_add_handle($mh, $ch);
            $handles[$key] = $ch;
        }

        $running = null;
        do {
            $status = curl_multi_exec($mh, $running);
            if ($running) {
                curl_multi_select($mh, 1.0);
            }
        } while ($running > 0 && $status === CURLM_OK);

        $results = [];
        $errors  = [];
        foreach ($handles as $key => $ch) {
            $raw      = curl_multi_getcontent($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlErr  = curl_error($ch);
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);

            try {
                $results[$key] = $this->decodeImageResponse($this->parseImageEditResponse($raw, $httpCode, $curlErr));
            } catch (\Throwable $e) {
                $errors[$key] = $e->getMessage();
            }
        }
        curl_multi_close($mh);

        if (!empty($errors)) {
            throw new \RuntimeException('Collage generation failed for: ' . implode('; ', array_map(
                fn($k, $m) => "{$k} ({$m})",
                array_keys($errors),
                $errors
            )));
        }

        return $results;
    }

    private function decodeImageResponse(array $response): string
    {
        $b64 = $response['data'][0]['b64_json'] ?? null;
        if (!is_string($b64) || $b64 === '') {
            throw new \RuntimeException('OpenAI did not return an image.');
        }
        $bytes = base64_decode($b64, true);
        if ($bytes === false) {
            throw new \RuntimeException('OpenAI returned an invalid image payload.');
        }
        return $bytes;
    }

    // ── Private HTTP helpers ───────────────────────────────────────────────────

    /**
     * $imagePaths is one or more source images. A single image is sent under
     * the plain `image` field (unchanged, proven behaviour); more than one is
     * sent as repeated `image[]` fields, which requires hand-building the
     * multipart body since PHP's CURLOPT_POSTFIELDS array can't hold two
     * entries under the same key. Returns an un-executed curl handle so
     * callers can either curl_exec() it directly or hand it to curl_multi for
     * concurrent execution.
     */
    private function buildImageEditHandle(array $imagePaths, string $prompt, string $size = '1024x1024')
    {
        $fieldName = count($imagePaths) > 1 ? 'image[]' : 'image';
        $parts = [
            ['name' => 'model',   'contents' => self::IMAGE_MODEL],
            ['name' => 'prompt',  'contents' => $prompt],
            ['name' => 'size',    'contents' => $size],
            // 'medium' (down from 'high') — gpt-image-1's own generation
            // time is BY FAR the dominant cost of the whole infographic
            // pipeline (60-115s+ observed at 'high', dwarfing every other
            // step combined), and no amount of pipeline-side optimization
            // can shrink an OpenAI-side latency this codebase doesn't
            // control. Deliberate quality-for-speed tradeoff per explicit
            // merchant request for generation to reliably land under 60s —
            // 'medium' is still a real quality tier (not 'low'), just
            // faster than 'high'.
            ['name' => 'quality', 'contents' => 'medium'],
            ['name' => 'n',       'contents' => '1'],
        ];
        foreach ($imagePaths as $path) {
            $parts[] = [
                'name'     => $fieldName,
                'file'     => $path,
                'filename' => basename($path),
                'mime'     => mime_content_type($path) ?: 'image/jpeg',
            ];
        }

        $boundary = 'ig' . bin2hex(random_bytes(16));
        $body     = $this->buildMultipartBody($parts, $boundary);

        $ch = curl_init(self::BASE_URL . '/images/edits');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            // High-quality gpt-image-1 generation at portrait size can take
            // well over a minute — give it real headroom instead of racing
            // the outer PHP/frontend timeouts.
            CURLOPT_TIMEOUT        => 160,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $this->apiKey,
                'Content-Type: multipart/form-data; boundary=' . $boundary,
            ],
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);

        return $ch;
    }

    private function parseImageEditResponse($raw, int $httpCode, string $curlErr): array
    {
        if ($curlErr) {
            throw new \RuntimeException("OpenAI image request failed: {$curlErr}");
        }
        $data = json_decode((string) $raw, true) ?? [];
        if ($httpCode >= 400) {
            $msg = $data['error']['message'] ?? "OpenAI image error HTTP {$httpCode}";
            writeLog('ERROR', 'OpenAI images/edits request failed', [
                'http_code' => $httpCode,
                'response'  => $data ?: substr((string) $raw, 0, 500),
            ]);
            throw new \RuntimeException($msg);
        }
        return $data;
    }

    /**
     * Hand-rolled multipart/form-data body builder — needed because array
     * fields (`image[]` repeated for multi-image edits) can't be expressed
     * as a plain PHP associative array passed to CURLOPT_POSTFIELDS, which
     * requires unique keys.
     */
    private function buildMultipartBody(array $parts, string $boundary): string
    {
        $body = '';
        foreach ($parts as $part) {
            $body .= "--{$boundary}\r\n";
            if (isset($part['file'])) {
                $body .= "Content-Disposition: form-data; name=\"{$part['name']}\"; filename=\"{$part['filename']}\"\r\n";
                $body .= "Content-Type: {$part['mime']}\r\n\r\n";
                $body .= (string) file_get_contents($part['file']);
            } else {
                $body .= "Content-Disposition: form-data; name=\"{$part['name']}\"\r\n\r\n";
                $body .= (string) $part['contents'];
            }
            $body .= "\r\n";
        }
        $body .= "--{$boundary}--\r\n";
        return $body;
    }

    private function chatCompletion(array $messages, int $maxTokens = 300, string $stage = 'chat'): array
    {
        $response = $this->jsonRequest('POST', '/chat/completions', [
            'model'       => self::CHAT_MODEL,
            'messages'    => $messages,
            'max_tokens'  => $maxTokens,
            'temperature' => 0.2,
        ]);
        $this->recordUsage($stage, $response['usage'] ?? null);
        return $response;
    }

    /**
     * Runs several /chat/completions requests concurrently via curl_multi —
     * same mechanism as requestGeneratedImagesParallel(), applied to the
     * cheap text-only planning calls instead of image generation. $jobs is
     * keyed ['key' => ['messages' => [...], 'maxTokens' => int]]; returns
     * ['key' => decoded_response_array] for whichever jobs succeeded. Unlike
     * requestGeneratedImagesParallel(), a failed job is simply OMITTED from
     * the result (not thrown) — every caller of this method already has a
     * documented per-item fallback for a missing/failed planning call, so a
     * partial result here is a normal, handled outcome, not an error state.
     */
    private function runParallelChatCompletions(array $jobs): array
    {
        $mh      = curl_multi_init();
        $handles = [];
        foreach ($jobs as $key => $job) {
            $ch = $this->buildChatCompletionHandle($job['messages'], $job['maxTokens'] ?? 300);
            curl_multi_add_handle($mh, $ch);
            $handles[$key] = $ch;
        }

        $running = null;
        do {
            $status = curl_multi_exec($mh, $running);
            if ($running) {
                curl_multi_select($mh, 1.0);
            }
        } while ($running > 0 && $status === CURLM_OK);

        $results = [];
        foreach ($handles as $key => $ch) {
            $raw      = curl_multi_getcontent($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlErr  = curl_error($ch);
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);

            if ($curlErr || $httpCode >= 400) {
                writeLog('WARN', 'Parallel chat-completion job failed', ['key' => $key, 'http_code' => $httpCode, 'curl_error' => $curlErr]);
                continue;
            }
            $data = json_decode((string) $raw, true);
            if (is_array($data)) {
                $results[$key] = $data;
            }
        }
        curl_multi_close($mh);

        return $results;
    }

    /** Un-executed curl handle for one /chat/completions call — same request shape as chatCompletion()/jsonRequest(), split out so runParallelChatCompletions() can hand it to curl_multi instead of curl_exec(). */
    private function buildChatCompletionHandle(array $messages, int $maxTokens = 300)
    {
        $body = json_encode([
            'model'       => self::CHAT_MODEL,
            'messages'    => $messages,
            'max_tokens'  => $maxTokens,
            'temperature' => 0.2,
        ]);

        $ch = curl_init(self::BASE_URL . '/chat/completions');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => 'POST',
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->apiKey,
            ],
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);

        return $ch;
    }

    private function jsonRequest(string $method, string $path, array $body): array
    {
        $url = self::BASE_URL . $path;
        $ch  = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_POSTFIELDS     => json_encode($body),
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->apiKey,
            ],
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);

        $raw      = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($curlErr) {
            throw new \RuntimeException("OpenAI request failed: {$curlErr}");
        }
        $data = json_decode((string) $raw, true) ?? [];
        if ($httpCode >= 400) {
            $msg = $data['error']['message'] ?? "OpenAI error HTTP {$httpCode}";
            throw new \RuntimeException($msg);
        }
        return $data;
    }
}
