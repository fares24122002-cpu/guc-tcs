import { useState } from "react";
import { api, post, ApiError } from "../lib/api";
import { errorMessage, useLoad } from "../lib/hooks";
import { Alert, Btn, Card, Field, inputCls, Loading, PageTitle, Progress, Stat } from "../components/ui";

const fmtBytes = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export default function Photos() {
  const [day, setDay] = useState("");
  const days = useLoad(() => api<{ days: { id: string; day_number: number }[] }>("/event-days").then((r) => r.days));
  const prev = useLoad(() => api<{ preview: any; confirm_phrase: string }>(`/cleanup${day ? `?event_day_id=${day}` : ""}`), [day]);
  const sys = useLoad(() => api<any>("/admin/system"));
  const [phrase, setPhrase] = useState("");
  const [early, setEarly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const p = prev.data?.preview;
  const need = prev.data?.confirm_phrase ?? "DELETE PHOTOS";
  const drawMissing = p && (day ? !p.daily_draw_done || !p.global_draw_done : !p.global_draw_done);

  async function run() {
    if (!p) return;
    setBusy(true);
    setMsg(null);
    const total = Number(p.photos_to_delete);
    let done = 0;
    let first = true;
    try {
      for (let i = 0; i < 200; i++) {
        const r = await post<{ deleted: number; failed: number; done: boolean; remaining: number }>("/cleanup", {
          ...(day ? { event_day_id: day } : {}),
          confirm: phrase,
          acknowledge_early: early,
          ...(first ? { expected_count: total } : {}),
        });
        first = false;
        done += r.deleted;
        setProgress({ done, total });
        if (r.done) break;
        if (r.deleted === 0) throw new ApiError(500, "Some photos could not be removed. Try again.");
      }
      setMsg({ kind: "ok", text: `${done} photo(s) removed. Registrations and winner photos were kept.` });
      setPhrase("");
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
      setProgress(null);
      void prev.reload();
      void sys.reload();
    }
  }

  return (
    <>
      <PageTitle title="Photos & cleanup" sub="Free storage by deleting participant photos. Registrations and winner photos are never deleted." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Photos stored" value={sys.data?.storage?.objects ?? "—"} />
        <Stat label="Storage used" value={sys.data?.storage ? fmtBytes(sys.data.storage.bytes) : "—"} sub="Free plan: 1 GB" />
        <Stat label="Will be deleted" value={p?.photos_to_delete ?? "…"} />
        <Stat label="Winner photos kept" value={p?.protected_winner_photos ?? "…"} />
      </div>
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      <Card className="max-w-xl space-y-4">
        <Field label="Which photos?">
          <select className={inputCls} value={day} onChange={(e) => setDay(e.target.value)} disabled={busy}>
            <option value="">All event days</option>
            {days.data?.map((d) => <option key={d.id} value={d.id}>Day {d.day_number} only</option>)}
          </select>
        </Field>
        {prev.loading && !p ? <Loading /> : p && (
          <>
            <p className="text-sm text-white/70">{p.photos_to_delete} photo(s) will be permanently deleted. {p.already_deleted} were already removed.</p>
            {drawMissing && (
              <>
                <Alert kind="warn">{day ? "The draws for this scope have not all been held." : "The global draw has not been held."} The presentation shuffle uses these photos.</Alert>
                <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-[#c9a13f]" checked={early} onChange={(e) => setEarly(e.target.checked)} /><span>I understand, delete them anyway</span></label>
              </>
            )}
            <Field label={`Type ${need} to confirm`}><input className={inputCls} value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" /></Field>
            {progress && <Progress value={progress.done} max={progress.total} />}
            <Btn variant="danger" busy={busy} disabled={phrase !== need || Number(p.photos_to_delete) === 0 || (Boolean(drawMissing) && !early)} onClick={run}>Delete photos</Btn>
          </>
        )}
      </Card>
    </>
  );
}
