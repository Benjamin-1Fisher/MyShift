begin;

-- Department-scoped weeks. Existing records are retained; mixed legacy versions
-- are split by moving each shift to a version for its own department.
alter table public.departments add column active boolean not null default true;
-- Add the known departments without overwriting organization configuration.
insert into departments(name,color) values('אחמ״שים','#7360d6'),('סיירים','#149c8e'),('קבלה','#3979bb'),('חניונים','#b27724') on conflict(name) do nothing;
insert into roles(department_id,name) select id,name from departments where name in ('אחמ״שים','סיירים','קבלה','חניונים') on conflict do nothing;

alter table public.schedule_versions add column department_id uuid references public.departments(id);
drop index public.schedule_one_active_week;
do $$ declare v record; d uuid; first_dep uuid; newid uuid; begin
 for v in select * from schedule_versions loop
  first_dep:=null;
  for d in select distinct department_id from shift_assignments where version_id=v.id loop
   if first_dep is null then
    first_dep:=d;
    update schedule_versions set department_id=d where id=v.id;
   else
    insert into schedule_versions(week_start,status,revision,created_by,archived_at,department_id)
    values(v.week_start,v.status,v.revision,v.created_by,v.archived_at,d) returning id into newid;
    update shift_assignments set version_id=newid where version_id=v.id and department_id=d;
   end if;
  end loop;
  if first_dep is null then
   update schedule_versions set department_id=(select id from departments order by name limit 1) where id=v.id;
  end if;
 end loop;
 -- Old proposals refer to the former combined revision; preserve them as cancelled.
 update change_requests set status='cancelled' where status='pending';
end $$;
create unique index schedule_one_active_department_week on public.schedule_versions(week_start,department_id) where status<>'archived';
create function public.check_shift_department() returns trigger language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from schedule_versions where id=new.version_id and department_id=new.department_id) then
  raise exception 'המשמרת חייבת להשתייך למחלקה של הסידור';
 end if;
 if not exists(select 1 from departments where id=new.department_id and active) then raise exception 'המחלקה מושבתת'; end if;
 return new;
end $$;
create trigger shift_department_scope before insert or update on public.shift_assignments for each row execute function public.check_shift_department();

create function public.department_schedule_action(week date, action text, department uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare v schedule_versions; begin
 if not coalesce(can_manage(department),false) then raise exception 'אין הרשאה למחלקה'; end if;
 if not exists(select 1 from departments where id=department and active) then raise exception 'המחלקה מושבתת'; end if;
 perform pg_advisory_xact_lock(782641);
 select * into v from schedule_versions where week_start=week and department_id=department and status<>'archived' for update;
 if action='create' then
  if v.id is null then
   insert into schedule_versions(week_start,department_id,created_by) values(week,department,auth.uid()) returning * into v;
  end if;
 elsif action in ('publish','reopen') then
  if v.id is null then raise exception 'יש ליצור סידור למחלקה תחילה'; end if;
  perform validate_schedule(v.id);
  update schedule_versions set status=case when action='publish' then 'published' else 'draft' end,revision=revision+1 where id=v.id;
  update change_requests set status='cancelled' where version_id=v.id and status='pending';
  insert into audit_logs(actor_id,version_id,department_id,entity,entity_id,before_data,after_data)
  values(auth.uid(),v.id,department,'schedule',v.id,to_jsonb(v),jsonb_build_object('action',action));
  insert into notifications(user_id,message) select p.id,'סידור המחלקה לשבוע '||week||' עודכן: '||action from profiles p where p.role='admin' or exists(select 1 from manager_departments m where m.user_id=p.id and m.department_id=department) or exists(select 1 from employees e join employee_departments ed on ed.employee_id=e.id where e.user_id=p.id and ed.department_id=department);
 else raise exception 'פעולה לא נתמכת'; end if;
 return v.id;
end $$;
-- Old clients may not create or publish a combined organization-wide week.
create or replace function public.schedule_action(week date, action text) returns uuid
language plpgsql security definer set search_path=public as $$
begin raise exception 'יש לבחור מחלקה ולעדכן את היישום'; end $$;
revoke all on function public.department_schedule_action(date,text,uuid) from public,anon;
grant execute on function public.department_schedule_action(date,text,uuid) to authenticated;

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
   if exists(select 1 from availability where employee_id=s.employee_id and kind='available' and starts_at<((s.week_start+7)::timestamp at time zone 'Asia/Jerusalem') and ends_at>(s.week_start::timestamp at time zone 'Asia/Jerusalem')) and not exists(select 1 from availability where employee_id=s.employee_id and kind='available' and starts_at<((s.week_start+7)::timestamp at time zone 'Asia/Jerusalem') and ends_at>(s.week_start::timestamp at time zone 'Asia/Jerusalem') and starts_at<=s.starts_at and ends_at>=s.ends_at) then raise exception 'המשמרת מחוץ לזמינות שהוגדרה'; end if;
   if exists(select 1 from shift_assignments a join schedule_versions v on v.id=a.version_id where v.status<>'archived' and a.id<>s.id and a.employee_id=s.employee_id and a.starts_at<s.ends_at+make_interval(secs=>cfg.min_rest_hours::double precision*3600) and a.ends_at>s.starts_at-make_interval(secs=>cfg.min_rest_hours::double precision*3600)) then raise exception 'חפיפה בין משמרות או הפרת זמן מנוחה'; end if;
  end if;
 end loop;
end $$;


create or replace function public.schedule_recover(vid uuid, action text, expected_revision integer, expected_active_id uuid, expected_active_revision integer) returns uuid
language plpgsql security definer set search_path=public as $$
declare target schedule_versions; active schedule_versions; begin
 
 perform pg_advisory_xact_lock(782641);
 select * into strict target from schedule_versions where id=vid for update;
 if not can_manage(target.department_id) then raise exception 'אין הרשאה למחלקה'; end if;
 select * into active from schedule_versions where week_start=target.week_start and department_id=target.department_id and status<>'archived' for update;
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

alter function public.manage_entity(text,jsonb) rename to manage_entity_legacy;
revoke all on function public.manage_entity_legacy(text,jsonb) from public,anon,authenticated;
create function public.manage_entity(kind text, data jsonb) returns void language plpgsql security definer set search_path=public as $$
declare dep uuid; eid uuid; olddep uuid; begin
 if kind='availability' then
  eid:=(data->>'employee_id')::uuid;
  if not (is_admin() or exists(select 1 from employees where id=eid and user_id=auth.uid()) or
    (exists(select 1 from employee_departments where employee_id=eid and can_manage(department_id)) and
     not exists(select 1 from employee_departments where employee_id=eid and not can_manage(department_id)))) then
   raise exception 'אין הרשאה לזמינות העובד';
  end if;
  if data->>'id' is not null and not exists(select 1 from availability where id=(data->>'id')::uuid and employee_id=eid) then raise exception 'אין הרשאה לרשומה'; end if;
  insert into availability(id,employee_id,starts_at,ends_at,kind) values(coalesce((data->>'id')::uuid,gen_random_uuid()),eid,(data->>'starts_at')::timestamptz,(data->>'ends_at')::timestamptz,data->>'kind')
  on conflict(id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,kind=excluded.kind;
 elsif kind in ('template','coverage') then
  dep:=(data->>'department_id')::uuid;
  if not coalesce(can_manage(dep),false) then raise exception 'אין הרשאה למחלקה'; end if;
  if not exists(select 1 from departments where id=dep and active) then raise exception 'המחלקה מושבתת'; end if;
  if kind='template' then
   select department_id into olddep from shift_templates where id=(data->>'id')::uuid;
   if olddep is not null and olddep<>dep then raise exception 'אין להעביר תבנית בין מחלקות'; end if;
   insert into shift_templates(id,department_id,name,start_time,end_time,confirmed) values(coalesce((data->>'id')::uuid,gen_random_uuid()),dep,data->>'name',(data->>'start_time')::time,(data->>'end_time')::time,coalesce((data->>'confirmed')::boolean,false))
   on conflict(id) do update set name=excluded.name,start_time=excluded.start_time,end_time=excluded.end_time,confirmed=excluded.confirmed;
  else
   select department_id into olddep from coverage_requirements where id=(data->>'id')::uuid;
   if olddep is not null and olddep<>dep then raise exception 'אין להעביר דרישה בין מחלקות'; end if;
   if not exists(select 1 from roles where id=(data->>'role_id')::uuid and department_id=dep) then raise exception 'תפקיד לא תואם למחלקה'; end if;
   insert into coverage_requirements(id,department_id,site_id,role_id,weekday,start_time,end_time,required_count)
   values(coalesce((data->>'id')::uuid,gen_random_uuid()),dep,(data->>'site_id')::uuid,(data->>'role_id')::uuid,(data->>'weekday')::integer,(data->>'start_time')::time,(data->>'end_time')::time,(data->>'required_count')::integer)
   on conflict(id) do update set site_id=excluded.site_id,role_id=excluded.role_id,weekday=excluded.weekday,start_time=excluded.start_time,end_time=excluded.end_time,required_count=excluded.required_count;
  end if;
 else
  perform manage_entity_legacy(kind,data);
  if kind='department' and data ? 'active' then update departments set active=(data->>'active')::boolean where id=(data->>'id')::uuid; end if;
 end if;
 if kind in ('availability','template','coverage') then
  insert into audit_logs(actor_id,department_id,entity,entity_id,after_data)
  values(auth.uid(),dep,kind,(data->>'id')::uuid,data);
 end if;
end $$;
revoke all on function public.manage_entity(text,jsonb) from public,anon;
grant execute on function public.manage_entity(text,jsonb) to authenticated;
-- Do not disclose unrelated qualifications or draft schedules via direct REST reads.
drop policy read_memberships on employee_departments;
create policy read_memberships on employee_departments for select to authenticated using(can_read_department(department_id) and can_read_employee(employee_id));
drop policy read_versions on schedule_versions;
create policy read_versions on schedule_versions for select to authenticated using(can_manage(department_id) or (status='published' and can_read_department(department_id)));


-- The legacy date-only recovery endpoint cannot identify a department safely.
create or replace function public.schedule_lifecycle(week date, action text, expected_revision integer) returns uuid
language plpgsql security definer set search_path=public as $$
begin raise exception 'יש לבחור מחלקה וסידור לשחזור'; end $$;

commit;
