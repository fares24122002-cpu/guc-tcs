import type { SupabaseClient } from "@supabase/supabase-js";

/** Private photo storage. Only the backend ever talks to it; browsers get short-lived signed URLs. */
export interface PhotoStorage {
  upload(path: string, data: Buffer, contentType: string): Promise<void>;
  /** Removes objects. Returns the paths that were removed and the ones that failed. */
  remove(paths: string[]): Promise<{ removed: string[]; failed: string[] }>;
  signedUrls(paths: string[], ttlSeconds: number): Promise<Map<string, string>>;
  /** Total stored bytes and object count, or null if it cannot be determined. */
  usage(): Promise<{ bytes: number; objects: number } | null>;
}

export class SupabasePhotoStorage implements PhotoStorage {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly bucket: string,
  ) {}

  async upload(path: string, data: Buffer, contentType: string): Promise<void> {
    const { error } = await this.admin.storage.from(this.bucket).upload(path, data, { contentType, upsert: false });
    if (error) throw new Error(`photo upload failed: ${error.message}`);
  }

  async remove(paths: string[]): Promise<{ removed: string[]; failed: string[] }> {
    if (paths.length === 0) return { removed: [], failed: [] };
    const { error } = await this.admin.storage.from(this.bucket).remove(paths);
    // Removing an object that is already gone is not an error, so a clean call means all are gone.
    return error ? { removed: [], failed: paths } : { removed: paths, failed: [] };
  }

  async signedUrls(paths: string[], ttlSeconds: number): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(paths.filter(Boolean))];
    if (unique.length === 0) return out;
    const { data, error } = await this.admin.storage.from(this.bucket).createSignedUrls(unique, ttlSeconds);
    if (error || !data) return out;
    for (const item of data) if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
    return out;
  }

  async usage(): Promise<{ bytes: number; objects: number } | null> {
    try {
      let bytes = 0;
      let objects = 0;
      for (const folder of ["event-day-1", "event-day-2", "event-day-3"]) {
        for (const [dir, countsAsPhoto] of [[folder, true], [`${folder}/thumbs`, false]] as const) {
          for (let offset = 0; ; offset += 100) {
            const { data, error } = await this.admin.storage.from(this.bucket).list(dir, { limit: 100, offset });
            if (error) return null;
            if (!data || data.length === 0) break;
            for (const item of data) {
              if (!item.id) continue; // a sub-folder entry, not a file
              if (countsAsPhoto) objects += 1;
              bytes += Number((item.metadata as { size?: number } | null)?.size ?? 0);
            }
            if (data.length < 100) break;
          }
        }
      }
      return { bytes, objects };
    } catch {
      return null;
    }
  }
}
