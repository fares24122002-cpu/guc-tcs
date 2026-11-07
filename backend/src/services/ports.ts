export type Role = "admin" | "staff";

export interface Profile {
  id: string;
  full_name: string;
  username: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  /** Unix seconds. */
  expires_at: number;
}

export interface SignedIn {
  session: Session;
  userId: string;
}

/** Persistence the routes depend on. Implemented by Supabase; faked in tests. */
export interface ProfileStore {
  getById(id: string): Promise<Profile | null>;
  list(): Promise<Profile[]>;
  insert(p: { id: string; full_name: string; username: string; role: Role }): Promise<Profile>;
  update(id: string, patch: { full_name?: string; is_active?: boolean }): Promise<Profile>;
  log(userId: string | null, action: string, details: Record<string, unknown>): Promise<void>;
}

/** Credential and session handling. Implemented by Supabase Auth; faked in tests. */
export interface AuthGateway {
  /** Returns the user id for a valid, unexpired access token, otherwise null. */
  verifyToken(token: string): Promise<string | null>;
  signIn(email: string, password: string): Promise<SignedIn | null>;
  refresh(refreshToken: string): Promise<SignedIn | null>;
  signOut(accessToken: string): Promise<void>;
  /** Throws HttpError(409) if the email already exists. */
  createUser(email: string, password: string): Promise<string>;
  deleteUser(id: string): Promise<void>;
  setPassword(id: string, password: string): Promise<void>;
}

export interface Deps {
  auth: AuthGateway;
  store: ProfileStore;
}

export function staffEmail(username: string, domain: string): string {
  return `${username.toLowerCase()}@${domain}`;
}

export function publicUser(p: Profile) {
  return { id: p.id, username: p.username, full_name: p.full_name, role: p.role };
}
