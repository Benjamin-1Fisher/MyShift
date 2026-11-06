create table public.ai_rate_limits(user_id uuid primary key references profiles(id) on delete cascade,window_start timestamptz not null,requests integer not null);
alter table public.ai_rate_limits enable row level security;
revoke all on public.ai_rate_limits from anon,authenticated;
create function public.claim_ai_slot() returns void language plpgsql security definer set search_path=public as $$
declare n integer; begin
 if not exists(select 1 from profiles where id=auth.uid() and role in ('admin','manager')) then raise exception 'אין הרשאה לעוזר'; end if;
 insert into ai_rate_limits values(auth.uid(),now(),1) on conflict(user_id) do update set requests=case when ai_rate_limits.window_start<now()-interval '1 minute' then 1 else ai_rate_limits.requests+1 end,window_start=case when ai_rate_limits.window_start<now()-interval '1 minute' then now() else ai_rate_limits.window_start end returning requests into n;
 if n>10 then raise exception 'מגבלת בקשות AI: נסה שוב בעוד דקה'; end if;
end $$;
revoke all on function public.claim_ai_slot() from public,anon;
grant execute on function public.claim_ai_slot() to authenticated;
