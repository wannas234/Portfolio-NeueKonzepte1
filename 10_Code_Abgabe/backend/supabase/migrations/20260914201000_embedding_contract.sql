begin;
-- Preserve existing vectors. This index is explicitly OpenAI's 1536-dimensional
-- text-embedding-3-small space; answer-provider configuration never changes it.
alter table public.document_chunks add column embedding_provider text not null default 'openai'
  check (embedding_provider = 'openai');

create function public.search_document_chunks(p_course_id uuid, p_embedding extensions.vector,
  p_embedding_provider text, p_embedding_model text, p_embedding_dimensions integer,
  p_limit integer default 10, p_min_similarity double precision default 0)
returns table (id uuid, document_id uuid, material_id uuid, chunk_index integer, content text,
  page_number integer, metadata jsonb, similarity double precision)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_embedding_provider is distinct from 'openai' or p_embedding_model is distinct from 'text-embedding-3-small'
    or p_embedding_dimensions is distinct from 1536 then
    raise exception 'EMBEDDING_CONTRACT_MISMATCH' using errcode = '22023';
  end if;
  return query select * from public.match_document_chunks(p_course_id,p_embedding,p_limit,p_min_similarity);
end;
$$;

create function public.finish_document_indexing_batch(p_document_id uuid, p_lease_token uuid,
  p_embedding_provider text, p_embedding_model text, p_embedding_dimensions integer,
  p_chunks jsonb default '[]', p_total_chunks integer default null, p_error_code text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_embedding_provider is distinct from 'openai' or p_embedding_model is distinct from 'text-embedding-3-small'
    or p_embedding_dimensions is distinct from 1536 then
    raise exception 'EMBEDDING_CONTRACT_MISMATCH' using errcode = '22023';
  end if;
  return public.finish_document_indexing(p_document_id,p_lease_token,p_chunks,p_total_chunks,p_error_code);
end;
$$;
revoke all on function public.search_document_chunks(uuid,extensions.vector,text,text,integer,integer,double precision),
  public.finish_document_indexing_batch(uuid,uuid,text,text,integer,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.search_document_chunks(uuid,extensions.vector,text,text,integer,integer,double precision) to authenticated;
grant execute on function public.finish_document_indexing_batch(uuid,uuid,text,text,integer,jsonb,integer,text) to service_role;
commit;
