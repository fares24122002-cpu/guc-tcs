import { api, apiUrl } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { DangerZone } from "../components/DangerZone";
import { Alert, Badge, Card, fmtDate, Loading, PageTitle, Stat } from "../components/ui";

export default function System() {
  const { data, error, loading, reload } = useLoad(() => api<any>("/admin/system"));
  if (loading && !data) return <Loading />;
  if (error || !data) return <Alert>{error}</Alert>;
  return (
    <>
      <PageTitle title="System" sub="Health of the running system." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Database" value={<Badge tone="green">{data.database}</Badge>} />
        <Stat label="Registrations" value={data.registrations} />
        <Stat label="Open days" value={`${data.days_open} / ${data.event_days}`} />
        <Stat label="Pending duplicates" value={data.pending_duplicates} />
        <Stat label="Active staff" value={data.active_staff} />
        <Stat label="Administrators" value={data.admins} />
        <Stat label="Draws held" value={data.draws} />
        <Stat label="Photos stored" value={data.storage?.objects ?? "unknown"} />
      </div>
      <Card className="mt-5 space-y-1 text-sm text-white/70">
        <p>Server time: {fmtDate(data.server_time)}</p>
        <p>Environment: {data.environment}</p>
        <p>API: {apiUrl}</p>
      </Card>
      <div className="mt-8"><DangerZone onDone={() => void reload()} /></div>
    </>
  );
}
