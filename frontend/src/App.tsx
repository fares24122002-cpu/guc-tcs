import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchMe, loadSession, setSignedOutHandler, signIn, signOut, type User } from "./lib/api";

// Placeholder: the official GUC TCS logo asset replaces this once provided.
function LogoPlaceholder({ size = "h-24 w-24" }: { size?: string }) {
  return (
    <div className={`${size} flex items-center justify-center rounded-full border border-gold-500/60 text-[10px] uppercase tracking-widest text-gold-400`}>
      Logo
    </div>
  );
}

function LoginScreen({ onSignedIn, notice }: { onSignedIn: (u: User) => void; notice?: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onSignedIn(await signIn(username.trim(), password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-5">
      <LogoPlaceholder />
      <h1 className="mt-6 font-display text-3xl font-bold tracking-wide">GUC TCS</h1>
      <p className="mt-1 text-xs uppercase tracking-[0.3em] text-gold-400">15th Anniversary</p>

      <form onSubmit={submit} className="mt-10 w-full space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-white/70">Username</span>
          <input
            className="w-full rounded-lg border border-white/15 bg-ink-800 px-4 py-3 text-base outline-none focus:border-gold-400"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-white/70">Password</span>
          <input
            className="w-full rounded-lg border border-white/15 bg-ink-800 px-4 py-3 text-base outline-none focus:border-gold-400"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        <button
          disabled={busy || !username || !password}
          className="w-full rounded-lg bg-gold-500 px-4 py-3 font-semibold text-ink-950 transition enabled:hover:bg-gold-400 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-8 text-xs text-white/40">Access is by invitation from an administrator.</p>
    </main>
  );
}

function Home({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <LogoPlaceholder size="h-12 w-12" />
          <div>
            <p className="font-display text-lg font-bold">GUC TCS</p>
            <p className="text-[11px] uppercase tracking-[0.25em] text-gold-400">15th Anniversary</p>
          </div>
        </div>
        <button onClick={onSignOut} className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:border-gold-400">
          Sign out
        </button>
      </header>

      <section className="mt-12 rounded-2xl border border-white/10 bg-ink-800/60 p-6">
        <p className="text-sm text-white/60">Signed in as</p>
        <p className="mt-1 text-2xl font-semibold">{user.full_name}</p>
        <p className="mt-1 text-sm">
          <span className="rounded-full border border-gold-500/50 px-3 py-0.5 text-xs uppercase tracking-wider text-gold-400">
            {user.role === "admin" ? "Administrator" : "Media staff"}
          </span>
        </p>
        <p className="mt-6 text-sm text-white/60">
          {user.role === "admin"
            ? "Administrator tools (staff, event days, giveaway) arrive in the next phases."
            : "Audience registration arrives in the next phase."}
        </p>
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(() => loadSession() !== null);
  const [notice, setNotice] = useState("");

  const handleSignedOut = useCallback(() => {
    setUser(null);
    setNotice("Your session has ended. Please sign in again.");
  }, []);

  useEffect(() => {
    setSignedOutHandler(handleSignedOut);
    if (!loadSession()) return;
    fetchMe()
      .then(setUser)
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [handleSignedOut]);

  if (checking) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-white/60">Loading…</main>;
  }
  if (!user) {
    return (
      <LoginScreen
        notice={notice}
        onSignedIn={(u) => {
          setNotice("");
          setUser(u);
        }}
      />
    );
  }
  return (
    <Home
      user={user}
      onSignOut={() => {
        void signOut().finally(() => setUser(null));
      }}
    />
  );
}
