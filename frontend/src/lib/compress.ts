/**
 * Shrinks a camera photo in the browser before upload: honours EXIF rotation, caps the longest side,
 * and lowers JPEG quality (then size) until the file is at most ~500 KB.
 */
export const MAX_ORIGINAL_BYTES = 6 * 1024 * 1024;
export const TARGET_BYTES = 500 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export class PhotoError extends Error {}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", q));

export function validatePhoto(file: File): void {
  if (!ACCEPTED.includes(file.type)) throw new PhotoError("Please choose a JPEG, PNG or WebP photo.");
  if (file.size > MAX_ORIGINAL_BYTES) throw new PhotoError("That photo is larger than 6 MB. Take it again at a lower resolution.");
  if (file.size === 0) throw new PhotoError("That photo is empty.");
}

/** A small (about 360 px, ~20 KB) copy of an already-compressed photo, used for the shuffle wall on the big screen. */
export async function makeThumbnail(photo: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(photo);
    const scale = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await toBlob(canvas, 0.7);
    return blob ? new File([blob], "thumb.jpg", { type: "image/jpeg" }) : null;
  } catch {
    return null; // optional: the registration works without it
  }
}

export async function compressPhoto(file: File): Promise<File> {
  validatePhoto(file);
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await decode(file);
  } catch {
    throw new PhotoError("That photo could not be read. Try another one.");
  }
  const w0 = "naturalWidth" in bitmap ? bitmap.naturalWidth : bitmap.width;
  const h0 = "naturalHeight" in bitmap ? bitmap.naturalHeight : bitmap.height;
  let side = Math.min(1600, Math.max(w0, h0));
  let blob: Blob | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, side / Math.max(w0, h0));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoError("Your browser cannot process photos.");
    ctx.fillStyle = "#fff"; // PNG transparency becomes white instead of black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const q of [0.82, 0.72, 0.62, 0.52]) {
      blob = await toBlob(canvas, q);
      if (blob && blob.size <= TARGET_BYTES) break;
    }
    if (blob && blob.size <= TARGET_BYTES) break;
    side = Math.round(side * 0.8);
  }
  if ("close" in bitmap) bitmap.close();
  if (!blob) throw new PhotoError("That photo could not be processed.");
  return new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
}
