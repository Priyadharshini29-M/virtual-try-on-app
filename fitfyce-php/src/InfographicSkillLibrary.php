<?php

declare(strict_types=1);

namespace VTON;

/**
 * Loads config/infographic_archetypes.json — the structured design-knowledge
 * base grounding infographic generation, per docs/skill.md's architecture:
 *   categories:  11 product categories. 'fmcg' and 'clothing' carry full
 *                content (extraction_fields, priority_tiers, 3 named layouts,
 *                typography, visual_rules, copy_pattern); the other 9 declare
 *                a 'layout_bucket' pointing at whichever of those two their
 *                content most resembles ('other' has no bucket — it falls
 *                back to a generic guide entirely in PHP, see
 *                OpenAIClient::resolveArchetype()-equivalent fallbacks).
 *   material_visual_map: fabric/ingredient name → how it should actually look
 *                when rendered (e.g. 'satin' → 'smooth reflective surface,
 *                soft sheen, flowing drape'), so a label naming a material
 *                gets shown, not just captioned.
 *
 * This is a deliberately deterministic, category-keyed lookup rather than a
 * vector-embedded/retrieved corpus — the category is already known by the
 * time this data is needed (from the photo-classification step), so a fuzzy
 * similarity search would only add cost and failure surface for content
 * that's fully known ahead of time. See [[project_ai_studio_module]] for the
 * full rationale.
 *
 * Kept as a bundled JSON file (not read from docs/) so it ships with the PHP
 * app regardless of how it's deployed.
 */
class InfographicSkillLibrary
{
    private static ?array $data = null;

    private static function load(): array
    {
        if (self::$data !== null) {
            return self::$data;
        }
        $path = dirname(__DIR__) . '/config/infographic_archetypes.json';
        $raw = is_file($path) ? file_get_contents($path) : false;
        $decoded = $raw !== false ? json_decode($raw, true) : null;
        self::$data = is_array($decoded) ? $decoded : ['categories' => [], 'material_visual_map' => []];
        return self::$data;
    }

    /** @return array<string, array> all 11 categories, keyed by category id, as raw JSON entries */
    public static function categories(): array
    {
        return self::load()['categories'] ?? [];
    }

    /** @return string[] all 11 recognized category ids */
    public static function categoryIds(): array
    {
        return array_keys(self::categories());
    }

    public static function category(string $id): ?array
    {
        return self::categories()[$id] ?? null;
    }

    /** Detection hint used by the classification vision prompt — what this category typically looks like in a photo. */
    public static function detectionHint(string $id): string
    {
        return (string)(self::category($id)['detection_hint'] ?? '');
    }

    /**
     * Resolves a category id to the category entry that actually carries full
     * content (extraction_fields/priority_tiers/layouts/typography/visual_rules/
     * copy_pattern) — either the category itself (fmcg, clothing) or, for the
     * other 9, whichever of those two its 'layout_bucket' points at. Returns
     * null for 'other' (or any category with neither content nor a bucket) —
     * callers must have their own generic fallback for that case.
     */
    public static function resolvedContent(string $id): ?array
    {
        $cat = self::category($id);
        if ($cat === null) return null;
        if (isset($cat['layouts'])) return $cat;
        $bucket = $cat['layout_bucket'] ?? null;
        return $bucket !== null ? self::category($bucket) : null;
    }

    /** @return string[] extraction field names for this category (bucket-resolved), [] if none (e.g. 'other'). */
    public static function extractionFields(string $categoryId): array
    {
        $content = self::resolvedContent($categoryId);
        return is_array($content['extraction_fields'] ?? null) ? $content['extraction_fields'] : [];
    }

    /** @return array{1: string[], 2: string[], 3: string[]} priority tier field names, bucket-resolved. */
    public static function priorityTiers(string $categoryId): array
    {
        $content = self::resolvedContent($categoryId);
        $tiers = $content['priority_tiers'] ?? [];
        return [
            1 => is_array($tiers['1'] ?? null) ? $tiers['1'] : [],
            2 => is_array($tiers['2'] ?? null) ? $tiers['2'] : [],
            3 => is_array($tiers['3'] ?? null) ? $tiers['3'] : [],
        ];
    }

    /** @return array<string, array{name: string, description: string, good_for?: string[]}> the 3 named layouts (A/B/C), bucket-resolved. [] for 'other'. */
    public static function layouts(string $categoryId): array
    {
        $content = self::resolvedContent($categoryId);
        return is_array($content['layouts'] ?? null) ? $content['layouts'] : [];
    }

    public static function layout(string $categoryId, string $layoutId): ?array
    {
        return self::layouts($categoryId)[$layoutId] ?? null;
    }

    /** @return array typography principles (scale/density/rotation_range_deg/max_callouts/notes), bucket-resolved. */
    public static function typography(string $categoryId): array
    {
        $content = self::resolvedContent($categoryId);
        return is_array($content['typography'] ?? null) ? $content['typography'] : [];
    }

    /** @return string[] visual composition rules, bucket-resolved. */
    public static function visualRules(string $categoryId): array
    {
        $content = self::resolvedContent($categoryId);
        return is_array($content['visual_rules'] ?? null) ? $content['visual_rules'] : [];
    }

    public static function copyPattern(string $categoryId): string
    {
        $content = self::resolvedContent($categoryId);
        return trim((string)($content['copy_pattern'] ?? ''));
    }

    /**
     * How a named fabric/ingredient should actually look when rendered, e.g.
     * 'satin' → 'smooth reflective surface, soft sheen, flowing drape'. Case-
     * insensitive, matches on the material name appearing anywhere in
     * $nameOrPhrase (so 'Himalayan Shilajit' matches the 'shilajit' entry).
     * Returns null when nothing in the map matches — callers fall back to a
     * generic "render however it naturally looks" instruction.
     */
    public static function materialVisual(string $nameOrPhrase): ?string
    {
        $map = self::load()['material_visual_map'] ?? [];
        if (empty($map) || trim($nameOrPhrase) === '') return null;
        $haystack = strtolower($nameOrPhrase);
        foreach ($map as $material => $visual) {
            if (str_contains($haystack, strtolower($material))) {
                return (string)$visual;
            }
        }
        return null;
    }
}
