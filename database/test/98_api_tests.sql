-- TEST ONLY. Assertions for the api_* functions in migration 0005 (run on a fresh database).
\set ON_ERROR_STOP on
\i test/helpers.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@t'), ('00000000-0000-0000-0000-0000000000b1', 'staff1@t'),
  ('00000000-0000-0000-0000-0000000000b2', 'staff2@t');
insert into public.profiles (id, full_name, username, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Admin One', 'admin1', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'Staff One', 'staff1', 'staff'),
  ('00000000-0000-0000-0000-0000000000b2', 'Staff Two', 'staff2', 'staff');

create temp table ctx as select
  (select id from public.event_days where day_number = 1) as d1,
  (select id from public.event_days where day_number = 2) as d2,
  (select id from public.event_days where day_number = 3) as d3,
  '00000000-0000-0000-0000-0000000000a1'::uuid as admin,
  '00000000-0000-0000-0000-0000000000b1'::uuid as s1,
  '00000000-0000-0000-0000-0000000000b2'::uuid as s2;

-- ------------------------------------------------------------ privileges
set role authenticated;
select pg_temp.expect_error($$select public.api_dashboard()$$, 'permission denied');
select pg_temp.expect_error($$select public.api_list_registrations('{"role":"admin"}')$$, 'permission denied');
reset role;
set role anon;
select pg_temp.expect_error($$select public.api_event_days()$$, 'permission denied');
reset role;
set role service_role;
select pg_temp.check(jsonb_array_length(public.api_event_days()) = 3, 'service role can call api functions; three days listed');
reset role;

-- ------------------------------------------------------------ event days
select pg_temp.expect_error(format($$select public.api_update_event_day(jsonb_build_object('admin','%s','id','%s','registration_open',true))$$, (select s1 from ctx), (select d1 from ctx)), 'admin_required');
select pg_temp.expect_error(format($$select public.api_update_event_day(jsonb_build_object('admin','%s','id','%s','registration_open',true))$$, (select admin from ctx), gen_random_uuid()), 'event_day_not_found');
select pg_temp.check((select (public.api_update_event_day(jsonb_build_object('admin',admin,'id',d1,'registration_open',true,'registration_target',200,'event_date','2026-11-10')))->>'registration_open' = 'true' from ctx), 'admin opens day 1 and sets target/date');
select public.api_update_event_day(jsonb_build_object('admin',admin,'id',d2,'registration_open',true)) from ctx;
select pg_temp.check((select count(*) = 2 from public.activity_logs where action = 'eventday.opened'), 'opening days is logged');
select pg_temp.check((select (e->>'registration_target')::int = 200 and e->>'event_date' = '2026-11-10' from jsonb_array_elements(public.api_event_days()) e where (e->>'day_number')::int = 1), 'target and date persisted');

-- ------------------------------------------------------------ registrations
create function pg_temp.reg(p_name text, p_day uuid, p_staff uuid, p_n int default 0) returns jsonb language sql as $$
  select public.api_create_registration(jsonb_build_object(
    'idempotency_key', gen_random_uuid(), 'full_name', p_name, 'photo_path', 'p/' || gen_random_uuid() || '.jpg',
    'event_day_id', p_day, 'registered_by', p_staff, 'consent', true))
$$;

select pg_temp.expect_error(format($$select pg_temp.reg('Closed Day Guy','%s','%s')$$, (select d3 from ctx), (select s1 from ctx)), 'registration_closed');

do $body$
declare c record; i int; r jsonb; k uuid := gen_random_uuid();
begin
  select * into c from ctx;
  -- 250 per day for days 1-2, alternating staff
  for i in 1..250 loop perform pg_temp.reg('Visitor D1 ' || i, c.d1, case when i % 2 = 0 then c.s1 else c.s2 end); end loop;
  for i in 1..250 loop perform pg_temp.reg('Visitor D2 ' || i, c.d2, c.s1); end loop;
  perform pg_temp.check((select count(*) = 500 from public.registrations), '500 registrations (250 per day)');
  -- idempotent
  r := public.api_create_registration(jsonb_build_object('idempotency_key', k, 'full_name', 'Idem Person', 'photo_path','p/i.jpg','event_day_id',c.d1,'registered_by',c.s1,'consent',true));
  perform pg_temp.check((public.api_create_registration(jsonb_build_object('idempotency_key', k, 'full_name', 'Idem Person', 'photo_path','p/i.jpg','event_day_id',c.d1,'registered_by',c.s1,'consent',true)))->>'id' = r->>'id', 'retry with same key returns same registration');
  perform pg_temp.check((select count(*) = 501 from public.registrations), 'retry created no extra row');
end $body$;

-- lookup by retry key
select pg_temp.check((select public.api_registration_by_key(jsonb_build_object('key', gen_random_uuid())) is null), 'unknown retry key finds nothing');
do $body$
declare c record; k uuid := gen_random_uuid(); r jsonb;
begin
  select * into c from ctx;
  r := public.api_create_registration(jsonb_build_object('idempotency_key', k, 'full_name', 'Key Lookup', 'photo_path','p/k.jpg','event_day_id',c.d1,'registered_by',c.s1,'consent',true));
  perform pg_temp.check((public.api_registration_by_key(jsonb_build_object('key', k)))->>'id' = r->>'id', 'retry key finds the saved registration');
end $body$;

-- name check + search escaping
select pg_temp.reg('Mona Hassan', (select d1 from ctx), (select s1 from ctx));
select pg_temp.reg('mona   HASSAN', (select d2 from ctx), (select s2 from ctx));
select pg_temp.reg('100% Real_Name', (select d1 from ctx), (select s1 from ctx));
select pg_temp.check((select (public.api_check_name('{"name":"  MONA hassan "}'))->>'total' = '2' from ctx), 'name check is case/space-insensitive');
select pg_temp.check((select (public.api_check_name('{"name":"Nobody Here"}'))->>'total' = '0'), 'name check: no match');
select pg_temp.check((select jsonb_array_length(public.api_list_registrations('{"role":"admin","q":"%"}')->'rows') = 1), 'search treats % literally (only the "100%" name)');
select pg_temp.check((select (public.api_list_registrations('{"role":"admin","q":"_"}')->>'total')::int = 1), 'search treats _ literally');
select pg_temp.check((select (public.api_list_registrations('{"role":"admin","q":"mona"}')->>'total')::int = 2), 'search by name');

-- listing: staff see only their own, admin filters, pagination
select pg_temp.check((select (public.api_list_registrations(jsonb_build_object('role','staff','viewer',s2)))->>'total' = (select count(*)::text from public.registrations where registered_by = (select s2 from ctx)) from ctx), 'staff2 sees only own registrations');
select pg_temp.check((select (public.api_list_registrations(jsonb_build_object('role','staff','viewer',s2,'registered_by',s1)))->>'total' = (select count(*)::text from public.registrations where registered_by = (select s2 from ctx)) from ctx), 'staff cannot widen the filter to another staff member');
select pg_temp.check((select (public.api_list_registrations(jsonb_build_object('role','admin','event_day_id',d2)))->>'total' = '251' from ctx), 'admin filter by day');
select pg_temp.check((select jsonb_array_length(public.api_list_registrations('{"role":"admin","limit":10,"offset":5}')->'rows') = 10), 'pagination limit');
select pg_temp.check((select (public.api_list_registrations('{"role":"admin","limit":1000}')->'rows') is not null and jsonb_array_length(public.api_list_registrations('{"role":"admin","limit":1000}')->'rows') = 200), 'limit capped at 200');
select pg_temp.check((select (public.api_list_registrations(jsonb_build_object('role','admin','from', now() + interval '1 day')))->>'total' = '0'), 'date filter (from future) returns none');
select pg_temp.check((select (public.api_my_summary(jsonb_build_object('viewer', s2)))->>'total' = (select count(*)::text from public.registrations where registered_by = (select s2 from ctx)) from ctx), 'my summary counts own registrations');

-- single registration visibility
select pg_temp.check((select public.api_get_registration(jsonb_build_object('id', r.id, 'role', 'staff', 'viewer', (select s2 from ctx))) is null from public.registrations r where r.registered_by = (select s1 from ctx) limit 1), 'staff cannot read another staff member''s registration');
select pg_temp.check((select public.api_get_registration(jsonb_build_object('id', r.id, 'role', 'admin', 'viewer', (select admin from ctx))) is not null from public.registrations r limit 1), 'admin can read any registration');

-- ------------------------------------------------------------ duplicates
select pg_temp.check((select (public.api_duplicates('{"status":"pending"}')->>'total')::int = 1), 'same-name pair queued for review');
do $body$
declare c record; cand uuid; n int; res jsonb;
begin
  select * into c from ctx;
  select id into cand from public.duplicate_candidates limit 1;
  perform pg_temp.expect_error(format($$select public.api_resolve_duplicate(jsonb_build_object('admin','%s','id','%s','decision','same'))$$, c.s1, cand), 'admin_required');
  perform pg_temp.expect_error(format($$select public.api_resolve_duplicate(jsonb_build_object('admin','%s','id','%s','decision','maybe'))$$, c.admin, cand), 'invalid_decision');
  select count(distinct eligibility_identity_id) into n from public.registrations where name_normalized = 'mona hassan';
  perform pg_temp.check(n = 2, 'before merge: two identities');
  res := public.api_resolve_duplicate(jsonb_build_object('admin', c.admin, 'id', cand, 'decision', 'same'));
  perform pg_temp.check((select count(distinct eligibility_identity_id) = 1 from public.registrations where name_normalized = 'mona hassan'), 'confirmed duplicate: one shared identity');
  perform pg_temp.check((select duplicate_status = 'merged' from public.participant_identities where id = (select eligibility_identity_id from public.registrations where name_normalized = 'mona hassan' limit 1)), 'surviving identity marked merged');
  perform pg_temp.check((select count(*) = 2 from public.registrations where name_normalized = 'mona hassan'), 'merge never deletes registrations');
  perform pg_temp.expect_error(format($$select public.api_resolve_duplicate(jsonb_build_object('admin','%s','id','%s','decision','same'))$$, c.admin, cand), 'already_resolved');
  perform pg_temp.check((select count(*) = 0 from public.participant_identities pi where not exists (select 1 from public.registrations r where r.eligibility_identity_id = pi.id)), 'no orphan identities after merge');
end $body$;

-- "different" keeps identities separate
select pg_temp.reg('Karim Adel', (select d1 from ctx), (select s1 from ctx));
select pg_temp.reg('Karim Adel', (select d1 from ctx), (select s2 from ctx));
do $body$
declare c record; cand uuid;
begin
  select * into c from ctx;
  select id into cand from public.duplicate_candidates where status = 'pending' limit 1;
  perform public.api_resolve_duplicate(jsonb_build_object('admin', c.admin, 'id', cand, 'decision', 'different'));
  perform pg_temp.check((select count(distinct eligibility_identity_id) = 2 from public.registrations where name_normalized = 'karim adel'), 'marked different: identities stay separate');
end $body$;

-- manual flag + merge of different names
do $body$
declare c record; a uuid; b uuid; cand jsonb;
begin
  select * into c from ctx;
  select id into a from public.registrations where full_name = 'Visitor D1 1';
  select id into b from public.registrations where full_name = 'Visitor D2 1';
  cand := public.api_add_duplicate_candidate(jsonb_build_object('admin', c.admin, 'registration_a', a, 'registration_b', b));
  perform pg_temp.check(cand->>'id' is not null, 'admin can manually flag a pair');
  perform pg_temp.check((public.api_add_duplicate_candidate(jsonb_build_object('admin', c.admin, 'registration_a', b, 'registration_b', a)))->>'id' = cand->>'id', 'flagging the same pair again is idempotent');
  perform pg_temp.expect_error(format($$select public.api_add_duplicate_candidate(jsonb_build_object('admin','%s','registration_a','%s','registration_b','%s'))$$, c.admin, a, a), 'invalid_pair');
  perform public.api_resolve_duplicate(jsonb_build_object('admin', c.admin, 'id', cand->>'id', 'decision', 'same'));
  perform pg_temp.check((select count(distinct eligibility_identity_id) = 1 from public.registrations where id in (a, b)), 'manually flagged pair merged');
end $body$;

-- ------------------------------------------------------------ draw settings + scope stats
select pg_temp.check((select (public.api_get_settings())->>'locked' = 'false'), 'settings start unlocked');
select pg_temp.expect_error(format($$select public.api_update_settings(jsonb_build_object('admin','%s','winner_count',0))$$, (select s1 from ctx)), 'admin_required');
select pg_temp.expect_error(format($$select public.api_update_settings(jsonb_build_object('admin','%s','winner_count',11))$$, (select admin from ctx)), 'violates|check');
select pg_temp.check((select (public.api_update_settings(jsonb_build_object('admin',admin,'draw_type','daily','event_day_id',d1,'winner_count',5)))->>'day_number' = '1' from ctx), 'configure daily draw for day 1');
select pg_temp.check((select jsonb_array_length(public.api_draw_scope_stats('{}')) = 4), 'scope stats: 3 days + global');
select pg_temp.check((select (e->>'eligible_people')::int > 5 from jsonb_array_elements(public.api_draw_scope_stats('{}')) e where e->>'key' = 'day-1'), 'day 1 has enough eligible people');
select pg_temp.check((select (e->>'eligible_people')::int = 0 from jsonb_array_elements(public.api_draw_scope_stats('{}')) e where e->>'key' = 'day-3'), 'day 3 has none');

-- ------------------------------------------------------------ official draw
do $body$
declare c record; pool jsonb; ids uuid[]; regs uuid[]; res jsonb; res2 jsonb; draw uuid;
begin
  select * into c from ctx;
  pool := public.api_draw_pool(jsonb_build_object('draw_type','daily','event_day_id',c.d1,'exclude_previous',true));
  perform pg_temp.check(jsonb_array_length(pool) >= 250, 'pool lists day 1 registrations');
  select array_agg(x.identity_id), array_agg(x.registration_id) into ids, regs from (
    select (e->>'identity_id')::uuid identity_id, (e->>'registration_id')::uuid registration_id
    from jsonb_array_elements(pool) e order by 2 limit 5) x;
  res := public.api_finalize_draw(jsonb_build_object('admin', c.admin, 'draw_type','daily','event_day_id',c.d1,'exclude_previous',true,
            'identity_ids', to_jsonb(ids), 'registration_ids', to_jsonb(regs)));
  perform pg_temp.check((res->>'created')::boolean, 'draw created');
  draw := (res->>'draw_id')::uuid;
  res2 := public.api_finalize_draw(jsonb_build_object('admin', c.admin, 'draw_type','daily','event_day_id',c.d1,'exclude_previous',true,
            'identity_ids', to_jsonb(ids), 'registration_ids', to_jsonb(regs)));
  perform pg_temp.check(not (res2->>'created')::boolean and res2->>'draw_id' = res->>'draw_id', 'second request retrieves the same locked draw');
  perform pg_temp.check((select count(*) = 5 from public.winners), 'five winners');
  perform pg_temp.check((select jsonb_array_length(public.api_get_draw(jsonb_build_object('draw_id', draw))->'winners') = 5), 'draw json lists five winners');
  perform pg_temp.check((select (public.api_get_settings())->>'locked' = 'true'), 'settings lock after the draw');
  perform pg_temp.expect_error(format($$select public.api_update_settings(jsonb_build_object('admin','%s','winner_count',3))$$, c.admin), 'settings_locked');
  perform pg_temp.check((select (e->>'draw_id') is not null from jsonb_array_elements(public.api_draw_scope_stats('{}')) e where e->>'key' = 'day-1'), 'scope stats show the day 1 draw');
  perform pg_temp.check((select (e->>'eligible_people')::int = 251 from jsonb_array_elements(public.api_draw_scope_stats('{}')) e where e->>'key' = 'day-1'), 'after the draw, day 1 has 256 people minus 5 winners = 251 eligible');
  -- presentation: idle -> countdown -> revealed
  perform pg_temp.check((public.api_get_draw(jsonb_build_object('draw_id', draw))->'session'->>'state') = 'idle', 'presentation starts idle');
  perform pg_temp.expect_error(format($$select public.api_presentation_action(jsonb_build_object('action','start','draw_id','%s','admin','%s','at',now()))$$, draw, c.s1), 'admin_required');
  res := public.api_presentation_action(jsonb_build_object('action','start','draw_id',draw,'admin',c.admin,'at',now()));
  perform pg_temp.check(res->>'state' = 'countdown' and (res->>'changed')::boolean, 'start -> countdown');
  res2 := public.api_presentation_action(jsonb_build_object('action','start','draw_id',draw,'admin',c.admin,'at',now() + interval '1 second'));
  perform pg_temp.check(not (res2->>'changed')::boolean and res2->>'countdown_started_at' = res->>'countdown_started_at', 'double start does not restart the countdown');
  res := public.api_presentation_action(jsonb_build_object('action','reveal','draw_id',draw,'at',now() + interval '5 seconds'));
  perform pg_temp.check(res->>'state' = 'countdown', 'reveal refused before 15 seconds');
  res := public.api_presentation_action(jsonb_build_object('action','reveal','draw_id',draw,'at',now() + interval '15 seconds'));
  perform pg_temp.check(res->>'state' = 'revealed', 'reveal accepted after 15 seconds');
  res := public.api_presentation_action(jsonb_build_object('action','replay','draw_id',draw,'admin',c.admin,'at',now()));
  perform pg_temp.check(res->>'state' = 'countdown', 'replay restarts the countdown');
  perform pg_temp.check((select count(*) = 5 from public.winners) and (select count(*) = 1 from public.giveaway_draws), 'replay created no new draw or winners');
  res := public.api_presentation_action(jsonb_build_object('action','reset','draw_id',draw,'admin',c.admin));
  perform pg_temp.check(res->>'state' = 'idle', 'reset returns to idle');
  perform pg_temp.check((select count(*) = 5 from public.winners), 'reset keeps official results');
  perform pg_temp.expect_error(format($$select public.api_presentation_action(jsonb_build_object('action','explode','draw_id','%s','admin','%s'))$$, draw, c.admin), 'invalid_action');
  perform pg_temp.check(jsonb_array_length(public.api_shuffle_sample('{"limit":10}')) = 10, 'shuffle sample returns photos');
  -- unlock for a new draw requires an admin
  perform pg_temp.expect_error(format($$select public.api_unlock_settings(jsonb_build_object('admin','%s'))$$, c.s1), 'admin_required');
  perform public.api_unlock_settings(jsonb_build_object('admin', c.admin));
  perform pg_temp.check((public.api_get_settings())->>'locked' = 'false', 'admin can unlock for a different draw');
  -- previous winners excluded from the global pool
  perform pg_temp.check((select count(*) = 0 from jsonb_array_elements(public.api_draw_pool('{"draw_type":"global","exclude_previous":true}')) e where (e->>'registration_id')::uuid = any (regs)), 'previous winners excluded from global pool');
  perform pg_temp.check((select count(*) = 5 from jsonb_array_elements(public.api_draw_pool('{"draw_type":"global","exclude_previous":false}')) e where (e->>'registration_id')::uuid = any (regs)), 'previous winners included when toggle is off');
end $body$;

-- a merged identity that already won cannot also win again via its twin registration
do $body$
declare c record; won uuid; twin uuid; cand jsonb;
begin
  select * into c from ctx;
  select registration_id into won from public.winners limit 1;
  select id into twin from public.registrations where full_name = 'Visitor D2 2';
  cand := public.api_add_duplicate_candidate(jsonb_build_object('admin', c.admin, 'registration_a', won, 'registration_b', twin));
  perform public.api_resolve_duplicate(jsonb_build_object('admin', c.admin, 'id', cand->>'id', 'decision', 'same'));
  perform pg_temp.check((select count(*) = 0 from jsonb_array_elements(public.api_draw_pool('{"draw_type":"daily","event_day_id":null,"exclude_previous":true}'::jsonb || jsonb_build_object('event_day_id', c.d2))) e where (e->>'registration_id')::uuid = twin), 'twin registration of a past winner is excluded');
  perform pg_temp.check((select eligibility_identity_id = (select eligibility_identity_id from public.registrations where id = won) from public.registrations where id = twin), 'identity of the winner survives the merge');
end $body$;

-- ------------------------------------------------------------ cleanup
do $body$
declare c record; prev jsonb; cands jsonb; ids jsonb; res jsonb; winner_regs uuid[];
begin
  select * into c from ctx;
  select array_agg(registration_id) into winner_regs from public.winners;
  prev := public.api_cleanup_preview(jsonb_build_object('event_day_id', c.d1));
  perform pg_temp.check((prev->>'protected_winner_photos')::int = 5, 'preview protects the 5 winner photos');
  perform pg_temp.check((prev->>'global_draw_done')::boolean is false, 'preview reports no global draw yet');
  cands := public.api_cleanup_candidates(jsonb_build_object('event_day_id', c.d1, 'limit', 500));
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(cands) e where (e->>'id')::uuid = any (winner_regs)), 'candidates exclude winners');
  perform pg_temp.check(jsonb_array_length(cands) = (prev->>'photos_to_delete')::int, 'preview count matches candidates');
  select jsonb_agg(e->'id') into ids from jsonb_array_elements(cands) e;
  perform pg_temp.expect_error(format($$select public.api_mark_photos_deleted(jsonb_build_object('admin','%s','ids','[]'::jsonb))$$, c.s1), 'admin_required');
  -- even if a winner id is smuggled in, it is not deleted
  res := public.api_mark_photos_deleted(jsonb_build_object('admin', c.admin, 'ids', ids || to_jsonb(winner_regs)));
  perform pg_temp.check((res->>'updated')::int = jsonb_array_length(cands), 'marked only non-winner photos deleted');
  perform pg_temp.check((select count(*) = 5 from public.registrations where id = any (winner_regs) and photo_path is not null), 'winner photos untouched');
  perform pg_temp.check((select count(*) = 507 from public.registrations), 'all 507 registration rows remain after cleanup');
  perform pg_temp.check((select count(*) = 0 from jsonb_array_elements(public.api_cleanup_candidates(jsonb_build_object('event_day_id', c.d1, 'limit', 500)))), 'no candidates left for day 1');
  perform public.api_log_cleanup(jsonb_build_object('admin', c.admin, 'event_day_id', c.d1, 'deleted', res->'updated'));
  perform pg_temp.check((select count(*) = 1 from public.activity_logs where action = 'cleanup.executed'), 'cleanup is logged');
end $body$;
select pg_temp.check((select count(*) = (select count(*) from public.registrations) from public.registrations), 'cleanup removed no registration rows');

-- ------------------------------------------------------------ dashboard / logs / exports
select pg_temp.check((select (public.api_dashboard()->'totals'->>'registrations')::int = (select count(*) from public.registrations)), 'dashboard total matches');
select pg_temp.check((select jsonb_array_length(public.api_dashboard()->'days') = 3), 'dashboard lists 3 days');
select pg_temp.check((select (public.api_dashboard()->'totals'->>'unique_people')::int < (public.api_dashboard()->'totals'->>'registrations')::int), 'unique people < registrations after merges');
select pg_temp.check((select jsonb_array_length(public.api_activity_logs('{"limit":5}')) = 5), 'activity log paging');
select pg_temp.check((select jsonb_array_length(public.api_activity_logs('{"action":"cleanup"}')) = 1), 'activity log action filter');
select pg_temp.check((select jsonb_array_length(public.api_export_registrations('{}')) = (select count(*) from public.registrations)), 'export lists every registration');
select pg_temp.check((select jsonb_array_length(public.api_export_registrations(jsonb_build_object('event_day_id', d1))) = (select count(*) from public.registrations where event_day_id = (select d1 from ctx)) from ctx), 'export filter by day');
select pg_temp.check((select jsonb_array_length(public.api_export_winners()) = 5), 'winner export lists five');
select pg_temp.check((select public.api_system_status()->>'database' = 'ok'), 'system status');

\echo ALL API FUNCTION TESTS PASSED
