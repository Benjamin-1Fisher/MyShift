begin;
alter table public.availability add column absence_reason text
 check(absence_reason in ('vacation','sick','personal','other'));

create function public.can_record_absence(eid uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select is_admin() or exists(select 1 from employees where id=eid and user_id=auth.uid()) or
  (exists(select 1 from employee_departments where employee_id=eid and can_manage(department_id)) and
   not exists(select 1 from employee_departments where employee_id=eid and not can_manage(department_id)))
$$;
create function public.save_absence(data jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare eid uuid; rid uuid; from_day date; through_day date; reason text; oldrow jsonb; begin
 eid := (data->>'employee_id')::uuid;
 if not coalesce(can_record_absence(eid),false) then raise exception 'אין הרשאה להיעדרויות העובד'; end if;
 from_day := (data->>'starts_on')::date; through_day := (data->>'ends_on')::date;
 reason := data->>'absence_reason';
 if from_day is null or through_day is null or through_day<from_day then raise exception 'יש לבחור טווח תאריכים תקין'; end if;
 if reason is null or reason not in ('vacation','sick','personal','other') then raise exception 'יש לבחור סוג היעדרות תקין'; end if;
 perform pg_advisory_xact_lock(782641);
 rid := coalesce((data->>'id')::uuid,gen_random_uuid());
 if data->>'id' is not null and not exists(select 1 from availability where id=rid and employee_id=eid and kind in ('leave','unavailable')) then
  raise exception 'דיווח ההיעדרות לא נמצא או אינו שייך לעובד';
 end if;
 select to_jsonb(a) into oldrow from availability a where id=rid;
 insert into availability(id,employee_id,kind,absence_reason,starts_at,ends_at)
 values(rid,eid,'leave',reason,from_day::timestamp at time zone 'Asia/Jerusalem',(through_day+1)::timestamp at time zone 'Asia/Jerusalem')
 on conflict(id) do update set kind='leave',absence_reason=excluded.absence_reason,starts_at=excluded.starts_at,ends_at=excluded.ends_at;
 insert into audit_logs(actor_id,entity,entity_id,before_data,after_data)
 values(auth.uid(),'absence',rid,oldrow,(select to_jsonb(a) from availability a where id=rid));
 return rid;
end $$;
create function public.cancel_absence(aid uuid) returns void
language plpgsql security definer set search_path=public as $$
declare a availability; begin
 perform pg_advisory_xact_lock(782641);
 select * into a from availability where id=aid and kind in ('leave','unavailable') for update;
 if a.id is null then raise exception 'דיווח ההיעדרות לא נמצא או כבר בוטל'; end if;
 if not coalesce(can_record_absence(a.employee_id),false) then raise exception 'אין הרשאה להיעדרויות העובד'; end if;
 delete from availability where id=aid;
 insert into audit_logs(actor_id,entity,entity_id,before_data,after_data) values(auth.uid(),'absence',aid,to_jsonb(a),null);
end $$;
revoke all on function public.can_record_absence(uuid) from public,anon,authenticated;
revoke all on function public.save_absence(jsonb),public.cancel_absence(uuid) from public,anon;
grant execute on function public.save_absence(jsonb),public.cancel_absence(uuid) to authenticated;
commit;
