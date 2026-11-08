/** Detects the audio format from the file's first bytes (never trust the file name or declared type). */
export interface DetectedAudio { mime: "audio/mpeg" | "audio/wav" | "audio/ogg" | "audio/mp4"; ext: "mp3" | "wav" | "ogg" | "m4a" }

export function detectAudio(buf: Buffer): DetectedAudio | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 3).toString("latin1") === "ID3") return { mime: "audio/mpeg", ext: "mp3" };
  if (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0 && (buf[1]! & 0x06) !== 0) return { mime: "audio/mpeg", ext: "mp3" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WAVE") return { mime: "audio/wav", ext: "wav" };
  if (buf.subarray(0, 4).toString("latin1") === "OggS") return { mime: "audio/ogg", ext: "ogg" };
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") return { mime: "audio/mp4", ext: "m4a" };
  return null;
}
