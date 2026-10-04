begin;

-- Expression index also covers existing chunks; no embedding regeneration.
create index document_chunks_full_text_idx on public.document_chunks using gin
  ((to_tsvector('pg_catalog.german', content) || to_tsvector('pg_catalog.simple', content)));

-- Keep the seven-argument vector RPC for already deployed callers. All eight
-- arguments are required here so PostgREST can resolve either overload exactly.
create function public.search_document_chunks(p_course_id uuid, p_embedding extensions.vector,
  p_embedding_provider text, p_embedding_model text, p_embedding_dimensions integer,
  p_limit integer, p_min_similarity double precision, p_query text)
returns table (id uuid, document_id uuid, material_id uuid, chunk_index integer, content text,
  page_number integer, metadata jsonb, similarity double precision)
language plpgsql stable security invoker set search_path = '' as $$
declare q tsquery; candidate_limit integer;
begin
  if p_query is null or char_length(p_query) > 1800 then
    raise exception 'INVALID_SEARCH' using errcode = '22023';
  end if;
  if p_embedding_provider is distinct from 'gemini' or p_embedding_model is distinct from 'gemini-embedding-2'
    or p_embedding_dimensions is distinct from 1536 then
    raise exception 'EMBEDDING_CONTRACT_MISMATCH' using errcode = '22023';
  end if;
  if p_embedding is null or extensions.vector_dims(p_embedding) <> 1536
    or extensions.vector_norm(p_embedding) = 0 or p_limit is null or p_limit not between 1 and 50
    or p_min_similarity is null or not (p_min_similarity between -1 and 1) then
    raise exception 'INVALID_SEARCH' using errcode = '22023';
  end if;
  -- Empty text preserves vector ordering.
  if btrim(p_query) = '' then
    return query select * from public.search_document_chunks(p_course_id, p_embedding,
      p_embedding_provider, p_embedding_model, p_embedding_dimensions, p_limit, p_min_similarity);
    return;
  end if;
  q := plainto_tsquery('pg_catalog.german', p_query) || plainto_tsquery('pg_catalog.simple', p_query);
  candidate_limit := greatest(20, least(50, p_limit * 4));
  return query
  with semantic as materialized (
    select s.id, row_number() over (order by s.similarity desc, s.id) as rank
    from public.search_document_chunks(p_course_id, p_embedding,
      p_embedding_provider, p_embedding_model, p_embedding_dimensions,
      candidate_limit, p_min_similarity) s
  ), lexical as materialized (
    select c.id, row_number() over (order by ts_rank_cd(
      to_tsvector('pg_catalog.german', c.content) || to_tsvector('pg_catalog.simple', c.content), q) desc, c.id) as rank
    from public.document_chunks c
    join public.source_documents d on d.id = c.document_id
    join public.materials m on m.id = d.material_id
    where m.course_id = p_course_id and d.indexing_status = 'ready'
      and c.embedding_provider = p_embedding_provider and c.embedding_model = p_embedding_model
      and (to_tsvector('pg_catalog.german', c.content) || to_tsvector('pg_catalog.simple', c.content)) @@ q
    order by rank limit candidate_limit
  ), fused as (
    select coalesce(s.id, l.id) as id,
      coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + l.rank), 0) as score,
      l.rank as lexical_rank
    from semantic s full join lexical l on l.id = s.id
  )
  select c.id, c.document_id, d.material_id, c.chunk_index, c.content, c.page_number, c.metadata,
    1 - (c.embedding operator(extensions.<=>) p_embedding) as similarity
  from fused f join public.document_chunks c on c.id = f.id
    join public.source_documents d on d.id = c.document_id
  order by f.score desc, f.lexical_rank nulls last, c.id limit p_limit;
end;
$$;

revoke all on function public.search_document_chunks(uuid,extensions.vector,text,text,integer,integer,double precision,text)
  from public, anon, authenticated;
grant execute on function public.search_document_chunks(uuid,extensions.vector,text,text,integer,integer,double precision,text)
  to authenticated;
commit;
