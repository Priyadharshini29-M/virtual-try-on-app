# Requires a GPU with >=48GB VRAM at inference (A100 80GB / H100 recommended) —
# Qwen-Image-Edit-2509 is a ~20B-parameter model loaded in bfloat16.
# Base image already bundles Python 3.11 + PyTorch 2.4 + matching CUDA 12.4 build.
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

WORKDIR /worker

COPY requirements.txt .
RUN python3.11 -m pip install --no-cache-dir -r requirements.txt

COPY handler.py .

# Model weights (~40GB+) download from Hugging Face on first cold start and
# are cached in the image layer/volume after that. For production traffic,
# attach a RunPod Network Volume so warm-up doesn't re-download per worker —
# see README.md.
CMD ["python3.11", "-u", "handler.py"]
