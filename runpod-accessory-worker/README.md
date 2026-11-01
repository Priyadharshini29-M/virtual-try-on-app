# RunPod accessory try-on worker

Serverless worker for accessory try-ons (watch / handbag / jewelry / glasses,
etc.) — fuses an accessory product photo onto a person photo. Replicates the
model recipe behind the `prithivMLmods/Qwen-Image-Edit-2509-LoRAs-Fast-Fusion`
Hugging Face Space that `AccessoryJobs`/`HfSpaceClient` currently call, so it
can be dropped in as the paid, non-quota-limited alternative described in
`AppConfig::useRunpodAccessory()`.

## Deploy (GitHub auto-build)

1. Push this folder as its own GitHub repo (or a repo containing just this
   directory at root — RunPod needs `Dockerfile` at the repo root or a path
   you specify).
2. In the RunPod console: **Settings → Connections → GitHub → Connect**,
   authorize, and grant access to this repo.
3. **Serverless → New Endpoint → Import Git Repository**, pick the repo/branch.
4. GPU: select a large-VRAM tier (A100 80GB or H100 — this model needs
   ~48GB+ VRAM in bf16). Anything smaller will OOM.
5. Deploy. Watch the **Builds** tab: Pending → Building → Uploading → Testing
   → Completed.
6. Copy the resulting endpoint ID into `fitfyce-php/.env`:
   ```
   RUNPOD_ACCESSORY_ENDPOINT_ID=<endpoint id>
   ```
   (`RUNPOD_API_KEY` is already set and shared with the VTON endpoint.)
7. Make sure `HF_TOKEN` is **unset** in `.env` — `SareeRouting::submitAccessory()`
   tries the Hugging Face Space first and only falls back to this RunPod
   endpoint when `HF_TOKEN` is empty.

## Cold starts / cost

First request on a fresh worker downloads the base model + transformer + LoRA
from Hugging Face (tens of GB) before it can serve — expect a slow first
call. For real traffic, attach a RunPod **Network Volume** to the endpoint so
the Hugging Face cache persists across worker restarts instead of
re-downloading every cold start.

## Contract

Matches `RunpodVtonClient::submitAccessoryRun()` / `extractImages()` /
`extractError()` in `fitfyce-php/src/RunpodVtonClient.php` — no PHP changes
needed.

Input (`input`):
| field | type | required | default |
|---|---|---|---|
| `person_image` | base64 or data URI | yes | — |
| `accessory_image` | base64 or data URI | yes | — |
| `prompt` | string | no | generic fusion prompt |
| `seed` | int | no | 42 |
| `guidance_scale` | float | no | 1.0 |
| `num_inference_steps` | int | no | 4 |

**Single-image edit mode** (used by `RunpodVtonClient::editImage()` for AI Studio
flat-lay → worn-reference conversion and pose variants): send `image` (base64 or
data URI) and `prompt` instead of `person_image`/`accessory_image`. The fusion
LoRA is set to weight 0 for these calls. Point `RUNPOD_IMAGE_EDIT_ENDPOINT_ID`
at this endpoint (or leave it blank to reuse `RUNPOD_ACCESSORY_ENDPOINT_ID`).
This mode has not been run on a GPU yet - check output quality before relying
on it for sarees/lehengas.

Output: `{"images": ["<base64 png>"]}` on success, `{"error": "..."}` on
failure (RunPod marks the job `FAILED` and the PHP client surfaces `error`).
