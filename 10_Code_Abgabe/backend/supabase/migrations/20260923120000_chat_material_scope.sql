begin;
-- NULL preserves the course-wide contract, including all historical exchanges.
-- Keep the selection as a snapshot: deleting a material must not change retry identity.
alter table public.chat_requests add column material_ids uuid[];
alter table public.chat_messages add column material_ids uuid[];
grant select (material_ids) on public.chat_requests to authenticated;
create function public.normalize_chat_material_ids(p_material_ids uuid[]) returns uuid[]
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_material_ids is null then return null; end if;
  if cardinality(p_material_ids) not between 1 and 100 or array_position(p_material_ids, null) is not null then
    raise exception 'INVALID_MATERIAL_SCOPE' using errcode = '22023';
  end if;
  return array(select distinct id from unnest(p_material_ids) id order by id);
end;
$$;
revoke all on function public.normalize_chat_material_ids(uuid[]) from public, anon;
grant execute on function public.normalize_chat_material_ids(uuid[]) to authenticated, service_role;
create function public.search_document_chunks(p_course_id uuid, p_embedding extensions.vector,
  p_embedding_provider text, p_embedding_model text, p_embedding_dimensions integer,
  p_limit integer, p_min_similarity double precision, p_material_ids uuid[])
returns table (id uuid, document_id uuid, material_id uuid, chunk_index integer, content text,
  page_number integer, metadata jsonb, similarity double precision)
language plpgsql stable security invoker set search_path = '' as $$
begin
  p_material_ids := public.normalize_chat_material_ids(p_material_ids);
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
    where m.course_id = p_course_id and (p_material_ids is null or m.id = any(p_material_ids)) and d.indexing_status = 'ready'
      and c.embedding_provider = 'gemini' and c.embedding_model = 'gemini-embedding-2'
      and 1 - (c.embedding operator(extensions.<=>) p_embedding) >= p_min_similarity
    order by c.embedding operator(extensions.<=>) p_embedding, c.id limit p_limit;
end;
$$;

create function public.search_document_chunks(p_course_id uuid, p_embedding extensions.vector,
  p_embedding_provider text, p_embedding_model text, p_embedding_dimensions integer,
  p_limit integer, p_min_similarity double precision, p_query text, p_material_ids uuid[])
returns table (id uuid, document_id uuid, material_id uuid, chunk_index integer, content text,
  page_number integer, metadata jsonb, similarity double precision)
language plpgsql stable security invoker set search_path = '' as $$
declare q tsquery; candidate_limit integer;
begin
  p_material_ids := public.normalize_chat_material_ids(p_material_ids);
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
      p_embedding_provider, p_embedding_model, p_embedding_dimensions, p_limit, p_min_similarity, p_material_ids);
    return;
  end if;
  q := plainto_tsquery('pg_catalog.german', p_query) || plainto_tsquery('pg_catalog.simple', p_query);
  candidate_limit := greatest(20, least(50, p_limit * 4));
  return query
  with semantic as materialized (
    select s.id, row_number() over (order by s.similarity desc, s.id) as rank
    from public.search_document_chunks(p_course_id, p_embedding,
      p_embedding_provider, p_embedding_model, p_embedding_dimensions,
      candidate_limit, p_min_similarity, p_material_ids) s
  ), lexical as materialized (
    select c.id, row_number() over (order by ts_rank_cd(
      to_tsvector('pg_catalog.german', c.content) || to_tsvector('pg_catalog.simple', c.content), q) desc, c.id) as rank
    from public.document_chunks c
    join public.source_documents d on d.id = c.document_id
    join public.materials m on m.id = d.material_id
    where m.course_id = p_course_id and (p_material_ids is null or m.id = any(p_material_ids)) and d.indexing_status = 'ready'
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


revoke all on function public.search_document_chunks(uuid,extensions.vector,text,text,integer,integer,double precision,uuid[]),
 public.search_document_chunks(uuid,extensions.vector,text,text,integer,integer,double precision,text,uuid[]) from public, anon, authenticated;
grant execute on function public.search_document_chunks(uuid,extensions.vector,text,text,integer,integer,double precision,uuid[]),
 public.search_document_chunks(uuid,extensions.vector,text,text,integer,integer,double precision,text,uuid[]) to authenticated;
-- Replace rather than overload defaulted arguments, avoiding ambiguous RPC resolution.
drop function public.reserve_chat_request(uuid,uuid,uuid,text,text,text,integer,integer);
create function public.reserve_chat_request(p_user_id uuid, p_conversation_id uuid,
  p_request_id uuid, p_question text, p_provider text, p_model text,
  p_questions_per_minute integer, p_concurrent_responses integer, p_material_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.chat_requests; q public.chat_messages; v_now timestamptz; v_starts timestamptz[];
  v_hash text; v_token uuid; v_wait integer;
begin
  p_material_ids := public.normalize_chat_material_ids(p_material_ids);
  if p_user_id is null or p_request_id is null or p_question is null
    or char_length(btrim(p_question)) not between 1 and 1800
    or p_provider is null or p_provider not in ('openai','gemini')
    or p_model is null or char_length(btrim(p_model)) not between 1 and 100
    or p_questions_per_minute is null or p_questions_per_minute not between 1 and 100
    or p_concurrent_responses is null or p_concurrent_responses not between 1 and 10 then
    raise exception 'INVALID_CHAT_REQUEST' using errcode = '22023';
  end if;
  insert into public.chat_admission(user_id) values (p_user_id) on conflict do nothing;
  perform 1 from public.chat_admission where user_id = p_user_id for update;
  perform 1 from public.chat_conversations c join public.courses co on co.id = c.course_id
    where c.id = p_conversation_id and co.owner_id = p_user_id for update of c;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  v_now := clock_timestamp();
  v_hash := encode(extensions.digest(convert_to(btrim(p_question),'UTF8'),'sha256'),'hex');
  select * into q from public.chat_messages where conversation_id = p_conversation_id
    and request_id = p_request_id and role = 'user';
  if found then
    if btrim(q.content) <> btrim(p_question) or q.material_ids is distinct from p_material_ids then return jsonb_build_object('code','REQUEST_ID_CONFLICT'); end if;
    return jsonb_build_object('exchange', public.chat_exchange_payload(q.id));
  end if;
  select * into r from public.chat_requests where conversation_id = p_conversation_id and request_id = p_request_id for update;
  if found and (r.question_hash <> v_hash or r.user_id <> p_user_id or r.material_ids is distinct from p_material_ids) then
    return jsonb_build_object('code','REQUEST_ID_CONFLICT');
  end if;
  if p_material_ids is not null and exists (
    select 1 from unnest(p_material_ids) selected(id) where not exists (
      select 1 from public.materials m join public.courses co on co.id = m.course_id
      join public.chat_conversations c on c.course_id = co.id
      where m.id = selected.id and c.id = p_conversation_id and co.owner_id = p_user_id
    )
  ) then return jsonb_build_object('code','MATERIAL_NOT_FOUND'); end if;
  if r.status = 'running' and r.lease_until > v_now then
    return jsonb_build_object('code','REQUEST_IN_PROGRESS','retry_after_seconds',2);
  end if;
  -- Expired workers cannot complete because completion also fences the token
  -- and expiry. Their last known state stays visible until a new attempt starts.
  update public.chat_requests set status = 'failed', error_code = 'REQUEST_EXPIRED', updated_at = v_now
    where user_id = p_user_id and status = 'running' and lease_until <= v_now;
  if exists (select 1 from public.chat_requests where conversation_id = p_conversation_id
    and status = 'running' and lease_until > v_now) then
    return jsonb_build_object('code','CONVERSATION_BUSY','retry_after_seconds',2);
  end if;
  delete from public.chat_execution_leases where user_id = p_user_id and lease_until <= v_now;
  if (select count(*) from public.chat_execution_leases where user_id = p_user_id
    and lease_until > v_now) >= p_concurrent_responses then
    return jsonb_build_object('code','CONCURRENCY_LIMIT','retry_after_seconds',2);
  end if;
  select coalesce(array_agg(t order by t), '{}'::timestamptz[]) into v_starts
    from public.chat_admission a, unnest(a.starts) t where a.user_id = p_user_id and t > v_now - interval '1 minute';
  if cardinality(v_starts) >= p_questions_per_minute then
    v_wait := greatest(1, ceil(extract(epoch from (v_starts[1] + interval '1 minute' - v_now)))::integer);
    return jsonb_build_object('code','RATE_LIMITED','retry_after_seconds',v_wait);
  end if;
  update public.chat_admission set starts = array_append(v_starts, v_now) where user_id = p_user_id;
  v_token := gen_random_uuid();
  insert into public.chat_requests(conversation_id,request_id,user_id,question_hash,material_ids,status,lease_token,lease_until,provider,model,updated_at)
    values (p_conversation_id,p_request_id,p_user_id,v_hash,p_material_ids,'running',v_token,v_now + interval '3 minutes',p_provider,p_model,v_now)
    on conflict (conversation_id,request_id) do update set status = 'running', lease_token = v_token,
      lease_until = v_now + interval '3 minutes', attempts = public.chat_requests.attempts + 1,
      provider = p_provider, model = p_model, error_code = null, stage = 'reserved',
      input_tokens = null, output_tokens = null, updated_at = v_now;
  insert into public.chat_execution_leases(lease_token,user_id,lease_until)
    values (v_token,p_user_id,v_now + interval '3 minutes');
  return jsonb_build_object('lease_token',v_token);
end;
$$;


revoke all on function public.reserve_chat_request(uuid,uuid,uuid,text,text,text,integer,integer,uuid[]) from public, anon, authenticated;
grant execute on function public.reserve_chat_request(uuid,uuid,uuid,text,text,text,integer,integer,uuid[]) to service_role;
create or replace function public.complete_chat_request(p_user_id uuid, p_conversation_id uuid, p_request_id uuid,
  p_lease_token uuid, p_question text, p_answer text, p_model text, p_input_tokens integer,
  p_output_tokens integer, p_sources jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.chat_requests; payload jsonb; q uuid;
begin
  perform 1 from public.chat_conversations c join public.courses co on co.id = c.course_id
    where c.id = p_conversation_id and co.owner_id = p_user_id for update of c for share of co;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into r from public.chat_requests where conversation_id = p_conversation_id and request_id = p_request_id for update;
  if not found or r.user_id <> p_user_id or r.lease_token is distinct from p_lease_token
    or r.status <> 'running' or r.lease_until <= clock_timestamp() then
    raise exception 'REQUEST_LEASE_EXPIRED' using errcode = 'P0001';
  end if;
  if p_question is null or r.question_hash <> encode(extensions.digest(convert_to(btrim(p_question),'UTF8'),'sha256'),'hex') then
    raise exception 'REQUEST_ID_CONFLICT' using errcode = '22023';
  end if;
  if r.material_ids is not null and exists (
    select 1 from jsonb_array_elements(p_sources) s
    where (s->>'material_id') is null or not ((s->>'material_id')::uuid = any(r.material_ids))
  ) then raise exception 'INVALID_CITATION' using errcode = '22023'; end if;
  payload := public.append_chat_exchange(p_conversation_id,p_request_id,p_question,p_answer,p_model,p_sources);
  update public.chat_messages set material_ids = r.material_ids
    where id = (payload->'messages'->0->>'id')::uuid;
  update public.chat_messages set provider = r.provider, input_tokens = p_input_tokens, output_tokens = p_output_tokens
    where id = (payload->'messages'->1->>'id')::uuid;
  update public.chat_requests set status = 'completed', model = p_model, input_tokens = p_input_tokens,
    output_tokens = p_output_tokens, stage = 'persist', error_code = null, updated_at = clock_timestamp()
    where conversation_id = p_conversation_id and request_id = p_request_id;
  delete from public.chat_execution_leases where lease_token = p_lease_token;
  q := (payload->'messages'->0->>'id')::uuid;
  return public.chat_exchange_payload(q);
end;
$$;

drop function public.chat_exchange(uuid,uuid);
create function public.chat_exchange(p_conversation_id uuid, p_request_id uuid, p_material_ids uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.chat_messages;
begin
  p_material_ids := public.normalize_chat_material_ids(p_material_ids);
  select msg.* into m from public.chat_messages msg
    join public.chat_conversations c on c.id = msg.conversation_id
    join public.courses co on co.id = c.course_id
    where msg.conversation_id = p_conversation_id and msg.role = 'user'
      and msg.request_id = p_request_id and co.owner_id = auth.uid();
  if not found then return null; end if;
  if m.material_ids is distinct from p_material_ids then
    raise exception 'REQUEST_ID_CONFLICT' using errcode = '22023';
  end if;
  return public.chat_exchange_payload(m.id);
end;
$$;
revoke all on function public.chat_exchange(uuid,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.chat_exchange(uuid,uuid,uuid[]) to authenticated;
commit;
