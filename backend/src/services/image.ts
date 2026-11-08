export interface DetectedImage {
  mime: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
}

/** Identify an image by its real file signature. The client-supplied type and file name are never trusted. */
/** Small preview kept next to each photo (used for the shuffle wall). `event-day-1/ab.jpg` -> `event-day-1/thumbs/ab.jpg`. */
export function thumbPath(photoPath: string): string {
  const i = photoPath.lastIndexOf("/");
  const base = photoPath.slice(i + 1).replace(/\.[^.]+$/, "");
  return `${photoPath.slice(0, i + 1)}thumbs/${base}.jpg`;
}

export function detectImage(buf: Buffer): DetectedImage | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}
