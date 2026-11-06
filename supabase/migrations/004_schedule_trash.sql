-- Soft deletion: every shift and audit record is retained. No table is dropped.
alter table public.schedule_versions drop constraint schedule_versions_status_check;
alter table public.schedule_versions add constraint schedule_versions_status_check check(status in ('draft','published','archived'));

create function public.schedule_lifecycle(week date, action text, expected_revision integer) returns uuid
language plpgsql security definer set search_path=public as $$
declare v schedule_versions; begin
 if not is_admin() then raise exception 'מחיקה ושחזור של סידור מותרים למנהל ראשי בלבד'; end if;
 perform pg_advisory_xact_lock(782641);
 select * into strict v from schedule_versions where week_start=week for update;
 if expected_revision is null or v.revision<>expected_revision then raise exception 'הסידור השתנה. רעננו ונסו שוב'; end if;
 if action='archive' and v.status<>'archived' then
  update schedule_versions set status='archived',revision=revision+1 where id=v.id;
 elsif action='restore' and v.status='archived' then
  perform validate_schedule(v.id);
  update schedule_versions set status='draft',revision=revision+1 where id=v.id;
 else raise exception 'הפעולה אינה מתאימה למצב הסידור'; end if;
 update change_requests set status='cancelled' where version_id=v.id and status='pending';
 insert into audit_logs(actor_id,version_id,entity,entity_id,before_data,after_data) values(auth.uid(),v.id,'schedule',v.id,to_jsonb(v),(select to_jsonb(s) from schedule_versions s where s.id=v.id));
 insert into notifications(user_id,message) select id,case when action='archive' then 'הסידור לשבוע '||week||' הועבר לסל המחזור' else 'הסידור לשבוע '||week||' שוחזר כטיוטה' end from profiles where role='admin';
 return v.id;
end $$;
revoke all on function public.schedule_lifecycle(date,text,integer) from public,anon;
grant execute on function public.schedule_lifecycle(date,text,integer) to authenticated;

-- Existing clients must explicitly restore an archived schedule before editing or publishing it.
create or replace function public.schedule_action(week date, action text) returns uuid language plpgsql security definer set search_path=public as $$
declare v schedule_versions; begin
 perform pg_advisory_xact_lock(782641);
 if not (is_admin() or exists(select 1 from manager_departments where user_id=auth.uid() and can_manage(department_id))) then raise exception 'אין הרשאה'; end if;
 select * into v from schedule_versions where week_start=week for update;
 if v.status='archived' then raise exception 'הסידור בסל המחזור. יש לשחזר אותו תחילה'; end if;
 if action='create' then
  insert into schedule_versions(week_start,created_by) values(week,auth.uid()) on conflict(week_start) do nothing;
 else
  if not is_admin() then raise exception 'פרסום ופתיחה מחדש מותרים למנהל ראשי בלבד'; end if;
  if v.id is null then raise exception 'יש ליצור סידור שבועי תחילה'; end if;
  if action is null or action not in ('publish','reopen') then raise exception 'פעולה לא נתמכת'; end if;
  perform validate_schedule(v.id);
  update schedule_versions set status=case when action='publish' then 'published' else 'draft' end,revision=revision+1 where id=v.id;
  insert into audit_logs(actor_id,version_id,entity,entity_id,before_data,after_data) values(auth.uid(),v.id,'schedule',v.id,to_jsonb(v),jsonb_build_object('action',action));
  insert into notifications(user_id,message) select id,'מצב הסידור לשבוע '||week||' השתנה: '||action from profiles;
 end if;
 return (select id from schedule_versions where week_start=week);
end $$;

create or replace function public.validate_schedule(vid uuid) returns void language plpgsql security definer set search_path=public as $$
declare s record; cfg settings; begin
 select * into cfg from settings;
 for s in select a.*, v.week_start from shift_assignments a join schedule_versions v on v.id=a.version_id where a.version_id=vid loop
  if (s.starts_at at time zone 'Asia/Jerusalem')::date < s.week_start or (s.starts_at at time zone 'Asia/Jerusalem')::date >= s.week_start+7 then raise exception 'תאריך המשמרת מחוץ לשבוע הנבחר'; end if;
  if extract(epoch from s.ends_at-s.starts_at)/3600>cfg.max_shift_hours then raise exception 'משך המשמרת חורג מההגדרה'; end if;
  if not exists(select 1 from roles where id=s.role_id and department_id=s.department_id) then raise exception 'תפקיד אינו שייך למחלקה'; end if;
  if s.employee_id is not null then
   if not exists(select 1 from employees e join employee_departments ed on ed.employee_id=e.id where e.id=s.employee_id and e.active and ed.department_id=s.department_id and ed.role_id=s.role_id) then raise exception 'לעובד אין הכשרה מתאימה לתפקיד ולמחלקה'; end if;
   if exists(select 1 from availability where employee_id=s.employee_id and kind in ('unavailable','leave') and starts_at<s.ends_at and ends_at>s.starts_at) then raise exception 'העובד אינו זמין'; end if;
   if exists(select 1 from availability where employee_id=s.employee_id and kind='available') and not exists(select 1 from availability where employee_id=s.employee_id and kind='available' and starts_at<=s.starts_at and ends_at>=s.ends_at) then raise exception 'המשמרת מחוץ לזמינות שהוגדרה'; end if;
   if exists(select 1 from shift_assignments a join schedule_versions v on v.id=a.version_id where v.status<>'archived' and a.id<>s.id and a.employee_id=s.employee_id and (a.version_id=vid or v.week_start<>s.week_start) and a.starts_at<s.ends_at+make_interval(secs=>cfg.min_rest_hours::double precision*3600) and a.ends_at>s.starts_at-make_interval(secs=>cfg.min_rest_hours::double precision*3600)) then raise exception 'חפיפה בין משמרות או הפרת זמן מנוחה'; end if;
  end if;
 end loop;
end $$;

