import { randomInt } from "node:crypto";
import { HttpError } from "../middleware/errorHandler.js";
import type { Repo, Settings } from "./repo.js";

export type RandomInt = (maxExclusive: number) => number;

/**
 * Unbiased partial Fisher-Yates: picks k distinct items. `randInt(n)` must return a uniform integer in
 * [0, n). Node's crypto.randomInt is cryptographically secure and free of modulo bias.
 */
export function sampleDistinct<T>(items: readonly T[], k: number, randInt: RandomInt = randomInt): T[] {
  if (k < 0 || k > items.length) throw new RangeError("cannot sample more items than exist");
  const a = items.slice();
  for (let i = 0; i < k; i++) {
    const j = i + randInt(a.length - i);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a.slice(0, k);
}

/**
 * Create the official draw for the configured scope, or retrieve it if one already exists.
 * The random pick happens here, on the server; the database re-validates and locks it atomically.
 */
export async function runOfficialDraw(
  repo: Repo,
  admin: string,
  settings: Settings,
  randInt: RandomInt = randomInt,
): Promise<{ drawId: string; created: boolean }> {
  const type = settings.draw_type;
  const dayId = type === "daily" ? settings.event_day_id : null;
  if (type === "daily" && !dayId) throw new HttpError(400, "Choose an event day for the daily giveaway first.");
  const scope = { draw_type: type, event_day_id: dayId, exclude_previous: settings.exclude_previous_winners };

  const stats = await repo.drawScopeStats(settings.exclude_previous_winners);
  const mine = stats.find((s) => (type === "global" ? s.key === "global" : s.event_day_id === dayId));
  if (mine?.draw_id) {
    // Already drawn: retrieve it (and re-activate it). Nothing is re-drawn.
    const res = await repo.finalizeDraw({ admin, ...scope, identity_ids: [], registration_ids: [] });
    return { drawId: res.draw_id, created: false };
  }

  if (mine && Number(mine.pending_duplicates) > 0 && !settings.acknowledge_pending_duplicates) {
    throw new HttpError(
      409,
      `There are ${mine.pending_duplicates} unreviewed possible duplicates. Review them first, or tick "draw anyway" in the giveaway settings.`,
    );
  }

  const pool = await repo.drawPool(scope);
  const byIdentity = new Map<string, string[]>();
  for (const row of pool) {
    const list = byIdentity.get(row.identity_id);
    if (list) list.push(row.registration_id);
    else byIdentity.set(row.identity_id, [row.registration_id]);
  }
  const count = settings.winner_count;
  if (byIdentity.size < count) {
    throw new HttpError(409, `Only ${byIdentity.size} unique eligible participants found; at least ${count} are needed.`);
  }

  const identities = sampleDistinct([...byIdentity.keys()], count, randInt);
  const registrations = identities.map((id) => {
    const regs = byIdentity.get(id)!;
    return regs[randInt(regs.length)] as string;
  });
  const res = await repo.finalizeDraw({ admin, ...scope, identity_ids: identities, registration_ids: registrations });
  return { drawId: res.draw_id, created: res.created };
}
