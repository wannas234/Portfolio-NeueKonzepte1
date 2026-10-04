begin;
-- Execution slots outlive a deleted conversation until the worker stops or its
-- deadline expires. Only reservation takes the per-user admission lock; release
-- deletes a unique token, so completion never reverses the admission lock order.
create table public.chat_execution_leases (
  lease_token uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  lease_until timestamptz not null
);
create index chat_execution_leases_user on public.chat_execution_leases(user_id,lease_until);
alter table public.chat_execution_leases enable row level security;
revoke all on public.chat_execution_leases from public,anon,authenticated;
grant all on public.chat_execution_leases to service_role;
insert into public.chat_execution_leases(lease_token,user_id,lease_until)
  select lease_token,user_id,lease_until from public.chat_requests
  where status = 'running' and lease_until > now();

create or replace function public.reserve_chat_request(p_user_id uuid, p_conversation_id uuid,
  p_request_id uuid, p_question text, p_provider text, p_model text,
  p_questions_per_minute integer, p_concurrent_responses integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.chat_requests; q public.chat_messages; v_now timestamptz; v_starts timestamptz[];
  v_hash text; v_token uuid; v_wait integer;
begin
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
    if btrim(q.content) <> btrim(p_question) then return jsonb_build_object('code','REQUEST_ID_CONFLICT'); end if;
    return jsonb_build_object('exchange', public.chat_exchange_payload(q.id));
  end if;
  select * into r from public.chat_requests where conversation_id = p_conversation_id and request_id = p_request_id for update;
  if found and (r.question_hash <> v_hash or r.user_id <> p_user_id) then
    return jsonb_build_object('code','REQUEST_ID_CONFLICT');
  end if;
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
  insert into public.chat_requests(conversation_id,request_id,user_id,question_hash,status,lease_token,lease_until,provider,model,updated_at)
    values (p_conversation_id,p_request_id,p_user_id,v_hash,'running',v_token,v_now + interval '3 minutes',p_provider,p_model,v_now)
    on conflict (conversation_id,request_id) do update set status = 'running', lease_token = v_token,
      lease_until = v_now + interval '3 minutes', attempts = public.chat_requests.attempts + 1,
      provider = p_provider, model = p_model, error_code = null, stage = 'reserved',
      input_tokens = null, output_tokens = null, updated_at = v_now;
  insert into public.chat_execution_leases(lease_token,user_id,lease_until)
    values (v_token,p_user_id,v_now + interval '3 minutes');
  return jsonb_build_object('lease_token',v_token);
end;
$$;

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
  payload := public.append_chat_exchange(p_conversation_id,p_request_id,p_question,p_answer,p_model,p_sources);
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

create or replace function public.fail_chat_request(p_conversation_id uuid, p_request_id uuid, p_lease_token uuid,
  p_error_code text, p_stage text, p_cancelled boolean default false,
  p_input_tokens integer default null, p_output_tokens integer default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare changed boolean;
begin
  if p_error_code is null or p_cancelled is null then raise exception 'INVALID_CHAT_FAILURE' using errcode = '22023'; end if;
  update public.chat_requests set status = case when p_cancelled then 'cancelled' else 'failed' end,
    error_code = p_error_code, stage = p_stage, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    updated_at = clock_timestamp()
    where conversation_id = p_conversation_id and request_id = p_request_id and lease_token = p_lease_token and status = 'running';
  changed := found;
  delete from public.chat_execution_leases where lease_token = p_lease_token;
  return changed;
end;
$$;

commit;
