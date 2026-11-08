import { randomUUID } from "node:crypto";
import { HttpError } from "../src/middleware/errorHandler.js";
import { Repo } from "../src/services/repo.js";
import type { PhotoStorage } from "../src/services/storage.js";
import type { AuthGateway, Deps, Profile, ProfileStore, Role, SignedIn } from "../src/services/ports.js";

interface FakeUser {
  id: string;
  email: string;
  password: string;
}

/** In-memory Supabase Auth. Tokens are opaque strings mapped to user ids. */
export class FakeAuth implements AuthGateway {
  users = new Map<string, FakeUser>();
  tokens = new Map<string, string>();
  refreshTokens = new Map<string, string>();
  deleted: string[] = [];

  private issue(userId: string): SignedIn {
    const access = `at_${randomUUID()}`;
    const refresh = `rt_${randomUUID()}`;
    this.tokens.set(access, userId);
    this.refreshTokens.set(refresh, userId);
    return {
      userId,
      session: { access_token: access, refresh_token: refresh, expires_at: Math.floor(Date.now() / 1000) + 3600 },
    };
  }

  async verifyToken(token: string) {
    return this.tokens.get(token) ?? null;
  }
  async signIn(email: string, password: string) {
    const user = [...this.users.values()].find((u) => u.email === email && u.password === password);
    return user ? this.issue(user.id) : null;
  }
  async refresh(refreshToken: string) {
    const id = this.refreshTokens.get(refreshToken);
    if (!id) return null;
    this.refreshTokens.delete(refreshToken);
    return this.issue(id);
  }
  async signOut(accessToken: string) {
    this.tokens.delete(accessToken);
  }
  async createUser(email: string, password: string) {
    if ([...this.users.values()].some((u) => u.email === email)) {
      throw new HttpError(409, "That username is already taken.");
    }
    const id = randomUUID();
    this.users.set(id, { id, email, password });
    return id;
  }
  async deleteUser(id: string) {
    this.users.delete(id);
    this.deleted.push(id);
  }
  async setPassword(id: string, password: string) {
    const u = this.users.get(id);
    if (u) u.password = password;
  }
}

export class FakeStore implements ProfileStore {
  profiles = new Map<string, Profile>();
  logs: { userId: string | null; action: string; details: Record<string, unknown> }[] = [];
  failNextInsert = false;

  async getById(id: string) {
    return this.profiles.get(id) ?? null;
  }
  async list() {
    return [...this.profiles.values()];
  }
  async insert(p: { id: string; full_name: string; username: string; role: Role }) {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new HttpError(500, "Database error.");
    }
    if ([...this.profiles.values()].some((x) => x.username === p.username)) {
      throw new HttpError(409, "That username is already taken.");
    }
    const profile: Profile = { ...p, is_active: true, created_at: new Date().toISOString() };
    this.profiles.set(p.id, profile);
    return profile;
  }
  async update(id: string, patch: { full_name?: string; is_active?: boolean }) {
    const existing = this.profiles.get(id);
    if (!existing) throw new HttpError(404, "Account not found.");
    const next = { ...existing, ...patch };
    this.profiles.set(id, next);
    return next;
  }
  async log(userId: string | null, action: string, details: Record<string, unknown>) {
    this.logs.push({ userId, action, details });
  }
}

/** In-memory photo storage; signed URLs are fake but unique per path. */
export class MemoryStorage implements PhotoStorage {
  files = new Map<string, { data: Buffer; contentType: string }>();
  async upload(path: string, data: Buffer, contentType: string) {
    if (this.files.has(path)) throw new Error("exists");
    this.files.set(path, { data, contentType });
  }
  async remove(paths: string[]) {
    for (const p of paths) this.files.delete(p);
    return { removed: paths, failed: [] };
  }
  async signedUrls(paths: string[]) {
    return new Map(paths.filter((p) => this.files.has(p)).map((p) => [p, `https://files.test/${p}?sig=1`]));
  }
  async usage() {
    return { bytes: [...this.files.values()].reduce((n, f) => n + f.data.length, 0), objects: this.files.size };
  }
}

/** A repository whose database is never reached (for tests that only exercise auth and routing). */
const noDb = new Repo({ rpc: async () => ({ data: null, error: { message: "no database in this test" } }) });

export const DOMAIN = "staff.guc-tcs.test";

export interface World {
  deps: Deps;
  auth: FakeAuth;
  store: FakeStore;
  /** Creates a user + profile directly (bypassing the API). */
  seed(username: string, password: string, role: Role, active?: boolean): Promise<Profile>;
}

export function makeWorld(): World {
  const auth = new FakeAuth();
  const store = new FakeStore();
  return {
    deps: { auth, store, repo: noDb, storage: new MemoryStorage(), sounds: new MemoryStorage() },
    auth,
    store,
    async seed(username, password, role, active = true) {
      const id = await auth.createUser(`${username}@${DOMAIN}`, password);
      const profile = await store.insert({ id, full_name: `${username} Person`, username, role });
      if (!active) await store.update(id, { is_active: false });
      return (await store.getById(id))!;
    },
  };
}
