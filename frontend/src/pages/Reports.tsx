import { useState } from "react";
import { api, download } from "../lib/api";
import { errorMessage, useLoad } from "../lib/hooks";
import { Alert, Btn, Card, Field, inputCls, PageTitle } from "../components/ui";

export default function Reports() {
  const days = useLoad(() => api<{ days: { id: string; day_number: number }[] }>("/event-days").then((r) => r.days));
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function get(path: string, file: string) {
    setBusy(file); setErr("");
    try { await download(path, file); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(""); }
  }
  const q = day ? `?event_day_id=${day}` : "";
  return (
    <>
      <PageTitle title="Reports" sub="Download registrations and winners as CSV or Excel." />
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}
      <div className="grid gap-5 md:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="font-display text-lg font-bold">Registrations</h2>
          <Field label="Event day"><select className={inputCls} value={day} onChange={(e) => setDay(e.target.value)}><option value="">All days</option>{days.data?.map((d) => <option key={d.id} value={d.id}>Day {d.day_number}</option>)}</select></Field>
          <div className="flex gap-2">
            <Btn variant="gold" busy={busy === "registrations.xlsx"} onClick={() => get(`/exports/registrations.xlsx${q}`, "registrations.xlsx")}>Excel</Btn>
            <Btn busy={busy === "registrations.csv"} onClick={() => get(`/exports/registrations.csv${q}`, "registrations.csv")}>CSV</Btn>
          </div>
        </Card>
        <Card className="space-y-4">
          <h2 className="font-display text-lg font-bold">Winners</h2>
          <p className="text-sm text-white/60">Every official draw with its winners.</p>
          <div className="flex gap-2">
            <Btn variant="gold" busy={busy === "winners.xlsx"} onClick={() => get("/exports/winners.xlsx", "winners.xlsx")}>Excel</Btn>
            <Btn busy={busy === "winners.csv"} onClick={() => get("/exports/winners.csv", "winners.csv")}>CSV</Btn>
          </div>
        </Card>
      </div>
    </>
  );
}
