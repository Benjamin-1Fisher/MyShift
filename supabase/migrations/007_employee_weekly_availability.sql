begin;

-- NULL keeps the existing unrestricted behavior. Index 0 is Sunday; each day
-- contains the allowed morning/evening/night shift types.
create function public.valid_weekly_availability(pattern jsonb) returns boolean
language plpgsql immutable set search_path=public as $$
declare day_pattern jsonb; total integer := 0; begin
 if pattern is null then return true; end if;
 if jsonb_typeof(pattern)<>'array' then return false; end if;
 if jsonb_array_length(pattern)<>7 then return false; end if;
 for day_pattern in select * from jsonb_array_elements(pattern) loop
  if jsonb_typeof(day_pattern)<>'array' then return false; end if;
  if jsonb_array_length(day_pattern)>3 then return false; end if;
  if exists(select 1 from jsonb_array_elements_text(day_pattern) p(value)
    where value is null or value not in ('morning','evening','night')) then return false; end if;
  if (select count(distinct value) from jsonb_array_elements_text(day_pattern) p(value))<>jsonb_array_length(day_pattern) then return false; end if;
  total := total+jsonb_array_length(day_pattern);
 end loop;
 return total>0;
end $$;

alter table public.employees add column weekly_availability jsonb
 check(public.valid_weekly_availability(weekly_availability));

create function public.is_weekly_available(eid uuid, department uuid, shift_start timestamptz, shift_end timestamptz) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare pattern jsonb; period text; start_local timestamp; begin
 select weekly_availability into pattern from employees where id=eid;
 if not found then return false; end if;
 if pattern is null then return true; end if;
 start_local := shift_start at time zone 'Asia/Jerusalem';
 -- Named, confirmed templates take precedence over the default time bands.
 select case when btrim(st.name) like 'בוקר%' then 'morning'
   when btrim(st.name) like 'ערב%' then 'evening' else 'night' end into period
 from shift_templates st where st.department_id=department and st.confirmed
  and to_char(st.start_time,'HH24:MI')=to_char(start_local,'HH24:MI')
  and to_char(st.end_time,'HH24:MI')=to_char(shift_end at time zone 'Asia/Jerusalem','HH24:MI')
  and (btrim(st.name) like 'בוקר%' or btrim(st.name) like 'ערב%' or btrim(st.name) like 'לילה%')
 order by st.id limit 1;
 if period is null then
  period := case when start_local::time>=time '07:00' and start_local::time<time '15:00' then 'morning'
    when start_local::time>=time '15:00' and start_local::time<time '23:00' then 'evening' else 'night' end;
 end if;
 return (pattern -> extract(dow from start_local)::integer) ? period;
end $$;

-- A distinct RPC avoids silently dropping new preferences on installations that
-- have not run this migration. Ordinary employee edits retain their old API.
create function public.save_employee_with_availability(data jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare eid uuid; pattern jsonb; old_pattern jsonb; begin
 if not is_admin() then raise exception 'נדרשת הרשאת מנהל ראשי'; end if;
 if data is null or jsonb_typeof(data)<>'object' or not (data ? 'weekly_availability') then
  raise exception 'יש לבחור זמינות קבועה';
 end if;
 pattern := nullif(data->'weekly_availability','null'::jsonb);
 if not valid_weekly_availability(pattern) then raise exception 'יש לבחור ימים ומשמרות תקינים או זמינות ללא הגבלה'; end if;
 perform pg_advisory_xact_lock(782641);
 select weekly_availability into old_pattern from employees where id=(data->>'id')::uuid;
 eid := save_employee(data);
 update employees set weekly_availability=pattern where id=eid;
 insert into audit_logs(actor_id,entity,entity_id,before_data,after_data)
 values(auth.uid(),'employee_availability',eid,jsonb_build_object('weekly_availability',old_pattern),jsonb_build_object('weekly_availability',pattern));
 return eid;
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
   if not is_weekly_available(s.employee_id,s.department_id,s.starts_at,s.ends_at) then raise exception 'המשמרת מחוץ לזמינות הקבועה של העובד'; end if;
   if exists(select 1 from availability where employee_id=s.employee_id and kind in ('unavailable','leave') and starts_at<s.ends_at and ends_at>s.starts_at) then raise exception 'העובד אינו זמין'; end if;
   if exists(select 1 from availability where employee_id=s.employee_id and kind='available' and starts_at<((s.week_start+7)::timestamp at time zone 'Asia/Jerusalem') and ends_at>(s.week_start::timestamp at time zone 'Asia/Jerusalem')) and not exists(select 1 from availability where employee_id=s.employee_id and kind='available' and starts_at<((s.week_start+7)::timestamp at time zone 'Asia/Jerusalem') and ends_at>(s.week_start::timestamp at time zone 'Asia/Jerusalem') and starts_at<=s.starts_at and ends_at>=s.ends_at) then raise exception 'המשמרת מחוץ לזמינות שהוגדרה'; end if;
   if exists(select 1 from shift_assignments a join schedule_versions v on v.id=a.version_id where v.status<>'archived' and a.id<>s.id and a.employee_id=s.employee_id and a.starts_at<s.ends_at+make_interval(secs=>cfg.min_rest_hours::double precision*3600) and a.ends_at>s.starts_at-make_interval(secs=>cfg.min_rest_hours::double precision*3600)) then raise exception 'חפיפה בין משמרות או הפרת זמן מנוחה'; end if;
  end if;
 end loop;
end $$;

revoke all on function public.valid_weekly_availability(jsonb),public.is_weekly_available(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.save_employee_with_availability(jsonb) from public,anon;
grant execute on function public.save_employee_with_availability(jsonb) to authenticated;
commit;
