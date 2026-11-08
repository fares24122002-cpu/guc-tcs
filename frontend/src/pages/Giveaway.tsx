import { useState } from "react";
import { api, post, put } from "../lib/api";
import { errorMessage, useLoad } from "../lib/hooks";
import { SoundsCard } from "../components/SoundsCard";
import { Alert, Badge, Btn, Card, Field, inputCls, Loading, Modal, PageTitle, Stat } from "../components/ui";

interface Settings { draw_type: "daily" | "global"; event_day_id: string | null; day_number: number | null; winner_count: number; exclude_previous_winners: boolean; acknowledge_pending_duplicates: boolean; muted: boolean; active_draw_id: string | null; locked: boolean }
interface Scope { key: string; draw_type: string; event_day_id: string | null; day_number: number | null; eligible_people: number; pending_duplicates: number; draw_id: string | null }

export default function Giveaway() {
  const settings = useLoad(() => api<{ settings: Settings }>("/draws/settings").then((r) => r.settings));
  const [excl, setExcl] = useState<boolean | null>(null);
  const days = useLoad(() => api<{ days: { id: string; day_number: number }[] }>("/event-days").then((r) => r.days));
  const s = settings.data;
  const scopes = useLoad(() => api<{ scopes: Scope[] }>(`/draws/scopes?exclude_previous=${(excl ?? s?.exclude_previous_winners ?? true) ? "true" : "false"}`).then((r) => r.scopes), [s?.exclude_previous_winners, excl]);
  const pres = useLoad(() => api<any>("/presentation/state"));
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  if (settings.loading && !s) return <Loading />;
  if (!s) return <Alert>{settings.error}</Alert>;
  const scope = scopes.data?.find((x) => (s.draw_type === "global" ? x.key === "global" : x.event_day_id === s.event_day_id));

  async function run(fn: () => Promise<unknown>, ok = "Saved.") {
    setBusy(true);
    try { await fn(); setMsg({ kind: "ok", text: ok }); await Promise.all([settings.reload(), scopes.reload(), pres.reload()]); }
    catch (e) { setMsg({ kind: "error", text: errorMessage(e) }); } finally { setBusy(false); }
  }
  const save = (patch: Partial<Settings>) => run(() => put("/draws/settings", patch));

  return (
    <>
      <PageTitle title="Giveaway controller" sub="Configure the draw here. The big screen runs it." actions={<a href="/present" target="_blank" rel="noreferrer" className="min-h-11 rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-semibold text-ink-950">Open projector ↗</a>} />
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}

      {s.locked && (
        <div className="mb-4"><Alert kind="warn">
          An official draw exists and the settings are locked. Winners cannot be changed. {pres.data?.phase === "revealed" ? "The winners have been revealed." : "Press SHUFFLE on the projector to present them."}
        </Alert></div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="font-display text-lg font-bold">Draw settings</h2>
          <Field label="Draw type">
            <select className={inputCls} disabled={s.locked || busy} value={s.draw_type} onChange={(e) => save({ draw_type: e.target.value as "daily" | "global", ...(e.target.value === "daily" && !s.event_day_id && days.data?.[0] ? { event_day_id: days.data[0].id } : {}) })}>
              <option value="daily">Daily giveaway (one event day)</option>
              <option value="global">Global giveaway (all days)</option>
            </select>
          </Field>
          {s.draw_type === "daily" && (
            <Field label="Event day">
              <select className={inputCls} disabled={s.locked || busy} value={s.event_day_id ?? ""} onChange={(e) => save({ event_day_id: e.target.value })}>
                <option value="" disabled>Choose a day</option>
                {days.data?.map((d) => <option key={d.id} value={d.id}>Day {d.day_number}</option>)}
              </select>
            </Field>
          )}
          <Field label="Number of winners (1–10)">
            <input type="number" min={1} max={10} className={inputCls} disabled={s.locked || busy} value={s.winner_count} onChange={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 10) void save({ winner_count: n }); }} />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[#c9a13f]" disabled={s.locked || busy} checked={s.exclude_previous_winners} onChange={(e) => { setExcl(e.target.checked); void save({ exclude_previous_winners: e.target.checked }); }} />
            <span>Exclude people who already won an earlier draw</span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[#c9a13f]" disabled={s.locked || busy} checked={s.acknowledge_pending_duplicates} onChange={(e) => save({ acknowledge_pending_duplicates: e.target.checked })} />
            <span>Draw even if possible duplicates are unreviewed <span className="text-white/40">(not recommended)</span></span>
          </label>
        </Card>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 font-display text-lg font-bold">This draw</h2>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Eligible people" value={scope?.eligible_people ?? "…"} />
              <Stat label="Unreviewed duplicates" value={scope?.pending_duplicates ?? "…"} />
            </div>
            {scope && scope.eligible_people < s.winner_count && !scope.draw_id && <div className="mt-3"><Alert kind="warn">Not enough eligible people yet for {s.winner_count} winners.</Alert></div>}
            {scope && scope.pending_duplicates > 0 && !scope.draw_id && !s.acknowledge_pending_duplicates && <div className="mt-3"><Alert kind="warn">Review the possible duplicates first, or the draw will be refused.</Alert></div>}
            <p className="mt-3 text-sm">{scope?.draw_id ? <Badge tone="green">Already drawn</Badge> : <Badge tone="grey">Not drawn yet</Badge>}</p>
          </Card>

          <Card className="space-y-3">
            <h2 className="font-display text-lg font-bold">Presentation</h2>
            <p className="text-sm text-white/60">Stage: <strong className="text-white">{pres.data?.phase ?? "…"}</strong></p>
            <div className="flex flex-wrap gap-2">
              <Btn busy={busy} disabled={pres.data?.phase !== "revealed"} onClick={() => run(() => post("/presentation/replay"), "Replay started on the projector.")}>Replay presentation</Btn>
              <Btn busy={busy} disabled={!s.active_draw_id || pres.data?.phase === "idle"} onClick={() => run(() => post("/presentation/reset"), "Projector reset to the start screen.")}>Back to start screen</Btn>
              <Btn busy={busy} onClick={() => run(() => post("/presentation/mute", { muted: !s.muted }), s.muted ? "Sound on." : "Sound muted.")}>{s.muted ? "Unmute sound" : "Mute sound"}</Btn>
            </div>
            <Btn busy={busy} onClick={() => run(async () => { const r = await post<{ token: string }>("/presentation/projector-token"); setLink(`${location.origin}/present?t=${r.token}`); }, "Read-only link created (valid 12 hours).")}>Create read-only screen link</Btn>
            {link && <input readOnly className={`${inputCls} text-xs`} value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Read-only projector link" />}
          </Card>

          {s.locked && (
            <Card>
              <h2 className="mb-2 font-display text-lg font-bold">Run another draw</h2>
              <p className="mb-3 text-sm text-white/60">Unlocking lets you choose a new scope. Existing winners and draws are never changed or deleted.</p>
              <Btn variant="danger" onClick={() => setUnlocking(true)}>Unlock for a new draw…</Btn>
            </Card>
          )}
        </div>
      </div>

      <div className="mt-5"><SoundsCard /></div>

      <Modal open={unlocking} onClose={() => setUnlocking(false)} title="Unlock the giveaway?">
        <p className="mb-4 text-sm text-white/70">The projector will go back to the start screen for the next draw. Previous winners stay recorded.</p>
        <div className="flex gap-2">
          <Btn variant="danger" busy={busy} onClick={async () => { await run(() => post("/draws/unlock", { confirm: true }), "Unlocked."); setUnlocking(false); }}>Yes, unlock</Btn>
          <Btn onClick={() => setUnlocking(false)}>Cancel</Btn>
        </div>
      </Modal>
    </>
  );
}
