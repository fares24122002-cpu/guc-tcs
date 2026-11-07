import { useState } from "react";
import { api } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { Alert, Empty, fmtDate, inputCls, Loading, PageTitle, Card } from "../components/ui";

const FILTERS = [["", "Everything"], ["registration", "Registrations"], ["staff", "Staff"], ["duplicate", "Duplicates"], ["giveaway", "Giveaway"], ["presentation", "Presentation"], ["cleanup", "Cleanup"]];

export default function Activity() {
  const [filter, setFilter] = useState("");
  const { data, error, loading } = useLoad(() => api<{ logs: any[] }>(`/admin/activity?limit=100${filter ? `&action=${filter}` : ""}`).then((r) => r.logs), [filter]);
  return (
    <>
      <PageTitle title="Activity log" sub="A permanent record of important actions." />
      <select className={`${inputCls} mb-4 max-w-xs`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
        {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {error && <Alert>{error}</Alert>}
      {loading && !data ? <Loading /> : !data?.length ? <Empty>No activity yet.</Empty> : (
        <Card className="divide-y divide-white/10 p-0">
          {data.map((l) => (
            <div key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 p-3 text-sm">
              <span><strong className="text-gold-400">{l.action}</strong> <span className="text-white/60">{l.user_name ?? "system"}</span></span>
              <span className="text-xs text-white/40">{fmtDate(l.created_at)}</span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
