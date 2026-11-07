-- TEST ONLY. Assertions for migrations 0001-0004. Any failed assertion aborts the run.
\set ON_ERROR_STOP on

create temp table _ctx (k text primary key, v text);
grant all on _ctx to public;

create function pg_temp.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm !~* p_pattern then
      raise exception 'FAIL: expected error matching % but got: %', p_pattern, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAIL: expected an error matching % but statement succeeded: %', p_pattern, p_sql;
end $$;

create function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FAIL: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@t'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@t'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff1@t'),
  ('00000000-0000-0000-0000-0000000000b2', 'staff2@t'),
  ('00000000-0000-0000-0000-0000000000b3', 'off@t');
insert into public.profiles (id, full_name, username, role, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', 'Admin One',  'admin1', 'admin', true),
  ('00000000-0000-0000-0000-0000000000a2', 'Admin Two',  'admin2', 'admin', true),
  ('00000000-0000-0000-0000-0000000000b1', 'Staff One',  'staff1', 'staff', true),
  ('00000000-0000-0000-0000-0000000000b2', 'Staff Two',  'staff2', 'staff', true),
  ('00000000-0000-0000-0000-0000000000b3', 'Staff Off',  'off',    'staff', false);

select pg_temp.check((select count(*) = 3 from public.event_days), 'three event days seeded');
select pg_temp.check((select bool_or(registration_open) = false from public.event_days), 'days start closed');

-- ---------------------------------------------------------------- profiles
select pg_temp.expect_error($$insert into public.profiles (id, full_name, username) values (gen_random_uuid(), 'X Y', 'BAD NAME')$$, 'violates|foreign key');
select pg_temp.expect_error($$update public.profiles set is_active=false where id='00000000-0000-0000-0000-0000000000a1'; update public.profiles set is_active=false where id='00000000-0000-0000-0000-0000000000a2'$$, 'last active administrator');
select pg_temp.check((select is_active from public.profiles where id='00000000-0000-0000-0000-0000000000a1'), 'failed multi-statement left admin1 active (statement-level rollback in test harness)');
select pg_temp.expect_error($$delete from public.profiles where username='staff1'$$, 'cannot be deleted');

-- ---------------------------------------------------------------- registration
select pg_temp.expect_error(
  $$select public.create_registration(gen_random_uuid(),'Closed Day','p/x.jpg',(select id from public.event_days where day_number=1),'00000000-0000-0000-0000-0000000000b1',true)$$,
  'registration_closed');
update public.event_days set registration_open = true where day_number in (1,2);

select pg_temp.expect_error(
  $$select public.create_registration(gen_random_uuid(),'Day Three','p/x.jpg',(select id from public.event_days where day_number=3),'00000000-0000-0000-0000-0000000000b1',true)$$,
  'registration_closed');
select pg_temp.expect_error(
  $$select public.create_registration(gen_random_uuid(),'Inactive Staff','p/x.jpg',(select id from public.event_days where day_number=1),'00000000-0000-0000-0000-0000000000b3',true)$$,
  'staff_not_active');
select pg_temp.expect_error(
  $$select public.create_registration(gen_random_uuid(),'No Consent','p/x.jpg',(select id from public.event_days where day_number=1),'00000000-0000-0000-0000-0000000000b1',false)$$,
  'consent');
select pg_temp.expect_error(
  $$select public.create_registration(gen_random_uuid(),'No Photo Person',null,(select id from public.event_days where day_number=1),'00000000-0000-0000-0000-0000000000b1',true)$$,
  'photo_present_or_deleted');
select pg_temp.expect_error(
  $$select public.create_registration(gen_random_uuid(),'A','p/x.jpg',(select id from public.event_days where day_number=1),'00000000-0000-0000-0000-0000000000b1',true)$$,
  'check');

-- idempotency: same key twice => one row
do $$
declare k uuid := gen_random_uuid(); a uuid; b uuid;
begin
  a := public.create_registration(k,'Idem Potent','d1/idem.jpg',(select id from public.event_days where day_number=1),'00000000-0000-0000-0000-0000000000b1',true);
  b := public.create_registration(k,'Idem Potent','d1/idem.jpg',(select id from public.event_days where day_number=1),'00000000-0000-0000-0000-0000000000b1',true);
  perform pg_temp.check(a = b, 'same idempotency key returns the same registration');
  perform pg_temp.check((select count(*) = 1 from public.registrations where idempotency_key = k), 'only one row stored for a double submit');
  perform pg_temp.check((select count(*) = 1 from public.participant_identities where canonical_registration_id = a), 'one identity per registration');
end $$;

-- bulk: 250 people per day for days 1 and 2 (unique names), via the real function
do $$
declare d int; i int; day uuid;
begin
  for d in 1..2 loop
    select id into day from public.event_days where day_number = d;
    for i in 1..250 loop
      perform public.create_registration(gen_random_uuid(), format('Person D%s N%s', d, i),
        format('event-day-%s/%s.jpg', d, i), day, '00000000-0000-0000-0000-0000000000b1', true);
    end loop;
  end loop;
  perform pg_temp.check((select count(*) = 501 from public.registrations), '501 registrations created');
  perform pg_temp.check((select count(distinct eligibility_identity_id) = 501 from public.registrations), 'each has its own identity');
  perform pg_temp.check((select count(distinct reg_number) = 501 from public.registrations), 'reg_numbers unique');
end $$;

-- duplicate review queue: same name (different case/spacing) is flagged, never auto-merged
do $$
declare day uuid; r1 uuid; r2 uuid;
begin
  select id into day from public.event_days where day_number = 2;
  r1 := public.create_registration(gen_random_uuid(),'Mona  Hassan','event-day-2/m1.jpg',day,'00000000-0000-0000-0000-0000000000b1',true);
  r2 := public.create_registration(gen_random_uuid(),'mona hassan','event-day-2/m2.jpg',day,'00000000-0000-0000-0000-0000000000b2',true);
  perform pg_temp.check((select count(*) = 1 from public.duplicate_candidates where registration_a = r1 and registration_b = r2 and status = 'pending'), 'same-name registrations queued for review');
  perform pg_temp.check((select eligibility_identity_id from public.registrations where id = r1) <> (select eligibility_identity_id from public.registrations where id = r2), 'same-name registrations are NOT auto-merged');
end $$;

-- registrations are immutable except cleanup / merge
select pg_temp.expect_error($$update public.registrations set full_name='Changed Name' where reg_number = (select min(reg_number) from public.registrations)$$, 'immutable');
select pg_temp.expect_error($$update public.registrations set event_day_id=(select id from public.event_days where day_number=2) where reg_number = (select min(reg_number) from public.registrations)$$, 'immutable');
select pg_temp.expect_error($$delete from public.registrations where reg_number = (select min(reg_number) from public.registrations)$$, 'cannot be deleted');
select pg_temp.expect_error($$truncate public.registrations cascade$$, 'cannot be deleted|truncate');
select pg_temp.expect_error($$update public.registrations set photo_path = null where reg_number = (select min(reg_number) from public.registrations)$$, 'photo_present_or_deleted');
update public.registrations set photo_path = null, photo_deleted_at = now() where reg_number = (select min(reg_number) from public.registrations);
select pg_temp.check((select photo_deleted_at is not null and photo_path is null from public.registrations where reg_number = (select min(reg_number) from public.registrations)), 'photo cleanup keeps the registration row');
select pg_temp.expect_error($$update public.registrations set photo_path = 'back.jpg', photo_deleted_at = null where reg_number = (select min(reg_number) from public.registrations)$$, 'cannot be restored');

-- ---------------------------------------------------------------- draws
-- pool excludes the registration whose photo was deleted
select pg_temp.check(
  (select count(*) = 502 from public.get_draw_pool('global', null, true)),
  'global pool excludes registrations without a photo');

-- Simulate the backend picking 5 (Node does the real random pick in Phase 7).
do $$
declare
  ids uuid[]; regs uuid[]; d1 uuid; v_draw uuid; again uuid; day1 uuid;
begin
  select id into day1 from public.event_days where day_number = 1;
  select array_agg(identity_id), array_agg(registration_id) into ids, regs
  from (select * from public.get_draw_pool('daily', day1, true) order by registration_id limit 5) s;

  -- non-admin cannot finalize
  begin
    perform public.finalize_official_draw('00000000-0000-0000-0000-0000000000b1','daily',day1,true,ids,regs);
    raise exception 'FAIL: staff finalized a draw';
  exception when others then
    perform pg_temp.check(sqlerrm ~ 'admin_required', 'staff cannot finalize a draw');
  end;

  v_draw := public.finalize_official_draw('00000000-0000-0000-0000-0000000000a1','daily',day1,true,ids,regs);
  perform pg_temp.check((select count(*) = 5 from public.winners where draw_id = v_draw), 'exactly five winners stored');
  perform pg_temp.check((select count(distinct participant_identity_id) = 5 from public.winners where draw_id = v_draw), 'five distinct identities');
  perform pg_temp.check((select array_agg(winner_position order by winner_position) = array[1,2,3,4,5]::smallint[] from public.winners where draw_id = v_draw), 'positions 1..5');
  perform pg_temp.check((select presentation_state = 'idle' from public.presentation_sessions where draw_id = v_draw), 'presentation session created idle');
  perform pg_temp.check((select count(*) = 1 from public.activity_logs where action = 'draw.completed'), 'draw logged');

  -- second request for the same scope returns the SAME draw (no second draw, no new winners)
  again := public.finalize_official_draw('00000000-0000-0000-0000-0000000000a1','daily',day1,true,ids,regs);
  perform pg_temp.check(again = v_draw, 'repeat request returns the locked draw');
  perform pg_temp.check((select count(*) = 1 from public.giveaway_draws where event_day_id = day1), 'only one draw per day');
  perform pg_temp.check((select count(*) = 5 from public.winners), 'no extra winners created');
end $$;

select pg_temp.expect_error($$update public.winners set winner_position = 5 where winner_position = 1$$, 'immutable');
select pg_temp.expect_error($$delete from public.winners$$, 'immutable');
select pg_temp.expect_error($$update public.giveaway_draws set winner_count = 3$$, 'immutable');
select pg_temp.expect_error($$delete from public.giveaway_draws$$, 'immutable');
select pg_temp.expect_error($$truncate public.winners$$, 'immutable');
select pg_temp.expect_error($$update public.activity_logs set action = 'x'$$, 'immutable');
select pg_temp.expect_error($$delete from public.activity_logs$$, 'immutable');

-- previous winners are excluded from the next pool; selection validation
do $$
declare day2 uuid; ids uuid[]; regs uuid[]; dup_ids uuid[]; bad_reg uuid; won uuid;
begin
  select id into day2 from public.event_days where day_number = 2;
  select participant_identity_id, registration_id into won, bad_reg from public.winners limit 1;
  perform pg_temp.check(
    not exists (select 1 from public.get_draw_pool('global', null, true) where identity_id in (select participant_identity_id from public.winners)),
    'previous winners excluded from the pool');
  perform pg_temp.check(
    exists (select 1 from public.get_draw_pool('global', null, false) where identity_id = won),
    'previous winners included when the toggle is off');

  select array_agg(identity_id), array_agg(registration_id) into ids, regs
  from (select * from public.get_draw_pool('daily', day2, true) order by registration_id limit 5) s;

  -- same person twice
  dup_ids := array[ids[1], ids[1], ids[3], ids[4], ids[5]];
  begin
    perform public.finalize_official_draw('00000000-0000-0000-0000-0000000000a1','daily',day2,true,dup_ids,regs);
    raise exception 'FAIL: duplicate identity accepted';
  exception when others then
    perform pg_temp.check(sqlerrm ~ 'duplicate_identity', 'same person cannot win twice in one draw');
  end;

  -- a registration from outside the pool (a previous winner)
  begin
    perform public.finalize_official_draw('00000000-0000-0000-0000-0000000000a1','daily',day2,true,
      array[won, ids[2], ids[3], ids[4], ids[5]], array[bad_reg, regs[2], regs[3], regs[4], regs[5]]);
    raise exception 'FAIL: out-of-pool selection accepted';
  exception when others then
    perform pg_temp.check(sqlerrm ~ 'selection_not_in_pool', 'selection outside the eligible pool is rejected');
  end;

  -- mismatched identity/registration pair
  begin
    perform public.finalize_official_draw('00000000-0000-0000-0000-0000000000a1','daily',day2,true,
      ids, array[regs[2], regs[1], regs[3], regs[4], regs[5]]);
    raise exception 'FAIL: mismatched pair accepted';
  exception when others then
    perform pg_temp.check(sqlerrm ~ 'selection_not_in_pool', 'identity/registration mismatch is rejected');
  end;

  perform pg_temp.check((select count(*) = 1 from public.giveaway_draws), 'rejected attempts created no draw');
end $$;

-- not enough eligible: day 3 has no registrations
select pg_temp.expect_error(
  $$select public.finalize_official_draw('00000000-0000-0000-0000-0000000000a1','daily',(select id from public.event_days where day_number=3),true,
      array[gen_random_uuid()], array[gen_random_uuid()])$$,
  'not_enough_eligible');

-- ---------------------------------------------------------------- RLS / privileges
insert into storage.objects (bucket_id, name) values ('participant-photos', 'event-day-1/secret.jpg');
-- authenticated staff: sees only own registrations; cannot write anything
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select count(*) = 1 from public.registrations), 'staff2 sees only the one registration they made');
select pg_temp.check((select count(*) = 1 from public.profiles), 'staff sees only their own profile');
select pg_temp.check((select count(*) = 3 from public.event_days), 'staff can read event days');
select pg_temp.expect_error($$insert into public.registrations (full_name, event_day_id, registered_by, consent, idempotency_key, eligibility_identity_id, photo_path) values ('Sneaky Insert', (select id from public.event_days limit 1), '00000000-0000-0000-0000-0000000000b2', true, gen_random_uuid(), gen_random_uuid(), 'x.jpg')$$, 'permission denied');
select pg_temp.expect_error($$update public.profiles set role = 'admin' where id = auth.uid()$$, 'permission denied');
select pg_temp.expect_error($$select * from public.winners$$, 'permission denied');
select pg_temp.expect_error($$select * from public.activity_logs$$, 'permission denied');
select pg_temp.expect_error($$select * from public.giveaway_draws$$, 'permission denied');
select pg_temp.expect_error($$select public.finalize_official_draw(auth.uid(),'global',null,true,array[]::uuid[],array[]::uuid[])$$, 'permission denied');
reset role;

-- inactive staff see nothing
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b3';
select pg_temp.check((select count(*) = 0 from public.registrations), 'deactivated staff see no registrations');
select pg_temp.check((select count(*) = 0 from public.event_days), 'deactivated staff see no event days');
reset role;

-- admin sees all registrations
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check((select count(*) = 503 from public.registrations), 'admin sees all registrations');
select pg_temp.check((select count(*) = 5 from public.profiles), 'admin sees all profiles');
reset role;

-- anon: nothing
set role anon;
select pg_temp.expect_error($$select * from public.registrations$$, 'permission denied');
select pg_temp.expect_error($$select * from public.profiles$$, 'permission denied');
select pg_temp.check((select count(*) = 0 from storage.objects), 'anon sees no photo objects (no storage policies)');
reset role;
set role authenticated;
select pg_temp.check((select count(*) = 0 from storage.objects), 'no storage policies: authenticated users see no photo objects');
reset role;

-- service role can do the backend's work
set role service_role;
select pg_temp.check((select count(*) = 503 from public.registrations), 'service role reads registrations');
reset role;

-- storage bucket is private
select pg_temp.check((select public = false and file_size_limit = 6291456 from storage.buckets where id = 'participant-photos'), 'photo bucket is private with a 6 MB limit');

\echo ALL DATABASE TESTS PASSED
