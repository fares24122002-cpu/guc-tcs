import { api } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { Alert, Badge, Card, Empty, fmtDate, Loading, PageTitle, Photo } from "../components/ui";

export default function Winners() {
  const { data, error, loading } = useLoad(() => api<{ draws: any[] }>("/draws").then((r) => r.draws));
  if (loading && !data) return <Loading />;
  return (
    <>
      <PageTitle title="Winners" sub="Official draws are permanent and cannot be edited or deleted." />
      {error && <Alert>{error}</Alert>}
      {!data?.length ? <Empty>No official draw has been held yet.</Empty> : (
        <div className="space-y-6">
          {data.map((d) => (
            <Card key={d.id}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-xl font-bold">{d.draw_type === "global" ? "Global giveaway" : `Day ${d.day_number} giveaway`}</h2>
                <p className="text-xs text-white/50">{fmtDate(d.created_at)} · {d.eligible_entry_count} eligible · drawn by {d.created_by_name} · <Badge tone="green">{d.status}</Badge></p>
              </div>
              <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {d.winners.map((w: any) => (
                  <li key={w.registration_id} className="rounded-xl border border-gold-500/30 bg-ink-900/60 p-3 text-center">
                    <Photo url={w.photo_url} alt={`Photo of ${w.full_name}`} className="aspect-square w-full rounded-lg" />
                    <p className="mt-2 font-medium">{w.full_name}</p>
                    <p className="text-xs text-gold-400">TCS-{String(w.reg_number).padStart(5, "0")} · Day {w.day_number}</p>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
