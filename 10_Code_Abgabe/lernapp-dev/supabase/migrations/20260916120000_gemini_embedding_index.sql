begin;
-- Atomic switch of vector space. Old workers must finish before this lock or
-- will encounter the new contract/invalidated lease after it commits.
lock table public.source_documents, public.document_indexing_jobs, public.document_chunks in access exclusive mode;

-- Keep original OpenAI vectors separately, never relabel them as Gemini.
-- Archive is not exposed by PostgREST and follows source-document deletion.
create schema if not exists embedding_archive;
revoke all on schema embedding_archive from public, anon, authenticated;
create table embedding_archive.openai_document_chunks as table public.document_chunks;
alter table embedding_archive.openai_document_chunks add primary key (id);
alter table embedding_archive.openai_document_chunks add foreign key (document_id)
  references public.source_documents(id) on delete cascade;
alter table embedding_archive.openai_document_chunks enable row level security;
revoke all on embedding_archive.openai_document_chunks from public, anon, authenticated;
grant usage on schema embedding_archive to service_role;
grant select on embedding_archive.openai_document_chunks to service_role;

-- Source snapshots on existing answers remain; only their chunk link becomes null.
delete from public.document_chunks;
alter table public.document_chunks
  drop constraint document_chunks_embedding_model_check,
  drop constraint document_chunks_embedding_provider_check,
  alter column embedding_model set default 'gemini-embedding-2',
  alter column embedding_provider set default 'gemini',
  add constraint document_chunks_embedding_model_check check (embedding_model = 'gemini-embedding-2'),
  add constraint document_chunks_embedding_provider_check check (embedding_provider = 'gemini');

-- Invalidate all old cursors and leases; extracted text/files are unchanged.
delete from public.document_indexing_jobs;
update public.source_documents set indexing_status = 'pending', indexing_error = null;
insert into public.document_indexing_jobs(document_id)
  select id from public.source_documents where processing_status = 'ready';

create or replace function public.finish_document_indexing_batch(p_document_id uuid, p_lease_token uuid,
  p_embedding_provider text, p_embedding_model text, p_embedding_dimensions integer,
  p_chunks jsonb default '[]', p_total_chunks integer default null, p_error_code text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare d public.source_documents; j public.document_indexing_jobs; n integer;
begin
  if p_embedding_provider is distinct from 'gemini' or p_embedding_model is distinct from 'gemini-embedding-2'
    or p_embedding_dimensions is distinct from 1536 then
    raise exception 'EMBEDDING_CONTRACT_MISMATCH' using errcode = '22023';
  end if;
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

create or replace function public.search_document_chunks(p_course_id uuid, p_embedding extensions.vector,
  p_embedding_provider text, p_embedding_model text, p_embedding_dimensions integer,
  p_limit integer default 10, p_min_similarity double precision default 0)
returns table (id uuid, document_id uuid, material_id uuid, chunk_index integer, content text,
  page_number integer, metadata jsonb, similarity double precision)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_embedding_provider is distinct from 'gemini' or p_embedding_model is distinct from 'gemini-embedding-2'
    or p_embedding_dimensions is distinct from 1536 then
    raise exception 'EMBEDDING_CONTRACT_MISMATCH' using errcode = '22023';
  end if;
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
      and c.embedding_provider = 'gemini' and c.embedding_model = 'gemini-embedding-2'
      and 1 - (c.embedding operator(extensions.<=>) p_embedding) >= p_min_similarity
    order by c.embedding operator(extensions.<=>) p_embedding, c.id limit p_limit;
end;
$$;

-- Remove provenance-free entrypoints. Old deployed workers/clients must fail
-- rather than write/search OpenAI vectors in the Gemini index.
drop function if exists public.finish_document_indexing(uuid,uuid,jsonb,integer,text);
drop function if exists public.match_document_chunks(uuid,extensions.vector,integer,double precision);
-- CREATE OR REPLACE preserves existing privileges, still assert the public API.
revoke all on function public.search_document_chunks(uuid,extensions.vector,text,text,integer,integer,double precision),
  public.finish_document_indexing_batch(uuid,uuid,text,text,integer,jsonb,integer,text) from public, anon, authenticated;
grant execute on function public.search_document_chunks(uuid,extensions.vector,text,text,integer,integer,double precision) to authenticated;
grant execute on function public.finish_document_indexing_batch(uuid,uuid,text,text,integer,jsonb,integer,text) to service_role;
commit;
