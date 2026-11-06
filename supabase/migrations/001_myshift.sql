-- Supabase PostgreSQL. All writes use scoped, transactional RPCs.
create type public.app_role as enum ('admin','manager','employee');
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, name text not null, role app_role not null default 'employee');
create table public.departments (id uuid primary key default gen_random_uuid(), name text not null unique, color text not null default '#2563eb');
create table public.manager_departments (user_id uuid references profiles(id) on delete cascade, department_id uuid references departments(id) on delete cascade, primary key(user_id,department_id));
create table public.sites (id uuid primary key default gen_random_uuid(), name text not null unique);
create table public.roles (id uuid primary key default gen_random_uuid(), department_id uuid not null references departments(id), name text not null, unique(department_id,name));
create table public.employees (id uuid primary key default gen_random_uuid(), user_id uuid unique references profiles(id), name text not null, active boolean not null default true);
create table public.employee_departments (employee_id uuid references employees(id) on delete cascade, department_id uuid references departments(id), role_id uuid not null references roles(id), primary key(employee_id,department_id,role_id));
create table public.shift_templates (id uuid primary key default gen_random_uuid(), department_id uuid not null references departments(id), name text not null, start_time time, end_time time, confirmed boolean not null default false, check(not confirmed or (start_time is not null and end_time is not null and start_time <> end_time)));
create table public.settings (id boolean primary key default true check(id), min_rest_hours numeric not null default 0 check(min_rest_hours>=0), max_shift_hours numeric not null default 24 check(max_shift_hours>0 and max_shift_hours<=24));
insert into public.settings default values;
create table public.schedule_versions (id uuid primary key default gen_random_uuid(), week_start date not null unique check(extract(dow from week_start)=0), status text not null default 'draft' check(status in ('draft','published')), revision integer not null default 0, created_by uuid not null references profiles(id));
create table public.shift_assignments (id uuid primary key default gen_random_uuid(), version_id uuid not null references schedule_versions(id), department_id uuid not null references departments(id), site_id uuid not null references sites(id), role_id uuid not null references roles(id), employee_id uuid references employees(id), starts_at timestamptz not null, ends_at timestamptz not null, check(ends_at>starts_at and ends_at<=starts_at+interval '24 hours'));
create index assignment_employee_time on shift_assignments(employee_id,starts_at,ends_at);
create index assignment_version on shift_assignments(version_id,department_id);
create table public.availability (id uuid primary key default gen_random_uuid(), employee_id uuid not null references employees(id), starts_at timestamptz not null, ends_at timestamptz not null, kind text not null check(kind in ('available','unavailable','leave')), check(ends_at>starts_at));
create index availability_time on availability(employee_id,starts_at,ends_at);
create table public.coverage_requirements (id uuid primary key default gen_random_uuid(), department_id uuid not null references departments(id), site_id uuid not null references sites(id), role_id uuid not null references roles(id), weekday integer not null check(weekday between 0 and 6), start_time time not null, end_time time not null, required_count integer not null check(required_count>0), check(start_time<>end_time));
create table public.change_requests (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id), version_id uuid not null references schedule_versions(id), revision integer not null, operations jsonb not null, preview jsonb not null, status text not null default 'pending' check(status in ('pending','confirmed','cancelled')), expires_at timestamptz not null default now()+interval '15 minutes', created_at timestamptz not null default now());
create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid not null references profiles(id), version_id uuid references schedule_versions(id), department_id uuid references departments(id), entity text not null, entity_id uuid, before_data jsonb, after_data jsonb, created_at timestamptz not null default now());
create index audit_time on audit_logs(created_at desc);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id), message text not null, read boolean not null default false, created_at timestamptz not null default now());
create index notification_user on notifications(user_id,created_at desc);
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from profiles where id=auth.uid() and role='admin') $$;
create function public.can_manage(d uuid) returns boolean language sql stable security definer set search_path=public as $$ select is_admin() or exists(select 1 from profiles p join manager_departments m on m.user_id=p.id where p.id=auth.uid() and p.role='manager' and m.department_id=d) $$;
create function public.can_read_department(d uuid) returns boolean language sql stable security definer set search_path=public as $$ select can_manage(d) or exists(select 1 from employee_departments ed join employees e on e.id=ed.employee_id where e.user_id=auth.uid() and ed.department_id=d) $$;
create function public.can_read_employee(eid uuid) returns boolean language sql stable security definer set search_path=public as $$ select is_admin() or exists(select 1 from employees where id=eid and user_id=auth.uid()) or exists(select 1 from employee_departments where employee_id=eid and can_manage(department_id)) $$;
-- No authenticated client may directly modify rows. RPCs below are the only write surface.
do $$ declare t text; begin foreach t in array array['profiles','departments','manager_departments','sites','roles','employees','employee_departments','shift_templates','settings','schedule_versions','shift_assignments','availability','coverage_requirements','change_requests','audit_logs','notifications'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from anon, authenticated',t); execute format('grant select on public.%I to authenticated',t); end loop; end $$;
create policy read_profiles on profiles for select to authenticated using(id=auth.uid() or is_admin());
create policy read_departments on departments for select to authenticated using(can_read_department(id));
create policy read_manager_departments on manager_departments for select to authenticated using(user_id=auth.uid() or is_admin());
create policy read_sites on sites for select to authenticated using(auth.uid() is not null);
create policy read_roles on roles for select to authenticated using(can_read_department(department_id));
create policy read_employees on employees for select to authenticated using(can_read_employee(id));
create policy read_memberships on employee_departments for select to authenticated using(can_read_employee(employee_id));
create policy read_templates on shift_templates for select to authenticated using(can_read_department(department_id));
create policy read_settings on settings for select to authenticated using(auth.uid() is not null);
create policy read_versions on schedule_versions for select to authenticated using(auth.uid() is not null);
create policy read_assignments on shift_assignments for select to authenticated using(can_manage(department_id) or (employee_id in (select id from employees where user_id=auth.uid()) and exists(select 1 from schedule_versions where id=version_id and status='published')));
create policy read_availability on availability for select to authenticated using(can_read_employee(employee_id));
create policy read_coverage on coverage_requirements for select to authenticated using(can_read_department(department_id));
create policy read_requests on change_requests for select to authenticated using(user_id=auth.uid());
create policy read_audit on audit_logs for select to authenticated using(is_admin() or can_manage(department_id));
create policy read_notifications on notifications for select to authenticated using(user_id=auth.uid());

create function public.validate_schedule(vid uuid) returns void language plpgsql security definer set search_path=public as $$
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
   if exists(select 1 from shift_assignments a join schedule_versions v on v.id=a.version_id where a.id<>s.id and a.employee_id=s.employee_id and (a.version_id=vid or v.week_start<>s.week_start) and a.starts_at<s.ends_at+make_interval(secs=>cfg.min_rest_hours::double precision*3600) and a.ends_at>s.starts_at-make_interval(secs=>cfg.min_rest_hours::double precision*3600)) then raise exception 'חפיפה בין משמרות או הפרת זמן מנוחה'; end if;
  end if;
 end loop;
end $$;

-- Private helper: invoked only inside a rollback-only preview or confirmed transaction.
create function public.apply_operations(vid uuid, ops jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare op jsonb; oldrow shift_assignments; newrow shift_assignments; changes jsonb:='[]'; dep uuid; begin
 if ops is null or jsonb_typeof(ops) is distinct from 'array' or jsonb_array_length(ops) not between 1 and 100 then raise exception 'נדרשות 1–100 פעולות'; end if;
 for op in select * from jsonb_array_elements(ops) loop
  oldrow:=null; newrow:=null;
  if op->>'kind' in ('update','delete') then
   select * into strict oldrow from shift_assignments where id=(op->>'id')::uuid and version_id=vid for update;
   if not can_manage(oldrow.department_id) then raise exception 'אין הרשאה למחלקה'; end if;
  end if;
  if op->>'kind' in ('create','update') then
   dep:=(op->>'department_id')::uuid;
   if not coalesce(can_manage(dep),false) then raise exception 'אין הרשאה למחלקה'; end if;
   if op->>'kind'='update' then delete from shift_assignments where id=oldrow.id; end if;
   insert into shift_assignments(id,version_id,department_id,site_id,role_id,employee_id,starts_at,ends_at) values(coalesce(oldrow.id,gen_random_uuid()),vid,dep,(op->>'site_id')::uuid,(op->>'role_id')::uuid,(op->>'employee_id')::uuid,(op->>'starts_at')::timestamptz,(op->>'ends_at')::timestamptz) returning * into newrow;
  elsif op->>'kind'='delete' then delete from shift_assignments where id=oldrow.id;
  else raise exception 'פעולה לא נתמכת'; end if;
  changes:=changes||jsonb_build_array(jsonb_build_object('before',case when oldrow.id is null then null else to_jsonb(oldrow) end,'after',case when newrow.id is null then null else to_jsonb(newrow) end));
  insert into audit_logs(actor_id,version_id,department_id,entity,entity_id,before_data,after_data) values(auth.uid(),vid,coalesce(newrow.department_id,oldrow.department_id),'shift',coalesce(newrow.id,oldrow.id),case when oldrow.id is null then null else to_jsonb(oldrow) end,case when newrow.id is null then null else to_jsonb(newrow) end);
 end loop;
 perform validate_schedule(vid);
 return changes;
end $$;
create function public.preview_change(vid uuid, ops jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare v schedule_versions; result jsonb; rid uuid; begin
 if auth.uid() is null then raise exception 'נדרשת התחברות'; end if;
 if not exists(select 1 from profiles where id=auth.uid() and role in ('admin','manager')) then raise exception 'אין הרשאה לעריכת סידור'; end if;
 perform pg_advisory_xact_lock(782641);
 select * into strict v from schedule_versions where id=vid for update;
 if v.status<>'draft' then raise exception 'הסידור פורסם; נדרשת פתיחה מחדש בידי מנהל ראשי'; end if;
 begin
  result:=apply_operations(vid,ops);
  raise exception using errcode='ZX001',message=result::text;
 exception when sqlstate 'ZX001' then result:=sqlerrm::jsonb;
 end;
 insert into change_requests(user_id,version_id,revision,operations,preview) values(auth.uid(),vid,v.revision,ops,result) returning id into rid;
 return jsonb_build_object('id',rid,'changes',result,'revision',v.revision);
end $$;
create function public.confirm_change(rid uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r change_requests; v schedule_versions; result jsonb; begin
 perform pg_advisory_xact_lock(782641);
 select * into strict r from change_requests where id=rid and user_id=auth.uid() for update;
 if r.status<>'pending' or r.expires_at<now() then raise exception 'הבקשה בוטלה, אושרה או פגה'; end if;
 select * into strict v from schedule_versions where id=r.version_id for update;
 if v.revision<>r.revision or v.status<>'draft' then raise exception 'הסידור השתנה. צור תצוגה מקדימה חדשה'; end if;
 result:=apply_operations(r.version_id,r.operations);
 update schedule_versions set revision=revision+1 where id=v.id;
 update change_requests set status='confirmed' where id=rid;
 insert into notifications(user_id,message) select p.id,'עודכן סידור העבודה לשבוע '||v.week_start from profiles p where p.role='admin' or exists(select 1 from manager_departments m where m.user_id=p.id and m.department_id in(select a.department_id from shift_assignments a where a.version_id=v.id)) or exists(select 1 from employees e where e.user_id=p.id and e.id in(select (x->'before'->>'employee_id')::uuid from jsonb_array_elements(result) x union select (x->'after'->>'employee_id')::uuid from jsonb_array_elements(result) x));
 return result;
end $$;
create function public.cancel_change(rid uuid) returns void language sql security definer set search_path=public as $$ update change_requests set status='cancelled' where id=rid and user_id=auth.uid() and status='pending' $$;
create function public.schedule_action(week date, action text) returns uuid language plpgsql security definer set search_path=public as $$
declare v schedule_versions; begin
 perform pg_advisory_xact_lock(782641);
 if not (is_admin() or exists(select 1 from manager_departments where user_id=auth.uid() and can_manage(department_id))) then raise exception 'אין הרשאה'; end if;
 if action='create' then
 insert into schedule_versions(week_start,created_by) values(week,auth.uid()) on conflict(week_start) do nothing;
 else
 if not is_admin() then raise exception 'פרסום ופתיחה מחדש מותרים למנהל ראשי בלבד'; end if;
 select * into strict v from schedule_versions where week_start=week for update;
 if action is null or action not in ('publish','reopen') then raise exception 'פעולה לא נתמכת'; end if;
 perform validate_schedule(v.id);
 update schedule_versions set status=case when action='publish' then 'published' else 'draft' end,revision=revision+1 where id=v.id;
 insert into audit_logs(actor_id,version_id,entity,entity_id,before_data,after_data) values(auth.uid(),v.id,'schedule',v.id,to_jsonb(v),jsonb_build_object('action',action));
 insert into notifications(user_id,message) select id,'מצב הסידור לשבוע '||week||' השתנה: '||action from profiles;
 end if;
 return (select id from schedule_versions where week_start=week);
end $$;

-- Administrative configuration is allowlisted; no dynamic table names from clients.
create function public.manage_entity(kind text, data jsonb) returns void language plpgsql security definer set search_path=public as $$
declare eid uuid; dep uuid; before_value jsonb; begin
 if kind='notification' then update notifications set read=true where id=(data->>'id')::uuid and user_id=auth.uid(); return; end if;
 if not is_admin() then raise exception 'נדרשת הרשאת מנהל ראשי'; end if;
 eid:=coalesce((data->>'id')::uuid,gen_random_uuid());
 case kind
 when 'department' then
 select to_jsonb(t) into before_value from departments t where id=eid;
 insert into departments(id,name,color) values(eid,data->>'name',coalesce(data->>'color','#2563eb')) on conflict(id) do update set name=excluded.name,color=excluded.color;
 when 'site' then
 select to_jsonb(t) into before_value from sites t where id=eid;
 insert into sites(id,name) values(eid,data->>'name') on conflict(id) do update set name=excluded.name;
 when 'role' then insert into roles(id,department_id,name) values(eid,(data->>'department_id')::uuid,data->>'name') on conflict(id) do update set name=excluded.name;
 when 'employee' then
 select to_jsonb(t) into before_value from employees t where id=eid;
 insert into employees(id,name,active,user_id) values(eid,data->>'name',coalesce((data->>'active')::boolean,true),(data->>'user_id')::uuid) on conflict(id) do update set name=excluded.name,active=excluded.active,user_id=excluded.user_id;
 when 'membership' then
 dep:=(data->>'department_id')::uuid;
 if not exists(select 1 from roles where id=(data->>'role_id')::uuid and department_id=dep) then raise exception 'תפקיד לא תואם'; end if;
 insert into employee_departments values((data->>'employee_id')::uuid,dep,(data->>'role_id')::uuid) on conflict do nothing;
 when 'template' then
 select to_jsonb(t) into before_value from shift_templates t where id=eid;
 insert into shift_templates(id,department_id,name,start_time,end_time,confirmed) values(eid,(data->>'department_id')::uuid,data->>'name',(data->>'start_time')::time,(data->>'end_time')::time,coalesce((data->>'confirmed')::boolean,false)) on conflict(id) do update set name=excluded.name,start_time=excluded.start_time,end_time=excluded.end_time,confirmed=excluded.confirmed;
 when 'availability' then insert into availability(id,employee_id,starts_at,ends_at,kind) values(eid,(data->>'employee_id')::uuid,(data->>'starts_at')::timestamptz,(data->>'ends_at')::timestamptz,data->>'kind');
 when 'coverage' then insert into coverage_requirements(id,department_id,site_id,role_id,weekday,start_time,end_time,required_count) values(eid,(data->>'department_id')::uuid,(data->>'site_id')::uuid,(data->>'role_id')::uuid,(data->>'weekday')::integer,(data->>'start_time')::time,(data->>'end_time')::time,(data->>'required_count')::integer);
 when 'settings' then
 select to_jsonb(t) into before_value from settings t;
 update settings set min_rest_hours=(data->>'min_rest_hours')::numeric,max_shift_hours=(data->>'max_shift_hours')::numeric;
 when 'permission' then
 select to_jsonb(t) into before_value from profiles t where id=(data->>'user_id')::uuid;
 update profiles set role=(data->>'role')::app_role where id=(data->>'user_id')::uuid;
 delete from manager_departments where user_id=(data->>'user_id')::uuid;
 insert into manager_departments select (data->>'user_id')::uuid,value::uuid from jsonb_array_elements_text(coalesce(data->'department_ids','[]'));
 else raise exception 'סוג לא נתמך'; end case;
 insert into audit_logs(actor_id,entity,entity_id,before_data,after_data) values(auth.uid(),kind,eid,before_value,data);
end $$;
-- New users have no elevated privileges. Bootstrap the first administrator manually.
create function public.new_user_profile() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into profiles(id,name) values(new.id,coalesce(new.raw_user_meta_data->>'name','משתמש חדש')); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_user_profile();
revoke all on function public.apply_operations(uuid,jsonb), public.validate_schedule(uuid), public.new_user_profile() from public,anon,authenticated;
revoke all on function public.preview_change(uuid,jsonb),public.confirm_change(uuid),public.cancel_change(uuid),public.schedule_action(date,text),public.manage_entity(text,jsonb) from public,anon;
grant execute on function public.preview_change(uuid,jsonb),public.confirm_change(uuid),public.cancel_change(uuid),public.schedule_action(date,text),public.manage_entity(text,jsonb) to authenticated;
