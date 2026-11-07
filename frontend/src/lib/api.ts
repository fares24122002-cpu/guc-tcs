const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface User {
  id: string;
  username: string;
  full_name: string;
  role: "admin" | "staff";
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  time: string;
}

// --- session storage (tolerates browsers that block storage) -------------------------------------
const KEY = "guc-tcs-session";
let memory: Session | null = null;

export function loadSession(): Session | null {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    memory = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    memory = null;
  }
  return memory;
}

export function saveSession(session: Session | null): void {
  memory = session;
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the session lives in memory for this tab only */
  }
}

/** Called when the session can no longer be refreshed, so the UI can return to the login screen. */
let onSignedOut: () => void = () => undefined;
export function setSignedOutHandler(fn: () => void): void {
  onSignedOut = fn;
}

async function send<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection.");
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new ApiError(response.status, data.error ?? "Something went wrong.");
  return data;
}

let refreshing: Promise<Session | null> | null = null;

/** Exchange the refresh token once, even if several requests expire at the same moment. */
function refreshSession(): Promise<Session | null> {
  refreshing ??= (async () => {
    const current = loadSession();
    if (!current) return null;
    try {
      const res = await send<{ session: Session }>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      saveSession(res.session);
      return res.session;
    } catch {
      saveSession(null);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Authenticated request. Refreshes the session once on a 401, then signs the user out. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = loadSession();
  try {
    return await send<T>(path, init, session?.access_token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && session) {
      const fresh = await refreshSession();
      if (fresh) return send<T>(path, init, fresh.access_token);
      onSignedOut();
    }
    if (err instanceof ApiError && err.status === 403 && session) {
      // Deactivated while signed in.
      saveSession(null);
      onSignedOut();
    }
    throw err;
  }
}

export async function signIn(username: string, password: string): Promise<User> {
  const res = await send<{ session: Session; user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  saveSession(res.session);
  return res.user;
}

export async function signOut(): Promise<void> {
  const session = loadSession();
  saveSession(null);
  if (session) await send("/auth/logout", { method: "POST" }, session.access_token).catch(() => undefined);
}

export async function fetchMe(): Promise<User> {
  return (await api<{ user: User }>("/auth/me")).user;
}
