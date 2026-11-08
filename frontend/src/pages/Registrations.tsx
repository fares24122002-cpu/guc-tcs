import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useDebounced, useLoad } from "../lib/hooks";
import { useAuth } from "../components/Shell";
import { Alert, Badge, Btn, Card, Empty, fmtDate, inputCls, Loading, PageTitle, Photo } from "../components/ui";

interface Reg {
  id: string; reg_number: number; full_name: string; photo_url: string | null; photo_deleted_at: string | null;
  day_number: number; staff_name: string; created_at: string; is_winner?: boolean; duplicate_pending?: boolean;
  registered_by: string;
}
const code = (n: number) => `TCS-${String(n).padStart(5, "0")}`;
const PAGE = 24;

export function Registrations() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [day, setDay] = useState("");
  const [photo, setPhoto] = useState("");
  const [staffId, setStaffId] = useState("");
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q);
  const days = useLoad(() => api<{ days: { id: string; day_number: number }[] }>("/event-days").then((r) => r.days));
  const staff = useLoad(() => (user.role === "admin" ? api<{ staff: { id: string; full_name: string; role: string }[] }>("/staff").then((r) => r.staff.filter((s) => s.role !== "presenter")) : Promise.resolve([])));
  const list = useLoad(() => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (dq) p.set("q", dq);
    if (day) p.set("event_day_id", day);
    if (photo) p.set("photo", photo);
    if (staffId) p.set("registered_by", staffId);
    return api<{ total: number; registrations: Reg[] }>(`/registrations?${p}`);
  }, [dq, day, photo, staffId, offset]);

  const total = list.data?.total ?? 0;
  return (
    <>
      <PageTitle title={user.role === "admin" ? "Registrations" : "My registrations"} sub={`${total} found`} />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <input className={`${inputCls} sm:col-span-2`} placeholder="Search by name…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} aria-label="Search by name" />
        <select className={inputCls} value={day} onChange={(e) => { setDay(e.target.value); setOffset(0); }} aria-label="Event day">
          <option value="">All days</option>
          {days.data?.map((d) => <option key={d.id} value={d.id}>Day {d.day_number}</option>)}
        </select>
        {user.role === "admin" && (
          <select className={inputCls} value={photo} onChange={(e) => { setPhoto(e.target.value); setOffset(0); }} aria-label="Photo status">
            <option value="">Any photo status</option>
            <option value="present">Photo kept</option>
            <option value="deleted">Photo removed</option>
          </select>
        )}
        {user.role === "admin" && (
          <select className={`${inputCls} sm:col-span-2`} value={staffId} onChange={(e) => { setStaffId(e.target.value); setOffset(0); }} aria-label="Registered by">
            <option value="">All staff</option>
            {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        )}
      </div>
      {list.error && <Alert>{list.error}</Alert>}
      {list.loading && !list.data ? <Loading /> : !list.data?.registrations.length ? <Empty>No registrations found.</Empty> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.registrations.map((r) => (
            <li key={r.id}>
              <Link to={`/registrations/${r.id}`} className="flex gap-3 rounded-2xl border border-white/10 bg-ink-800/60 p-3 hover:border-gold-400">
                <Photo url={r.photo_url} alt={`Photo of ${r.full_name}`} className="h-20 w-20 shrink-0 rounded-xl" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.full_name}</p>
                  <p className="text-xs text-gold-400">{code(r.reg_number)} · Day {r.day_number}</p>
                  <p className="truncate text-xs text-white/50">{fmtDate(r.created_at)} · {r.staff_name}</p>
                  <div className="mt-1 flex gap-1">
                    {r.is_winner && <Badge tone="green">Winner</Badge>}
                    {r.duplicate_pending && <Badge tone="red">Check duplicate</Badge>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {total > PAGE && (
        <div className="mt-6 flex items-center justify-between">
          <Btn disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Btn>
          <span className="text-sm text-white/50">{offset + 1}–{Math.min(total, offset + PAGE)} of {total}</span>
          <Btn disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</Btn>
        </div>
      )}
    </>
  );
}

export function RegistrationDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const r = useLoad(() => api<{ registration: any }>(`/registrations/${id}`).then((x) => x.registration), [id]);
  if (r.loading && !r.data) return <Loading />;
  if (r.error || !r.data) return <><PageTitle title="Registration" /><Alert>{r.error || "Not found."}</Alert></>;
  const reg = r.data;
  return (
    <>
      <PageTitle title={reg.full_name} sub={`${code(reg.reg_number)} · Day ${reg.day_number}`} actions={<Link to="/registrations" className="rounded-lg border border-white/15 px-4 py-2 text-sm">Back</Link>} />
      <div className="grid gap-5 md:grid-cols-2">
        <Photo url={reg.photo_url} alt={`Photo of ${reg.full_name}`} className="aspect-square w-full rounded-2xl" />
        <Card className="space-y-3 text-sm">
          <Row k="Registered" v={fmtDate(reg.created_at)} />
          <Row k="Registered by" v={reg.staff_name} />
          <Row k="Consent given" v={reg.consent ? "Yes" : "No"} />
          <Row k="Photo" v={reg.photo_deleted_at ? `Removed ${fmtDate(reg.photo_deleted_at)}` : "Kept"} />
          {reg.winner_of?.length > 0 && <Badge tone="green">Winner</Badge>}
          {user.role === "admin" && (
            <>
              <Related title="Same person (merged)" items={reg.same_person_registrations} />
              <Related title="Other registrations with this name" items={reg.same_name_registrations} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <p className="flex justify-between gap-4 border-b border-white/5 pb-2"><span className="text-white/50">{k}</span><span className="text-right">{v}</span></p>
);

function Related({ title, items }: { title: string; items: Reg[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wider text-white/50">{title}</p>
      <ul className="space-y-2">
        {items.map((o) => (
          <li key={o.id}><Link to={`/registrations/${o.id}`} className="flex items-center gap-3 text-gold-400 hover:underline">
            <Photo url={o.photo_url} alt="" className="h-10 w-10 rounded-lg" />{o.full_name} · {code(o.reg_number)} · Day {o.day_number}
          </Link></li>
        ))}
      </ul>
    </div>
  );
}
