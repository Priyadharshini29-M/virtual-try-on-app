"""
RunPod serverless handler for accessory try-ons: fuses an accessory product
photo (watch, handbag, jewelry, glasses, ...) onto a person photo.

Recipe mirrors the prithivMLmods "Qwen-Image-Edit-2509-LoRAs-Fast-Fusion" HF
Space that AccessoryJobs/HfSpaceClient already call in production:
  - base model:        Qwen/Qwen-Image-Edit-2509
  - fast transformer:  linoyts/Qwen-Image-Edit-Rapid-AIO
  - fusion LoRA:       ostris/qwen_image_edit_inpainting

Input/output shape matches RunpodVtonClient::submitAccessoryRun() and
extractImages()/extractError() in fitfyce-php/src/RunpodVtonClient.php, so no
PHP changes are needed once RUNPOD_ACCESSORY_ENDPOINT_ID points here:
  input:  {person_image, accessory_image, prompt?, seed?, guidance_scale?, num_inference_steps?}
      or  {image, prompt, seed?, guidance_scale?, num_inference_steps?}   (single-image edit)
  output: {images: [base64 png]}  on success
          {error: "..."}          on failure (RunPod marks the job FAILED)
"""

import base64
import io
import traceback

import runpod
import torch
from PIL import Image
from diffusers import QwenImageEditPlusPipeline, QwenImageTransformer2DModel

MODEL_ID = "Qwen/Qwen-Image-Edit-2509"
TRANSFORMER_ID = "linoyts/Qwen-Image-Edit-Rapid-AIO"
FUSION_LORA_REPO = "ostris/qwen_image_edit_inpainting"
FUSION_LORA_WEIGHT = "qwen_image_edit_inpainting.safetensors"
FUSION_ADAPTER_NAME = "fusion"

DEFAULT_PROMPT = (
    "Fuse the accessory product from image 2 naturally onto the person in "
    "image 1, matching its lighting, scale and perspective. Keep the "
    "person's identity, pose and background unchanged."
)

_pipe = None


def _load_pipeline() -> QwenImageEditPlusPipeline:
    """Lazy singleton — loaded once per warm worker, not per request."""
    global _pipe
    if _pipe is not None:
        return _pipe

    transformer = QwenImageTransformer2DModel.from_pretrained(
        TRANSFORMER_ID, subfolder="transformer", torch_dtype=torch.bfloat16,
    )
    pipe = QwenImageEditPlusPipeline.from_pretrained(
        MODEL_ID, transformer=transformer, torch_dtype=torch.bfloat16,
    )
    pipe.load_lora_weights(
        FUSION_LORA_REPO, weight_name=FUSION_LORA_WEIGHT, adapter_name=FUSION_ADAPTER_NAME,
    )
    pipe.set_adapters([FUSION_ADAPTER_NAME], adapter_weights=[1.0])
    pipe.to("cuda")

    _pipe = pipe
    return _pipe


def _decode_image(value: str) -> Image.Image:
    if value.strip().startswith("data:"):
        value = value.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(value))).convert("RGB")


def _encode_image(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def handler(event):
    try:
        inp = event.get("input") or {}

        person_b64 = inp.get("person_image")
        accessory_b64 = inp.get("accessory_image")
        edit_b64 = inp.get("image")

        if edit_b64 and not accessory_b64:
            # Single-image edit mode (flat-lay -> worn reference, pose variants):
            # one source photo + an instruction prompt. The object-fusion LoRA is
            # switched off (weight 0) so it does not pull the edit toward inpainting.
            if not inp.get("prompt"):
                return {"error": "prompt is required when editing a single image"}
            images = [_decode_image(edit_b64)]
            lora_weight = 0.0
        elif person_b64 and accessory_b64:
            images = [_decode_image(person_b64), _decode_image(accessory_b64)]
            lora_weight = 1.0
        else:
            return {"error": "send either image + prompt (edit) or person_image + accessory_image (accessory try-on)"}

        prompt = str(inp.get("prompt") or DEFAULT_PROMPT)
        seed = int(inp.get("seed", 42))
        guidance_scale = float(inp.get("guidance_scale", 1.0))
        num_inference_steps = int(inp.get("num_inference_steps", 4))

        pipe = _load_pipeline()
        pipe.set_adapters([FUSION_ADAPTER_NAME], adapter_weights=[lora_weight])
        generator = torch.Generator(device="cuda").manual_seed(seed)

        result = pipe(
            image=images,
            prompt=prompt,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            generator=generator,
        )

        return {"images": [_encode_image(result.images[0])]}
    except Exception as e:  # noqa: BLE001 — surface every failure to the caller
        return {
            "error": f"{type(e).__name__}: {e}",
            "traceback": traceback.format_exc(),
        }


runpod.serverless.start({"handler": handler})
