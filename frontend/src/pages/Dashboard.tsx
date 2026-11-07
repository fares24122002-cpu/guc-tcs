import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { Alert, Badge, Card, fmtDate, Loading, PageTitle, Progress, Stat } from "../components/ui";

export default function Dashboard() {
  const { data, error, loading } = useLoad(() => api<any>("/admin/dashboard"));
  if (loading && !data) return <Loading />;
  if (error || !data) return <Alert>{error}</Alert>;
  const t = data.totals;
  return (
    <>
      <PageTitle title="Dashboard" sub="Live overview of the three event days." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Registrations" value={t.registrations} />
        <Stat label="Unique people" value={t.unique_people} />
        <Stat label="Winners drawn" value={t.winners} sub={`${t.draws} draw(s)`} />
        <Stat label="Active staff" value={t.active_staff} />
      </div>
      {t.pending_duplicates > 0 && (
        <div className="mt-4"><Alert kind="warn">{t.pending_duplicates} possible duplicate(s) need review. <Link to="/duplicates" className="underline">Review now</Link></Alert></div>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {data.days.map((d: any) => (
          <Card key={d.id}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Day {d.day_number}</h2>
              <Badge tone={d.registration_open ? "green" : "grey"}>{d.registration_open ? "Open" : "Closed"}</Badge>
            </div>
            <p className="mt-3 text-3xl font-semibold">{d.registrations}<span className="text-base text-white/40"> / {d.registration_target}</span></p>
            <div className="mt-2"><Progress value={d.registrations} max={d.registration_target} /></div>
            <p className="mt-3 text-xs text-white/50">{d.unique_people} unique · {d.photos_present} photos kept · {d.photos_deleted} removed</p>
            <p className="mt-1 text-xs">{d.draw_done ? <span className="text-emerald-300">Daily draw done</span> : <span className="text-white/40">Daily draw not held</span>}</p>
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-display text-lg font-bold">Latest registrations</h2>
          <ul className="space-y-2 text-sm">
            {data.recent_registrations.map((r: any) => (
              <li key={r.id} className="flex justify-between gap-3"><Link className="truncate hover:text-gold-400" to={`/registrations/${r.id}`}>{r.full_name}</Link><span className="shrink-0 text-white/40">Day {r.day_number} · {fmtDate(r.created_at)}</span></li>
            ))}
            {!data.recent_registrations.length && <li className="text-white/40">Nothing yet.</li>}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-display text-lg font-bold">Staff activity</h2>
          <ul className="space-y-2 text-sm">
            {data.staff_activity.map((s: any) => (
              <li key={s.staff_id} className="flex justify-between"><span>{s.name}</span><span className="text-white/60">{s.registrations}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
