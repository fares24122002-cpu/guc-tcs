import { useState } from "react";
import { signIn, type User } from "../lib/api";
import { Alert, Btn, Field, inputCls, Logo } from "../components/ui";
import { errorMessage } from "../lib/hooks";

export default function Login({ onSignedIn, notice }: { onSignedIn: (u: User) => void; notice?: string }) {
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
      setError(errorMessage(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-5">
      <Logo size="h-24 w-24" />
      <h1 className="mt-6 font-display text-3xl font-bold tracking-wide">GUC TCS</h1>
      <p className="mt-1 text-xs uppercase tracking-[0.3em] text-gold-400">15th Anniversary</p>
      <form onSubmit={submit} className="mt-10 w-full space-y-4">
        <Field label="Username">
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" required />
        </Field>
        <Field label="Password">
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error && <Alert>{error}</Alert>}
        <Btn variant="gold" className="w-full py-3" busy={busy} disabled={!username || !password}>Sign in</Btn>
      </form>
      <p className="mt-8 text-xs text-white/40">Access is by invitation from an administrator.</p>
    </main>
  );
}
