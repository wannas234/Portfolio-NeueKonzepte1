-- Persistent document quiz generation. Internal functions are service-only.
begin;
alter table public.plan_limits drop constraint plan_limits_kind_check;
alter table public.plan_limits add constraint plan_limits_kind_check check(kind in ('chat','search','search_per_minute','summary','flashcards','quizzes','material_analysis','upload','storage_bytes'));
alter table public.usage_events drop constraint usage_events_kind_check;
alter table public.usage_events add constraint usage_events_kind_check check(kind in ('chat','search','summary','flashcards','quizzes','material_analysis','upload'));
insert into public.plan_limits(plan,kind,value) values('free','quizzes',5),('pro','quizzes',50);
create or replace function public.consume_usage(p_user_id uuid, p_kind text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan text;
  v_limit bigint;
  v_rate bigint;
  v_used bigint;
  v_recent timestamptz[];
  v_start timestamptz := public.usage_period_start();
begin
  if p_user_id is null or p_key is null or char_length(p_key) not between 1 and 100
    or p_kind is null or p_kind not in ('chat', 'search', 'summary', 'flashcards', 'quizzes',
      'material_analysis', 'upload') then
    raise exception 'INVALID_USAGE' using errcode = '22023';
  end if;
  -- Serialisiert gleichzeitige Aktionen derselben Art: Zählen und Eintragen sind atomar.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_kind, 8301));
  if exists (select 1 from public.usage_events
    where user_id = p_user_id and kind = p_kind and key = p_key) then
    return jsonb_build_object('allowed', true, 'replay', true);
  end if;
  v_plan := public.current_plan(p_user_id);
  select value into v_limit from public.plan_limits where plan = v_plan and kind = p_kind;
  if v_limit is null then
    raise exception 'USAGE_LIMIT_NOT_CONFIGURED' using errcode = '55000';
  end if;
  select count(*) into v_used from public.usage_events
    where user_id = p_user_id and kind = p_kind and created_at >= v_start;
  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'code', 'QUOTA_EXCEEDED', 'plan', v_plan,
      'limit', v_limit, 'used', v_used,
      'resets_at', (date_trunc('month', now() at time zone 'Europe/Berlin') + interval '1 month')
        at time zone 'Europe/Berlin');
  end if;
  if p_kind = 'search' then
    select value into v_rate from public.plan_limits
      where plan = v_plan and kind = 'search_per_minute';
    if v_rate is null then
      raise exception 'USAGE_LIMIT_NOT_CONFIGURED' using errcode = '55000';
    end if;
    select coalesce(array_agg(created_at order by created_at), '{}') into v_recent
      from public.usage_events
      where user_id = p_user_id and kind = 'search' and created_at > now() - interval '1 minute';
    if cardinality(v_recent) >= v_rate then
      return jsonb_build_object('allowed', false, 'code', 'RATE_LIMITED', 'plan', v_plan,
        'retry_after_seconds', greatest(1, coalesce(ceil(extract(epoch from
          (v_recent[1] + interval '1 minute' - now())))::integer, 60)));
    end if;
  end if;
  insert into public.usage_events(user_id, kind, key, plan) values (p_user_id, p_kind, p_key, v_plan);
  return jsonb_build_object('allowed', true, 'plan', v_plan, 'limit', v_limit, 'used', v_used + 1);
end;
$$;
create or replace function public.configure_plan_limits(p_limits jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_plan text;
  v_kind text;
  v_value jsonb;
  v_kinds text[] := array['chat', 'search', 'search_per_minute', 'summary', 'flashcards', 'quizzes',
    'material_analysis', 'upload', 'storage_bytes'];
begin
  if jsonb_typeof(p_limits) is distinct from 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p_limits) k)
      is distinct from array['free', 'pro'] then
    raise exception 'INVALID_PLAN_LIMITS' using errcode = '22023';
  end if;
  foreach v_plan in array array['free', 'pro'] loop
    if jsonb_typeof(p_limits -> v_plan) is distinct from 'object'
      or (select array_agg(k order by k) from jsonb_object_keys(p_limits -> v_plan) k)
        is distinct from (select array_agg(k order by k) from unnest(v_kinds) k) then
      raise exception 'INVALID_PLAN_LIMITS' using errcode = '22023';
    end if;
    foreach v_kind in array v_kinds loop
      v_value := p_limits -> v_plan -> v_kind;
      if jsonb_typeof(v_value) is distinct from 'number'
        or (v_value #>> '{}')::numeric < 0
        or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
        or (v_value #>> '{}')::numeric > 9007199254740991 then
        raise exception 'INVALID_PLAN_LIMITS' using errcode = '22023';
      end if;
      insert into public.plan_limits(plan, kind, value)
        values (v_plan, v_kind, (v_value #>> '{}')::bigint)
        on conflict (plan, kind) do update set value = excluded.value, updated_at = now()
          where public.plan_limits.value is distinct from excluded.value;
    end loop;
  end loop;
end;
$$;
create function public.normalize_quiz_questions(p_source_material uuid,p_questions jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q jsonb; opt jsonb; chunk jsonb; snapshot jsonb; refs jsonb; normalized jsonb:='[]'::jsonb;
begin
 if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) not between 1 and 10 or octet_length(p_questions::text)>100000 then raise exception 'INVALID_QUIZ' using errcode='22023'; end if;
  for q in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(q->'question') is distinct from 'string'
      or length(btrim(q->>'question')) not between 1 and 1000 or jsonb_typeof(q->'options') is distinct from 'array'
      or jsonb_typeof(q->'correctIndex') is distinct from 'number' then
      raise exception 'INVALID_QUESTION' using errcode='22023'; end if;
    if jsonb_array_length(q->'options')<>4 or (q->>'correctIndex')::numeric not between 0 and 3
      or trunc((q->>'correctIndex')::numeric)<>(q->>'correctIndex')::numeric then
      raise exception 'INVALID_QUESTION' using errcode='22023'; end if;
    for opt in select value from jsonb_array_elements(q->'options') loop
      if jsonb_typeof(opt) is distinct from 'string' or length(btrim(opt#>>'{}')) not between 1 and 2000 then
        raise exception 'INVALID_OPTION' using errcode='22023'; end if;
    end loop;
    if q ? 'explanation' and (jsonb_typeof(q->'explanation') is distinct from 'string' or length(btrim(q->>'explanation')) not between 1 and 4000) then raise exception 'INVALID_EXPLANATION' using errcode='22023'; end if;
    refs:='[]';
    if q ? 'source_chunk_ids' then
      if jsonb_typeof(q->'source_chunk_ids') is distinct from 'array' then raise exception 'INVALID_SOURCES' using errcode='22023'; end if;
      if jsonb_array_length(q->'source_chunk_ids')>20 then raise exception 'INVALID_SOURCES' using errcode='22023'; end if;
      for chunk in select value from jsonb_array_elements(q->'source_chunk_ids') loop
        if jsonb_typeof(chunk) is distinct from 'string' then raise exception 'INVALID_SOURCES' using errcode='22023'; end if;
        select jsonb_build_object('source_document_id',d.id,'material_id',m.id,'chunk_id',c.id,
          'title',m.title,'page_number',c.page_number,'excerpt',left(c.content,4000)) into snapshot
          from public.document_chunks c join public.source_documents d on d.id=c.document_id
          join public.materials m on m.id=d.material_id where c.id=(chunk#>>'{}')::uuid and m.id=p_source_material;
        if snapshot is null then raise exception 'SOURCE_NOT_FOUND' using errcode='22023'; end if;
        refs:=refs||jsonb_build_array(snapshot);
      end loop;
    end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('question',btrim(q->>'question'),
      'options',q->'options','correctIndex',(q->>'correctIndex')::numeric,'sources',refs,'explanation',nullif(btrim(q->>'explanation'),'')));
  end loop;
 return normalized;
end $$;
create or replace function public.save_learning_quiz(p_source_material uuid,p_title text,p_questions jsonb,p_request_id uuid,p_previous_quiz uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; v_result jsonb;
  normalized jsonb:='[]'::jsonb; qid uuid:=gen_random_uuid(); previous public.learning_quizzes; family uuid; version integer;
begin
  select m.course_id into cid from public.materials m join public.courses c on c.id=m.course_id
    where m.id=p_source_material and m.type='source_document' and c.owner_id=auth.uid();
  if cid is null then raise exception 'SOURCE_NOT_FOUND' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception 'INVALID_QUIZ' using errcode='22023'; end if;
  if jsonb_array_length(p_questions) not between 1 and 10 or octet_length(p_questions::text)>100000 then
    raise exception 'INVALID_QUIZ' using errcode='22023'; end if;
  v_result:=public.begin_learning_write(p_request_id,'quiz',cid,
    jsonb_build_object('source_material_id',p_source_material,'title',btrim(p_title),'questions',p_questions,'previous_quiz',p_previous_quiz));
  if v_result is not null then return v_result; end if;
  -- Serialize revisions within a course; old question sets and attempts remain untouched.
  perform 1 from public.courses where id=cid for update;
  family:=qid; version:=1;
  if p_previous_quiz is not null then
    select * into previous from public.learning_quizzes where id=p_previous_quiz and source_material_id=p_source_material;
    if not found then raise exception 'QUIZ_NOT_FOUND' using errcode='42501'; end if;
    if exists(select 1 from public.learning_quizzes where family_id=previous.family_id and revision>previous.revision) then
      raise exception 'QUIZ_REVISION_CONFLICT' using errcode='40001'; end if;
    family:=previous.family_id; version:=previous.revision+1;
  end if;
  normalized:=public.normalize_quiz_questions(p_source_material,p_questions);
  insert into public.learning_quizzes(id,course_id,source_material_id,family_id,revision,title,questions)
    values(qid,cid,p_source_material,family,version,btrim(p_title),normalized);
  v_result:=jsonb_build_object('quiz_id',qid,'family_id',family,'revision',version);
  update public.learning_write_requests set result=v_result where owner_id=auth.uid() and request_id=p_request_id;
  return v_result;
end $$;

create table public.quiz_generation_jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 course_id uuid not null references public.courses(id) on delete cascade,
 source_material_id uuid not null references public.materials(id) on delete cascade,
 request_id uuid not null,
 requested_count integer not null check(requested_count between 1 and 10),
 status text not null default 'queued' check(status in ('queued','processing','completed','failed','cancelled')),
 phase text not null default 'analyze' check(phase in ('analyze','generate')),
 sources jsonb not null, fingerprint text not null, configuration jsonb not null,
 checkpoint jsonb, attempts integer not null default 0, retries integer not null default 0,
 paid_calls integer not null default 0, reserved_tokens bigint not null default 0,
 lease_token uuid, lease_until timestamptz, error_code text,
 quiz_id uuid references public.learning_quizzes(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,request_id)
);
alter table public.quiz_generation_jobs enable row level security;
revoke all on public.quiz_generation_jobs from public,anon,authenticated;
grant all on public.quiz_generation_jobs to service_role;
create index quiz_jobs_due on public.quiz_generation_jobs(created_at) where status in ('queued','processing');
create index quiz_jobs_material on public.quiz_generation_jobs(source_material_id,created_at desc);
create trigger quiz_jobs_usage before insert on public.quiz_generation_jobs for each row execute function public.enforce_usage_quota('quizzes','owner_id');

create function public.quiz_source_snapshot(p_material uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('document_id',d.id,'title',m.title,'processing_status',d.processing_status,
 'indexing_status',d.indexing_status,'file_status',f.status,'chunks',coalesce((
 select jsonb_agg(jsonb_build_object('id',c.id,'text',c.content,'page_number',c.page_number) order by c.chunk_index)
 from public.document_chunks c where c.document_id=d.id),'[]'::jsonb))
 from public.source_documents d join public.materials m on m.id=d.material_id join public.files f on f.id=m.file_id
 where m.id=p_material and m.type='source_document'
$$;
create function public.quiz_job_view(j public.quiz_generation_jobs) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',j.id,'status',j.status,'phase',j.phase,'requested_count',j.requested_count,
 'generated_count',coalesce(jsonb_array_length(j.checkpoint->'questions'),0), 'quiz_id',j.quiz_id,
 'error_code',j.error_code,'analyzed',coalesce((j.checkpoint->>'analyzed')::integer,0),
 'total',jsonb_array_length(j.sources->'chunks'),'created_at',j.created_at)
$$;
create function public.quiz_action(p_owner uuid,p_body jsonb,p_configuration jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare action text:=p_body->>'action'; mid uuid; cid uuid; wanted integer; request uuid; src jsonb; j public.quiz_generation_jobs;
begin
 if p_owner is null then raise exception 'TARGET_NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,8110));
 if action in ('generate','list') then
  mid:=(p_body->>'source_material_id')::uuid;
  select m.course_id into cid from public.materials m join public.courses c on c.id=m.course_id
   where m.id=mid and m.type='source_document' and c.owner_id=p_owner;
  if cid is null then raise exception 'TARGET_NOT_FOUND'; end if;
  if action='list' then return coalesce((select jsonb_agg(public.quiz_job_view(x) order by x.created_at desc)
   from (select * from public.quiz_generation_jobs where source_material_id=mid and owner_id=p_owner order by created_at desc limit 50) x),'[]'); end if;
  request:=(p_body->>'request_id')::uuid;
  if request is null or jsonb_typeof(p_body->'count') is distinct from 'number'
   or (p_body->>'count')::numeric<>trunc((p_body->>'count')::numeric) then raise exception 'INVALID_REQUEST'; end if;
  wanted:=(p_body->>'count')::integer;
  if wanted not between 1 and 10 then raise exception 'INVALID_REQUEST'; end if;
  select * into j from public.quiz_generation_jobs where owner_id=p_owner and request_id=request;
  if found then
   if j.source_material_id<>mid or j.requested_count<>wanted then raise exception 'REQUEST_CONFLICT'; end if;
   return public.quiz_job_view(j);
  end if;
  if p_configuration->>'version' is distinct from 'quizzes-v1' then raise exception 'INVALID_REQUEST'; end if;
  -- Bound allocation before aggregating document chunks.
  if (select coalesce(sum(length(c.content)),0) from public.document_chunks c join public.source_documents d on d.id=c.document_id where d.material_id=mid)>least(500000,(p_configuration->>'maxSourceCharacters')::integer)
   then raise exception 'SOURCE_LIMIT_EXCEEDED'; end if;
  src:=public.quiz_source_snapshot(mid);
  if src is null or src->>'processing_status'<>'ready' or src->>'indexing_status'<>'ready' or src->>'file_status'<>'ready' then raise exception 'SOURCES_NOT_READY'; end if;
  if jsonb_array_length(src->'chunks')=0 then raise exception 'NO_LEARNING_CONTENT'; end if;
  if (select count(*) from public.quiz_generation_jobs where owner_id=p_owner and status in ('queued','processing'))>=4
   or (select count(*) from public.quiz_generation_jobs where owner_id=p_owner and created_at>now()-interval '1 hour')>=10 then raise exception 'RATE_LIMITED'; end if;
  insert into public.quiz_generation_jobs(owner_id,course_id,source_material_id,request_id,requested_count,sources,fingerprint,configuration)
   values(p_owner,cid,mid,request,wanted,src,md5(src::text),p_configuration) returning * into j;
  return public.quiz_job_view(j);
 end if;
 select * into j from public.quiz_generation_jobs where id=(p_body->>'job_id')::uuid and owner_id=p_owner for update;
 if not found or not exists(select 1 from public.courses where id=j.course_id and owner_id=p_owner) then raise exception 'TARGET_NOT_FOUND'; end if;
 if action='status' then return public.quiz_job_view(j); end if;
 if action='cancel' then
  if j.status in ('queued','processing','failed') then update public.quiz_generation_jobs set status='cancelled',lease_token=null,lease_until=null,updated_at=now() where id=j.id returning * into j; end if;
 elsif action='retry' then
  if j.status<>'failed' then return public.quiz_job_view(j); end if;
  if j.retries>=3 or j.error_code in ('SOURCE_CHANGED','BUDGET_EXCEEDED','NO_LEARNING_CONTENT','POINT_LIMIT_EXCEEDED') then raise exception 'NEW_REQUEST_REQUIRED'; end if;
  if md5(public.quiz_source_snapshot(j.source_material_id)::text) is distinct from j.fingerprint then raise exception 'SOURCE_CHANGED'; end if;
  update public.quiz_generation_jobs set status='queued',attempts=0,retries=retries+1,error_code=null,lease_token=null,lease_until=null,updated_at=now() where id=j.id returning * into j;
 else raise exception 'INVALID_REQUEST'; end if;
 return public.quiz_job_view(j);
end $$;
create function public.claim_quiz_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.quiz_generation_jobs;
begin
 select * into j from public.quiz_generation_jobs where status in ('queued','processing') and (lease_until is null or lease_until<=clock_timestamp()) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 if j.attempts>=3 then
  update public.quiz_generation_jobs set status='failed',error_code='PROCESSING_FAILED',lease_token=null,lease_until=null,updated_at=now() where id=j.id; return null;
 end if;
 update public.quiz_generation_jobs set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create function public.reserve_quiz_call(p_job uuid,p_lease uuid,p_tokens integer) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.quiz_generation_jobs;
begin
 select * into j from public.quiz_generation_jobs where id=p_job for update;
 if not found or j.status<>'processing' or j.lease_token is distinct from p_lease or j.lease_until<=clock_timestamp() then return false; end if;
 if md5(public.quiz_source_snapshot(j.source_material_id)::text) is distinct from j.fingerprint then
  update public.quiz_generation_jobs set status='failed',error_code='SOURCE_CHANGED',lease_token=null,lease_until=null where id=j.id; return false;
 end if;
 if p_tokens is null or p_tokens<1 or j.reserved_tokens+p_tokens>(j.configuration->>'tokenBudget')::bigint or j.paid_calls>=(j.configuration->>'maxCalls')::integer then
  update public.quiz_generation_jobs set status='failed',error_code='BUDGET_EXCEEDED',lease_token=null,lease_until=null where id=j.id; return false;
 end if;
 update public.quiz_generation_jobs set paid_calls=paid_calls+1,reserved_tokens=reserved_tokens+p_tokens where id=j.id;
 return true;
end $$;
create function public.save_quiz_step(p_job uuid,p_lease uuid,p_checkpoint jsonb,p_status text,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.quiz_generation_jobs; normalized jsonb; q jsonb; qid uuid; title text;
begin
 select * into j from public.quiz_generation_jobs where id=p_job for update;
 if not found or j.status<>'processing' or j.lease_token is distinct from p_lease or j.lease_until<=clock_timestamp() then return false; end if;
 perform 1 from public.courses where id=j.course_id and owner_id=j.owner_id for share;
 if not found then return false; end if;
 perform 1 from public.materials where id=j.source_material_id for share;
 perform 1 from public.files where id=(select file_id from public.materials where id=j.source_material_id) for share;
 perform 1 from public.source_documents where material_id=j.source_material_id for share;
 if md5(public.quiz_source_snapshot(j.source_material_id)::text) is distinct from j.fingerprint then p_error:='SOURCE_CHANGED'; end if;
 if p_status not in ('queued','completed','failed') or octet_length(p_checkpoint::text)>16000000 then raise exception 'INVALID_REQUEST'; end if;
 if p_error is null and p_status='completed' then
  normalized:=public.normalize_quiz_questions(j.source_material_id,p_checkpoint->'questions');
  if jsonb_array_length(normalized)>j.requested_count then raise exception 'INVALID_QUIZ'; end if;
  for q in select value from jsonb_array_elements(normalized) loop
   if q->>'explanation' is null or jsonb_array_length(q->'sources')=0
    or (select count(distinct lower(btrim(x))) from jsonb_array_elements_text(q->'options') x)<>4 then raise exception 'INVALID_QUESTION'; end if;
  end loop;
  if (select count(distinct lower(btrim(q2->>'question'))) from jsonb_array_elements(normalized) q2)<>jsonb_array_length(normalized) then raise exception 'INVALID_QUESTION'; end if;
  title:=left(j.sources->>'title',190)||' – Test'; qid:=gen_random_uuid();
  insert into public.learning_quizzes(id,course_id,source_material_id,family_id,revision,title,questions)
   values(qid,j.course_id,j.source_material_id,qid,1,title,normalized);
 end if;
 update public.quiz_generation_jobs set checkpoint=coalesce(p_checkpoint,checkpoint),status=case when p_error is not null then 'failed' else p_status end,
 phase=case when p_checkpoint->>'planned'='true' then 'generate' else 'analyze' end,
 quiz_id=coalesce(qid,quiz_id),error_code=p_error,attempts=0,lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 return true;
end $$;
create function public.dispatch_quiz_work() returns void language plpgsql security definer set search_path='' as $$
declare base text; secret text;
begin
 if not pg_try_advisory_xact_lock(20261005,1) then return; end if;
 if not exists(select 1 from public.quiz_generation_jobs where status in ('queued','processing') and (lease_until is null or lease_until<=clock_timestamp())) then return; end if;
 select decrypted_secret into base from vault.decrypted_secrets where name='document_processing_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='document_processing_service_key';
 if base is null or secret is null then return; end if;
 perform net.http_post(url:=replace(base,'/documents-process','/quizzes-process'),headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}'::jsonb,timeout_milliseconds:=90000);
end $$;
select cron.schedule('learning-quizzes-dispatch','10 seconds','select public.dispatch_quiz_work()');
revoke all on function public.normalize_quiz_questions(uuid,jsonb),public.quiz_source_snapshot(uuid),public.quiz_job_view(public.quiz_generation_jobs),public.quiz_action(uuid,jsonb,jsonb),public.claim_quiz_job(),public.reserve_quiz_call(uuid,uuid,integer),public.save_quiz_step(uuid,uuid,jsonb,text,text),public.dispatch_quiz_work() from public,anon,authenticated;
grant execute on function public.normalize_quiz_questions(uuid,jsonb),public.quiz_source_snapshot(uuid),public.quiz_job_view(public.quiz_generation_jobs),public.quiz_action(uuid,jsonb,jsonb),public.claim_quiz_job(),public.reserve_quiz_call(uuid,uuid,integer),public.save_quiz_step(uuid,uuid,jsonb,text,text),public.dispatch_quiz_work() to service_role;
commit;
