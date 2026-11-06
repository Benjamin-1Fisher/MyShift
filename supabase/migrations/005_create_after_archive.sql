-- Keep archived schedules and their shifts intact while allowing a fresh active week.
alter table public.schedule_versions add column archived_at timestamptz;
alter table public.schedule_versions drop constraint schedule_versions_week_start_key;
create unique index schedule_one_active_week on public.schedule_versions(week_start) where status<>'archived';

create or replace function public.schedule_action(week date, action text) returns uuid language plpgsql security definer set search_path=public as $$
declare v schedule_versions; begin
 perform pg_advisory_xact_lock(782641);
 if not (is_admin() or exists(select 1 from manager_departments where user_id=auth.uid() and can_manage(department_id))) then raise exception 'אין הרשאה'; end if;
 select * into v from schedule_versions where week_start=week and status<>'archived' for update;
 if action='create' then
  insert into schedule_versions(week_start,created_by) values(week,auth.uid()) on conflict(week_start) where status<>'archived' do nothing;
 else
  if not is_admin() then raise exception 'פרסום ופתיחה מחדש מותרים למנהל ראשי בלבד'; end if;
  if v.id is null then raise exception 'יש ליצור סידור שבועי תחילה'; end if;
  if action is null or action not in ('publish','reopen') then raise exception 'פעולה לא נתמכת'; end if;
  perform validate_schedule(v.id);
  update schedule_versions set status=case when action='publish' then 'published' else 'draft' end,revision=revision+1 where id=v.id;
  insert into audit_logs(actor_id,version_id,entity,entity_id,before_data,after_data) values(auth.uid(),v.id,'schedule',v.id,to_jsonb(v),jsonb_build_object('action',action));
  insert into notifications(user_id,message) select id,'מצב הסידור לשבוע '||week||' השתנה: '||action from profiles;
 end if;
 return (select id from schedule_versions where week_start=week and status<>'archived');
end $$;

create function public.schedule_recover(vid uuid, action text, expected_revision integer, expected_active_id uuid, expected_active_revision integer) returns uuid
language plpgsql security definer set search_path=public as $$
declare target schedule_versions; active schedule_versions; begin
 if not is_admin() then raise exception 'מחיקה ושחזור של סידור מותרים למנהל ראשי בלבד'; end if;
 perform pg_advisory_xact_lock(782641);
 select * into strict target from schedule_versions where id=vid for update;
 select * into active from schedule_versions where week_start=target.week_start and status<>'archived' for update;
 if expected_revision is null or target.revision<>expected_revision or active.id is distinct from expected_active_id or active.revision is distinct from expected_active_revision then raise exception 'הסידור השתנה. רעננו ונסו שוב'; end if;
 if action='archive' and target.status<>'archived' then
  update schedule_versions set status='archived',archived_at=now(),revision=revision+1 where id=target.id;
 elsif action='restore' and target.status='archived' then
  -- Switching schedules never destroys the current one: it goes to the same trash list.
  if active.id is not null then
   update schedule_versions set status='archived',archived_at=now(),revision=revision+1 where id=active.id;
   update change_requests set status='cancelled' where version_id=active.id and status='pending';
   insert into audit_logs(actor_id,version_id,entity,entity_id,before_data,after_data) values(auth.uid(),active.id,'schedule',active.id,to_jsonb(active),jsonb_build_object('action','archive_for_restore'));
  end if;
  update schedule_versions set status='draft',archived_at=null,revision=revision+1 where id=target.id;
  perform validate_schedule(target.id);
 else raise exception 'הפעולה אינה מתאימה למצב הסידור'; end if;
 update change_requests set status='cancelled' where version_id=target.id and status='pending';
 insert into audit_logs(actor_id,version_id,entity,entity_id,before_data,after_data) values(auth.uid(),target.id,'schedule',target.id,to_jsonb(target),(select to_jsonb(s) from schedule_versions s where s.id=target.id));
 return target.id;
end $$;
revoke all on function public.schedule_recover(uuid,text,integer,uuid,integer) from public,anon;
grant execute on function public.schedule_recover(uuid,text,integer,uuid,integer) to authenticated;

-- Old clients may use the week-based RPC only when it identifies one schedule safely.
create or replace function public.schedule_lifecycle(week date, action text, expected_revision integer) returns uuid
language plpgsql security definer set search_path=public as $$
declare v schedule_versions; active schedule_versions; begin
 if not is_admin() then raise exception 'מחיקה ושחזור של סידור מותרים למנהל ראשי בלבד'; end if;
 perform pg_advisory_xact_lock(782641);
 select * into active from schedule_versions where week_start=week and status<>'archived';
 if action='archive' then v:=active;
 elsif action='restore' then
  if active.id is not null then raise exception 'קיים סידור פעיל. בחרו את הסידור לשחזור בסל המחזור'; end if;
  select * into v from schedule_versions where week_start=week and status='archived' order by archived_at desc nulls last,id desc limit 1;
 else raise exception 'פעולה לא נתמכת'; end if;
 if v.id is null then raise exception 'הסידור כבר השתנה. רעננו ונסו שוב'; end if;
 return schedule_recover(v.id,action,expected_revision,active.id,active.revision);
end $$;
