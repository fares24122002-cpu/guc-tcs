import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, loadSession, post, publicGet, fetchMe, type User } from "../lib/api";
import { startFireworks } from "../lib/fireworks";
import { audioReady, sounds, unlockAudio } from "../lib/sound";
import { errorMessage } from "../lib/hooks";
import { Logo } from "../components/ui";
import Login from "./Login";

interface Winner { position: number; full_name: string; reg_number: number; photo_url: string | null }
interface State {
  phase: "none" | "idle" | "countdown" | "revealed";
  server_time: string; countdown_seconds: number; countdown_started_at: string | null;
  muted: boolean; winner_count: number; draw_type: "daily" | "global"; day_number: number | null; winners?: Winner[];
}
const WORDS = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"];
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Present() {
  const token = useMemo(() => new URLSearchParams(location.search).get("t") ?? "", []);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(!token && loadSession() !== null);

  useEffect(() => {
    if (token || !loadSession()) return;
    fetchMe().then(setUser).catch(() => undefined).finally(() => setChecking(false));
  }, [token]);

  if (checking) return <Screen><p className="m-auto text-white/50">Loading…</p></Screen>;
  if (!token && !user) return <Login onSignedIn={setUser} notice="" />;
  if (!token && user?.role !== "admin") return <Screen><p className="m-auto text-xl text-white/70">Only administrators can open the projector.</p></Screen>;
  return <Projector token={token} admin={!token} />;
}

const Screen = ({ children }: { children: React.ReactNode }) => <main className="flex min-h-screen bg-ink-950">{children}</main>;

function Projector({ token, admin }: { token: string; admin: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0); // server clock minus local clock
  const [photos, setPhotos] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [localMute, setLocalMute] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [shuffleError, setShuffleError] = useState("");
  const prevPhase = useRef<string>("");
  const justRevealed = useRef(false);
  const lastTick = useRef(-1);
  const q = token ? `?t=${encodeURIComponent(token)}` : "";

  const fetchJson = useCallback(<T,>(path: string) => (token ? publicGet<T>(`${path}?t=${encodeURIComponent(token)}`) : api<T>(path)), [token]);
  const muted = (state?.muted ?? false) || localMute;

  const refresh = useCallback(async () => {
    try {
      const t0 = Date.now();
      const s = await fetchJson<State>("/presentation/state");
      const rtt = Date.now() - t0;
      setOffset(Date.parse(s.server_time) + rtt / 2 - Date.now());
      setNow(Date.now());
      setState(s);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? errorMessage(e) : "Reconnecting…");
    }
  }, [fetchJson]);

  const remainingMs = state?.phase === "countdown" && state.countdown_started_at
    ? state.countdown_seconds * 1000 - (now + offset - Date.parse(state.countdown_started_at))
    : state?.countdown_seconds ? state.countdown_seconds * 1000 : 15000;
  const count = Math.min(state?.countdown_seconds ?? 15, Math.max(0, Math.ceil(remainingMs / 1000)));

  // Polling: fast while the countdown runs, relaxed otherwise.
  useEffect(() => {
    void refresh();
    const ms = state?.phase === "countdown" ? 700 : state?.phase === "revealed" ? 4000 : 1500;
    const id = setInterval(() => void refresh(), ms);
    return () => clearInterval(id);
  }, [refresh, state?.phase]);

  // Near zero, ask the server quickly so the winners appear the instant the 15 seconds are over.
  const nearEnd = state?.phase === "countdown" && count <= 1;
  useEffect(() => {
    if (!nearEnd) return;
    const id = setInterval(() => void refresh(), 250);
    return () => clearInterval(id);
  }, [nearEnd, refresh]);

  // Local clock for smooth countdown.
  useEffect(() => {
    if (state?.phase !== "countdown") return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [state?.phase]);

  // Photos for the shuffle visuals, prefetched before the countdown starts.
  useEffect(() => {
    if (!state || state.phase === "revealed" || photos.length) return;
    fetchJson<{ photos: string[] }>("/presentation/pool?limit=48")
      .then((r) => {
        r.photos.forEach((u) => { const i = new Image(); i.src = u; });
        setPhotos(r.photos);
      })
      .catch(() => undefined);
  }, [state?.phase, fetchJson, photos.length, state]);

  // Custom sounds uploaded by the admin (fall back to the built-in synthesized ones when absent).
  const [custom, setCustom] = useState<{ countdown: string | null; winners: string | null }>({ countdown: null, winners: null });
  const countdownAudio = useRef<HTMLAudioElement | null>(null);
  const winnersAudio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchJson<{ sounds: { countdown: { url: string | null } | null; winners: { url: string | null } | null } }>("/sounds")
        .then((r) => alive && setCustom({ countdown: r.sounds.countdown?.url ?? null, winners: r.sounds.winners?.url ?? null }))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 20 * 60 * 1000); // signed links last 6 hours; refresh well before that
    return () => { alive = false; clearInterval(id); };
  }, [fetchJson]);
  useEffect(() => {
    const make = (url: string | null, prev: HTMLAudioElement | null) => {
      if (prev && url && prev.src === url) return prev;
      prev?.pause();
      if (!url) return null;
      const a = new Audio(url);
      a.preload = "auto";
      return a;
    };
    countdownAudio.current = make(custom.countdown, countdownAudio.current);
    winnersAudio.current = make(custom.winners, winnersAudio.current);
  }, [custom]);
  const stopAll = () => { for (const a of [countdownAudio.current, winnersAudio.current]) { a?.pause(); } };

  // Sounds on phase changes and each second.
  useEffect(() => {
    const phase = state?.phase ?? "";
    const prev = prevPhase.current;
    const cd = countdownAudio.current;
    const win = winnersAudio.current;
    if (muted) {
      stopAll();
    } else {
      if (phase === "countdown") {
        if (cd) {
          // Start (or resume after a reload) in step with the server clock.
          if (cd.paused) {
            const elapsed = Math.max(0, Math.min(14.5, (state?.countdown_seconds ?? 15) - remainingMs / 1000));
            try { cd.currentTime = prev === "countdown" || !prev ? elapsed : 0; } catch { /* not seekable yet */ }
            void cd.play().catch(() => undefined);
          }
        } else if (prev && prev !== phase) sounds.start();
      } else if (cd && !cd.paused) {
        cd.pause();
      }
      if (phase === "revealed" && prev === "countdown") {
        if (win) { win.currentTime = 0; void win.play().catch(() => undefined); } else sounds.reveal();
      }
      if (phase !== "revealed") win?.pause();
    }
    justRevealed.current = phase === "revealed" && prev === "countdown";
    if (phase !== "countdown") lastTick.current = -1;
    prevPhase.current = phase;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phase, muted, custom]);
  useEffect(() => {
    if (state?.phase === "countdown" && count !== lastTick.current) {
      if (lastTick.current !== -1 && !muted && count > 0 && !countdownAudio.current) sounds.tick(count <= 3);
      lastTick.current = count;
    }
  }, [count, state?.phase, muted]);

  // Keep the screen awake and allow F for fullscreen.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    const key = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "f") void toggleFullscreen(); };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); void lock?.release(); };
  }, []);

  const enableSound = () => setSoundOn(unlockAudio());
  useEffect(() => {
    const unlock = () => enableSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  async function shuffle() {
    enableSound();
    setShuffling(true);
    setShuffleError("");
    try {
      await post("/presentation/shuffle");
      await refresh();
    } catch (e) {
      setShuffleError(errorMessage(e));
    } finally {
      setShuffling(false);
    }
  }
  async function toggleMute() {
    enableSound();
    if (admin) {
      try { await post("/presentation/mute", { muted: !(state?.muted ?? false) }); await refresh(); } catch { /* ignore */ }
    } else setLocalMute((m) => !m);
  }

  const phase = state?.phase ?? "none";
  const sub = state ? `${state.draw_type === "global" ? "Global giveaway" : state.day_number ? `Day ${state.day_number} giveaway` : "Giveaway"} · ${state.winner_count} winner${state.winner_count === 1 ? "" : "s"}` : "";

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-950 text-white" style={{ cursor: phase === "idle" || phase === "none" ? "default" : "none" }}>
      {phase === "countdown" && <ShuffleStage photos={photos} count={count} />}
      {phase === "revealed" && state?.winners && <Reveal winners={state.winners} count={state.winner_count} fanfare={justRevealed.current} muted={muted || Boolean(custom.winners)} />}
      {(phase === "idle" || phase === "none") && (
        <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <Logo size="h-56 w-56 sm:h-72 sm:w-72" imgClass="h-56 w-auto max-w-[90vw] sm:h-80" />
          <h1 className="mt-8 font-display text-5xl font-bold uppercase tracking-[0.3em] text-gold-300 sm:text-7xl">The Giveaway</h1>
          {sub && <p className="mt-6 text-lg text-white/60">{sub}</p>}
          {admin ? (
            <button onClick={shuffle} disabled={shuffling} className="mt-12 rounded-full bg-gold-500 px-16 py-6 font-display text-4xl font-bold tracking-[0.2em] text-ink-950 shadow-[0_0_60px_rgba(201,161,63,0.5)] transition enabled:hover:scale-105 enabled:hover:bg-gold-400 disabled:opacity-60 sm:text-5xl">
              {shuffling ? "…" : "SHUFFLE"}
            </button>
          ) : (
            <p className="mt-12 text-xl text-white/50">The draw will begin shortly…</p>
          )}
          {shuffleError && <p role="alert" className="mt-6 max-w-xl rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-red-200">{shuffleError}</p>}
        </div>
      )}

      <div className="fixed bottom-3 right-3 z-30 flex items-center gap-2 opacity-40 transition hover:opacity-100" style={{ cursor: "default" }}>
        {!muted && !soundOn && !audioReady() && <span className="rounded bg-black/60 px-2 py-1 text-xs">Click anywhere to enable sound</span>}
        <button onClick={toggleMute} className="h-10 w-10 rounded-full bg-black/60 text-lg" aria-label={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🔊"}</button>
        <button onClick={() => void toggleFullscreen()} className="h-10 w-10 rounded-full bg-black/60 text-lg" aria-label="Full screen">⛶</button>
      </div>
      {error && <p className="fixed left-3 top-3 z-30 rounded bg-black/70 px-3 py-1 text-xs text-amber-300" role="status">{error}</p>}
      <span className="sr-only" aria-live="polite">{phase === "countdown" ? `Shuffling, ${count} seconds` : phase === "revealed" ? "Winners revealed" : ""}</span>
      <span hidden>{q}</span>
    </main>
  );
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* not supported */ }
}

/** Stage 2: a wall of participant photos flickering at random, with the countdown on top. */
function ShuffleStage({ photos, count }: { photos: string[]; count: number }) {
  const COLS = 8, ROWS = 5, N = COLS * ROWS;
  const [tiles, setTiles] = useState<number[]>(() => Array.from({ length: N }, (_, i) => i));
  const [hot, setHot] = useState(0);
  useEffect(() => {
    if (!photos.length) return;
    const slow = reduced();
    const id = setInterval(() => {
      const t = Math.floor(Math.random() * N);
      setHot(t);
      setTiles((cur) => { const next = cur.slice(); next[t] = Math.floor(Math.random() * photos.length); return next; });
    }, slow ? 1000 : 90);
    return () => clearInterval(id);
  }, [photos.length, N]);

  return (
    <div className="relative flex min-h-screen items-center justify-center">
      <div className="absolute inset-0 grid gap-1 p-1 opacity-70" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }} aria-hidden>
        {tiles.map((ph, i) => (
          <div key={i} className={`overflow-hidden rounded-md bg-ink-800 transition ${i === hot && !reduced() ? "scale-105 ring-4 ring-gold-400" : ""}`}>
            {photos.length > 0 && <img src={photos[ph % photos.length]} alt="" className="h-full w-full object-cover" />}
          </div>
        ))}
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/70 via-ink-950/40 to-ink-950/80" />
      <div className="relative text-center">
        <p className="font-display text-3xl uppercase tracking-[0.35em] text-gold-300 sm:text-5xl">Shuffling</p>
        <div className="mx-auto mt-6 flex h-72 w-72 items-center justify-center rounded-full border-8 border-gold-400 bg-ink-950/80 shadow-[0_0_80px_rgba(224,187,98,0.6)] sm:h-96 sm:w-96">
          <span className="font-display text-[10rem] font-bold leading-none text-white tabular-nums sm:text-[13rem]" aria-hidden>{count}</span>
        </div>
      </div>
    </div>
  );
}

/** Stage 3: all winners appear together in one row, with fireworks behind them. */
function Reveal({ winners, count, fanfare, muted }: { winners: Winner[]; count: number; fanfare: boolean; muted: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  useEffect(() => {
    if (!canvas.current) return;
    return startFireworks(canvas.current, { intenseMs: fanfare ? 8000 : 2500, onPop: () => { if (!mutedRef.current && audioReady()) sounds.pop(); } });
  }, [fanfare]);
  const n = winners.length;
  const title = WORDS[count] ? `WE HAVE OUR ${WORDS[count]} WINNER${count === 1 ? "" : "S"}!` : "WE HAVE OUR WINNERS!";
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
      <div className="relative z-10 w-full text-center">
        <h1 className="reveal-in font-display text-4xl font-bold text-gold-300 drop-shadow-[0_0_30px_rgba(224,187,98,0.7)] sm:text-6xl">{title}</h1>
        <p className="reveal-in mt-3 font-display text-2xl tracking-[0.4em] text-white sm:text-4xl">CONGRATULATIONS!</p>
        <ol className="mx-auto mt-10 grid w-full max-w-[1800px] gap-3 sm:gap-5" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {winners.map((w) => (
            <li key={w.position} className="reveal-card rounded-2xl border-2 border-gold-400/70 bg-ink-900/80 p-2 shadow-[0_0_40px_rgba(224,187,98,0.35)] backdrop-blur sm:p-4">
              {w.photo_url ? <img src={w.photo_url} alt={`Photo of ${w.full_name}`} className="aspect-square w-full rounded-xl object-cover" /> : <div className="aspect-square w-full rounded-xl bg-ink-800" />}
              <p className="mt-3 break-words text-center font-display font-bold leading-tight" style={{ fontSize: `clamp(0.9rem, ${n > 6 ? 1.4 : 2.1}vw, 2.2rem)` }}>{w.full_name}</p>
              <p className="mt-1 text-center text-xs text-gold-400 sm:text-sm">TCS-{String(w.reg_number).padStart(5, "0")}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
