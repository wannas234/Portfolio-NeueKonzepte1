begin;
create or replace function public.claim_document_processing(p_document_id uuid) returns jsonb
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
    -- Keep paid pages for an explicit authenticated retry; exclude parked jobs from dispatch.
    update public.document_processing_jobs set available_at='infinity',lease_token=null,lease_until=null where document_id=d.id;
    return null;
  end if;
  update public.document_processing_jobs set attempts = attempts + 1,
    lease_token = gen_random_uuid(), lease_until = now() + interval '5 minutes'
    where document_id = d.id returning * into j;
  update public.source_documents set processing_status = 'processing', started_at = now() where id = d.id;
  return jsonb_build_object('document_id', d.id, 'lease_token', j.lease_token,
    'lease_until', j.lease_until, 'attempt', j.attempts, 'checkpoint', j.checkpoint, 'file', to_jsonb(f));
end;
$$;

-- All application replicas share one semaphore and project request-start quota.
create table public.document_provider_limits (
  provider text primary key check (provider in ('visual','embedding','all')),
  concurrency integer not null check (concurrency between 1 and 16),
  starts_per_minute integer not null check (starts_per_minute between 3 and 10000),
  window_start timestamptz not null default clock_timestamp(),
  starts integer not null default 0,
  blocked_until timestamptz not null default '-infinity'
);
insert into public.document_provider_limits(provider,concurrency,starts_per_minute)
  values ('all',3,60),('visual',3,30),('embedding',2,30);
create table public.document_provider_slots (
  token uuid primary key default gen_random_uuid(),
  provider text not null references public.document_provider_limits(provider),
  document_id uuid references public.source_documents(id) on delete set null,
  expires_at timestamptz not null
);
create index on public.document_provider_slots(provider,expires_at);
alter table public.document_provider_limits enable row level security;
alter table public.document_provider_slots enable row level security;
revoke all on public.document_provider_limits, public.document_provider_slots from public,anon,authenticated;
grant all on public.document_provider_limits, public.document_provider_slots to service_role;

-- Per-page merge uses the SAME file-first lock order and original ownership/lease
-- validation as save_document_processing_checkpoint. No last-writer-wins snapshots.
create function public.save_document_processing_page(p_document_id uuid, p_lease_token uuid,
  p_page jsonb) returns boolean language plpgsql security definer set search_path = '' as $$
declare cp jsonb; n integer;
begin
  perform 1 from public.files f join public.document_processing_jobs j on j.file_id=f.id
    where j.document_id=p_document_id for update of f;
  if not found then return false; end if;
  select checkpoint into cp from public.document_processing_jobs where document_id=p_document_id;
  n := (p_page->>'page')::integer;
  if cp is null or n is null or n < 1 or n > jsonb_array_length(cp->'pages')
    or p_page->>'route' is distinct from 'visual' or jsonb_typeof(p_page->'extraction') is distinct from 'object'
    or (cp->'configuration' is not null and p_page->'extraction'->'configuration' is distinct from cp->'configuration')
    or cp->'pages'->(n-1)->>'route' is distinct from 'visual' then
    raise exception 'INVALID_PROCESSING_PAGE' using errcode='22023';
  end if;
  -- An acknowledged page is immutable; retries only acknowledge identical data.
  if cp->'pages'->(n-1)->'extraction' is not null then
    if cp->'pages'->(n-1) is distinct from p_page then return false; end if;
  else cp := jsonb_set(cp, array['pages',(n-1)::text], p_page); end if;
  return public.save_document_processing_checkpoint(p_document_id,p_lease_token,cp,false);
end;
$$;

create function public.acquire_document_provider_slot(p_provider text,p_document_id uuid,p_lease_token uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare lim public.document_provider_limits; global_lim public.document_provider_limits; slot uuid;
begin
  if not exists (select 1 from public.source_documents d
    join public.materials m on m.id=d.material_id join public.files f on f.id=m.file_id
    join public.courses c on c.id=m.course_id
    where d.id=p_document_id and f.status='ready' and m.created_by=f.uploaded_by
      and m.course_id=f.course_id and c.owner_id=m.created_by) then return null; end if;
  -- No slot for stale, deleted or unowned work. Processing ownership is rechecked
  -- by the guarded checkpoint RPC before launching each page.
  if p_provider='visual' then
    if not exists (select 1 from public.document_processing_jobs where document_id=p_document_id
      and lease_token=p_lease_token and lease_until>clock_timestamp()) then return null; end if;
  elsif p_provider='embedding' then
    if not exists (select 1 from public.document_indexing_jobs where document_id=p_document_id
      and lease_token=p_lease_token and lease_until>clock_timestamp()) then return null; end if;
  else return null; end if;
  select * into global_lim from public.document_provider_limits where provider='all' for update;
  if not found or global_lim.blocked_until>clock_timestamp() then return null; end if;
  -- Count only live slots here. Delete expired rows after taking the provider
  -- lock, matching release's provider -> slot order and avoiding deadlocks.
  if (select count(*) from public.document_provider_slots where expires_at>clock_timestamp())>=global_lim.concurrency then return null; end if;
  if global_lim.window_start+interval '1 minute'<=clock_timestamp() then
    update public.document_provider_limits set window_start=clock_timestamp(),starts=0 where provider='all' returning * into global_lim;
  end if;
  if global_lim.starts+3>global_lim.starts_per_minute then return null; end if;
  select * into lim from public.document_provider_limits where provider=p_provider for update;
  if not found or lim.blocked_until>clock_timestamp() then return null; end if;
  delete from public.document_provider_slots where provider=p_provider and expires_at<=clock_timestamp();
  if (select count(*) from public.document_provider_slots where provider=p_provider)>=lim.concurrency then return null; end if;
  if lim.window_start+interval '1 minute'<=clock_timestamp() then
    update public.document_provider_limits set window_start=clock_timestamp(),starts=0 where provider=p_provider returning * into lim;
  end if;
  -- Reserve the worst-case three HTTP attempts per acquired slot.
  if lim.starts+3>lim.starts_per_minute then return null; end if;
  update public.document_provider_limits set starts=starts+3 where provider in (p_provider,'all');
  insert into public.document_provider_slots(provider,document_id,expires_at)
    values(p_provider,p_document_id,clock_timestamp()+interval '90 seconds') returning token into slot;
  return slot;
end;
$$;
create function public.release_document_provider_slot(p_token uuid,p_retry_ms integer default 0)
returns void language plpgsql security definer set search_path='' as $$
declare kind text;
begin
  select provider into kind from public.document_provider_slots where token=p_token;
  -- Same lock order as acquire. A cooldown applies across documents.
  perform 1 from public.document_provider_limits where provider=kind for update;
  if p_retry_ms>0 then
    update public.document_provider_limits set blocked_until=greatest(blocked_until,
      clock_timestamp()+make_interval(secs=>least(p_retry_ms,86400000)/1000.0)) where provider=kind;
  end if;
  delete from public.document_provider_slots where token=p_token;
end;
$$;
create function public.yield_document_work(p_provider text,p_document_id uuid,p_lease_token uuid,
  p_delay_ms integer default 0,p_failed boolean default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare cp jsonb;
begin
  if p_provider='visual' then
    perform 1 from public.files f join public.document_processing_jobs j on j.file_id=f.id
      where j.document_id=p_document_id for update of f;
    select checkpoint into cp from public.document_processing_jobs where document_id=p_document_id;
    if cp is null or not public.save_document_processing_checkpoint(p_document_id,p_lease_token,cp,false) then return false; end if;
    update public.document_processing_jobs set lease_token=null,lease_until=null,
      attempts=case when p_failed is true then attempts when p_failed is false then 0 else greatest(0,attempts-1) end,
      available_at=clock_timestamp()+make_interval(secs=>greatest(0,least(p_delay_ms,86400000))/1000.0)
      where document_id=p_document_id;
  elsif p_provider='embedding' then
    perform 1 from public.source_documents where id=p_document_id for update;
    update public.document_indexing_jobs set lease_token=null,lease_until=null,
      attempts=case when p_failed is true then attempts when p_failed is false then 0 else greatest(0,attempts-1) end,
      available_at=clock_timestamp()+make_interval(secs=>greatest(0,least(p_delay_ms,86400000))/1000.0)
      where document_id=p_document_id and lease_token=p_lease_token and lease_until>clock_timestamp();
    return found;
  else return false; end if;
  return true;
end;
$$;

-- Separate from pre-existing, optional document_processing_runs instrumentation.
create table public.document_worker_events (
 id bigint generated always as identity primary key,
 document_id uuid not null references public.source_documents(id) on delete cascade,
 worker text not null check(worker in ('visual','embedding')),
 run_id uuid not null,
 event text not null check(event in ('started','finished','request','routing')),
 occurred_at timestamptz not null default clock_timestamp(),
 detail jsonb not null check(jsonb_typeof(detail)='object' and octet_length(detail::text)<65536)
);
create index on public.document_worker_events(document_id,occurred_at);
alter table public.document_worker_events enable row level security;
revoke all on public.document_worker_events from public,anon,authenticated;
grant all on public.document_worker_events to service_role;
grant usage, select on sequence public.document_worker_events_id_seq to service_role;

-- Logged jobs are the durable continuation. pg_net is merely a wakeup and may
-- lose its unlogged queue on restart: the next tick/minute recovers the job.
create function public.dispatch_document_work() returns void
language plpgsql security definer set search_path='' as $$
declare base text; secret text; kind text;
begin
 if not pg_try_advisory_xact_lock(20261002,1) then return; end if;
 select decrypted_secret into base from vault.decrypted_secrets where name='document_processing_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='document_processing_service_key';
 if base is null or secret is null then return; end if;
 if not exists (select 1 from public.document_provider_limits l where provider='all'
   and blocked_until<=clock_timestamp()
   and (window_start+interval '1 minute'<=clock_timestamp() or starts+3<=starts_per_minute)
   and (select count(*) from public.document_provider_slots where expires_at>clock_timestamp())<l.concurrency) then return; end if;
 for kind in select 'process' where exists (select 1 from public.document_processing_jobs
   where available_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()))
   union all select 'index' where exists (select 1 from public.document_indexing_jobs
   where available_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()))
 loop
   -- Do not repeatedly download/parse queued documents while capacity is exhausted.
   if not exists (select 1 from public.document_provider_limits l
     where l.provider=case kind when 'process' then 'visual' else 'embedding' end
       and l.blocked_until<=clock_timestamp()
       and (l.window_start+interval '1 minute'<=clock_timestamp() or l.starts+3<=l.starts_per_minute)
       and (select count(*) from public.document_provider_slots s
         where s.provider=l.provider and s.expires_at>clock_timestamp())<l.concurrency) then continue; end if;
   perform net.http_post(url:=replace(base,'/documents-process','/documents-'||kind),
     headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),
     body:='{}'::jsonb,timeout_milliseconds:=90000);
 end loop;
end;
$$;
-- Sub-minute cron is supported by current Supabase pg_cron. No recursive HTTP calls.
select cron.schedule('learning-documents-dispatch','5 seconds','select public.dispatch_document_work()');
-- Existing minute schedules deliberately remain the recovery path.
revoke all on function public.save_document_processing_page(uuid,uuid,jsonb),
 public.acquire_document_provider_slot(text,uuid,uuid),public.release_document_provider_slot(uuid,integer),
 public.yield_document_work(text,uuid,uuid,integer,boolean),public.dispatch_document_work() from public,anon,authenticated;
grant execute on function public.save_document_processing_page(uuid,uuid,jsonb),
 public.acquire_document_provider_slot(text,uuid,uuid),public.release_document_provider_slot(uuid,integer),
 public.yield_document_work(text,uuid,uuid,integer,boolean),public.dispatch_document_work() to service_role;

create view public.document_worker_metrics with (security_invoker=true) as
with events as (
 select e.* from public.document_worker_events e join public.document_pipeline_timings t on t.document_id=e.document_id
 where e.occurred_at>=coalesce(t.processing_queued_at,t.upload_completed_at)
), runs as (
 select document_id,worker,run_id,min(occurred_at) filter(where event='started') as started_at,
 max(occurred_at) filter(where event='finished') as finished_at,
 max((detail->>'duration_ms')::double precision) filter(where event='finished') as active_ms
 from events group by document_id,worker,run_id
), gaps as (
 select *,greatest(0,extract(epoch from (started_at-lag(finished_at) over(partition by document_id,worker order by started_at)))*1000) as gap_ms from runs
), aggregate_runs as (
 select document_id,sum(active_ms) as worker_active_ms,sum(gap_ms) as between_steps_ms,
 count(*) filter(where finished_at is null) as interrupted_or_running from gaps group by document_id
), requests as (
 select document_id,
 sum((detail->>'duration_ms')::double precision) filter(where worker='visual') as gemini_request_ms,
 sum((detail->>'duration_ms')::double precision) filter(where worker='embedding') as embedding_request_ms,
 count(*) filter(where worker='embedding' and detail->>'status'='completed' and (detail->>'chunks')::int>0) as embedding_batches,
 sum(greatest(0,jsonb_array_length(coalesce(detail->'attempts','[]'::jsonb))-1)) as inline_retries,
 count(*) filter(where detail->>'status'='failed') as failed_requests
 from events where event='request' group by document_id
)
select t.document_id,t.processing_wait,t.indexing_wait,t.total_duration,
 a.worker_active_ms,a.between_steps_ms,a.interrupted_or_running,
 r.gemini_request_ms,r.embedding_request_ms,r.embedding_batches,r.inline_retries,r.failed_requests
from public.document_pipeline_timings t left join aggregate_runs a on a.document_id=t.document_id
left join requests r on r.document_id=t.document_id;
revoke all on public.document_worker_metrics from public,anon,authenticated;
grant select on public.document_worker_metrics to service_role;
commit;
