-- Optional fictional demonstration structure only. No real personnel.
-- Run after migrations as a database administrator, once.
insert into public.departments(name,color) values ('אחמ״שים','#8b73d4'),('סיירים','#4fa69d'),('קבלה','#6b96d7'),('חניונים','#d5a55e') on conflict(name) do nothing;
insert into public.sites(name) values('אתר הדגמה — פיקטיבי') on conflict(name) do nothing;
insert into public.roles(department_id,name) select id,'תפקיד הדגמה — '||name from public.departments on conflict do nothing;
insert into public.shift_templates(department_id,name,start_time,end_time,confirmed)
select d.id,t.name,t.start_time::time,t.end_time::time,true from public.departments d cross join (values('בוקר','07:00','15:00'),('ערב','15:00','23:00'),('לילה','23:00','07:00'),('יום ארוך','07:00','19:00'),('לילה ארוך','19:00','07:00'),('יום','07:00','17:00'),('ערב קצר','17:00','22:00')) t(name,start_time,end_time) where d.name<>'חניונים' and not exists(select 1 from public.shift_templates s where s.department_id=d.id and s.name=t.name);
insert into public.shift_templates(department_id,name,start_time,end_time,confirmed) select id,'בוקר חניונים — טעון אימות','08:00','18:00',false from public.departments d where name='חניונים' and not exists(select 1 from public.shift_templates s where s.department_id=d.id and s.name='בוקר חניונים — טעון אימות');
insert into public.shift_templates(department_id,name,start_time,end_time,confirmed) select id,'ערב חניונים — סיום לא ידוע','18:00',null,false from public.departments d where name='חניונים' and not exists(select 1 from public.shift_templates s where s.department_id=d.id and s.name='ערב חניונים — סיום לא ידוע');
