begin;

-- A publication survives reopening. An explicit archive withdraws it, and
-- restoring an archive starts an unpublished draft until the next release.
alter table public.schedule_publications add column withdrawn_at timestamptz;
update public.schedule_publications p
set withdrawn_at = coalesce(v.archived_at, now())
from public.schedule_versions v
where v.id = p.version_id and (
  v.status = 'archived'
  or (v.status = 'draft' and coalesce((
    select a.after_data->>'action'
    from public.audit_logs a
    where a.version_id = v.id and a.entity = 'schedule'
    order by a.created_at desc, a.id
    limit 1
  ), '') <> 'reopen')
);

create function public.last_department_publication(target_department uuid, target_week date)
returns public.schedule_publications
language sql stable security definer set search_path = public as $$
  select p.*
  from schedule_publications p
  join schedule_versions v on v.id = p.version_id
  where v.department_id = target_department and v.week_start = target_week
  order by p.published_at desc, p.version_id
  limit 1
$$;

create or replace function public.notify_schedule_publication() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  previous schedule_publications;
  current_publication schedule_publications;
  after_snapshot jsonb;
  notice_kind text;
  summary jsonb;
begin
  if new.status = old.status then return new; end if;
  select * into current_publication from schedule_publications where version_id = new.id;

  if new.status = 'published' then
    after_snapshot := schedule_snapshot(new.id);
    if current_publication.version_id is not null
       and current_publication.withdrawn_at is null
       and current_publication.snapshot = after_snapshot then
      -- Closing an unchanged draft (including an undone weekly plan) leaves
      -- the already-visible publication and its notifications alone.
      return new;
    end if;
    previous := last_department_publication(new.department_id, new.week_start);
    notice_kind := case
      when previous.version_id is not null and previous.snapshot <> after_snapshot
        then 'schedule_changed'
      else 'schedule_published'
    end;
    summary := publication_details(coalesce(previous.snapshot, '[]'::jsonb), after_snapshot);
    insert into schedule_publications(version_id, snapshot, published_at, withdrawn_at)
    values(new.id, after_snapshot, clock_timestamp(), null)
    on conflict(version_id) do update
      set snapshot = excluded.snapshot, published_at = excluded.published_at, withdrawn_at = null;
  elsif new.status = 'archived'
        and current_publication.version_id is not null
        and current_publication.withdrawn_at is null then
    update schedule_publications set withdrawn_at = now() where version_id = new.id;
    notice_kind := 'schedule_withdrawn';
    summary := publication_details(current_publication.snapshot, '[]'::jsonb)
      || jsonb_build_object('reason', 'archived');
  else
    return new;
  end if;

  insert into notifications(user_id, message, kind, version_id, department_id, week_start, details)
  select p.id,
    case when notice_kind = 'schedule_published' then 'סידור פורסם' else 'שינוי בסידור שפורסם' end,
    notice_kind, new.id, new.department_id, new.week_start, summary
  from profiles p
  where p.role = 'admin'
     or (p.role = 'manager' and exists (
       select 1 from manager_departments m where m.user_id = p.id and m.department_id = new.department_id
     ))
     or exists (
       select 1 from employees e join employee_departments ed on ed.employee_id = e.id
       where e.user_id = p.id and ed.department_id = new.department_id
     );
  return new;
end
$$;

create function public.read_personal_schedule() returns jsonb
language sql stable security definer set search_path = public as $$
  with employee as (
    select id from employees where user_id = auth.uid()
  ), visible as (
    select v.id, v.week_start, v.department_id, p.snapshot, e.id as employee_id
    from employee e
    join schedule_versions v on exists (
      select 1 from employee_departments ed
      where ed.employee_id = e.id and ed.department_id = v.department_id
    )
    join schedule_publications p on p.version_id = v.id and p.withdrawn_at is null
    where v.status <> 'archived'
  )
  select jsonb_build_object(
    'schedule_versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'week_start', week_start, 'department_id', department_id, 'status', 'published'
      ) order by week_start, department_id) from visible
    ), '[]'::jsonb),
    'shift_assignments', coalesce((
      select jsonb_agg(a.value || jsonb_build_object('version_id', v.id)
        order by a.value->>'starts_at', a.value->>'id')
      from visible v cross join lateral jsonb_array_elements(v.snapshot) a(value)
      where a.value->>'employee_id' = v.employee_id::text
    ), '[]'::jsonb)
  )
$$;

-- Working drafts are validated together by validate_schedule. A release must
-- also account for other departments' previously published, still-visible
-- assignments when those departments are outside this release.
create function public.validate_weekly_publication(vid uuid, selected_versions uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare rest_hours numeric;
begin
  perform validate_schedule(vid);
  select min_rest_hours into strict rest_hours from settings;
  if exists (
    select 1
    from shift_assignments draft
    join schedule_versions draft_version on draft_version.id = draft.version_id
    join schedule_versions other
      on other.status = 'draft' and other.id <> all(selected_versions)
     and (other.week_start - draft_version.week_start) between
       -(7 + ceil(rest_hours / 24)::integer) and (7 + ceil(rest_hours / 24)::integer)
    join schedule_publications publication
      on publication.version_id = other.id and publication.withdrawn_at is null
    cross join lateral jsonb_to_recordset(publication.snapshot)
      as snapshot(employee_id uuid, starts_at timestamptz, ends_at timestamptz)
    where draft.version_id = vid and draft.employee_id = snapshot.employee_id
      and snapshot.starts_at < draft.ends_at + make_interval(secs => rest_hours::double precision * 3600)
      and snapshot.ends_at > draft.starts_at - make_interval(secs => rest_hours::double precision * 3600)
  ) then
    raise exception 'שיבוץ מתנגש עם סידור אחר שעדיין מוצג לעובדים. בדקו אם צריך לפרסם גם את העדכון למחלקה השנייה';
  end if;
end
$$;

create function public.assert_weekly_targets(week date, targets jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'נדרשת התחברות'; end if;
  if week is null or extract(dow from week) <> 0 then raise exception 'יש לבחור תחילת שבוע תקינה'; end if;
  if jsonb_typeof(targets) is distinct from 'array' or jsonb_array_length(targets) = 0 then
    raise exception 'יש לבחור מחלקה אחת לפחות';
  end if;
  if (select count(distinct (value->>'department_id')::uuid) from jsonb_array_elements(targets))
      <> jsonb_array_length(targets) then
    raise exception 'יש לבחור כל מחלקה פעם אחת';
  end if;
end
$$;

create function public.set_department_schedule_status(version schedule_versions, target_status text)
returns schedule_versions
language plpgsql security definer set search_path = public as $$
declare
  changed schedule_versions;
  event text := case when target_status = 'published' then 'publish' else 'reopen' end;
begin
  update schedule_versions set status = target_status, revision = revision + 1
  where id = version.id returning * into changed;
  update change_requests set status = 'cancelled' where version_id = version.id and status = 'pending';
  if version.status <> target_status then
    insert into audit_logs(actor_id, version_id, department_id, entity, entity_id, before_data, after_data)
    values(auth.uid(), version.id, version.department_id, 'schedule', version.id, to_jsonb(version),
      jsonb_build_object('action', event));
  end if;
  return changed;
end
$$;

-- Legacy single-department clients follow the same visibility and validation
-- rules. The reviewed path below additionally checks expected revisions.
create or replace function public.department_schedule_action(week date, action text, department uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  version schedule_versions;
  target_status text;
begin
  if not coalesce(can_manage(department), false) then raise exception 'אין הרשאה למחלקה'; end if;
  if not exists(select 1 from departments where id = department and active) then raise exception 'המחלקה מושבתת'; end if;
  perform pg_advisory_xact_lock(782641);
  select * into version from schedule_versions
  where week_start = week and department_id = department and status <> 'archived' for update;

  if action = 'create' then
    if version.id is null then
      insert into schedule_versions(week_start, department_id, created_by)
      values(week, department, auth.uid()) returning * into version;
    end if;
  elsif action in ('publish', 'reopen') then
    if version.id is null then raise exception 'יש ליצור סידור למחלקה תחילה'; end if;
    target_status := case when action = 'publish' then 'published' else 'draft' end;
    if version.status <> target_status then
      if action = 'publish' then perform validate_weekly_publication(version.id, array[version.id]); end if;
      version := set_department_schedule_status(version, target_status);
    end if;
  else
    raise exception 'פעולה לא נתמכת';
  end if;
  return version.id;
end
$$;

create function public.apply_weekly_draft_changes(week date, targets jsonb, undo boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  target jsonb;
  target_department uuid;
  version schedule_versions;
  operations jsonb;
  changes jsonb;
  restore_published boolean;
  results jsonb := '[]'::jsonb;
begin
  perform assert_weekly_targets(week, targets);
  perform pg_advisory_xact_lock(782641);

  for target in select value from jsonb_array_elements(targets) order by value->>'department_id' loop
    target_department := (target->>'department_id')::uuid;
    if not coalesce(can_manage(target_department), false) then raise exception 'אין הרשאה למחלקה'; end if;
    if not exists(select 1 from departments where id = target_department and active) then raise exception 'המחלקה מושבתת'; end if;
    select * into version from schedule_versions
    where week_start = week and department_id = target_department and status <> 'archived' for update;
    if version.id is distinct from (target->>'version_id')::uuid
       or coalesce(version.revision, 0) is distinct from (target->>'revision')::integer
       or version.status is distinct from (case when undo then 'draft' else target->>'status' end) then
      raise exception 'הסידור השתנה. חשבו הצעה חדשה ונסו שוב';
    end if;
    if version.id is null then
      if exists (
        select 1 from schedule_versions
        where week_start = week and department_id = target_department and status = 'archived'
      ) then
        raise exception 'הסידור נמצא בסל המחזור. אפשר לשחזר אותו ממסך המחלקה';
      end if;
      insert into schedule_versions(week_start, department_id, created_by)
      values(week, target_department, auth.uid()) returning * into version;
    end if;

    operations := target->'operations';
    if jsonb_typeof(operations) is distinct from 'array' or jsonb_array_length(operations) = 0 then
      raise exception 'לא נמצאו משמרות לעדכון';
    end if;
    if exists (
      select 1 from jsonb_array_elements(operations) op(value)
      where not coalesce(
        case
          when not undo and op.value->>'kind' = 'create' then
            (op.value->>'department_id')::uuid = target_department
          when undo and op.value->>'kind' = 'delete' then
            exists (select 1 from shift_assignments a where a.version_id = version.id and a.id = (op.value->>'id')::uuid)
          when op.value->>'kind' = 'update' then exists (
            select 1 from shift_assignments a
            where a.version_id = version.id and a.id = (op.value->>'id')::uuid
              and a.department_id = (op.value->>'department_id')::uuid
              and a.site_id = (op.value->>'site_id')::uuid and a.role_id = (op.value->>'role_id')::uuid
              and a.starts_at = (op.value->>'starts_at')::timestamptz
              and a.ends_at = (op.value->>'ends_at')::timestamptz
              and (case when undo then a.employee_id is not null and op.value->>'employee_id' is null
                        else a.employee_id is null and op.value->>'employee_id' is not null end)
          )
          else false
        end, false)
    ) then
      raise exception 'התכנון השבועי יכול להוסיף משמרות ולמלא משמרות פנויות בלבד';
    end if;
    if exists (
      select 1 from jsonb_array_elements(operations) op(value)
      where op.value->>'kind' in ('update', 'delete')
      group by (op.value->>'id')::uuid having count(*) > 1
    ) then
      raise exception 'נמצאה יותר מפעולה אחת לאותה משמרת';
    end if;

    changes := apply_operations(version.id, operations);
    restore_published := undo and coalesce((target->>'restore_published')::boolean, false);
    if restore_published and not exists (
      select 1 from schedule_publications p
      where p.version_id = version.id and p.withdrawn_at is null and p.snapshot = schedule_snapshot(version.id)
    ) then
      raise exception 'לא ניתן לשחזר את הגרסה שפורסמה';
    end if;
    version := set_department_schedule_status(version, case when restore_published then 'published' else 'draft' end);
    results := results || jsonb_build_array(jsonb_build_object(
      'department_id', target_department, 'version_id', version.id,
      'revision', version.revision, 'changes', changes
    ));
  end loop;
  return results;
end
$$;

create function public.apply_weekly_plan(week date, targets jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select public.apply_weekly_draft_changes(week, targets, false)
$$;
create function public.undo_weekly_plan(week date, targets jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select public.apply_weekly_draft_changes(week, targets, true)
$$;

create function public.review_weekly_publication(week date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  version schedule_versions;
  previous schedule_publications;
  draft_snapshot jsonb;
  changes jsonb;
  blocker text;
  selected_versions uuid[];
  results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'נדרשת התחברות'; end if;
  if week is null or extract(dow from week) <> 0 then raise exception 'יש לבחור תחילת שבוע תקינה'; end if;
  select coalesce(array_agg(v.id), array[]::uuid[]) into selected_versions
  from schedule_versions v join departments d on d.id = v.department_id
  where v.week_start = week and v.status = 'draft' and d.active and can_manage(d.id)
    and (exists (select 1 from shift_assignments where version_id = v.id)
      or (last_department_publication(v.department_id, week)).version_id is not null);

  for version in select * from schedule_versions where id = any(selected_versions) order by department_id loop
    previous := last_department_publication(version.department_id, week);
    draft_snapshot := schedule_snapshot(version.id);
    select coalesce(jsonb_agg(jsonb_build_object(
      'before', case when b.value is not null then b.value || jsonb_build_object('version_id', previous.version_id) end,
      'after', case when a.value is not null then a.value || jsonb_build_object('version_id', version.id) end
    ) order by coalesce(a.value->>'starts_at', b.value->>'starts_at'),
      coalesce(a.value->>'id', b.value->>'id')), '[]'::jsonb)
    into changes
    from jsonb_array_elements(draft_snapshot) a(value)
    full join jsonb_array_elements(coalesce(previous.snapshot, '[]'::jsonb)) b(value)
      on a.value->>'id' = b.value->>'id'
    where a.value is distinct from b.value;

    blocker := null;
    begin
      perform validate_weekly_publication(version.id, selected_versions);
    exception when raise_exception then
      blocker := sqlerrm;
    end;
    results := results || jsonb_build_array(jsonb_build_object(
      'department_id', version.department_id, 'version_id', version.id, 'revision', version.revision,
      'first_publication', previous.version_id is null,
      'open_count', (select count(*) from jsonb_array_elements(draft_snapshot) where value->>'employee_id' is null),
      'changes', changes, 'error', blocker
    ));
  end loop;
  return results;
end
$$;

create function public.publish_weekly_schedule(week date, targets jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  target jsonb;
  target_department uuid;
  publishing_version_id uuid;
  version schedule_versions;
  selected_versions uuid[] := array[]::uuid[];
  results jsonb := '[]'::jsonb;
begin
  perform assert_weekly_targets(week, targets);
  perform pg_advisory_xact_lock(782641);
  for target in select value from jsonb_array_elements(targets) order by value->>'department_id' loop
    target_department := (target->>'department_id')::uuid;
    if not coalesce(can_manage(target_department), false) then raise exception 'אין הרשאה למחלקה'; end if;
    if not exists(select 1 from departments where id = target_department and active) then raise exception 'המחלקה מושבתת'; end if;
    select * into version from schedule_versions
    where week_start = week and department_id = target_department and status = 'draft' for update;
    if version.id is null or version.id is distinct from (target->>'version_id')::uuid
       or version.revision is distinct from (target->>'revision')::integer then
      raise exception 'הסידור השתנה. עברו שוב על השינויים לפני הפרסום';
    end if;
    if not exists (select 1 from shift_assignments where version_id = version.id)
       and (last_department_publication(target_department, week)).version_id is null then
      raise exception 'יש להוסיף משמרות לפני פרסום ראשון';
    end if;
    selected_versions := array_append(selected_versions, version.id);
  end loop;

  foreach publishing_version_id in array selected_versions loop
    perform validate_weekly_publication(publishing_version_id, selected_versions);
  end loop;
  for version in select * from schedule_versions where id = any(selected_versions) order by department_id loop
    version := set_department_schedule_status(version, 'published');
    results := results || jsonb_build_array(jsonb_build_object(
      'department_id', version.department_id, 'version_id', version.id, 'revision', version.revision
    ));
  end loop;
  return results;
end
$$;

revoke all on function
  public.last_department_publication(uuid, date), public.validate_weekly_publication(uuid, uuid[]),
  public.assert_weekly_targets(date, jsonb), public.set_department_schedule_status(schedule_versions, text),
  public.apply_weekly_draft_changes(date, jsonb, boolean)
from public, anon, authenticated;
revoke all on function
  public.read_personal_schedule(), public.apply_weekly_plan(date, jsonb), public.undo_weekly_plan(date, jsonb),
  public.review_weekly_publication(date), public.publish_weekly_schedule(date, jsonb)
from public, anon;
grant execute on function
  public.read_personal_schedule(), public.apply_weekly_plan(date, jsonb), public.undo_weekly_plan(date, jsonb),
  public.review_weekly_publication(date), public.publish_weekly_schedule(date, jsonb)
to authenticated;

commit;
