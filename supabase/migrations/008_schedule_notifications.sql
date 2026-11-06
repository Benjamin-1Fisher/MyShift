begin;
alter table public.notifications
 add column kind text check(kind in ('schedule_published','schedule_changed','schedule_withdrawn')),
 add column version_id uuid references public.schedule_versions(id),
 add column department_id uuid references public.departments(id),
 add column week_start date,
 add column details jsonb;

-- Full publication snapshots are private. Notifications contain aggregate counts,
-- never another employee's assignment or personal data.
create table public.schedule_publications (
 version_id uuid primary key references public.schedule_versions(id),
 snapshot jsonb not null,
 published_at timestamptz not null default now()
);
alter table public.schedule_publications enable row level security;
revoke all on public.schedule_publications from public,anon,authenticated;

create function public.schedule_snapshot(vid uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'department_id',a.department_id,
  'site_id',a.site_id,'role_id',a.role_id,'employee_id',a.employee_id,
  'starts_at',a.starts_at,'ends_at',a.ends_at) order by a.id),'[]'::jsonb)
 from shift_assignments a where a.version_id=vid
$$;
create function public.publication_details(before_snapshot jsonb, after_snapshot jsonb) returns jsonb
language sql immutable set search_path=public as $$
 select jsonb_build_object(
  'total_count',jsonb_array_length(after_snapshot),
  'open_count',(select count(*) from jsonb_array_elements(after_snapshot) a(value) where value->>'employee_id' is null),
  'added',(select count(*) from jsonb_array_elements(after_snapshot) a(value) where not exists(select 1 from jsonb_array_elements(before_snapshot) b(value) where b.value->>'id'=a.value->>'id')),
  'removed',(select count(*) from jsonb_array_elements(before_snapshot) b(value) where not exists(select 1 from jsonb_array_elements(after_snapshot) a(value) where a.value->>'id'=b.value->>'id')),
  'updated',(select count(*) from jsonb_array_elements(after_snapshot) a(value) join jsonb_array_elements(before_snapshot) b(value) on a.value->>'id'=b.value->>'id' where a.value<>b.value)
 )
$$;

-- Preserve the current published baseline and known historical publication dates.
insert into schedule_publications(version_id,snapshot,published_at)
 select v.id,schedule_snapshot(v.id),coalesce((select max(a.created_at) from audit_logs a
  where a.version_id=v.id and a.entity='schedule' and a.after_data->>'action'='publish'),now())
 from schedule_versions v where v.status='published';
insert into notifications(user_id,message,kind,version_id,department_id,week_start,details,created_at,read)
 select p.id,'סידור פורסם','schedule_published',v.id,v.department_id,v.week_start,
 publication_details('[]'::jsonb,pub.snapshot),a.created_at,true
 from schedule_versions v join schedule_publications pub on pub.version_id=v.id
 join lateral (select max(created_at) created_at from audit_logs
  where version_id=v.id and entity='schedule' and after_data->>'action'='publish') a on a.created_at is not null
 cross join profiles p where v.status='published' and (p.role='admin'
  or (p.role='manager' and exists(select 1 from manager_departments m where m.user_id=p.id and m.department_id=v.department_id))
  or exists(select 1 from employees e join employee_departments ed on ed.employee_id=e.id where e.user_id=p.id and ed.department_id=v.department_id));

create function public.notify_schedule_publication() returns trigger
language plpgsql security definer set search_path=public as $$
declare before_snapshot jsonb; after_snapshot jsonb; notice_kind text; summary jsonb; begin
 if new.status=old.status then return new; end if;
 if new.status<>'published' and old.status<>'published' then return new; end if;
 select snapshot into before_snapshot from schedule_publications where version_id=new.id;
 after_snapshot := schedule_snapshot(new.id);
 summary := publication_details(coalesce(before_snapshot,'[]'::jsonb),after_snapshot);
 if new.status='published' then
  notice_kind := case when before_snapshot is not null and before_snapshot<>after_snapshot then 'schedule_changed' else 'schedule_published' end;
  insert into schedule_publications(version_id,snapshot,published_at) values(new.id,after_snapshot,now())
   on conflict(version_id) do update set snapshot=excluded.snapshot,published_at=excluded.published_at;
 else
  notice_kind := 'schedule_withdrawn';
  summary := summary||jsonb_build_object('reason',case when new.status='archived' then 'archived' else 'reopened' end);
 end if;
 insert into notifications(user_id,message,kind,version_id,department_id,week_start,details)
 select p.id,case when notice_kind='schedule_published' then 'סידור פורסם' else 'שינוי בסידור שפורסם' end,
  notice_kind,new.id,new.department_id,new.week_start,summary from profiles p
 where p.role='admin'
  or (p.role='manager' and exists(select 1 from manager_departments m where m.user_id=p.id and m.department_id=new.department_id))
  or exists(select 1 from employees e join employee_departments ed on ed.employee_id=e.id where e.user_id=p.id and ed.department_id=new.department_id);
 return new;
end $$;
create trigger schedule_publication_notice after update of status on public.schedule_versions
 for each row execute function public.notify_schedule_publication();

-- Draft edits remain in the activity log, outside the notification feed.
create or replace function public.confirm_change(rid uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r change_requests; v schedule_versions; result jsonb; begin
 perform pg_advisory_xact_lock(782641);
 select * into strict r from change_requests where id=rid and user_id=auth.uid() for update;
 if r.status<>'pending' or r.expires_at<now() then raise exception 'הבקשה בוטלה, אושרה או פגה'; end if;
 select * into strict v from schedule_versions where id=r.version_id for update;
 if v.revision<>r.revision or v.status<>'draft' then raise exception 'הסידור השתנה. צור תצוגה מקדימה חדשה'; end if;
 result:=apply_operations(r.version_id,r.operations);
 update schedule_versions set revision=revision+1 where id=v.id;
 update change_requests set status='confirmed' where id=rid;
 return result;
end $$;
create or replace function public.department_schedule_action(week date, action text, department uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare v schedule_versions; target_status text; begin
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
  target_status := case when action='publish' then 'published' else 'draft' end;
  if v.status=target_status then return v.id; end if;
  if action='publish' then perform validate_schedule(v.id); end if;
  update schedule_versions set status=target_status,revision=revision+1 where id=v.id;
  update change_requests set status='cancelled' where version_id=v.id and status='pending';
  insert into audit_logs(actor_id,version_id,department_id,entity,entity_id,before_data,after_data)
  values(auth.uid(),v.id,department,'schedule',v.id,to_jsonb(v),jsonb_build_object('action',action));
 else raise exception 'פעולה לא נתמכת'; end if;
 return v.id;
end $$;
revoke all on function public.schedule_snapshot(uuid),public.publication_details(jsonb,jsonb),public.notify_schedule_publication() from public,anon,authenticated;
commit;
