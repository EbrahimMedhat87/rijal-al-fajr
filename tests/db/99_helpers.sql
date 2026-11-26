create schema t;
grant usage on schema t to anon, authenticated;

create function t.login(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, false);
  execute 'set role authenticated';
end $$;

create function t.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role anon';
end $$;

create function t.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

-- security definer: مستخدم التطبيق لا يقرأ auth.users (مثل Supabase)، لكن مساعد الاختبار يحتاج ذلك
create function t.uid(p_email text) returns uuid language sql stable security definer as $$
  select id from auth.users where email = p_email
$$;

create function t.expect(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok   - %', msg;
end $$;

-- ينفّذ SQL ويتوقع خطأ يحتوي على النص code
create function t.expect_err(stmt text, code text, msg text) returns void language plpgsql as $$
declare ok boolean := false;
begin
  begin
    execute stmt;
  exception when others then
    if position(code in sqlerrm) > 0 then
      ok := true;
    else
      raise exception 'FAIL: % — wrong error: %', msg, sqlerrm;
    end if;
  end;
  if not ok then raise exception 'FAIL: % — expected error containing "%"', msg, code; end if;
  raise notice 'ok   - %', msg;
end $$;

grant execute on all functions in schema t to anon, authenticated;
