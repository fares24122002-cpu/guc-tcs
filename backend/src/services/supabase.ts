import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "../middleware/errorHandler.js";
import type { AuthGateway, Profile, ProfileStore, Role, SignedIn } from "./ports.js";

const COLUMNS = "id, full_name, username, role, is_active, created_at";

interface PgError {
  code?: string;
  message?: string;
}

function mapDbError(error: PgError): HttpError {
  if (error.code === "23505") return new HttpError(409, "That username is already taken.");
  if (error.message?.includes("last active administrator")) {
    return new HttpError(409, "The last active administrator cannot be deactivated or demoted.");
  }
  return new HttpError(500, "Database error.");
}

export class SupabaseProfileStore implements ProfileStore {
  constructor(private readonly db: SupabaseClient) {}

  async getById(id: string): Promise<Profile | null> {
    const { data, error } = await this.db.from("profiles").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) throw mapDbError(error);
    return (data as Profile | null) ?? null;
  }

  async list(): Promise<Profile[]> {
    const { data, error } = await this.db.from("profiles").select(COLUMNS).order("created_at");
    if (error) throw mapDbError(error);
    return (data as Profile[]) ?? [];
  }

  async insert(p: { id: string; full_name: string; username: string; role: Role }): Promise<Profile> {
    const { data, error } = await this.db.from("profiles").insert(p).select(COLUMNS).single();
    if (error) throw mapDbError(error);
    return data as Profile;
  }

  async update(id: string, patch: { full_name?: string; is_active?: boolean }): Promise<Profile> {
    const { data, error } = await this.db.from("profiles").update(patch).eq("id", id).select(COLUMNS).maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new HttpError(404, "Account not found.");
    return data as Profile;
  }

  async log(userId: string | null, action: string, details: Record<string, unknown>): Promise<void> {
    const { error } = await this.db.from("activity_logs").insert({ user_id: userId, action, details });
    if (error) throw mapDbError(error);
  }
}

export class SupabaseAuthGateway implements AuthGateway {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly anon: SupabaseClient,
  ) {}

  async verifyToken(token: string): Promise<string | null> {
    const { data, error } = await this.admin.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  }

  private toSigned(data: { session: { access_token: string; refresh_token: string; expires_at?: number } | null; user: { id: string } | null }): SignedIn | null {
    if (!data.session || !data.user) return null;
    return {
      userId: data.user.id,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      },
    };
  }

  async signIn(email: string, password: string): Promise<SignedIn | null> {
    const { data, error } = await this.anon.auth.signInWithPassword({ email, password });
    if (error) {
      // Diagnostic for operators only (server logs). Never includes the password; the client still
      // receives one generic message so usernames cannot be probed.
      console.warn(`signIn failed: status=${error.status ?? "n/a"} code=${error.code ?? "n/a"} message=${error.message} email=${email}`);
      return null;
    }
    return this.toSigned(data);
  }

  async refresh(refreshToken: string): Promise<SignedIn | null> {
    const { data, error } = await this.anon.auth.refreshSession({ refresh_token: refreshToken });
    if (error) return null;
    return this.toSigned(data);
  }

  async signOut(accessToken: string): Promise<void> {
    await this.admin.auth.admin.signOut(accessToken).catch(() => undefined);
  }

  async createUser(email: string, password: string): Promise<string> {
    const { data, error } = await this.admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      if (error && (error.status === 422 || /already/i.test(error.message))) {
        throw new HttpError(409, "That username is already taken.");
      }
      throw new HttpError(500, "Could not create the account.");
    }
    return data.user.id;
  }

  async deleteUser(id: string): Promise<void> {
    await this.admin.auth.admin.deleteUser(id);
  }

  async setPassword(id: string, password: string): Promise<void> {
    const { error } = await this.admin.auth.admin.updateUserById(id, { password });
    if (error) throw new HttpError(500, "Could not update the password.");
  }
}
