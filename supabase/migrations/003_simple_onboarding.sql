-- Atomic employee + qualification creation. No half-created employee on failure.
create function public.save_employee(data jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare eid uuid; dep uuid; rid uuid; oldrow jsonb; begin
 if not is_admin() then raise exception 'נדרשת הרשאת מנהל ראשי'; end if;
 eid:=coalesce((data->>'id')::uuid,gen_random_uuid());
 dep:=(data->>'department_id')::uuid; rid:=(data->>'role_id')::uuid;
 if (dep is null) <> (rid is null) then raise exception 'יש לבחור מחלקה ותפקיד יחד'; end if;
 if dep is not null and not exists(select 1 from roles where id=rid and department_id=dep) then raise exception 'התפקיד אינו שייך למחלקה שנבחרה'; end if;
 if nullif(trim(data->>'name'),'') is null then raise exception 'יש להזין שם עובד'; end if;
 if not exists(select 1 from employees where id=eid) and dep is null then raise exception 'יש לבחור מחלקה ותפקיד לעובד החדש'; end if;
 select to_jsonb(e) into oldrow from employees e where id=eid;
 insert into employees(id,name,active,user_id) values(eid,trim(data->>'name'),coalesce((data->>'active')::boolean,true),(data->>'user_id')::uuid)
 on conflict(id) do update set name=excluded.name,active=excluded.active,user_id=excluded.user_id;
 if dep is not null then insert into employee_departments values(eid,dep,rid) on conflict do nothing; end if;
 insert into audit_logs(actor_id,entity,entity_id,before_data,after_data) values(auth.uid(),'employee',eid,oldrow,(select to_jsonb(e) from employees e where id=eid));
 return eid;
end $$;
create function public.initialize_workspace(site_name text) returns void
language plpgsql security definer set search_path=public as $$
declare d record; begin
 if not is_admin() then raise exception 'נדרשת הרשאת מנהל ראשי'; end if;
 if nullif(trim(site_name),'') is null or length(site_name)>100 then raise exception 'יש להזין שם אתר תקין'; end if;
 perform pg_advisory_xact_lock(782641);
 insert into sites(name) values(trim(site_name)) on conflict(name) do nothing;
 insert into departments(name,color) values('אחמ״שים','#8b73d4'),('סיירים','#4fa69d'),('קבלה','#6b96d7'),('חניונים','#d5a55e') on conflict(name) do nothing;
 for d in select id,name from departments where name in ('אחמ״שים','סיירים','קבלה','חניונים') loop
  insert into roles(department_id,name) values(d.id,d.name) on conflict do nothing;
 end loop;
 insert into audit_logs(actor_id,entity,after_data) values(auth.uid(),'workspace',jsonb_build_object('site_name',trim(site_name),'action','initialize'));
end $$;
revoke all on function public.save_employee(jsonb),public.initialize_workspace(text) from public,anon;
grant execute on function public.save_employee(jsonb),public.initialize_workspace(text) to authenticated;
