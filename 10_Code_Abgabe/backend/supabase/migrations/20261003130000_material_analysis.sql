begin;

create table public.material_analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  request_id uuid not null,
  context jsonb not null,
  source_hash text not null,
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  lease_token uuid not null default gen_random_uuid(),
  lease_until timestamptz not null default now() + interval '100 seconds',
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array'),
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  error_code text,
  created_at timestamptz not null default now(),
  unique (owner_id, request_id),
  check ((status = 'failed') = (error_code is not null))
);
create index material_analyses_owner_created on public.material_analyses(owner_id,created_at);
alter table public.material_analyses enable row level security;
revoke all on public.material_analyses from public, anon, authenticated;
grant all on public.material_analyses to service_role;

-- Keep receipts after a calendar event is deleted: retry must not recreate it.
create table public.material_analysis_decisions (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  item_id text not null,
  status text not null check (status in ('accepted','dismissed')),
  calendar_event_id uuid,
  created_at timestamptz not null default now(),
  primary key (owner_id,material_id,item_id),
  check ((status='accepted') = (calendar_event_id is not null))
);
alter table public.material_analysis_decisions enable row level security;
revoke all on public.material_analysis_decisions from public, anon, authenticated;
grant all on public.material_analysis_decisions to service_role;

create function public.read_material_analysis(p_owner_id uuid, p_analysis_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.material_analyses;
begin
  update public.material_analyses set status='failed',error_code='ANALYSIS_TIMEOUT'
    where id=p_analysis_id and owner_id=p_owner_id and status='processing' and lease_until<=now();
  select x.* into a from public.material_analyses x
    join public.materials m on m.id=x.material_id join public.courses c on c.id=m.course_id
    where x.id=p_analysis_id and x.owner_id=p_owner_id and c.owner_id=p_owner_id;
  if not found then raise exception 'ANALYSIS_NOT_FOUND'; end if;
  return jsonb_build_object('schema_version','1.0','analysis_id',a.id,'material_id',a.material_id,
    'status',a.status,'items',a.items,'warnings',a.warnings,'error_code',a.error_code,
    'decisions',coalesce((select jsonb_agg(jsonb_build_object('item_id',d.item_id,'status',d.status,'calendar_event_id',d.calendar_event_id) order by d.created_at)
      from public.material_analysis_decisions d where d.owner_id=p_owner_id and d.material_id=a.material_id
      and exists(select 1 from jsonb_array_elements(a.items) i where i->>'id'=d.item_id)),'[]'::jsonb));
end;
$$;

create function public.begin_material_analysis(p_owner_id uuid,p_request_id uuid,p_material_id uuid,p_context jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.material_analyses; source public.source_documents; fingerprint text;
begin
  if p_owner_id is null or p_request_id is null or p_material_id is null or p_context is null
    or jsonb_typeof(p_context)<>'object' then raise exception 'INVALID_REQUEST'; end if;
  -- Serialize reservations per owner, including parallel HTTP retries.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,431));
  select d.* into source from public.source_documents d
    join public.materials m on m.id=d.material_id join public.courses c on c.id=m.course_id
    join public.files f on f.id=m.file_id
    where m.id=p_material_id and c.owner_id=p_owner_id and f.status='ready';
  if not found then raise exception 'TARGET_NOT_FOUND'; end if;
  if source.processing_status<>'ready' or nullif(btrim(source.extracted_text),'') is null then raise exception 'SOURCES_NOT_READY'; end if;
  if length(source.extracted_text)>60000 or length(coalesce(source.pages::text,''))>120000 then raise exception 'SOURCE_LIMIT_EXCEEDED'; end if;
  fingerprint := md5(jsonb_build_array(source.extracted_text,source.pages)::text);
  select * into a from public.material_analyses where owner_id=p_owner_id and request_id=p_request_id;
  if found then
    if a.material_id<>p_material_id or a.context<>p_context then raise exception 'REQUEST_CONFLICT'; end if;
    if a.source_hash<>fingerprint then raise exception 'SOURCE_CHANGED'; end if;
    return jsonb_build_object('run',false,'result',public.read_material_analysis(p_owner_id,a.id));
  end if;
  update public.material_analyses set status='failed',error_code='ANALYSIS_TIMEOUT'
    where owner_id=p_owner_id and status='processing' and lease_until<=now();
  if (select count(*) from public.material_analyses where owner_id=p_owner_id and created_at>now()-interval '1 minute')>=6
    or exists(select 1 from public.material_analyses where owner_id=p_owner_id and status='processing')
    then raise exception 'ANALYSIS_RATE_LIMITED'; end if;
  insert into public.material_analyses(owner_id,request_id,material_id,context,source_hash)
    values(p_owner_id,p_request_id,p_material_id,p_context,fingerprint) returning * into a;
  return jsonb_build_object('run',true,'analysis_id',a.id,'lease_token',a.lease_token,
    'source',jsonb_build_object('text',source.extracted_text,'pages',source.pages));
end;
$$;

create function public.finish_material_analysis(p_owner_id uuid,p_analysis_id uuid,p_lease_token uuid,p_items jsonb,p_warnings jsonb,p_error text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.material_analyses; fingerprint text;
begin
  select * into a from public.material_analyses where id=p_analysis_id and owner_id=p_owner_id for update;
  if not found then raise exception 'ANALYSIS_NOT_FOUND'; end if;
  if a.status<>'processing' or a.lease_token<>p_lease_token or p_lease_token is null or a.lease_until<=now() then raise exception 'ANALYSIS_EXPIRED'; end if;
  select md5(jsonb_build_array(d.extracted_text,d.pages)::text) into fingerprint from public.source_documents d
    join public.materials m on m.id=d.material_id join public.courses c on c.id=m.course_id join public.files f on f.id=m.file_id
    where m.id=a.material_id and c.owner_id=p_owner_id and f.status='ready' and d.processing_status='ready';
  if fingerprint is distinct from a.source_hash then p_error := 'SOURCE_CHANGED'; end if;
  if p_error is null and (p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>50
    or p_warnings is null or jsonb_typeof(p_warnings)<>'array') then raise exception 'INVALID_REQUEST'; end if;
  update public.material_analyses set status=case when p_error is null then 'completed' else 'failed' end,
    items=case when p_error is null then p_items else '[]'::jsonb end,
    warnings=case when p_error is null then p_warnings else '[]'::jsonb end,error_code=p_error where id=a.id;
  return public.read_material_analysis(p_owner_id,a.id);
end;
$$;

create function public.decide_material_analysis(p_owner_id uuid,p_analysis_id uuid,p_item_id text,p_action text,p_event jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.material_analyses; decision public.material_analysis_decisions; item jsonb; cid uuid; eid uuid;
begin
  if p_action is null or p_action not in ('accept','dismiss') or p_item_id is null then raise exception 'INVALID_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,431));
  select x.* into a from public.material_analyses x join public.materials m on m.id=x.material_id
    join public.courses c on c.id=m.course_id
    where x.id=p_analysis_id and x.owner_id=p_owner_id and c.owner_id=p_owner_id;
  if not found then raise exception 'ANALYSIS_NOT_FOUND'; end if;
  if a.status<>'completed' then raise exception 'ANALYSIS_NOT_READY'; end if;
  select i into item from jsonb_array_elements(a.items) i where i->>'id'=p_item_id;
  if item is null or item->>'type'<>'calendar_entry' then raise exception 'ITEM_NOT_FOUND'; end if;
  select * into decision from public.material_analysis_decisions
    where owner_id=p_owner_id and material_id=a.material_id and item_id=p_item_id;
  if found then
    if (p_action='accept')<>(decision.status='accepted') then raise exception 'DECISION_CONFLICT'; end if;
    return jsonb_build_object('item_id',p_item_id,'status',decision.status,'calendar_event_id',decision.calendar_event_id);
  end if;
  if p_action='accept' then
    if p_event is null or jsonb_typeof(p_event)<>'object'
      or not (p_event ?& array['title','description','kind','starts_at','ends_at','all_day'])
      or jsonb_typeof(p_event->'title')<>'string' or length(btrim(p_event->>'title')) not between 1 and 200
      or jsonb_typeof(p_event->'description') not in ('null','string') or length(p_event->>'description')>2000
      or jsonb_typeof(p_event->'all_day')<>'boolean'
      or coalesce(p_event->>'kind','') not in ('lecture','exercise','study','presentation','exam','deadline','other')
      or coalesce(p_event->>'starts_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$'
      or (p_event->>'ends_at' is not null and p_event->>'ends_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$')
      then raise exception 'INVALID_REQUEST'; end if;
    select course_id into cid from public.materials where id=a.material_id;
    insert into public.calendar_events(owner_id,course_id,title,description,kind,starts_at,ends_at,all_day)
      values(p_owner_id,cid,btrim(p_event->>'title'),p_event->>'description',p_event->>'kind',
        (p_event->>'starts_at')::timestamptz,(p_event->>'ends_at')::timestamptz,(p_event->>'all_day')::boolean)
      returning id into eid;
  end if;
  insert into public.material_analysis_decisions(owner_id,material_id,item_id,status,calendar_event_id)
    values(p_owner_id,a.material_id,p_item_id,case when p_action='accept' then 'accepted' else 'dismissed' end,eid);
  return jsonb_build_object('item_id',p_item_id,'status',case when p_action='accept' then 'accepted' else 'dismissed' end,'calendar_event_id',eid);
end;
$$;

revoke all on function public.read_material_analysis(uuid,uuid),public.begin_material_analysis(uuid,uuid,uuid,jsonb),
  public.finish_material_analysis(uuid,uuid,uuid,jsonb,jsonb,text),public.decide_material_analysis(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.read_material_analysis(uuid,uuid),public.begin_material_analysis(uuid,uuid,uuid,jsonb),
  public.finish_material_analysis(uuid,uuid,uuid,jsonb,jsonb,text),public.decide_material_analysis(uuid,uuid,text,text,jsonb) to service_role;
commit;
