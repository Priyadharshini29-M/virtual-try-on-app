// Maps an AI Studio wizard's generate request onto PHP's /studio/generate body.
// Shared by the single-person workflows (app.studio.create action) and the
// duo/group workflow (api.studio-group), so both send exactly the same fields.

// workflow_type → garment_type so PHP's /studio/generate controller can route
// to the correct AI model. PHP requires this field.
const GARMENT_TYPE_BY_WORKFLOW = {
  "model-generation": "full",
  "flat-lay": "top",
  mannequin: "top",
  accessories: "top",
  infographic: "full",
};

export function buildGeneratePayload(body) {
  const modelKey = body.model_key || null;

  // "Upload New Model" in the wizard has no model_key, just an ad-hoc photo
  // URL. PHP accepts model_image_url directly, unlimited, not constrained by
  // the registry's fixed 7-per-gender slots.
  const modelImageUrl = !modelKey ? body.model_image_url || null : null;
  const modelGender = body.model_gender === "male" ? "male" : "female";

  return {
    front_image_url: body.front_image_url || null,
    back_image_url: body.back_image_url || null,
    // Paired top + bottom outfit: PHP dresses the top first, then this bottom.
    bottom_image_url: body.bottom_image_url || null,
    detail_image_1_url: body.detail_image_1_url || null,
    detail_image_2_url: body.detail_image_2_url || null,
    detail_image_3_url: body.detail_image_3_url || null,
    model_key: modelKey,
    model_image_url: modelImageUrl,
    model_gender: modelGender,
    garment_type: body.garment_type ?? GARMENT_TYPE_BY_WORKFLOW[body.workflow_type] ?? "full",
    clothing_prompt: body.clothing_prompt || null,
    workflow_type: body.workflow_type || null,
    // Wizard's explicit product type (e.g. "saree"): PHP uses it to pick the
    // try-on engine instead of guessing from the free-text prompt.
    product_type: body.product_type || null,
    // Accessories Try-On: which accessory and where it goes on the model.
    accessory_category: body.accessory_category || null,
    accessory_placement: body.accessory_placement || null,
    // Settings step: PHP applies these with an image-edit pass after try-on.
    pose_reference_url: body.poseReferenceUrl || null,
    background: body.background || null,
    background_image_url: body.background === "custom" ? body.backgroundImageUrl || null : null,
  };
}
