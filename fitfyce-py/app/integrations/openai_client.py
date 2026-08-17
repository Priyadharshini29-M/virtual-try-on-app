"""Async httpx port of fitfyce-php/src/OpenAIClient.php.

Two OpenAI capabilities, no Fashn involved anywhere in this module:
  - gpt-4o-mini (chat completions)  → extract_key_points()
  - gpt-image-1 (images/edits)      → generate_infographic_image() /
                                        generate_collage_panels() /
                                        edit_infographic_image()

Works on in-memory bytes throughout rather than PHP's temp-file paths —
httpx's `files=` multipart param takes bytes directly, and a list of
`(field_name, file_tuple)` pairs lets more than one file share the same
field name (`image[]`), which is why PHP had to hand-roll its multipart
body in the first place.
"""

from __future__ import annotations

import asyncio
import json
import random
import re
from typing import Any

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)

BASE_URL = "https://api.openai.com/v1"
CHAT_MODEL = "gpt-4o-mini"
IMAGE_MODEL = "gpt-image-1"

# Each style is a genuinely different design treatment, not just a recolor
# of the same layout — 'look' sets the MOOD (not a fixed color or scene) so
# the model invents a fresh palette/background scenario every generation
# instead of repeating the same locked colors every time; 'labels' sets how
# the key points are actually rendered (badges vs. dashed leader lines vs.
# plain caption list, etc.) and its accent color should follow whatever
# palette was invented for this generation, not a fixed literal color either.
STYLE_GUIDES: dict[str, dict[str, str]] = {
    "fashion": {
        "look": (
            "a romantic, feminine editorial mood. Invent a fresh soft pastel or jewel-toned color "
            "palette and a complementary background scenario for THIS generation specifically — pick "
            "your own gradient direction, texture (bokeh light, soft floral line-art, fabric weave, "
            "subtle seasonal motif, etc.), and color combination; do not default to the same palette "
            "or scene every time, vary it generation to generation while keeping it tasteful"
        ),
        "labels": (
            "bold rounded pill-shaped badges with a matching small line-icon beside the text, "
            "positioned around the product with short thin connector lines linking each badge to the "
            "product; pick a badge color and text color that complement the palette you invented above"
        ),
    },
    "luxury": {
        "look": (
            "a premium, warm editorial mood. Invent a fresh elevated color palette (cream, champagne, "
            "blush, deep emerald, charcoal, etc. — your choice) and background scenario for THIS "
            "generation — a radial or diagonal gradient, a subtle marbled/linen/paper texture, foil-"
            "style corner flourishes, an embossed pattern, or a soft shadow scene; do not default to "
            "the same palette or texture every time, vary it generation to generation"
        ),
        "labels": (
            "refined thin-weight serif text labels, no connector lines and no badges — just elegant, "
            "generously spaced placement around the product for a premium editorial feel; pick a "
            "text color that complements the palette you invented above"
        ),
    },
    "modern": {
        "look": (
            "a clean, contemporary editorial mood — never a flat single-tone or plain two-color "
            "gradient on its own, that reads as empty/boring; the background must always combine a "
            "gradient with at least one confident graphic element layered into it — pick one and "
            "commit to it fully: bold abstract geometric shapes, a soft ambient light glow with visible "
            "depth, a diagonal color-block split, or a subtle repeating textured pattern. Invent a "
            "fresh cool-toned or bold color palette for THIS generation; do not default to the same "
            "palette or scene every time, vary it generation to generation while keeping it clean and "
            "modern, but never plain or empty-looking"
        ),
        "labels": (
            "clean bold sans-serif text labels, each connected to a specific point on the product "
            "with a thin dashed leader line starting from a small dot; pick an accent color that "
            "complements the palette you invented above"
        ),
    },
    "minimal": {
        "look": (
            "a plain, deliberately uncluttered background with generous negative space — no texture "
            "or pattern; the richness here comes from confident typography, spacing, and a single "
            "soft natural shadow beneath the product, not decoration. You may vary the exact "
            "background tone (white, off-white, very pale grey, very pale tint of any color) between "
            "generations, but always keep it plain and calm"
        ),
        "labels": (
            "simple caption-style text arranged in a tidy single-column list along one side or the "
            "bottom of the frame — no connector lines, no badges, no icons, ultra minimal; pick a "
            "single understated text color (charcoal, black, or a dark tone matching the background)"
        ),
    },
    "ecommerce": {
        "look": (
            "a bold, punchy retail-catalog mood. Invent a fresh vibrant color palette and background "
            "scenario for THIS generation — a gradient, a sunburst/radial light-ray pattern, a dotted "
            "or grid texture, or a bold color-block scene; do not default to the same palette or "
            "scene every time, vary it generation to generation while keeping it punchy and energetic"
        ),
        "labels": (
            "bold rectangular callout chips with a small colored icon, positioned around the product "
            "with short thin connector lines, punchy retail-catalog feel; pick chip and text colors "
            "that complement the palette you invented above"
        ),
    },
    "catalog": {
        "look": (
            "a crisp technical spec-sheet mood — a plain pale paper or fine blueprint-grid background "
            "with subtle hairline grid lines or ruler tick marks along one edge, a restrained two-tone "
            "palette (one neutral base plus one precise accent color you invent fresh this generation); "
            "no busy texture, gradient, or lifestyle scene — the feel of a product manual diagram or a "
            "museum placard, not a marketing scene; vary the exact accent color and grid tone between "
            "generations while keeping it precise and uncluttered"
        ),
        "labels": (
            "small numbered circular markers (01, 02, 03, ...) placed directly ON the product photo at "
            "the exact spot each feature refers to, each linked by a short thin straight line to a "
            "matching numbered row in a compact key/legend list running down one edge of the frame — "
            "every legend row shows its number then the label text in a technical sans-serif or "
            "monospace type; no pills, no chips, no icons; pick a single accent color for the "
            "markers, connector lines, and legend numbers that complements the palette you invented "
            "above"
        ),
    },
    "lifestyle": {
        "look": (
            "a full-bleed lifestyle mood — the product/model photo itself IS the background, extended "
            "and softened to fill the entire frame edge-to-edge (not placed on a separate flat or "
            "gradient background), optionally with a subtle complementary color-tint wash or gentle "
            "vignette over the extended areas so text stays readable; invent a fresh accent color for "
            "the labels that pops against THIS specific photo's tones, and vary that choice "
            "generation to generation"
        ),
        "labels": (
            "each key point rendered as a two-tier label — a short bold header word or two, with a "
            "smaller descriptive phrase directly beneath it in a lighter weight — linked to its exact "
            "point of reference on the product/model in the photo by a smooth flowing CURVED connector "
            "line (never straight, never dashed); pick a label text color and curved-line color that "
            "complement the palette you invented above"
        ),
    },
    "radial": {
        "look": (
            "a centered radial diagram mood — the product photo sits in the middle of the frame, "
            "optionally inside a thin circular guide ring, on a calm plain or very softly gradiented "
            "background; invent a fresh restrained color palette for THIS generation (a neutral base "
            "plus one accent) and vary it generation to generation while keeping the background calm "
            "enough that it never competes with the radial layout"
        ),
        "labels": (
            "each key point placed as its own small icon inside a circular badge, arranged evenly "
            "spaced around the product in a ring like spokes on a wheel, each badge linked to the "
            "center product by a short straight or gently curved connector line of equal length, with "
            "the label's text sitting directly beneath its icon badge; pick an icon/connector-line "
            "accent color that complements the palette you invented above"
        ),
    },
}

# Short, human-readable name for each style's label mechanic, used only to
# build the "do NOT use these other mechanics" negative constraint below —
# gpt-image-1 kept converging every style toward the same safe "elegant
# serif caption, no connector lines" look (the luxury mechanic) regardless
# of which named style was requested, because the style instruction was a
# small, easily-ignored fragment buried inside one long shared prompt block.
# Naming the mechanic explicitly and telling the model what NOT to draw
# fixes that convergence.
STYLE_MECHANIC_NAMES: dict[str, str] = {
    "fashion": "rounded pill badges with icons and connector lines",
    "luxury": "plain thin serif captions with no connector lines and no badges",
    "modern": "sans-serif text with dashed leader lines",
    "minimal": "a plain single-column caption list with no lines, badges, or icons",
    "ecommerce": "bold rectangular callout chips with connector lines",
    "catalog": "numbered circular markers on the product linked to a numbered legend list",
    "collage": "a 2x2 multi-panel grid of cropped photo variants with icon badges and zoom-circle callouts",
    "lifestyle": "the photo itself as a full-bleed background with curved connector lines to two-tier (bold header + subtext) labels",
    "radial": "icon badges arranged in a ring around the centered product, each linked to it by a connector line",
}

# Each "Regenerate" variation must be a genuinely different COMPOSITION, not
# just a reworded position hint — vague wording like "arc" vs. "scattered"
# produced near-identical results (same badges, same corner positions, same
# crop). These force the model into structurally different layouts: column
# vs. row vs. grid vs. split vs. diagonal.
VARIATION_HINTS: list[str] = [
    "Shrink the product photo to occupy only the center 55% of the frame width. Arrange ALL labels in a "
    "single vertical column running down the left edge of the frame, stacked evenly spaced top to "
    "bottom, each connected to the product with a horizontal connector line. The right side of the "
    "frame stays empty background.",
    "Shrink the product photo to occupy only the top 65% of the frame height, leaving it more space below. "
    "Arrange ALL labels in a single horizontal row along the bottom of the frame, evenly spaced left to "
    "right, each connected upward to the product with a short connector line.",
    "Keep the product centered and roughly life-size within the frame. Arrange labels in a symmetric grid "
    "around it — two labels upper-left/upper-right at the same height, the remaining labels "
    "lower-left/lower-right at the same height, each at a consistent 45-degree angle from the product "
    "with connector lines of equal length.",
    "Shrink the product photo to occupy only the center 60% of the frame, positioned slightly toward one "
    "side. Split the labels into two vertical stacks — half stacked along the left edge, half stacked "
    "along the right edge — each stack evenly spaced, connected to the product with horizontal lines, "
    "product framed symmetrically between the two stacks.",
    "Keep the product photo large, filling most of the frame height. Arrange labels scattered at varying "
    "distances and diagonal angles from the product — no two labels at the same distance or angle from "
    "it — connected with connector lines of clearly different lengths, for an asymmetric dynamic layout.",
]

# 'lifestyle' has no separate inset photo to shrink/reposition (the photo IS
# the full-bleed background), so VARIATION_HINTS' "shrink to X% / occupy top
# Y%" language doesn't apply — these vary the label placement zone instead.
LIFESTYLE_VARIATION_HINTS: list[str] = [
    "Cluster all labels toward the upper-right and lower-left thirds of the frame, each with a curved "
    "connector line sweeping toward its point of reference on the product, leaving the center of the "
    "frame clear so the product itself stays the visual focus.",
    "Arrange labels in a loose arc around the top half of the frame, each curved connector line sweeping "
    "down toward a different point on the product below, like spokes fanning out from a wheel.",
    "Place all labels along one vertical side of the frame (left or right), stacked with even spacing, each "
    "with a curved connector line sweeping across to its point of reference on the product on the "
    "opposite side of the frame.",
    "Scatter labels individually near their exact point of reference on the product, each with a short, "
    "tightly curved connector line — no two labels clustered together, spaced out across the full height "
    "of the frame from top to bottom.",
    "Place labels in the lower third of the frame in a gentle upward arc, each curved connector line "
    "sweeping up to a different point on the product above, leaving the upper two-thirds of the frame "
    "clear.",
]

# 'radial' keeps the product centered in every variation (that's the point
# of the layout), so variations rotate/resize the ring instead of
# repositioning the product.
RADIAL_VARIATION_HINTS: list[str] = [
    "Arrange the icon badges evenly spaced around a full circle surrounding the product, starting one badge "
    "directly above the product and continuing clockwise at equal angular intervals.",
    "Arrange the icon badges only around the top semicircle (the upper half) surrounding the product, evenly "
    "spaced left to right, leaving the lower half of the frame open.",
    "Arrange the icon badges at the four corners of an implied square surrounding the product (upper-left, "
    "upper-right, lower-left, lower-right), each at the same distance from the center.",
    "Arrange the icon badges in a wider, larger-radius circle around a smaller centered product, giving each "
    "connector line more visible length.",
    "Arrange the icon badges in a tighter, smaller-radius circle close around a larger centered product, "
    "giving each connector line a short, compact length.",
]

# Fixed named palettes for the 'collage' style — one is picked at random per
# generation and its literal hex values are embedded in all four panel
# prompts identically. The other styles leave color "invent fresh each
# generation" to gpt-image-1 on purpose, but that only works within a single
# API call; four independent calls each inventing their own palette would
# produce four images that don't visually belong together. Picking one fixed
# palette and quoting the exact hex codes into every call keeps the set
# coherent while still varying between different generations/regenerations.
COLLAGE_PALETTES: list[dict[str, str]] = [
    {"background": "warm cream (#F3EEE4)", "accent": "deep forest green (#1F5C3E)", "text": "near-black charcoal (#1A1A1A)"},
    {"background": "soft blush pink (#F7E9E6)", "accent": "deep rose (#8C3B4A)", "text": "near-black charcoal (#1A1A1A)"},
    {"background": "pale sage grey-green (#E7EAE2)", "accent": "warm terracotta clay (#B5622F)", "text": "near-black charcoal (#1A1A1A)"},
    {"background": "soft powder blue (#E7EEF3)", "accent": "deep navy (#1E3A5C)", "text": "near-black charcoal (#1A1A1A)"},
    {"background": "warm ivory (#F6F1E8)", "accent": "deep burgundy (#5C2331)", "text": "near-black charcoal (#1A1A1A)"},
]

# StudioV2Controller.php calls `OpenAIClient::marketingStyleKeys()` (static)
# and `$openai->generateMarketingInfographics(...)` — neither method exists
# anywhere in the PHP codebase (confirmed by grep across the whole repo).
# This is a real, pre-existing bug: in production PHP today,
# `/studio-v2/generate-status`'s post-completion infographic batch and
# `/studio-v2/regenerate-infographics` would throw a fatal error the moment
# they're reached. There is no original behavior to port, so
# MARKETING_STYLE_KEYS and generate_marketing_infographics() below are a
# documented best-effort *implementation*, not a faithful port — 5 fixed
# styles (excluding 'collage', which needs the special 4-panel pipeline)
# chosen for marketing-creative variety, reusing the existing single-style
# generate_infographic_image() per style.
MARKETING_STYLE_KEYS: list[str] = ["fashion", "luxury", "modern", "ecommerce", "lifestyle"]

_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


class OpenAIClient:
    def __init__(self, api_key: str):
        self.api_key = api_key

    # ── Key-point extraction ──────────────────────────────────────────────

    async def extract_key_points(self, paragraph: str) -> list[str]:
        """Extract up to 4 short, de-duplicated key-point phrases from a
        product description paragraph via gpt-4o-mini."""
        system = (
            "You are a product copywriter. Extract 3 to 4 key selling points from the product description. "
            "Rules: each point must be 2–5 words only — no full sentences, no verbs, no punctuation. Each point "
            "must be about a genuinely different attribute — never list the same feature twice using different "
            'wording (e.g. do not return both "Zari Border" and "Luxurious Zari Border"). '
            "Focus on materials, features, benefits, or quality markers. "
            "Return ONLY a JSON array of strings, nothing else. "
            'Example: ["Pure Silk Fabric","Hand Embroidered","Machine Washable","Free Size"]'
        )
        response = await self._chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": paragraph}], 150
        )
        raw = response.get("choices", [{}])[0].get("message", {}).get("content", "[]")
        raw = _CODE_FENCE_RE.sub("", raw.strip())
        try:
            points = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return []
        if not isinstance(points, list):
            return []

        # Cap at 4 (not 5) — fewer labels means more breathing room on the
        # canvas and less chance of gpt-image-1 crowding/duplicating one.
        clean: list[str] = []
        seen: set[str] = set()
        for p in points[:6]:
            if len(clean) >= 4:
                break
            if not isinstance(p, str):
                continue
            p = p.strip(" \t\n\r\0.,;:\"'")
            if p == "" or len(p.split()) > 6:
                continue
            key = re.sub(r"[^a-z0-9]+", "", p.lower())
            if key in seen:
                continue
            seen.add(key)
            clean.append(p)
        return clean

    # ── Infographic composition ───────────────────────────────────────────

    async def generate_infographic_image(
        self,
        image_bytes: bytes,
        filename: str,
        key_points: list[str],
        style: str,
        description: str = "",
        custom_style_prompt: str = "",
        category: str = "clothing",
        variation: int = 1,
        size: str | None = None,
    ) -> bytes:
        """Composes the final infographic image from a source product/model
        photo plus the extracted key points, entirely via gpt-image-1
        (images/edits). Returns raw PNG image bytes."""
        guide = STYLE_GUIDES.get(style, STYLE_GUIDES["modern"])

        forbidden_mechanics = "; ".join(v for k, v in STYLE_MECHANIC_NAMES.items() if k != style)
        style_lock = (
            f'STYLE LOCK — you are generating the "{style}" template specifically. Its label mechanic is: '
            f"{guide['labels']}. Use exactly that mechanic and nothing else. Do NOT fall back to any of the "
            "other templates' mechanics no matter how clean or elegant they seem, especially not: "
            f'{forbidden_mechanics}. This generation must be clearly distinguishable at a glance from the app\'s '
            f'other named styles — do not default to a generic minimalist serif-caption look unless "{style}" '
            'is literally "luxury". '
        )

        points = "; ".join(f'{i + 1}. "{p}"' for i, p in enumerate(key_points))
        point_count = len(key_points)
        variation_hints = {
            "lifestyle": LIFESTYLE_VARIATION_HINTS,
            "radial": RADIAL_VARIATION_HINTS,
        }.get(style, VARIATION_HINTS)
        layout_hint = variation_hints[(variation - 1) % len(variation_hints)]
        photo_is_full_bleed_background = style == "lifestyle"

        shared = (
            "CRITICAL — the photographed pixels of the product/model themselves must never be redrawn, restyled, "
            "re-illustrated, or reinterpreted — reuse the exact same photograph, unaltered. The photo's SIZE and "
            "POSITION within the frame should follow the arrangement instructions below (they intentionally vary "
            "between creative variations), but the content of the photo itself must not change. "
            "If a person appears in the photo, their face, identity, skin tone, expression, and hair must stay "
            "completely identical to the source photo — do not regenerate, beautify, reinterpret, or subtly "
            "change the face in any way; treat the person exactly like the rest of the untouched photograph. "
            f"Render exactly {point_count} labels as {guide['labels']} — one label per numbered item below, each "
            f"shown verbatim, each appearing in the image exactly once and nowhere else: {points}. Never repeat, "
            "duplicate, or partially re-render the same or a similar label a second time anywhere in the frame, "
            f"even in a shortened or truncated form — each of the {point_count} numbered items above corresponds "
            "to exactly one label and no more. Before finishing, count the labels you have drawn and confirm the "
            f"total is exactly {point_count}. "
            f"Composition for this variation: {layout_hint} "
            + (f"Merchant's background/theme request — follow this closely: {custom_style_prompt}. " if custom_style_prompt else "")
            + (
                "This is a fresh creative variation — it must look structurally different from a "
                "typical or previous layout of the same product (different label arrangement and photo "
                "size/position per the composition instruction above, AND a freshly invented color palette and "
                "background scenario per the style description above — do not reuse the same colors as a "
                "previous variation). Keep the same label mechanic (badges vs. lines vs. plain captions, per the "
                "style) and the same label text. "
                if variation > 1 else ""
            )
            + 'PRODUCTION QUALITY — this must be indistinguishable from a real, professionally shot and composited '
            'e-commerce marketing asset — photorealistic, seamless, and polished throughout, with natural lighting '
            'and shadow continuity between the photo and the design elements around it. Avoid any flat, uncanny, '
            'or "obviously AI-generated" look. Triple-check the spelling of every single rendered word against the '
            'key points given above, letter by letter — zero typos, zero misspellings, zero invented words. Use a '
            'clear, consistent typographic hierarchy — all key-point labels the same readable size as each other '
            '(never one label huge and another tiny), a headline (if any) modestly larger than the labels, '
            'generous line-height so wrapped text never looks cramped. Use at most two font families total across '
            'the whole image. Keep a generous safe margin on all four '
            'edges of the frame — no label text, connector line, badge, or icon may be cut off, clipped, or touch '
            'the frame border. Leave clear empty space between every label and the next so nothing overlaps or '
            'collides. Ensure every piece of text has strong, comfortably legible contrast against whatever sits '
            'directly behind it. If any icons are used, every icon in the image must share the same stroke width, '
            'the same visual style (all line-icons or all filled-icons, never mixed), and consistent sizing '
            'relative to each other — never distorted or stretched. '
            + (
                "Because the photo itself is the full-bleed background here, every label's text box may sit "
                "directly over an open, uncluttered area of the photo (plain fabric, plain backdrop, empty "
                "space) — if the area behind a label is busy, add a subtle soft translucent scrim behind just "
                "that label so its text stays fully legible. No label text box may ever sit over a face, eyes, "
                "or directly over the exact product/garment detail it is pointing to — position it just beside "
                "that point instead, with the curved connector line bridging the gap. "
                if photo_is_full_bleed_background else
                "Every label (its full text box, badge, or chip) must sit entirely in the open background "
                "area beside or around the product — never on top of the product/model photo itself, never "
                "overlapping the garment, skin, or hair. Only the thin connector line (and its small dot, if "
                "the style uses one) may cross into the product photo to reach its point of reference; the "
                "label text itself always stays clear of the photo. "
            )
            + (f"Product context for tone only, do not add extra body text: {description}. " if description else "")
            + "High-quality commercial marketing look, no watermarks, no extra logos."
        )

        # Food packs are roughly square; a full-length garment/model photo
        # needs a taller frame — the extra vertical room also gives labels
        # more breathing space, which helps avoid the crowding/duplication
        # that a cramped square canvas encouraged. An explicit `size` (from
        # the merchant's Square/Portrait/Landscape picker) overrides this
        # category-based default.
        resolved_size = size or ("1024x1024" if category == "food" else "1024x1536")

        if photo_is_full_bleed_background:
            # 'lifestyle' doesn't fit the food/clothing "inset photo +
            # separate background" split below — the photo IS the
            # background in both cases, so it gets one composition sentence
            # regardless of category.
            composition = (
                "Design a polished, visually rich marketing infographic built around this exact lifestyle photo — "
                f"with the specific level of overlay/tint richness described here (follow it precisely): {guide['look']}. "
                "Do NOT add any headline, title, subtitle, tagline, banner text, product name, or any other text "
                f"beyond exactly the {point_count} labels described below — the image must contain only the "
                "(now full-bleed) photo and those labels, nothing else written anywhere in the frame. Tall portrait "
                "composition. " + shared
            )
        elif category == "food":
            composition = (
                "Design a polished, visually rich marketing infographic for a packaged food product — with the specific "
                "level of background depth/richness described below (follow that description precisely — some "
                "styles want rich texture and gradient, others want deliberate plainness) — built around this exact "
                f"product photo. Center the product photo on {guide['look']}, filling most of the frame — a bold "
                "circular or soft rounded background shape behind it works well. Optionally add a short one-line "
                "headline in a small banner near the top introducing the product. Square 1:1 composition. " + shared
            )
        else:
            composition = (
                "Design a polished, visually rich marketing infographic for an apparel/product photo — with the specific "
                "level of background depth/richness described below (follow that description precisely — some "
                "styles want rich texture and gradient, others want deliberate plainness) — built around this exact "
                f"photo. Place the photo slightly off-center on {guide['look']}, leaving room around it for "
                "labels. Tall portrait composition. Do NOT add any headline, title, subtitle, tagline, banner "
                f"text, product name, or any other text beyond exactly the {point_count} labels — the image must "
                "contain only the product photo and those labels, nothing else written anywhere in the frame. "
                + shared
            )

        prompt = style_lock + composition
        return await self._request_generated_image([(image_bytes, filename)], prompt, resolved_size)

    async def generate_collage_panels(
        self,
        image_bytes: bytes,
        filename: str,
        key_points: list[str],
        description: str = "",
        custom_style_prompt: str = "",
        size: str | None = None,
    ) -> dict[str, bytes]:
        """Generates the 'collage' style as FOUR separate standalone images
        (a hero shot + two close-up detail shots with zoom-circle callouts +
        a features shot), all reusing the same source photo and a single
        fixed color palette so they read as one matching set. Returns
        {'hero':, 'detail1':, 'detail2':, 'features':} → PNG bytes."""
        resolved_size = size or "1024x1536"

        # Split in Python, not left for the model to improvise — an earlier
        # single-grid-image version of this style left the distribution
        # ambiguous and produced a duplicated label, a truncated label, and
        # one panel with no callout at all. Fixed slices per image avoid
        # that; reuse of the same point across images is fine (the
        # reference creatives repeat claims across slides too).
        half = -(-len(key_points) // 2)  # ceil
        hero_points = key_points[:half]
        feature_points = key_points[half:] or hero_points
        detail1_label = hero_points[0]
        detail2_label = feature_points[0]

        palette = random.choice(COLLAGE_PALETTES)

        jobs = {
            "hero": {
                "images": [(image_bytes, filename)],
                "prompt": self._build_collage_badge_prompt(1, hero_points, palette, description, custom_style_prompt),
                "size": resolved_size,
            },
            "detail1": {
                "images": [(image_bytes, filename)],
                "prompt": self._build_collage_detail_prompt(2, detail1_label, palette, custom_style_prompt),
                "size": resolved_size,
            },
            "detail2": {
                "images": [(image_bytes, filename)],
                "prompt": self._build_collage_detail_prompt(3, detail2_label, palette, custom_style_prompt),
                "size": resolved_size,
            },
            "features": {
                "images": [(image_bytes, filename)],
                "prompt": self._build_collage_badge_prompt(4, feature_points, palette, description, custom_style_prompt),
                "size": resolved_size,
            },
        }
        return await self._request_generated_images_parallel(jobs)

    def _collage_shared_rules(self, image_num: int, palette: dict[str, str], custom_style_prompt: str) -> str:
        return (
            f"This is image {image_num} of 4 in a matching product-creative set (a hero shot, two close-up detail "
            "shots, and a features shot) — even though each is generated separately, they must all look like they "
            "belong to the same set: identical background color, identical badge/label design, identical "
            f"typography style. Use EXACTLY this palette, no deviation: background {palette['background']}, "
            f"badge/accent color {palette['accent']}, text color {palette['text']}. "
            "CRITICAL — reuse the exact same source photograph, unaltered pixels, for the product/model — never "
            "redraw, re-illustrate, or reinterpret it, only crop/zoom into it. Never invent a different angle or "
            "pose that isn't actually visible in the source photo (no true back view if the source is a "
            "front-facing photo, for example). If a person's face is visible, their face, identity, skin tone, "
            "expression, and hair must stay completely identical to the source photo. "
            + (f"Merchant's background/theme request — follow this closely: {custom_style_prompt}. " if custom_style_prompt else "")
            + 'PRODUCTION QUALITY — indistinguishable from a real, professionally shot and composited e-commerce '
            'social-media creative — photorealistic, seamless, polished. Avoid any flat, uncanny, or "obviously '
            'AI-generated" look. Triple-check the spelling of every rendered word, letter by letter — zero typos, '
            'zero misspellings, zero invented words. Keep a generous safe margin on all four edges of the frame — '
            'no text, line, badge, icon, or zoom-circle may be cut off, clipped, or touch the frame border. Use at '
            'most two font families total. Ensure text has strong, comfortably legible contrast against whatever '
            'sits behind it. Every icon must share the same stroke width, the same visual style (all line-icons or '
            'all filled-icons, never mixed), and consistent sizing — never distorted or stretched. '
            'High-quality commercial marketing look, no watermarks, no extra logos.'
        )

    def _build_collage_badge_prompt(
        self, image_num: int, points: list[str], palette: dict[str, str], description: str, custom_style_prompt: str
    ) -> str:
        listing = "; ".join(f'{i + 1}. "{p}"' for i, p in enumerate(points))
        return (
            f"Design a clean product marketing shot. Place the source photo off-center, filling most of the frame, "
            f"on a plain {palette['background']} background. Add a compact vertical stack of small rounded icon "
            f"badges beside the product. Render exactly {len(points)} badge(s), no more and no fewer, one "
            "badge per numbered item below, each badge holding its ENTIRE quoted phrase as one single indivisible "
            "unit of text — never split one quoted item across two badges, never merge two items into one badge, "
            f"never shorten a multi-word phrase down to one word: {listing}. Tall portrait composition. Do NOT add "
            "any headline, title, or extra text beyond these badges. "
            "Every badge must sit entirely in open background space, never on top of the product/model photo "
            "itself. "
            + self._collage_shared_rules(image_num, palette, custom_style_prompt)
            + (f" Product context for tone only, do not add extra body text: {description}." if description else "")
        )

    def _build_collage_detail_prompt(
        self, image_num: int, label: str, palette: dict[str, str], custom_style_prompt: str
    ) -> str:
        return (
            "Design a close-up product detail shot. Crop and zoom tightly into one specific region of the garment "
            "from the source photo (e.g. a sleeve, collar, seam, or waistband — whichever is actually visible), "
            f"filling most of the frame, with a plain {palette['background']} background around the edges where "
            "needed. Add exactly ONE small circular zoom-inset bubble showing an extreme close-up magnification "
            "of that exact spot, linked by a short thin dashed leader line directly to exactly ONE text label box "
            f'attached to that same line. That label must show the complete phrase "{label}" as one single '
            "indivisible unit of text — not split, not shortened to a single word from it — and it must not "
            "appear anywhere else in the image as a separate freestanding badge. Do NOT add any other text. "
            + self._collage_shared_rules(image_num, palette, custom_style_prompt)
        )

    async def generate_marketing_infographics(
        self, image_bytes: bytes, filename: str, description: str, prompt: str
    ) -> list[dict[str, Any]]:
        """NEW — no PHP equivalent (see MARKETING_STYLE_KEYS docstring
        above). Extracts key points from `prompt` (the merchant's
        product/creative-direction text from the StudioV2 generate() flow)
        and composes one infographic per MARKETING_STYLE_KEYS style,
        reusing `prompt` as the custom_style_prompt so the merchant's
        creative direction steers every style's background/theme. Styles
        that fail are simply omitted — the caller (studio_v2_service)
        marks the missing style rows 'failed', mirroring how PHP's
        runInfographicBatch() already handled partial-batch failure.
        Returns [{'style_key':, 'image_bytes':}, ...].
        """
        key_points = await self.extract_key_points(prompt or description)
        if not key_points:
            key_points = [prompt[:40]] if prompt else ["Premium Quality"]

        async def run(style: str) -> tuple[str, bytes | None]:
            try:
                img = await self.generate_infographic_image(
                    image_bytes, filename, key_points, style, description, prompt, "clothing", 1, None,
                )
                return style, img
            except Exception as exc:  # noqa: BLE001
                logger.warning("generate_marketing_infographics: style=%s failed: %s", style, exc)
                return style, None

        outcomes = await asyncio.gather(*(run(s) for s in MARKETING_STYLE_KEYS))
        return [{"style_key": s, "image_bytes": img} for s, img in outcomes if img is not None]

    async def edit_infographic_image(
        self,
        image_bytes: bytes,
        filename: str,
        edit_prompt: str,
        background_image_bytes: bytes | None = None,
        background_filename: str | None = None,
    ) -> bytes:
        """Applies a merchant-provided free-text edit to an already-generated
        infographic image via the same OpenAI image model, iterating on the
        existing artwork instead of starting over."""
        prompt = (
            "This is a marketing infographic that was generated for an e-commerce product (the first image). "
            "Apply the following edit request while keeping everything else in the image — the product, the "
            f"other labels, the headline — unchanged unless the request says otherwise: {edit_prompt}. "
            + (
                "A second reference image is provided — use it as the new background for the infographic "
                "(crop/extend it to fill the frame naturally). Keep the product photo and all labels from the "
                "first image exactly as they are, just composited onto this new background. "
                if background_image_bytes is not None else ""
            )
            + "CRITICAL — the product/model photo itself must stay pixel-for-pixel exactly as it currently appears: "
            "the exact same scale, crop, framing, and position within the frame. Do not zoom, re-crop, resize, or "
            "reposition it, even slightly, while applying this edit. If a person appears in the photo, their face, "
            "identity, skin tone, expression, and hair must stay completely identical to how they appear right "
            "now — never regenerate, beautify, or alter the face. "
            "PRODUCTION QUALITY — this must remain indistinguishable from a real, professionally shot and "
            "composited e-commerce marketing asset — photorealistic and seamless, not flat or \"AI-generated\" "
            "looking. Never repeat, duplicate, or partially re-render any label a second time anywhere in the "
            "frame. Triple-check the spelling of every rendered word, letter by letter, against the existing "
            "label text — zero typos, zero misspellings. Keep a generous safe margin on all four edges of the "
            "frame — no text, line, badge, or icon may be cut off, clipped, or touch the frame border. Keep all "
            "label text the same consistent, readable size as each other unless the edit specifically asks to "
            "change sizing. Keep all existing text crisp, legible, and correctly spelled."
        )

        images = [(image_bytes, filename)]
        if background_image_bytes is not None:
            images.append((background_image_bytes, background_filename or "background.jpg"))

        # Match the output size to whatever aspect the image being edited
        # already has, so an edit never squashes a portrait infographic back
        # into a square (or vice versa).
        size = _detect_portrait_size(image_bytes)

        return await self._request_generated_image(images, prompt, size)

    # ── Private HTTP helpers ──────────────────────────────────────────────

    async def _request_generated_image(self, images: list[tuple[bytes, str]], prompt: str, size: str) -> bytes:
        data = await self._images_edits_request(images, prompt, size)
        return _decode_image_response(data)

    async def _request_generated_images_parallel(self, jobs: dict[str, dict[str, Any]]) -> dict[str, bytes]:
        """Runs several images/edits requests concurrently instead of one
        after another — the 'collage' style needs 4 separate gpt-image-1
        calls per generation, and each can individually take up to a minute
        or more at high quality/portrait size, so running them sequentially
        risked a 2-4 minute round trip and real timeout failures. Raises if
        any job fails (mirrors the single-request behaviour — a partial
        collage isn't a useful result)."""

        async def run(key: str, job: dict[str, Any]) -> tuple[str, bytes | None, str | None]:
            try:
                data = await self._images_edits_request(job["images"], job["prompt"], job["size"])
                return key, _decode_image_response(data), None
            except Exception as exc:  # noqa: BLE001
                return key, None, str(exc)

        outcomes = await asyncio.gather(*(run(k, j) for k, j in jobs.items()))
        errors = {k: msg for k, img, msg in outcomes if msg is not None}
        if errors:
            detail = "; ".join(f"{k} ({m})" for k, m in errors.items())
            raise RuntimeError(f"Collage generation failed for: {detail}")
        return {k: img for k, img, msg in outcomes if img is not None}

    async def _images_edits_request(self, images: list[tuple[bytes, str]], prompt: str, size: str) -> dict:
        field_name = "image[]" if len(images) > 1 else "image"
        files = [
            (field_name, (filename, img_bytes, _guess_mime(filename)))
            for img_bytes, filename in images
        ]
        data = {"model": IMAGE_MODEL, "prompt": prompt, "size": size, "quality": "high", "n": "1"}

        try:
            # High-quality gpt-image-1 generation at portrait size can take
            # well over a minute — give it real headroom instead of racing
            # outer timeouts.
            async with httpx.AsyncClient(timeout=160) as client:
                resp = await client.post(
                    f"{BASE_URL}/images/edits",
                    data=data,
                    files=files,
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
        except httpx.HTTPError as exc:
            raise RuntimeError(f"OpenAI image request failed: {exc}") from exc

        try:
            decoded = resp.json()
        except ValueError:
            decoded = {}

        if resp.status_code >= 400:
            msg = (decoded.get("error") or {}).get("message") or f"OpenAI image error HTTP {resp.status_code}"
            logger.error("OpenAI images/edits request failed: status=%s response=%s", resp.status_code, decoded or resp.text[:500])
            raise RuntimeError(msg)

        return decoded

    async def _chat_completion(self, messages: list[dict], max_tokens: int = 300) -> dict:
        return await self._json_request(
            "POST", "/chat/completions",
            {"model": CHAT_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2},
        )

    async def _json_request(self, method: str, path: str, body: dict) -> dict:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.request(
                    method, f"{BASE_URL}{path}", json=body,
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                )
        except httpx.HTTPError as exc:
            raise RuntimeError(f"OpenAI request failed: {exc}") from exc

        try:
            decoded = resp.json()
        except ValueError:
            decoded = {}

        if resp.status_code >= 400:
            msg = (decoded.get("error") or {}).get("message") or f"OpenAI error HTTP {resp.status_code}"
            raise RuntimeError(msg)

        return decoded


def _decode_image_response(response: dict) -> bytes:
    import base64

    b64 = (response.get("data") or [{}])[0].get("b64_json")
    if not isinstance(b64, str) or b64 == "":
        raise RuntimeError("OpenAI did not return an image.")
    try:
        return base64.b64decode(b64, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("OpenAI returned an invalid image payload.") from exc


def _guess_mime(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {"png": "image/png", "webp": "image/webp", "jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext, "image/jpeg")


def _detect_portrait_size(image_bytes: bytes) -> str:
    import io

    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            w, h = img.size
    except (UnidentifiedImageError, OSError):
        return "1024x1024"
    return "1024x1536" if h > w else "1024x1024"
