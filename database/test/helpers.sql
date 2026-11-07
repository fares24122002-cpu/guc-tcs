-- TEST ONLY helpers (included with \i).
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
  if p_ok is not true then raise exception 'FAIL: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
