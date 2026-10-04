begin;
create extension if not exists vector with schema extensions;

alter table public.source_documents add column indexing_status text not null default 'pending'
  check (indexing_status in ('pending', 'processing', 'ready', 'failed'));
alter table public.source_documents add column indexing_error text
  check (indexing_error in ('INDEXING_TIMEOUT', 'INVALID_INDEXING_INPUT'));

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.source_documents(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (length(btrim(content)) > 0 and octet_length(content) <= 8000),
  page_number integer check (page_number > 0),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  embedding extensions.vector(1536) not null check (extensions.vector_norm(embedding) > 0),
  embedding_model text not null default 'text-embedding-3-small' check (embedding_model = 'text-embedding-3-small'),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);
alter table public.document_chunks enable row level security;
revoke all on public.document_chunks from public, anon, authenticated;
grant select on public.document_chunks to authenticated;
grant all on public.document_chunks to service_role;
create policy document_chunks_select_owned on public.document_chunks for select to authenticated
  using (exists (select 1 from public.source_documents d
    where d.id = document_id and d.indexing_status = 'ready'));

create table public.document_indexing_jobs (
  document_id uuid primary key references public.source_documents(id) on delete cascade,
  next_index integer not null default 0 check (next_index >= 0),
  total_chunks integer check (total_chunks between 0 and 10000),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  check ((lease_token is null) = (lease_until is null))
);
create index document_indexing_due on public.document_indexing_jobs(available_at);
alter table public.document_indexing_jobs enable row level security;
revoke all on public.document_indexing_jobs from public, anon, authenticated;
grant all on public.document_indexing_jobs to service_role;

create function public.enqueue_document_indexing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.processing_status = 'ready' then
    insert into public.document_indexing_jobs(document_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger source_documents_enqueue_indexing after insert or update of processing_status on public.source_documents
  for each row execute function public.enqueue_document_indexing();
insert into public.document_indexing_jobs(document_id)
  select id from public.source_documents where processing_status = 'ready';

create function public.claim_document_indexing(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.source_documents; j public.document_indexing_jobs;
begin
  select * into d from public.source_documents where id = p_document_id
    and processing_status = 'ready' and indexing_status in ('pending','processing') for update skip locked;
  if not found then return null; end if;
  select * into j from public.document_indexing_jobs where document_id = d.id for update;
  if not found or j.available_at > now() or j.lease_until > now() then return null; end if;
  if j.attempts >= 3 then
    update public.source_documents set indexing_status = 'failed', indexing_error = 'INDEXING_TIMEOUT' where id = d.id;
    delete from public.document_indexing_jobs where document_id = d.id;
    return null;
  end if;
  update public.document_indexing_jobs set attempts = attempts + 1,
    lease_token = gen_random_uuid(), lease_until = now() + interval '2 minutes'
    where document_id = d.id returning * into j;
  update public.source_documents set indexing_status = 'processing', indexing_error = null where id = d.id;
  return jsonb_build_object('document_id', d.id, 'lease_token', j.lease_token,
    'next_index', j.next_index, 'text', d.extracted_text, 'pages', d.pages);
end;
$$;

-- One bounded batch commits atomically. The cursor survives worker restarts;
-- partially indexed documents are never visible in retrieval.
create function public.finish_document_indexing(p_document_id uuid, p_lease_token uuid,
  p_chunks jsonb default '[]', p_total_chunks integer default null, p_error_code text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare d public.source_documents; j public.document_indexing_jobs; n integer;
begin
  select * into d from public.source_documents where id = p_document_id for update;
  if not found then return false; end if;
  select * into j from public.document_indexing_jobs where document_id = d.id for update;
  if not found or d.indexing_status <> 'processing' or p_lease_token is null
    or j.lease_token is distinct from p_lease_token or j.lease_until <= now() then return false; end if;
  if p_error_code is not null then
    if p_error_code <> 'INVALID_INDEXING_INPUT' then raise exception 'INVALID_INDEXING_RESULT' using errcode = '22023'; end if;
    update public.source_documents set indexing_status = 'failed', indexing_error = p_error_code where id = d.id;
    delete from public.document_indexing_jobs where document_id = d.id;
    return true;
  end if;
  if p_total_chunks is null or p_total_chunks not between 0 and 10000
    or (j.total_chunks is not null and j.total_chunks <> p_total_chunks)
    or p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'INVALID_INDEXING_RESULT' using errcode = '22023';
  end if;
  n := jsonb_array_length(p_chunks);
  if n <> least(32, p_total_chunks - j.next_index) or exists (
    select 1 from jsonb_array_elements(p_chunks) with ordinality c(value, i)
    where (value->'chunk_index') is distinct from to_jsonb(j.next_index + i - 1)
      or jsonb_typeof(value->'content') is distinct from 'string'
      or jsonb_typeof(value->'embedding') is distinct from 'array'
      or jsonb_typeof(value->'metadata') is distinct from 'object'
      or (d.pages is null and coalesce(value->'page_number', 'null'::jsonb) <> 'null'::jsonb)
      or (d.pages is not null and not exists (select 1 from jsonb_array_elements(d.pages) p
        where p->'page' = c.value->'page_number'))
  ) then raise exception 'INVALID_INDEXING_RESULT' using errcode = '22023'; end if;
  insert into public.document_chunks(document_id,chunk_index,content,page_number,metadata,embedding)
    select d.id, (c->>'chunk_index')::integer, c->>'content', (c->>'page_number')::integer,
      c->'metadata', (c->>'embedding')::extensions.vector(1536) from jsonb_array_elements(p_chunks) c;
  if j.next_index + n = p_total_chunks then
    update public.source_documents set indexing_status = 'ready', indexing_error = null where id = d.id;
    delete from public.document_indexing_jobs where document_id = d.id;
  else
    update public.document_indexing_jobs set next_index = next_index + n, total_chunks = p_total_chunks,
      attempts = 0, available_at = now(), lease_token = null, lease_until = null where document_id = d.id;
  end if;
  return true;
end;
$$;

create function public.retry_document_indexing(p_document_id uuid) returns public.source_documents
language plpgsql security definer set search_path = '' as $$
declare d public.source_documents;
begin
  select s.* into d from public.source_documents s join public.materials m on m.id = s.material_id
    join public.courses c on c.id = m.course_id
    where s.id = p_document_id and m.created_by = auth.uid() and c.owner_id = auth.uid() for update of s;
  if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.indexing_status <> 'failed' then return d; end if;
  delete from public.document_chunks where document_id = d.id;
  update public.source_documents set indexing_status = 'pending', indexing_error = null where id = d.id returning * into d;
  insert into public.document_indexing_jobs(document_id,available_at) values (d.id, now() + interval '5 seconds');
  return d;
end;
$$;

-- Exact cosine search after RLS/course filtering. Avoid approximate-index
-- post-filtering dropping legitimate matches in small per-course corpora.
create function public.match_document_chunks(p_course_id uuid, p_embedding extensions.vector,
  p_limit integer default 10, p_min_similarity double precision default 0)
returns table (id uuid, document_id uuid, material_id uuid, chunk_index integer, content text,
  page_number integer, metadata jsonb, similarity double precision)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_embedding is null or extensions.vector_dims(p_embedding) <> 1536
    or extensions.vector_norm(p_embedding) = 0 or p_limit is null or p_limit not between 1 and 50
    or p_min_similarity is null or not (p_min_similarity between -1 and 1) then
    raise exception 'INVALID_SEARCH' using errcode = '22023';
  end if;
  return query select c.id, c.document_id, d.material_id, c.chunk_index, c.content, c.page_number, c.metadata,
    1 - (c.embedding operator(extensions.<=>) p_embedding) as similarity
    from public.document_chunks c join public.source_documents d on d.id = c.document_id
    join public.materials m on m.id = d.material_id
    where m.course_id = p_course_id and d.indexing_status = 'ready'
      and 1 - (c.embedding operator(extensions.<=>) p_embedding) >= p_min_similarity
    order by c.embedding operator(extensions.<=>) p_embedding, c.id limit p_limit;
end;
$$;
revoke all on function public.enqueue_document_indexing(), public.claim_document_indexing(uuid),
  public.finish_document_indexing(uuid,uuid,jsonb,integer,text), public.retry_document_indexing(uuid),
  public.match_document_chunks(uuid,extensions.vector,integer,double precision) from public, anon, authenticated;
grant execute on function public.claim_document_indexing(uuid), public.finish_document_indexing(uuid,uuid,jsonb,integer,text) to service_role;
grant execute on function public.retry_document_indexing(uuid), public.match_document_chunks(uuid,extensions.vector,integer,double precision) to authenticated;

-- Reuse the already provisioned document-worker Vault configuration.
select cron.schedule('learning-documents-index', '* * * * *', $job$
  select net.http_post(
    url := replace(u.decrypted_secret, '/functions/v1/documents-process', '/functions/v1/documents-index'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || k.decrypted_secret),
    body := '{}'::jsonb, timeout_milliseconds := 90000)
  from vault.decrypted_secrets u cross join vault.decrypted_secrets k
  where u.name = 'document_processing_url' and k.name = 'document_processing_service_key';
$job$);
commit;
