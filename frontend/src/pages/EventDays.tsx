import { useState } from "react";
import { api, patch } from "../lib/api";
import { errorMessage, useLoad } from "../lib/hooks";
import { Alert, Badge, Btn, Card, Field, inputCls, Loading, PageTitle, Progress } from "../components/ui";

interface Day { id: string; day_number: number; event_date: string | null; registration_open: boolean; registration_target: number; registrations: number }

export default function EventDays() {
  const days = useLoad(() => api<{ days: Day[] }>("/event-days").then((r) => r.days));
  const [msg, setMsg] = useState("");
  if (days.loading && !days.data) return <Loading />;
  return (
    <>
      <PageTitle title="Event days" sub="Open a day when registration starts and close it when it ends." />
      {msg && <div className="mb-4"><Alert kind={msg.startsWith("Saved") ? "ok" : "error"}>{msg}</Alert></div>}
      {days.error && <Alert>{days.error}</Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        {days.data?.map((d) => <DayCard key={d.id} day={d} onSaved={() => { setMsg("Saved."); void days.reload(); }} onError={(e) => setMsg(e)} />)}
      </div>
    </>
  );
}

function DayCard({ day, onSaved, onError }: { day: Day; onSaved: () => void; onError: (e: string) => void }) {
  const [date, setDate] = useState(day.event_date ?? "");
  const [target, setTarget] = useState(String(day.registration_target));
  const [busy, setBusy] = useState(false);
  async function save(body: object) {
    setBusy(true);
    try { await patch(`/event-days/${day.id}`, body); onSaved(); } catch (e) { onError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold">Day {day.day_number}</h2>
        <Badge tone={day.registration_open ? "green" : "grey"}>{day.registration_open ? "Open" : "Closed"}</Badge>
      </div>
      <div>
        <p className="text-2xl font-semibold">{day.registrations}<span className="text-sm text-white/40"> / {day.registration_target}</span></p>
        <div className="mt-2"><Progress value={day.registrations} max={day.registration_target} /></div>
      </div>
      <Btn variant={day.registration_open ? "ghost" : "gold"} className="w-full" busy={busy} onClick={() => save({ registration_open: !day.registration_open })}>
        {day.registration_open ? "Close registration" : "Open registration"}
      </Btn>
      <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Registration target"><input type="number" min={1} max={5000} className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
      <Btn className="w-full" busy={busy} onClick={() => save({ event_date: date, registration_target: Number(target) })}>Save details</Btn>
    </Card>
  );
}
