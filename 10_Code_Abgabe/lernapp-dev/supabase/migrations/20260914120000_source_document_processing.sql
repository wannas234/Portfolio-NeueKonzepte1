begin;

-- Preserve existing source materials. Ambiguous legacy duplicates require review.
create unique index materials_source_file_unique on public.materials(file_id)
  where type = 'source_document' and file_id is not null;

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null unique references public.materials(id) on delete cascade,
  material_type text generated always as ('source_document'::text) stored,
  foreign key (material_id, material_type) references public.materials(id, type) on delete cascade,
  processing_status text not null default 'uploaded'
    check (processing_status in ('uploaded', 'processing', 'ready', 'failed')),
  page_count integer check (page_count > 0),
  extracted_text text,
  pages jsonb,
  error_code text check (error_code in ('PROCESSING_FAILED', 'PROCESSING_TIMEOUT', 'SOURCE_DELETED', 'UNSUPPORTED_FORMAT', 'INVALID_DOCUMENT')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((processing_status = 'failed') = (error_code is not null)),
  check ((processing_status in ('ready', 'failed')) = (completed_at is not null)),
  check (processing_status <> 'ready' or extracted_text is not null),
  check (processing_status = 'ready' or (extracted_text is null and pages is null and page_count is null))
);
create trigger source_documents_updated before update on public.source_documents
  for each row execute function public.set_updated_at();
alter table public.source_documents enable row level security;
revoke all on public.source_documents from public, anon, authenticated;
grant select on public.source_documents to authenticated;
grant all on public.source_documents to service_role;
create policy source_documents_select_owned on public.source_documents for select to authenticated
  using (exists (select 1 from public.materials m where m.id = material_id));

-- A durable queue, consumed by the processor added in #30. No dummy worker.
create table public.document_processing_jobs (
  document_id uuid primary key references public.source_documents(id) on delete cascade,
  file_id uuid not null unique references public.files(id) on delete cascade,
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  check ((lease_token is null) = (lease_until is null))
);
create index document_processing_due on public.document_processing_jobs(available_at);
alter table public.document_processing_jobs enable row level security;
revoke all on public.document_processing_jobs from public, anon, authenticated;
grant all on public.document_processing_jobs to service_role;

-- Source creation belongs to complete; titles/descriptions remain editable.
create policy materials_source_insert_server on public.materials as restrictive
  for insert to authenticated with check (type <> 'source_document');
create function public.guard_source_material() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.type = 'source_document' and exists (select 1 from public.source_documents where material_id = old.id) then
    if new.course_id is distinct from old.course_id or new.created_by is distinct from old.created_by
      or (new.file_id is distinct from old.file_id and
        (new.file_id is not null or exists (select 1 from public.files where id = old.file_id))) then
      raise exception 'SOURCE_LINK_IMMUTABLE' using errcode = '23514';
    end if;
    if old.file_id is not null and new.file_id is null then
      update public.source_documents set processing_status = 'failed', error_code = 'SOURCE_DELETED',
        completed_at = now() where material_id = old.id and processing_status <> 'ready';
    end if;
  end if;
  return new;
end;
$$;
create trigger materials_guard_source before update on public.materials
  for each row execute function public.guard_source_material();

-- Called only after the Edge Function has checked the actual stored bytes.
-- File readiness, material creation and queue insertion commit together.
create function public.complete_file_upload(p_file_id uuid, p_owner_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.files; m public.materials; d public.source_documents;
begin
  select * into f from public.files where id = p_file_id and uploaded_by = p_owner_id for update;
  if not found or not exists (select 1 from public.courses where id = f.course_id and owner_id = p_owner_id) then
    raise exception 'FILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if f.status not in ('pending', 'unverified', 'ready') then
    raise exception 'UPLOAD_NOT_PENDING' using errcode = '55000';
  end if;
  if f.storage_bucket <> 'learning-files' or public.file_extension(f.mime_type) is null
    or f.storage_path <> f.uploaded_by::text || '/' || f.course_id::text || '/' || f.id::text || '.' || public.file_extension(f.mime_type) then
    raise exception 'INVALID_FILE' using errcode = '22023';
  end if;
  if f.status <> 'ready' then
    update public.files set status = 'ready', error_code = null where id = f.id returning * into f;
  end if;
  select * into m from public.materials where file_id = f.id and type = 'source_document' for update;
  if not found then
    insert into public.materials(course_id, created_by, file_id, type, title)
      values (f.course_id, f.uploaded_by, f.id, 'source_document', f.original_filename) returning * into m;
  elsif m.course_id <> f.course_id or m.created_by <> f.uploaded_by then
    raise exception 'INVALID_SOURCE_MATERIAL' using errcode = '23514';
  end if;
  insert into public.source_documents(material_id) values (m.id) on conflict (material_id) do nothing;
  select * into d from public.source_documents where material_id = m.id;
  if d.processing_status = 'uploaded' then
    insert into public.document_processing_jobs(document_id, file_id) values (d.id, f.id)
      on conflict (document_id) do nothing;
  end if;
  return jsonb_build_object('file', to_jsonb(f), 'material_id', m.id,
    'source_document', jsonb_build_object('id', d.id, 'processing_status', d.processing_status, 'error_code', d.error_code));
end;
$$;

-- Lock source file, then material, document and job. Each claim handles one ID;
-- concurrent workers skip locked files and receive NULL instead of duplicate work.
create function public.claim_document_processing(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.files; m public.materials; d public.source_documents; j public.document_processing_jobs;
begin
  select f0.* into f from public.files f0 join public.document_processing_jobs j0 on j0.file_id = f0.id
    where j0.document_id = p_document_id and f0.status = 'ready' for update of f0 skip locked;
  if not found then return null; end if;
  select m0.* into m from public.materials m0 join public.source_documents d0 on d0.material_id = m0.id
    where d0.id = p_document_id and m0.file_id = f.id and m0.course_id = f.course_id
      and m0.created_by = f.uploaded_by for update of m0;
  if not found or not exists (select 1 from public.courses where id = m.course_id and owner_id = m.created_by) then return null; end if;
  select * into d from public.source_documents where id = p_document_id for update;
  select * into j from public.document_processing_jobs where document_id = d.id for update;
  if not found or d.processing_status not in ('uploaded', 'processing')
    or j.available_at > now() or j.lease_until > now() then return null; end if;
  if j.attempts >= 3 then
    update public.source_documents set processing_status = 'failed', error_code = 'PROCESSING_TIMEOUT', completed_at = now() where id = d.id;
    delete from public.document_processing_jobs where document_id = d.id;
    return null;
  end if;
  update public.document_processing_jobs set attempts = attempts + 1,
    lease_token = gen_random_uuid(), lease_until = now() + interval '5 minutes'
    where document_id = d.id returning * into j;
  update public.source_documents set processing_status = 'processing', started_at = now() where id = d.id;
  return jsonb_build_object('document_id', d.id, 'lease_token', j.lease_token,
    'lease_until', j.lease_until, 'attempt', j.attempts, 'file', to_jsonb(f));
end;
$$;

create function public.finish_document_processing(p_document_id uuid, p_lease_token uuid,
  p_text text default null, p_pages jsonb default null, p_error_code text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare f public.files; m public.materials; d public.source_documents; j public.document_processing_jobs;
begin
  select f0.* into f from public.files f0 join public.document_processing_jobs j0 on j0.file_id = f0.id
    where j0.document_id = p_document_id and f0.status = 'ready' for update of f0;
  if not found then return false; end if;
  select m0.* into m from public.materials m0 join public.source_documents d0 on d0.material_id = m0.id
    where d0.id = p_document_id and m0.file_id = f.id and m0.course_id = f.course_id
      and m0.created_by = f.uploaded_by for update of m0;
  if not found or not exists (select 1 from public.courses where id = m.course_id and owner_id = m.created_by) then return false; end if;
  select * into d from public.source_documents where id = p_document_id for update;
  select * into j from public.document_processing_jobs where document_id = d.id for update;
  if not found or d.processing_status <> 'processing' or p_lease_token is null
    or j.lease_token is distinct from p_lease_token or j.lease_until <= now() then return false; end if;
  if p_error_code is not null then
    if p_error_code not in ('PROCESSING_FAILED', 'UNSUPPORTED_FORMAT', 'INVALID_DOCUMENT') then
      raise exception 'INVALID_PROCESSING_RESULT' using errcode = '22023';
    end if;
    update public.source_documents set processing_status = 'failed', error_code = p_error_code,
      completed_at = now() where id = d.id;
  else
    if p_text is null or octet_length(p_text) > 10485760 then
      raise exception 'INVALID_PROCESSING_RESULT' using errcode = '22023';
    end if;
    if p_pages is not null then
      if jsonb_typeof(p_pages) <> 'array' or octet_length(p_pages::text) > 20971520 then
        raise exception 'INVALID_PROCESSING_RESULT' using errcode = '22023';
      end if;
      if jsonb_array_length(p_pages) not between 1 and 10000 or exists (
        select 1 from jsonb_array_elements(p_pages) with ordinality as p(value, n)
        where jsonb_typeof(value) <> 'object' or (value->'page') is distinct from to_jsonb(n)
          or jsonb_typeof(value->'text') is distinct from 'string'
      ) then raise exception 'INVALID_PROCESSING_RESULT' using errcode = '22023'; end if;
    end if;
    update public.source_documents set processing_status = 'ready', extracted_text = p_text,
      pages = p_pages, page_count = case when p_pages is null then null else jsonb_array_length(p_pages) end,
      error_code = null, completed_at = now() where id = d.id;
  end if;
  delete from public.document_processing_jobs where document_id = d.id;
  return true;
end;
$$;

create function public.retry_document_processing(p_document_id uuid) returns public.source_documents
language plpgsql security definer set search_path = '' as $$
declare f public.files; m public.materials; d public.source_documents; uid uuid := auth.uid();
begin
  select f0.* into f from public.files f0 join public.materials m0 on m0.file_id = f0.id
    join public.source_documents d0 on d0.material_id = m0.id
    where d0.id = p_document_id and f0.uploaded_by = uid and m0.created_by = uid
      and m0.course_id = f0.course_id
      and exists (select 1 from public.courses where id = f0.course_id and owner_id = uid) for update of f0;
  if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if f.status <> 'ready' then raise exception 'FILE_NOT_READY' using errcode = '55000'; end if;
  select m0.* into m from public.materials m0 join public.source_documents d0 on d0.material_id = m0.id
    where d0.id = p_document_id and m0.file_id = f.id for update of m0;
  if not found or m.course_id <> f.course_id or m.created_by <> uid then
    raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into d from public.source_documents where id = p_document_id for update;
  -- Repeating a successful retry never restarts running or finished processing.
  if d.processing_status <> 'failed' then return d; end if;
  update public.source_documents set processing_status = 'uploaded', error_code = null,
    started_at = null, completed_at = null where id = d.id returning * into d;
  insert into public.document_processing_jobs(document_id, file_id, available_at)
    values (d.id, f.id, now() + interval '5 seconds') on conflict (document_id) do update
    set attempts = 0, available_at = excluded.available_at, lease_token = null, lease_until = null;
  return d;
end;
$$;

revoke all on function public.guard_source_material(), public.complete_file_upload(uuid,uuid),
  public.claim_document_processing(uuid), public.finish_document_processing(uuid,uuid,text,jsonb,text),
  public.retry_document_processing(uuid) from public, anon, authenticated;
grant execute on function public.complete_file_upload(uuid,uuid), public.claim_document_processing(uuid),
  public.finish_document_processing(uuid,uuid,text,jsonb,text) to service_role;
grant execute on function public.retry_document_processing(uuid) to authenticated;

-- Reuse existing materials, preserve their titles, and never promote unverified files.
do $$
declare f record;
begin
  for f in select id, uploaded_by from public.files where status = 'ready' loop
    perform public.complete_file_upload(f.id, f.uploaded_by);
  end loop;
end;
$$;
commit;
