import { useState } from "react";
import { api, post } from "../lib/api";
import { errorMessage, useLoad } from "../lib/hooks";
import { Alert, Btn, Card, Field, inputCls, Loading } from "./ui";

interface Preview { registrations: number; winner_registrations: number; draws: number; photos: number; winner_photos: number }
interface Result { registrations_deleted: number; registrations_kept: number; winners_deleted: number; draws_deleted: number; photos_removed: number; photos_failed: number }

export function DangerZone({ onDone }: { onDone?: () => void }) {
  const { data, loading, error, reload } = useLoad(() => api<{ preview: Preview; confirm_phrase: string }>("/reset"));
  const [includeWinners, setIncludeWinners] = useState<boolean | null>(null);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState("");

  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const p = data.preview;
  const need = data.confirm_phrase;
  const toDelete = includeWinners === null ? null : includeWinners ? p.registrations : p.registrations - p.winner_registrations;

  async function run() {
    if (includeWinners === null || toDelete === null) return;
    setBusy(true);
    setErr("");
    try {
      setResult(await post<Result>("/reset", { confirm: phrase, include_winners: includeWinners, expected_count: toDelete }));
      setPhrase("");
      setIncludeWinners(null);
      onDone?.();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
      void reload();
    }
  }

  return (
    <Card className="space-y-4 border-red-400/30">
      <div>
        <h2 className="font-display text-lg font-bold text-red-300">Delete audience data</h2>
        <p className="mt-1 text-sm text-white/60">
          Permanently erases registrations and their photos, for example the test data before the real event. This cannot be undone.
          Staff accounts, event days and settings are kept. Download the reports first if you need a copy.
        </p>
      </div>

      {result && (
        <Alert kind={result.photos_failed ? "warn" : "ok"}>
          Deleted {result.registrations_deleted} registration(s)
          {result.winners_deleted ? `, ${result.winners_deleted} winner record(s) and ${result.draws_deleted} draw(s)` : ""}. Kept {result.registrations_kept}.
          {result.photos_failed ? ` ${result.photos_failed} photo file(s) could not be removed; delete them in Supabase → Storage.` : ` ${result.photos_removed} photo(s) removed.`}
        </Alert>
      )}
      {err && <Alert>{err}</Alert>}

      <p className="text-sm text-white/70">
        Right now: <strong>{p.registrations}</strong> registrations, <strong>{p.photos}</strong> photos, <strong>{p.draws}</strong> draw(s), <strong>{p.winner_registrations}</strong> winner registration(s).
      </p>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm text-white/70">What should happen to the winners?</legend>
        <label className="flex items-start gap-3 rounded-lg border border-white/10 p-3 text-sm">
          <input type="radio" name="winners" className="mt-1 h-5 w-5 accent-[#c9a13f]" checked={includeWinners === false} onChange={() => setIncludeWinners(false)} />
          <span><strong>Keep the winners.</strong> Delete everyone else. Winners, their photos and the draw results stay; numbering continues.
            <span className="block text-white/50">Deletes {p.registrations - p.winner_registrations} registration(s).</span></span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-white/10 p-3 text-sm">
          <input type="radio" name="winners" className="mt-1 h-5 w-5 accent-[#c9a13f]" checked={includeWinners === true} onChange={() => setIncludeWinners(true)} />
          <span><strong>Delete everything, winners included.</strong> Also erases all draws and results, unlocks the giveaway and restarts numbering at TCS-00001.
            <span className="block text-white/50">Deletes {p.registrations} registration(s) and {p.draws} draw(s).</span></span>
        </label>
      </fieldset>

      {includeWinners !== null && (
        <>
          <Field label={`Type ${need} to confirm`}>
            <input className={inputCls} value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
          </Field>
          <Btn variant="danger" busy={busy} disabled={phrase !== need || toDelete === 0} onClick={run}>
            {toDelete === 0 ? "Nothing to delete" : `Permanently delete ${toDelete} registration(s)`}
          </Btn>
        </>
      )}
    </Card>
  );
}
