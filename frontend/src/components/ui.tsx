import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Logo({ size = "h-12 w-12", imgClass = "h-12 w-auto" }: { size?: string; imgClass?: string }) {
  // Drop the official file at frontend/public/logo.png (or .svg) and it replaces the placeholder automatically.
  const [ok, setOk] = useState(true);
  if (ok) return <img src="/logo.png" alt="GUC TCS" className={`${imgClass} object-contain`} onError={() => setOk(false)} />;
  return (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-full border border-gold-500/60 text-[9px] uppercase tracking-widest text-gold-400`}>
      Logo
    </div>
  );
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-white/60">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-white/10 bg-ink-800/60 p-5 ${className}`}>{children}</section>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "gold" | "ghost" | "danger"; busy?: boolean };
export function Btn({ variant = "ghost", busy, className = "", children, disabled, ...rest }: BtnProps) {
  const styles = {
    gold: "bg-gold-500 text-ink-950 enabled:hover:bg-gold-400 font-semibold",
    ghost: "border border-white/15 enabled:hover:border-gold-400",
    danger: "bg-red-600 text-white enabled:hover:bg-red-500 font-semibold",
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`min-h-11 rounded-lg px-4 py-2 text-sm transition disabled:opacity-50 ${styles} ${className}`}
    >
      {busy ? "Please wait…" : children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-lg border border-white/15 bg-ink-900 px-4 py-3 text-base outline-none focus:border-gold-400";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-white/70">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-white/40">{hint}</span>}
    </label>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "ok" | "warn"; children: ReactNode }) {
  const c = {
    error: "border-red-400/30 bg-red-500/10 text-red-200",
    ok: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    warn: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  }[kind];
  return (
    <p role={kind === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${c}`}>
      {children}
    </p>
  );
}

export function Badge({ children, tone = "gold" }: { children: ReactNode; tone?: "gold" | "green" | "red" | "grey" }) {
  const c = {
    gold: "border-gold-500/50 text-gold-400",
    green: "border-emerald-400/40 text-emerald-300",
    red: "border-red-400/40 text-red-300",
    grey: "border-white/20 text-white/60",
  }[tone];
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] uppercase tracking-wider ${c}`}>{children}</span>;
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <p className="py-10 text-center text-sm text-white/50">{what}…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-white/50">{children}</p>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
      <p className="text-xs uppercase tracking-wider text-white/50">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-white/40">{sub}</p>}
    </div>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, max > 0 ? Math.round((value / max) * 100) : 0);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className="h-full rounded-full bg-gold-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/10 bg-ink-800 p-6 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 font-display text-xl font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Photo({ url, alt, className = "" }: { url?: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className={`flex items-center justify-center bg-ink-900 text-[11px] text-white/40 ${className}`}>
        {url ? "Photo unavailable" : "Photo removed"}
      </div>
    );
  }
  return <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
