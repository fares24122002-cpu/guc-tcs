import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, apiUrl, loadSession } from "../lib/api";
import { compressPhoto, PhotoError } from "../lib/compress";
import { errorMessage, useLoad } from "../lib/hooks";
import { Alert, Btn, Card, Field, inputCls, Loading, PageTitle, Stat } from "../components/ui";

interface Day { id: string; day_number: number; event_date: string | null; registration_open: boolean; registration_target: number; registrations: number }
interface Saved { code: string; full_name: string; photo_url: string | null; already_saved?: boolean }
interface Match { day_number: number; count: number }

const newKey = () => crypto.randomUUID();

/** Uses XMLHttpRequest so the upload shows real progress on slow venue Wi-Fi. */
function upload(form: FormData, onProgress: (pct: number) => void): Promise<{ status: number; body: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiUrl}/registrations`);
    xhr.setRequestHeader("Authorization", `Bearer ${loadSession()?.access_token ?? ""}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: Record<string, any> = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new ApiError(0, "No connection. Your entry is kept; tap Try again when you are back online."));
    xhr.ontimeout = () => reject(new ApiError(0, "The upload timed out. Tap Try again."));
    xhr.timeout = 60_000;
    xhr.send(form);
  });
}

export default function Register() {
  const days = useLoad(() => api<{ days: Day[] }>("/event-days").then((r) => r.days));
  const summary = useLoad(() => api<{ total: number; today: number }>("/registrations/summary"));
  const [dayId, setDayId] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dupes, setDupes] = useState<Match[] | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const key = useRef(newKey());
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  const openDays = useMemo(() => (days.data ?? []).filter((d) => d.registration_open), [days.data]);
  useEffect(() => {
    if (!dayId && openDays.length) setDayId(openDays[0]!.id);
    if (dayId && !openDays.some((d) => d.id === dayId)) setDayId(openDays[0]?.id ?? "");
  }, [openDays, dayId]);
  useEffect(() => {
    if (!photo) return setPreview("");
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    setDupes(null);
    try {
      setBusy(true);
      setPhoto(await compressPhoto(file));
      key.current = newKey(); // a new photo is a new submission
    } catch (e) {
      setPhoto(null);
      setError(e instanceof PhotoError ? e.message : "That photo could not be used.");
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(name.trim().length >= 2 && photo && dayId && consent) && !busy;

  async function submit(allowDuplicate = false) {
    if (!photo || busy) return;
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const form = new FormData();
      form.set("full_name", name.trim());
      form.set("event_day_id", dayId);
      form.set("idempotency_key", key.current);
      form.set("consent", String(consent));
      if (allowDuplicate) form.set("allow_duplicate", "true");
      form.set("photo", photo);
      const { status, body } = await upload(form, setProgress);
      if (status === 401) throw new ApiError(401, "Your session ended. Sign in again; your entry is still here.");
      if (status === 409 && body.code === "possible_duplicate") {
        setDupes((body.matches as Match[]) ?? []);
        return;
      }
      if (status >= 400) throw new ApiError(status, (body.error as string) ?? "The registration failed.");
      setSaved({ ...(body.registration as Saved), already_saved: body.already_saved });
      void summary.reload();
      void days.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSaved(null);
    setName("");
    setPhoto(null);
    setConsent(false);
    setDupes(null);
    setError("");
    key.current = newKey();
  }

  if (days.loading && !days.data) return <Loading />;

  if (saved) {
    return (
      <Card className="mx-auto max-w-md text-center">
        {saved.photo_url && <img src={saved.photo_url} alt="" className="mx-auto h-40 w-40 rounded-xl object-cover" />}
        <p className="mt-4 text-sm uppercase tracking-widest text-emerald-300">{saved.already_saved ? "Already saved" : "Registered"}</p>
        <p className="mt-1 font-display text-4xl font-bold text-gold-400">{saved.code}</p>
        <p className="mt-2 text-lg">{saved.full_name}</p>
        <Btn variant="gold" className="mt-6 w-full py-3" onClick={reset}>Register next person</Btn>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="Register a participant" sub="Take a clear photo of the participant, then enter their name." />
      <div className="mb-5 grid grid-cols-2 gap-3">
        <Stat label="Your registrations today" value={summary.data?.today ?? "…"} />
        <Stat label="Your total" value={summary.data?.total ?? "…"} />
      </div>

      {openDays.length === 0 ? (
        <Alert kind="warn">Registration is closed for every event day. Ask an administrator to open a day.</Alert>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submit(false); }} className="space-y-5">
          <Card className="space-y-4">
            {openDays.length > 1 && (
              <Field label="Event day">
                <select className={inputCls} value={dayId} onChange={(e) => setDayId(e.target.value)}>
                  {openDays.map((d) => <option key={d.id} value={d.id}>Day {d.day_number}{d.event_date ? ` · ${d.event_date}` : ""}</option>)}
                </select>
              </Field>
            )}
            {openDays.length === 1 && <p className="text-sm text-white/60">Event day: <strong className="text-white">Day {openDays[0]!.day_number}</strong></p>}

            <div>
              <span className="mb-1 block text-sm text-white/70">Photo</span>
              {preview ? (
                <img src={preview} alt="Preview of the participant" className="mb-3 h-64 w-full rounded-xl object-cover" />
              ) : (
                <div className="mb-3 flex h-40 items-center justify-center rounded-xl border border-dashed border-white/20 text-sm text-white/40">No photo yet</div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Btn type="button" variant="gold" onClick={() => camera.current?.click()} disabled={busy}>{photo ? "Retake photo" : "Take photo"}</Btn>
                <Btn type="button" onClick={() => gallery.current?.click()} disabled={busy}>Choose file</Btn>
              </div>
              <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
              <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
              {photo && <p className="mt-2 text-xs text-white/40">Compressed to {Math.round(photo.size / 1024)} KB</p>}
            </div>

            <Field label="Full name">
              <input className={inputCls} value={name} onChange={(e) => { setName(e.target.value); setDupes(null); }} autoComplete="off" maxLength={120} required />
            </Field>

            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-[#c9a13f]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span className="text-white/80">The participant agrees to be photographed and to take part in the giveaway, and that their name and photo may be shown on screen if they win.</span>
            </label>
          </Card>

          {dupes && (
            <Alert kind="warn">
              Someone named “{name.trim()}” is already registered ({dupes.map((m) => `Day ${m.day_number}: ${m.count}`).join(", ")}). Are they a different person?
              <span className="mt-3 flex gap-2">
                <Btn type="button" variant="gold" onClick={() => void submit(true)} busy={busy}>Different person, register</Btn>
                <Btn type="button" onClick={() => setDupes(null)}>Cancel</Btn>
              </span>
            </Alert>
          )}
          {error && <Alert>{error}</Alert>}
          {busy && photo && progress > 0 && progress < 100 && <Progress pct={progress} />}
          <Btn variant="gold" className="w-full py-4 text-base" busy={busy} disabled={!ready || Boolean(dupes)}>
            {error && photo ? "Try again" : "Register"}
          </Btn>
        </form>
      )}
    </div>
  );
}

function Progress({ pct }: { pct: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-label="Upload progress">
      <div className="h-full bg-gold-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}
