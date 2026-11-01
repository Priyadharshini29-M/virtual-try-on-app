// Browser-only helper: AI Studio has no upload size limit, so big phone/DSLR photos
// are downscaled here before they are sent. Without this a 30 MB original would be
// re-encoded by the PHP server (GD runs out of memory on huge images) and later sent
// as base64 to the try-on engines, which cap their request size.
//
// Longest side is capped at MAX_EDGE px and the result is re-encoded as JPEG. Small
// images are returned untouched. On any failure (e.g. a format the browser cannot
// decode) the original file is returned so the upload still goes through.

const MAX_EDGE = 2560;
const SKIP_BELOW_BYTES = 3 * 1024 * 1024;

export async function shrinkImageIfLarge(file) {
  if (!file || !file.type?.startsWith("image/") || file.type === "image/gif") return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (file.size <= SKIP_BELOW_BYTES && longEdge <= MAX_EDGE) return file;

    const scale = Math.min(1, MAX_EDGE / longEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff"; // transparent PNGs flatten onto white instead of black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return file;
    // Never make a file bigger when the pixel size did not change.
    if (scale === 1 && blob.size >= file.size) return file;

    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}
