# Saree → Fashn.ai Routing: Implementation Plan

## Goal

Route **saree** try-ons to the hosted **Fashn.ai** API. Every other garment keeps using the **RunPod** FASHN VTON 1.5 endpoint. Applies to the storefront widget and the Studio module (AI Studio + Garment Studio). No other flow changes, including OpenAI infographics.

## Why

The deployed RunPod worker crashes on `category=saree` (`FASHN_LABELS_TO_IDS` lookup returns None), so sarees were being forced through `one-pieces` and drape quality suffered. Fashn.ai is used for sarees only.

## Architecture

```
Widget / Studio ──► PHP submit endpoint
                        │
            SareeRouting::shouldUseFashn(prompt, product_title)
              ┌─────────┴───────────┐
       saree + key set          everything else
              │                     │
   SareeRouting::submitFashn   RunpodVtonClient::submitRun   (unchanged)
   (FashnClient → tryon-max +
    nivi drape prompt, retry once)
              │                     │
     job_id = "fs_<id>"        job_id = "<runpod id>"
              └─────────┬───────────┘
                        ▼
            client polls status endpoint
                        │
            SareeRouting::checkStatus(job_id)
             fs_ prefix → FashnClient::checkStatus
             no prefix  → RunpodVtonClient::checkStatus
                        ▼
      same {job_status, image_bytes, error_details} shape
      → existing save / analytics / infographic-chain code
```

## Design decisions

1. **Additive only.** The RunPod code path is untouched. A saree adds one branch at submit and one dispatch call at poll.
2. **Engine encoded in the job ID.** Fashn jobs are prefixed `fs_`; RunPod jobs have no prefix. The stateless poll endpoints and the Studio tables (which already store the ID in `fashn_prediction_id`) need no schema change, and the widget / Shopify app need no change. RunPod jobs in flight before rollout keep resolving.
3. **Detection.** In the Studio wizard the merchant's explicit product type decides: picking **Saree** in "What are you selling?" sends `product_type=saree` (all garment workflows: Model Generation, Flat Lay to Model, Ghost Mannequin to Model), and any other choice stays on RunPod even if the notes mention a saree. In the storefront widget there is no explicit pick, so a request is a saree if any of these match `(sarees?|saris?)` (case-insensitive): the variant's clothing prompt, the product title, or, looked up in PHP from the synced product (by `shopify_product_id`), its product type, tags, handle or collection title. The `product_title` the widget sends used to be dropped by the Shopify proxy (`api.tryon.jsx`); it is now forwarded. A saree listing with none of these containing "saree"/"sari" is not detected and falls back to RunPod. Each widget try-on writes a `Try-on engine decision` line to `logs/app.log` showing the engine chosen and the signals seen. The Accessories workflow never goes to Fashn.
4. **Strict, no RunPod for sarees.** Any product recognised as a saree (title, tags, type, handle, collection or variant prompt) goes to Fashn only. If `FASHN_API_KEY` is blank, saree try-ons fail with an error ("Saree try-on is not configured") and are logged; they are never sent to RunPod. There is no off-switch back to RunPod for sarees.
5. **No cross-engine fallback.** If Fashn fails after one retry (network error, 429, 5xx), the user sees the normal error. Falling back to RunPod is the path that drapes sarees badly.
6. **Garment Studio** sends only the front photo to Fashn, not the front/back/detail composite (Fashn expects one clean garment image).

## Files

All under `fitfyce-php/`:

| File | Change |
|---|---|
| `src/SareeRouting.php` | New. Detection, `submitFashn()`, `checkStatus()`, `fs_` prefix handling. |
| `config/AppConfig.php` | `fashnApiKey()`, `fashnMode()` (default `quality`), `fashnSareeModel()` (default `tryon-max`), `useFashn()`. |
| `router.php` | `require_once` for `FashnClient.php` and `SareeRouting.php`. |
| `.env` | `FASHN_API_KEY`, `FASHN_MODE=quality`, `FASHN_SAREE_MODEL=tryon-max`. |
| `src/FashnClient.php` | SSL verification re-enabled. |
| `controllers/TryOnController.php` | Widget submit + `pollStatus()`; saree detection from synced product data; friendly pose-failure message. |
| `fitfyce-shopify/app/routes/api.tryon.jsx` | Forwards `product_title` to PHP (it was dropped before). |
| `controllers/StudioV2Controller.php` | AI Studio `generate()` + `checkGenerationStatus()`. |
| `controllers/GarmentStudioController.php` | `generate()`, `prepareAndSubmit()`, `checkGenerationStatus()`. Reads `product_type`. |
| `fitfyce-shopify/app/routes/app.studio.create.jsx`, `api.studio.jsx` | Wizard sends its chosen product type (`product_type`) to PHP. |
| `fitfyce-shopify/extensions/tryon-widget/` (`assets/tryon-widget.js`, `assets/tryon-modal.css`, `snippets/tryon-modal.liquid`) | Saree-only photo guidance and check in the storefront widget (see below). Needs `shopify app deploy`. |

## Per-flow behavior

All flows call Fashn **`tryon-max`** (default, `FASHN_SAREE_MODEL=tryon-max`) with `generation_mode=quality` and a nivi-style drape prompt (blouse matching the border, pleats tucked at the front waist, pallu over the left shoulder). `tryon-max` auto-detects the garment, so there is no category or photo type. Set `FASHN_SAREE_MODEL=tryon-v1.6` to fall back to the category-based model (`category=one-pieces`, photo type per flow: widget as computed, AI Studio `auto`, Garment Studio as selected), which cannot be told how to drape.

Why `tryon-max`: `tryon-v1.6` has no saree category and takes no prompt, so a saree tends to come out as a plain dress. The earlier Fashn implementation in this repo used `tryon-max` with this drape prompt for the same reason.

Plan-limit counting, analytics, result saving and the Studio infographic chain are unchanged.

## Saree photo guidance (storefront widget)

Applies only when the product title contains saree/sari. Other products are unchanged.

- **Tips on the upload step:** "For the best saree result: stand straight facing the camera, head to toe in frame; arms relaxed at your sides; fitted clothes and good light."
- **Photo check before any generation is spent** (file picker, drag-and-drop and camera all go through it). Rejected with a plain message: a photo smaller than 300 px on its short side, and a landscape or square photo (height/width under 1.15), which is almost never a full-length shot. Where the browser supports `FaceDetector` (Chrome), a face taller than 22% of the image height (waist-up or close-up) is rejected too. A photo that can't be inspected is let through.
- **Server message:** if Fashn still can't find a body, the shopper sees "We couldn't see your full body in that photo. Please upload a standing, front-facing photo that shows you from head to toe." instead of the generic error (Fashn saree jobs only).
- **Limits:** a waist-up portrait in Safari or Firefox (no `FaceDetector`) passes the check, so the server message is the backstop. Products whose title lacks saree/sari get no tips.

## Rollout

1. Add `FASHN_API_KEY` to `.env`.
2. Test a saree in the widget, then in AI Studio and Garment Studio. Confirm a non-saree (e.g. kurti) still goes to RunPod.
3. Check `logs/app.log` for `Saree try-on routed to Fashn`.
4. Monitor failure rate and cost per engine for a week.

## Verification status

- `php -l` passes on all edited files.
- Saree detection and the `shouldUseFashn` / `isFashnJob` helpers checked with a script.
- Live submit/poll against Fashn checked with a real saree and model photo (see Open items).
- **Not yet tested:** the three controllers end to end on the server, and Fashn responses inside the widget's 190s / Shopify proxy limits (Fashn took ~30s in the test).

## Open items

- **One real saree tested (`docs/test-images/`).** `tryon-max` with the drape prompt draped a folded coral Kankatala silk saree onto a full-body model correctly: nivi pleats, pallu over the left shoulder, and the saree's colour, gold checks, buttis and magenta border preserved. `tryon-v1.6` with `one-pieces` on the same photos produced a short orange mini dress, confirming it is unsuitable for sarees. Only one saree and one model have been tested; try more (plain, heavy-border, printed, on-model product photos) before relying on it.
- **Drape varies run to run.** The same loose prompt gave a classic shoulder pallu once and a front-hanging pallu the next time. A structural prompt (tuck at the navel, 6-7 knife pleats, pallu diagonally over the left shoulder) gave the cleanest drape in the one run tried, and is now the default. With the structural prompt all 3 runs on the same photos gave the classic drape (vs 1 of 3 with the loose prompt). A fixed `seed` does **not** make results repeatable (same seed, same inputs: ~37% of pixels differed), so none is used. Small sample; only one model photo and one saree so far.
- **First-attempt reliability depends on the shopper's photo.** Untested: cropped, seated, side-on or bulky-clothing photos. A face-only crop failed with "Failed to detect body pose". Options not built: guide/reject non-full-body photos in the widget; silent automatic re-generation behind a drape quality check.
- **FAL flat-lay conversion is skipped for Fashn sarees.** FLUX Kontext (FAL) invents a "worn" photo of the saree, which can lose the real colour, pattern or drape, and it feeds that invented image to the try-on. Raw flat-lay photos went straight to `tryon-max` in every test and worked. If `FAL_API_KEY` is set on the server this was a likely cause of the badly draped widget result.
- **Fashn credits:** each `tryon-max` generation costs about 3 credits (`tryon-v1.6` about 1); 19 remained after testing.
- **Do not put colours in the prompt.** Naming a different colour in the prompt made `tryon-max` recolour the saree to match the text instead of the photo. Keep the prompt to the drape instruction only.
- `product-to-model` (builds a new model from a flat product photo) remains an option for flat-lay sarees, not wired.
- **Secrets hygiene.** `fitfyce-php/.env` contains live keys and shows as modified in git. Confirm it is ignored/untracked and rotate the RunPod key if it was ever pushed.
- **Local SSL.** With verification on, a local XAMPP without a CA bundle may fail Fashn calls (RunPod calls already verify).
