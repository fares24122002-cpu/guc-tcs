import { useState } from "react";
import { api, post } from "../lib/api";
import { errorMessage, useLoad } from "../lib/hooks";
import { Alert, Badge, Btn, Card, Empty, fmtDate, Loading, PageTitle, Photo } from "../components/ui";

const code = (n: number) => `TCS-${String(n).padStart(5, "0")}`;

export default function Duplicates() {
  const [status, setStatus] = useState("pending");
  const list = useLoad(() => api<{ total: number; items: any[] }>(`/duplicates?status=${status}&limit=50`), [status]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  async function decide(id: string, decision: "same" | "different") {
    setBusy(id);
    try { await post(`/duplicates/${id}/resolve`, { decision }); setMsg(""); void list.reload(); } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(""); }
  }
  return (
    <>
      <PageTitle title="Possible duplicates" sub="Registrations that look like the same person. Merging makes them count as one person in the draw." />
      <div className="mb-4 flex gap-2">
        {[["pending", "Needs review"], ["confirmed_same", "Merged"], ["confirmed_different", "Kept separate"]].map(([v, l]) => (
          <Btn key={v} variant={status === v ? "gold" : "ghost"} onClick={() => setStatus(v!)}>{l}</Btn>
        ))}
      </div>
      {msg && <div className="mb-4"><Alert>{msg}</Alert></div>}
      {list.loading && !list.data ? <Loading /> : !list.data?.items.length ? <Empty>Nothing here.</Empty> : (
        <div className="space-y-4">
          {list.data.items.map((c) => (
            <Card key={c.id}>
              <div className="grid gap-4 sm:grid-cols-2">
                {[c.a, c.b].map((r) => (
                  <div key={r.id} className="flex gap-3">
                    <Photo url={r.photo_url} alt={`Photo of ${r.full_name}`} className="h-28 w-28 shrink-0 rounded-xl" />
                    <div className="text-sm">
                      <p className="font-medium">{r.full_name}</p>
                      <p className="text-gold-400">{code(r.reg_number)} · Day {r.day_number}</p>
                      <p className="text-white/50">{fmtDate(r.created_at)}</p>
                      <p className="text-white/50">by {r.staff_name}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {c.status === "pending" ? (
                  <>
                    <Btn variant="gold" busy={busy === c.id} onClick={() => decide(c.id, "same")}>Same person — merge</Btn>
                    <Btn busy={busy === c.id} onClick={() => decide(c.id, "different")}>Different people</Btn>
                  </>
                ) : <Badge tone={c.status === "confirmed_same" ? "gold" : "grey"}>{c.status === "confirmed_same" ? "Merged" : "Kept separate"}</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
