import os
import base64
from io import BytesIO

import requests
import streamlit as st
from PIL import Image
from dotenv import load_dotenv


# ============================================================
# ENVIRONMENT
# ============================================================

load_dotenv()

RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY")
RUNPOD_ENDPOINT_ID = os.getenv("RUNPOD_ENDPOINT_ID")

if not RUNPOD_API_KEY:
    st.error("RUNPOD_API_KEY is missing from .env")
    st.stop()

if not RUNPOD_ENDPOINT_ID:
    st.error("RUNPOD_ENDPOINT_ID is missing from .env")
    st.stop()

RUNPOD_RUNSYNC_URL = (
    f"https://api.runpod.ai/v2/{RUNPOD_ENDPOINT_ID}/runsync"
)


# ============================================================
# PAGE CONFIG
# ============================================================

st.set_page_config(
    page_title="FASHN VTON 1.5",
    page_icon="👗",
    layout="wide",
)


# ============================================================
# FUNCTIONS
# ============================================================

def image_to_base64(uploaded_file):
    """Convert uploaded image to base64 JPEG."""

    image = Image.open(uploaded_file).convert("RGB")

    buffer = BytesIO()

    image.save(
        buffer,
        format="JPEG",
        quality=95,
    )

    return base64.b64encode(
        buffer.getvalue()
    ).decode("utf-8")


def base64_to_image(encoded_image):
    """Convert base64 response from RunPod to PIL image."""

    if "," in encoded_image:
        encoded_image = encoded_image.split(",", 1)[1]

    image_bytes = base64.b64decode(
        encoded_image
    )

    return Image.open(
        BytesIO(image_bytes)
    ).convert("RGB")


def run_vton(
    person_file,
    garment_file,
    prompt,
    category,
    garment_photo_type,
    num_samples,
    num_timesteps,
    guidance_scale,
    seed,
    segmentation_free,
):
    """Send VTON request to RunPod."""

    person_b64 = image_to_base64(
        person_file
    )

    garment_b64 = image_to_base64(
        garment_file
    )

    payload = {
        "input": {
            "person_image": person_b64,
            "garment_image": garment_b64,

            # Optional prompt
            "prompt": prompt,

            # Model parameters
            "category": category,
            "garment_photo_type": garment_photo_type,
            "num_samples": int(num_samples),
            "num_timesteps": int(num_timesteps),
            "guidance_scale": float(guidance_scale),
            "seed": int(seed),
            "segmentation_free": bool(
                segmentation_free
            ),
        }
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {RUNPOD_API_KEY}",
    }

    response = requests.post(
        RUNPOD_RUNSYNC_URL,
        headers=headers,
        json=payload,
        timeout=300,
    )

    return response


# ============================================================
# HEADER
# ============================================================

st.title("FASHN VTON 1.5")

st.caption(
    "AI Virtual Try-On powered by RunPod Serverless"
)


# ============================================================
# SIDEBAR
# ============================================================

with st.sidebar:

    st.header("Generation Settings")

    category = st.selectbox(
        "Category",
        [
            "tops",
            "bottoms",
            "one-pieces",
            "saree",
        ],
        index=0,
    )

    garment_photo_type = st.selectbox(
        "Garment Photo Type",
        [
            "model",
            "flat-lay",
        ],
        index=0,
    )

    num_samples = st.number_input(
        "Number of Samples",
        min_value=1,
        max_value=4,
        value=1,
        step=1,
    )

    num_timesteps = st.number_input(
        "Timesteps",
        min_value=1,
        max_value=100,
        value=30,
        step=1,
    )

    guidance_scale = st.number_input(
        "Guidance Scale",
        min_value=0.0,
        max_value=10.0,
        value=1.5,
        step=0.1,
    )

    seed = st.number_input(
        "Seed",
        min_value=0,
        max_value=999999999,
        value=42,
        step=1,
    )

    segmentation_free = st.checkbox(
        "Segmentation Free",
        value=True,
    )

    st.divider()

    st.success("RunPod API connected")


# ============================================================
# IMAGE UPLOADS
# ============================================================

col1, col2 = st.columns(2)


# ------------------------------------------------------------
# PERSON
# ------------------------------------------------------------

with col1:

    st.subheader("Person Image")

    person_file = st.file_uploader(
        "Upload person",
        type=[
            "jpg",
            "jpeg",
            "png",
            "webp",
        ],
        key="person_upload",
    )

    if person_file:

        person_preview = Image.open(
            person_file
        )

        st.image(
            person_preview,
            caption="Person",
            use_container_width=True,
        )


# ------------------------------------------------------------
# GARMENT
# ------------------------------------------------------------

with col2:

    st.subheader("Garment Image")

    garment_file = st.file_uploader(
        "Upload garment",
        type=[
            "jpg",
            "jpeg",
            "png",
            "webp",
        ],
        key="garment_upload",
    )

    if garment_file:

        garment_preview = Image.open(
            garment_file
        )

        st.image(
            garment_preview,
            caption="Garment",
            use_container_width=True,
        )


# ============================================================
# PROMPT
# ============================================================

st.divider()

st.subheader("Prompt")

prompt = st.text_area(
    "Optional prompt",
    value="",
    placeholder=(
        "Example: realistic virtual try-on, "
        "natural fit, preserve the person's appearance"
    ),
    height=100,
)


# ============================================================
# GENERATE BUTTON
# ============================================================

st.divider()

generate = st.button(
    "Generate Virtual Try-On",
    type="primary",
    use_container_width=True,
)


# ============================================================
# GENERATE
# ============================================================

if generate:

    # --------------------------------------------------------
    # VALIDATION
    # --------------------------------------------------------

    if not person_file:

        st.error(
            "Please upload a person image."
        )

        st.stop()

    if not garment_file:

        st.error(
            "Please upload a garment image."
        )

        st.stop()


    # --------------------------------------------------------
    # RUNPOD REQUEST
    # --------------------------------------------------------

    with st.spinner(
        "Running FASHN VTON on RunPod..."
    ):

        try:

            response = run_vton(
                person_file=person_file,
                garment_file=garment_file,
                prompt=prompt,
                category=category,
                garment_photo_type=garment_photo_type,
                num_samples=num_samples,
                num_timesteps=num_timesteps,
                guidance_scale=guidance_scale,
                seed=seed,
                segmentation_free=segmentation_free,
            )

        except requests.exceptions.Timeout:

            st.error(
                "RunPod request timed out."
            )

            st.stop()

        except requests.exceptions.RequestException as e:

            st.error(
                f"RunPod request failed: {e}"
            )

            st.stop()

        except Exception as e:

            st.error(
                f"Unexpected error: {e}"
            )

            st.stop()


    # ========================================================
    # HTTP ERROR
    # ========================================================

    if response.status_code != 200:

        st.error(
            f"RunPod HTTP Error: "
            f"{response.status_code}"
        )

        st.code(
            response.text,
            language="json",
        )

        st.stop()


    # ========================================================
    # PARSE RESPONSE
    # ========================================================

    try:

        result = response.json()

    except Exception:

        st.error(
            "RunPod returned invalid JSON."
        )

        st.code(
            response.text
        )

        st.stop()


    # ========================================================
    # JOB FAILURE
    # ========================================================

    if result.get("status") == "FAILED":

        st.error(
            "RunPod job failed."
        )

        st.json(result)

        st.stop()


    if "error" in result:

        st.error(
            "RunPod returned an error."
        )

        st.json(result)

        st.stop()


    # ========================================================
    # GET OUTPUT IMAGES
    # ========================================================

    output_images = None

    if "output" in result:

        output = result["output"]

        if isinstance(output, dict):

            output_images = output.get(
                "images"
            )

    elif "images" in result:

        output_images = result["images"]


    # ========================================================
    # NO OUTPUT
    # ========================================================

    if not output_images:

        st.warning(
            "RunPod completed but returned no images."
        )

        st.json(result)

        st.stop()


    # ========================================================
    # RESULTS
    # ========================================================

    st.success(
        f"Generated {len(output_images)} image(s)"
    )

    st.subheader("Result")


    # ========================================================
    # RESULT DISPLAY
    # ========================================================

    if len(output_images) == 1:

        result_columns = [
            st.container()
        ]

    else:

        result_columns = st.columns(
            len(output_images)
        )


    for index, encoded_image in enumerate(
        output_images
    ):

        try:

            result_image = base64_to_image(
                encoded_image
            )

            with result_columns[index]:

                st.image(
                    result_image,
                    caption=f"Result {index + 1}",
                    use_container_width=True,
                )


                # --------------------------------------------
                # SAVE IMAGE
                # --------------------------------------------

                output_buffer = BytesIO()

                result_image.save(
                    output_buffer,
                    format="PNG",
                )

                st.download_button(
                    label=(
                        f"Save Result "
                        f"{index + 1}"
                    ),
                    data=output_buffer.getvalue(),
                    file_name=(
                        f"vton_result_"
                        f"{index + 1}.png"
                    ),
                    mime="image/png",
                    use_container_width=True,
                    key=(
                        f"download_result_"
                        f"{index}"
                    ),
                )

        except Exception as e:

            st.error(
                f"Could not decode result "
                f"{index + 1}: {e}"
            )


# ============================================================
# DEBUG
# ============================================================

with st.expander("RunPod Endpoint"):

    st.code(
        RUNPOD_RUNSYNC_URL
    )
