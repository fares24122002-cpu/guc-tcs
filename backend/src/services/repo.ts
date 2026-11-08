import { HttpError } from "../middleware/errorHandler.js";

/** The slice of the Supabase client the repository needs (also implemented by the test harness). */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}

export type Row = Record<string, any>;

export interface RegistrationBrief {
  id: string;
  reg_number: number;
  full_name: string;
  photo_path: string | null;
  photo_deleted_at: string | null;
  event_day_id: string;
  day_number: number;
  registered_by: string;
  staff_name: string;
  created_at: string;
  is_winner?: boolean;
  duplicate_pending?: boolean;
  photo_url?: string | null;
}

export interface Settings {
  draw_type: "daily" | "global";
  event_day_id: string | null;
  day_number: number | null;
  winner_count: number;
  exclude_previous_winners: boolean;
  acknowledge_pending_duplicates: boolean;
  muted: boolean;
  active_draw_id: string | null;
  locked: boolean;
}

export interface DrawWinner {
  position: number;
  registration_id: string;
  reg_number: number;
  full_name: string;
  photo_path: string | null;
  day_number: number;
  photo_url?: string | null;
}

export interface Draw {
  id: string;
  draw_type: "daily" | "global";
  event_day_id: string | null;
  day_number: number | null;
  winner_count: number;
  eligible_entry_count: number;
  exclude_previous_winners: boolean;
  created_at: string;
  status: string;
  created_by_name: string;
  winners: DrawWinner[];
  session?: { state: "idle" | "countdown" | "revealed"; countdown_started_at: string | null } | null;
}

/** Database error messages raised by the SQL functions, mapped to HTTP responses. */
const ERRORS: Record<string, [number, string]> = {
  registration_closed: [409, "Registration is closed for this day."],
  event_day_not_found: [404, "Event day not found."],
  staff_not_active: [403, "This account is not active."],
  admin_required: [403, "Administrator access is required."],
  not_enough_eligible: [409, "There are not enough unique eligible participants for this draw."],
  selection_not_in_pool: [409, "The selection changed while drawing. Please try again."],
  duplicate_identity_in_selection: [500, "Draw validation failed."],
  invalid_scope: [400, "Invalid draw scope."],
  invalid_selection: [400, "Invalid draw selection."],
  candidate_not_found: [404, "Duplicate review item not found."],
  already_resolved: [409, "This duplicate has already been reviewed."],
  both_identities_have_won: [409, "Both of these people have already won, so they cannot be merged."],
  invalid_decision: [400, "Invalid decision."],
  invalid_pair: [400, "Choose two different registrations."],
  registration_not_found: [404, "Registration not found."],
  settings_locked: [409, "The giveaway is locked because an official draw exists. Unlock it to run a new draw."],
  draw_not_found: [404, "Draw not found."],
  invalid_action: [400, "Invalid action."],
};

function mapError(error: { code?: string; message: string }): HttpError {
  const known = ERRORS[error.message.trim()];
  if (known) return new HttpError(known[0], known[1]);
  if (error.code === "23514" || error.code === "22P02" || error.code === "22007" || error.code === "22008") {
    return new HttpError(400, "Invalid value.");
  }
  if (error.code === "23505") return new HttpError(409, "That already exists.");
  console.error("database error:", error.code, error.message);
  return new HttpError(500, "Something went wrong. Please try again.");
}

/** Every method is one SQL function call. All business rules live in (tested) SQL. */
export class Repo {
  constructor(private readonly db: RpcClient) {}

  private async call<T = Row>(fn: string, p: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.db.rpc(fn, { p });
    if (error) throw mapError(error);
    return data as T;
  }

  // event days
  eventDays() { return this.call<Row[]>("api_event_days"); }
  updateEventDay(admin: string, id: string, patch: Row) { return this.call("api_update_event_day", { admin, id, ...patch }); }

  // registrations
  createRegistration(p: { idempotency_key: string; full_name: string; photo_path: string; event_day_id: string; registered_by: string; consent: boolean }) {
    return this.call<Row & { id: string; photo_path: string }>("api_create_registration", p);
  }
  registrationByKey(key: string) { return this.call<RegistrationBrief | null>("api_registration_by_key", { key }); }
  checkName(name: string) { return this.call<{ total: number; by_day: { day_number: number; count: number }[] }>("api_check_name", { name }); }
  mySummary(viewer: string) { return this.call<{ total: number; today: number }>("api_my_summary", { viewer }); }
  listRegistrations(p: Row) { return this.call<{ total: number; rows: RegistrationBrief[] }>("api_list_registrations", p); }
  getRegistration(id: string, viewer: string, role: string) { return this.call<Row | null>("api_get_registration", { id, viewer, role }); }

  // duplicates
  duplicates(p: Row) { return this.call<{ total: number; rows: Row[] }>("api_duplicates", p); }
  resolveDuplicate(admin: string, id: string, decision: string) { return this.call("api_resolve_duplicate", { admin, id, decision }); }
  flagDuplicate(admin: string, a: string, b: string) { return this.call("api_add_duplicate_candidate", { admin, registration_a: a, registration_b: b }); }

  // dashboard, logs, system, exports
  dashboard() { return this.call<Row>("api_dashboard"); }
  activityLogs(p: Row) { return this.call<Row[]>("api_activity_logs", p); }
  systemStatus() { return this.call<Row>("api_system_status"); }
  exportRegistrations(eventDayId?: string) { return this.call<Row[]>("api_export_registrations", { event_day_id: eventDayId ?? "" }); }
  exportWinners() { return this.call<Row[]>("api_export_winners"); }

  // giveaway
  getSettings() { return this.call<Settings>("api_get_settings"); }
  updateSettings(admin: string, patch: Row) { return this.call<Settings>("api_update_settings", { admin, ...patch }); }
  unlockSettings(admin: string) { return this.call<Settings>("api_unlock_settings", { admin }); }
  setMuted(admin: string, muted: boolean) { return this.call<Settings>("api_set_muted", { admin, muted }); }
  drawScopeStats(excludePrevious: boolean) { return this.call<Row[]>("api_draw_scope_stats", { exclude_previous: excludePrevious }); }
  drawPool(p: { draw_type: string; event_day_id: string | null; exclude_previous: boolean }) {
    return this.call<{ identity_id: string; registration_id: string }[]>("api_draw_pool", p);
  }
  finalizeDraw(p: { admin: string; draw_type: string; event_day_id: string | null; exclude_previous: boolean; identity_ids: string[]; registration_ids: string[] }) {
    return this.call<{ draw_id: string; created: boolean }>("api_finalize_draw", p);
  }
  getDraw(drawId: string) { return this.call<Draw | null>("api_get_draw", { draw_id: drawId }); }
  listDraws() { return this.call<Draw[]>("api_list_draws"); }

  // presentation
  presentation() {
    return this.call<{ settings: Settings; draw_id: string | null; session: { state: "idle" | "countdown" | "revealed"; countdown_started_at: string | null } | null }>("api_presentation");
  }
  presentationAction(p: { action: "start" | "replay" | "reset" | "reveal"; draw_id: string; admin?: string; at?: string }) {
    return this.call<{ state: "idle" | "countdown" | "revealed"; countdown_started_at: string | null; changed: boolean }>("api_presentation_action", p);
  }
  shuffleSample(limit: number) { return this.call<{ registration_id: string; photo_path: string }[]>("api_shuffle_sample", { limit }); }

  // sounds
  getSounds() { return this.call<{ kind: "countdown" | "winners"; path: string; name: string; content_type: string; size_bytes: number; updated_at: string }[]>("api_get_sounds"); }
  setSound(admin: string, p: { kind: string; path: string; original_name: string; content_type: string; size_bytes: number }) { return this.call<{ previous_path: string | null }>("api_set_sound", { admin, ...p }); }
  clearSound(admin: string, kind: string) { return this.call<{ previous_path: string | null }>("api_clear_sound", { admin, kind }); }

  // cleanup
  cleanupPreview(eventDayId?: string) { return this.call<Row>("api_cleanup_preview", { event_day_id: eventDayId ?? "" }); }
  cleanupCandidates(eventDayId: string, limit = 500) { return this.call<{ id: string; photo_path: string }[]>("api_cleanup_candidates", { event_day_id: eventDayId, limit }); }
  markPhotosDeleted(admin: string, ids: string[]) { return this.call<{ updated: number }>("api_mark_photos_deleted", { admin, ids }); }
  logCleanup(admin: string, details: Row) { return this.call("api_log_cleanup", { admin, ...details }); }
}

/** Adapt a Supabase client (whose rpc() returns a thenable builder) to RpcClient. */
export function supabaseRpc(client: { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> }): RpcClient {
  return { rpc: (fn, args) => client.rpc(fn, args) };
}
