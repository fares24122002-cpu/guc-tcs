import { useState } from "react";
import { api, patch, post } from "../lib/api";
import { errorMessage, useLoad } from "../lib/hooks";
import { Alert, Badge, Btn, Card, Empty, Field, inputCls, Loading, Modal, PageTitle } from "../components/ui";

interface Member { id: string; username: string; full_name: string; role: "admin" | "staff" | "presenter"; is_active: boolean }
const ROLE_LABEL = { admin: "Admin", staff: "Staff", presenter: "Projector screen" } as const;

export default function Staff() {
  const list = useLoad(() => api<{ staff: Member[] }>("/staff").then((r) => r.staff));
  const [creating, setCreating] = useState(false);
  const [reset, setReset] = useState<Member | null>(null);
  const [msg, setMsg] = useState("");

  async function toggle(m: Member) {
    try { await patch(`/staff/${m.id}`, { is_active: !m.is_active }); setMsg(""); void list.reload(); } catch (e) { setMsg(errorMessage(e)); }
  }
  return (
    <>
      <PageTitle title="Accounts" sub="Media staff register participants. A projector screen account can only run the presentation." actions={<Btn variant="gold" onClick={() => setCreating(true)}>Add account</Btn>} />
      {msg && <div className="mb-4"><Alert>{msg}</Alert></div>}
      {list.loading && !list.data ? <Loading /> : (
        <Card className="divide-y divide-white/10 p-0">
          {list.data?.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{m.full_name} <span className="text-white/40">@{m.username}</span></p>
                <div className="mt-1 flex gap-2"><Badge tone={m.role === "admin" ? "gold" : m.role === "presenter" ? "green" : "grey"}>{ROLE_LABEL[m.role]}</Badge>{!m.is_active && <Badge tone="red">Deactivated</Badge>}</div>
              </div>
              {m.role !== "admin" && (
                <div className="flex gap-2">
                  <Btn onClick={() => setReset(m)}>Reset password</Btn>
                  <Btn variant={m.is_active ? "ghost" : "gold"} onClick={() => toggle(m)}>{m.is_active ? "Deactivate" : "Activate"}</Btn>
                </div>
              )}
            </div>
          ))}
          {!list.data?.length && <Empty>No staff yet.</Empty>}
        </Card>
      )}
      <CreateModal open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void list.reload(); }} />
      <ResetModal member={reset} onClose={() => setReset(null)} />
    </>
  );
}

function CreateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [full, setFull] = useState(""); const [user, setUser] = useState(""); const [pw, setPw] = useState(""); const [role, setRole] = useState<"staff" | "presenter">("staff");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await post("/staff", { full_name: full, username: user.toLowerCase(), password: pw, role }); setFull(""); setUser(""); setPw(""); onDone(); }
    catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add account">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Account type" hint={role === "presenter" ? "Can open the projector and press SHUFFLE. Nothing else." : "Registers participants from a phone."}>
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as "staff" | "presenter")}>
            <option value="staff">Media staff</option>
            <option value="presenter">Projector screen</option>
          </select>
        </Field>
        <Field label="Full name"><input className={inputCls} value={full} onChange={(e) => setFull(e.target.value)} required /></Field>
        <Field label="Username" hint="Lowercase letters, numbers, dot, dash or underscore (3–32)."><input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)} autoCapitalize="none" required /></Field>
        <Field label="Password" hint="At least 12 characters."><input className={inputCls} type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" minLength={12} required /></Field>
        {err && <Alert>{err}</Alert>}
        <div className="flex gap-2"><Btn variant="gold" busy={busy}>Create</Btn><Btn type="button" onClick={onClose}>Cancel</Btn></div>
      </form>
    </Modal>
  );
}

function ResetModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!member) return; setBusy(true); setErr("");
    try { await patch(`/staff/${member.id}`, { password: pw }); setDone(true); setPw(""); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  }
  return (
    <Modal open={Boolean(member)} onClose={() => { setDone(false); setErr(""); onClose(); }} title={`Reset password · ${member?.full_name ?? ""}`}>
      {done ? <Alert kind="ok">Password changed.</Alert> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password" hint="At least 12 characters."><input className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" minLength={12} required /></Field>
          {err && <Alert>{err}</Alert>}
          <Btn variant="gold" busy={busy}>Set password</Btn>
        </form>
      )}
    </Modal>
  );
}
