begin;

alter table public.summaries add column generation_kind text not null default 'manual'
 check (generation_kind in ('manual','document','course'));
-- Existing column grants intentionally exclude generation_kind.
create policy summaries_generated_readonly on public.summaries as restrictive
 for update to authenticated using (generation_kind='manual') with check (generation_kind='manual');

create table public.summary_jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 course_id uuid not null references public.courses(id) on delete cascade,
 document_id uuid,
 kind text not null check(kind in ('document','course')),
 fingerprint text not null,
 sources jsonb not null,
 configuration jsonb not null,
 status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
 checkpoint jsonb,
 completed_steps integer not null default 0,
 total_steps integer not null default 0,
 phase text not null default 'queued',
 attempts integer not null default 0,
 retries integer not null default 0,
 lease_token uuid,
 lease_until timestamptz,
 available_at timestamptz not null default now(),
 summary_id uuid references public.summaries(id) on delete set null,
 error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((kind='document')=(document_id is not null))
);
create unique index summary_jobs_dedup on public.summary_jobs(owner_id,course_id,kind,coalesce(document_id,'00000000-0000-0000-0000-000000000000'::uuid),fingerprint)
 where status in ('queued','processing','completed');
create index summary_jobs_due on public.summary_jobs(available_at) where status in ('queued','processing');
create table public.summary_requests (
 owner_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null,
 target jsonb not null,
 job_id uuid not null references public.summary_jobs(id) on delete cascade,
 primary key(owner_id,request_id)
);
create table public.summary_generations (
 summary_id uuid primary key references public.summaries(id) on delete cascade,
 course_id uuid not null references public.courses(id) on delete cascade,
 document_id uuid,
 kind text not null check(kind in ('document','course')),
 fingerprint text not null,
 configuration jsonb not null,
 sources jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.summary_jobs enable row level security;
alter table public.summary_requests enable row level security;
alter table public.summary_generations enable row level security;
revoke all on public.summary_jobs,public.summary_requests,public.summary_generations from public,anon,authenticated;
grant all on public.summary_jobs,public.summary_requests,public.summary_generations to service_role;
grant select on public.summary_generations to authenticated;
create policy summary_generations_owned on public.summary_generations for select to authenticated
 using (exists(select 1 from public.courses c where c.id=course_id and c.owner_id=(select auth.uid())));

-- One ordered database snapshot, independent of the Data API row limit. Text and
-- pages are hashed together; no top-k retrieval or silently omitted documents.
create function public.summary_source_snapshot(p_course_id uuid,p_document_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'material_id',m.id,'file_id',m.file_id,
 'title',m.title,'status',d.processing_status,'file_status',f.status,
 'text',d.extracted_text,'pages',d.pages) order by d.id),'[]'::jsonb)
 from public.source_documents d join public.materials m on m.id=d.material_id
 left join public.files f on f.id=m.file_id
 where m.course_id=p_course_id and (p_document_id is null or d.id=p_document_id)
$$;

create function public.enqueue_summary(p_owner_id uuid,p_request_id uuid,p_kind text,
 p_target_id uuid,p_configuration jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid; did uuid; src jsonb; fp text; jid uuid; existing public.summary_requests;
 target jsonb; bad jsonb; max_chars integer;
begin
 if p_kind not in ('document','course') or p_kind is null or p_request_id is null or p_target_id is null then
   raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,8102));
 if p_kind='document' then
   did:=p_target_id;
   select m.course_id into cid from public.source_documents d join public.materials m on m.id=d.material_id
    join public.courses c on c.id=m.course_id where d.id=did and c.owner_id=p_owner_id;
 else
   select id into cid from public.courses where id=p_target_id and owner_id=p_owner_id;
 end if;
 if cid is null then raise exception 'TARGET_NOT_FOUND' using errcode='P0002'; end if;
 target:=jsonb_build_object('type',p_kind,'id',p_target_id);
 select * into existing from public.summary_requests where owner_id=p_owner_id and request_id=p_request_id;
 if found then
   if existing.target<>target then raise exception 'REQUEST_CONFLICT' using errcode='22023'; end if;
   return public.read_summary(p_owner_id,existing.job_id,null);
 end if;
 max_chars:=least(2000000,greatest(1,(p_configuration->>'maxSourceCharacters')::integer));
 if max_chars is null or p_configuration->>'version' is distinct from 'summary-v1' then
   raise exception 'INVALID_CONFIGURATION' using errcode='22023'; end if;
 -- Bound allocation before collecting source text. Count pages too since page JSON
 -- can be larger than extracted_text. These are explicit request rejection limits.
 if (select coalesce(sum(length(coalesce(d.extracted_text,''))+length(coalesce(d.pages::text,''))),0)
   from public.source_documents d join public.materials m on m.id=d.material_id
   where m.course_id=cid and (did is null or d.id=did)) > max_chars*3
   then raise exception 'SOURCE_LIMIT_EXCEEDED' using errcode='54000'; end if;
 src:=public.summary_source_snapshot(cid,did);
 if jsonb_array_length(src)=0 then raise exception 'NO_SOURCES' using errcode='22023'; end if;
 select jsonb_agg(s->>'id') into bad from jsonb_array_elements(src) s
   where s->>'status' is distinct from 'ready' or s->>'file_status' is distinct from 'ready'
     or nullif(btrim(s->>'text'),'') is null;
 if bad is not null then raise exception 'SOURCES_NOT_READY' using errcode='55000',detail=bad::text; end if;
 if (select sum(length(s->>'text')) from jsonb_array_elements(src) s)>max_chars
   or jsonb_array_length(src)>200 then raise exception 'SOURCE_LIMIT_EXCEEDED' using errcode='54000'; end if;
 fp:=md5(src::text||p_configuration::text);
 select id into jid from public.summary_jobs where owner_id=p_owner_id and course_id=cid
   and kind=p_kind and document_id is not distinct from did and fingerprint=fp
   and (status in ('queued','processing') or (status='completed' and summary_id is not null));
 if jid is null then
   -- Deleted results must no longer occupy the dedup key.
   update public.summary_jobs set status='failed',error_code='RESULT_DELETED'
    where owner_id=p_owner_id and status='completed' and summary_id is null;
   if (select count(*) from public.summary_jobs where owner_id=p_owner_id and status in ('queued','processing'))>=2
     or (select count(*) from public.summary_jobs where owner_id=p_owner_id and created_at>now()-interval '1 hour')>=10 then
     raise exception 'SUMMARY_RATE_LIMITED' using errcode='53300'; end if;
   insert into public.summary_jobs(owner_id,course_id,document_id,kind,fingerprint,sources,configuration)
    values(p_owner_id,cid,did,p_kind,fp,src,p_configuration) returning id into jid;
 end if;
 insert into public.summary_requests values(p_owner_id,p_request_id,target,jid);
 return public.read_summary(p_owner_id,jid,null);
end $$;

create function public.read_summary(p_owner_id uuid,p_job_id uuid default null,p_summary_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.summary_jobs; g public.summary_generations; result jsonb;
begin
 if p_job_id is not null then
   select * into j from public.summary_jobs where id=p_job_id and owner_id=p_owner_id
    and exists(select 1 from public.courses where id=course_id and owner_id=p_owner_id);
   if not found then raise exception 'SUMMARY_NOT_FOUND' using errcode='P0002'; end if;
   return jsonb_build_object('job_id',j.id,'status',j.status,'phase',j.phase,
    'completed_steps',j.completed_steps,'total_steps',j.total_steps,'summary_id',j.summary_id,
    'error_code',j.error_code,'created_at',j.created_at,'updated_at',j.updated_at);
 end if;
 select g0.* into g from public.summary_generations g0 join public.courses c on c.id=g0.course_id
  where g0.summary_id=p_summary_id and c.owner_id=p_owner_id;
 if not found then raise exception 'SUMMARY_NOT_FOUND' using errcode='P0002'; end if;
 select jsonb_build_object('summary_id',s.id,'material_id',s.material_id,'content',s.content,
  'target',jsonb_build_object('type',g.kind,'course_id',g.course_id,'source_document_id',g.document_id),
  'sources',g.sources,'created_at',g.created_at,
  'is_stale',md5(public.summary_source_snapshot(g.course_id,g.document_id)::text||g.configuration::text)<>g.fingerprint)
 into result from public.summaries s where s.id=g.summary_id;
 return result;
end $$;

create function public.retry_summary(p_owner_id uuid,p_job_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.summary_jobs;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,8102));
 select * into j from public.summary_jobs where id=p_job_id and owner_id=p_owner_id for update;
 if not found then raise exception 'SUMMARY_NOT_FOUND' using errcode='P0002'; end if;
 if j.status<>'failed' then return public.read_summary(p_owner_id,j.id,null); end if;
 if j.error_code in ('SOURCE_CHANGED','RESULT_DELETED','BUDGET_EXCEEDED') then
  raise exception 'NEW_REQUEST_REQUIRED' using errcode='55000'; end if;
 if j.retries>=3 or j.updated_at>now()-interval '5 seconds' or
  (select count(*) from public.summary_jobs where owner_id=p_owner_id and status in ('queued','processing'))>=2
  then raise exception 'SUMMARY_RATE_LIMITED' using errcode='53300'; end if;
 if md5(public.summary_source_snapshot(j.course_id,j.document_id)::text||j.configuration::text)<>j.fingerprint then
  raise exception 'SOURCE_CHANGED' using errcode='55000'; end if;
 if exists(select 1 from public.summary_jobs where id<>j.id and owner_id=j.owner_id and course_id=j.course_id
   and kind=j.kind and document_id is not distinct from j.document_id and fingerprint=j.fingerprint
   and status in ('queued','processing','completed')) then raise exception 'NEW_REQUEST_REQUIRED' using errcode='55000'; end if;
 update public.summary_jobs set status='queued',attempts=0,retries=retries+1,error_code=null,
  available_at=now(),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 return public.read_summary(p_owner_id,j.id,null);
end $$;

create function public.claim_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.summary_jobs;
begin
 select * into j from public.summary_jobs where status in ('queued','processing')
  and available_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp())
  order by available_at for update skip locked limit 1;
 if not found then return null; end if;
 if j.attempts>=3 or md5(public.summary_source_snapshot(j.course_id,j.document_id)::text||j.configuration::text)<>j.fingerprint then
  update public.summary_jobs set status='failed',error_code=case when j.attempts>=3 then 'SUMMARY_PROCESSING_FAILED' else 'SOURCE_CHANGED' end,
   lease_token=null,lease_until=null,updated_at=now() where id=j.id;
  return null;
 end if;
 update public.summary_jobs set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),
  lease_until=clock_timestamp()+interval '2 minutes',updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j);
end $$;

-- Each successful paid step is a durable checkpoint. Only the current lease can
-- publish. Final material, result and metadata are committed in this transaction.
create function public.save_summary_step(p_job_id uuid,p_lease_token uuid,p_checkpoint jsonb,
 p_completed integer,p_total integer,p_phase text,p_content jsonb default null,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.summary_jobs; mid uuid; sid uuid; refs jsonb;
begin
 select * into j from public.summary_jobs where id=p_job_id for update;
 if not found or j.status<>'processing' or j.lease_token is distinct from p_lease_token
  or j.lease_until<=clock_timestamp() then return false; end if;
 if md5(public.summary_source_snapshot(j.course_id,j.document_id)::text||j.configuration::text)<>j.fingerprint then
  p_error:='SOURCE_CHANGED'; end if;
 if p_error is not null then
  update public.summary_jobs set status='failed',error_code=p_error,lease_token=null,lease_until=null,updated_at=now() where id=j.id;
  return true;
 end if;
 if p_completed<0 or p_total<1 or p_completed>p_total or p_total>2000
  or octet_length(p_checkpoint::text)>16000000 then raise exception 'INVALID_SUMMARY_STEP' using errcode='22023'; end if;
 if p_content is not null then
  if p_completed<>p_total or nullif(btrim(p_content->>'text'),'') is null
    or length(p_content->>'text')>20000 then raise exception 'INVALID_SUMMARY_RESULT' using errcode='22023'; end if;
  select jsonb_agg(s-'text'-'pages'-'status'-'file_status') into refs from jsonb_array_elements(j.sources) s;
  insert into public.materials(course_id,created_by,type,title) values(j.course_id,j.owner_id,'summary',
   case when j.kind='course' then 'Kurszusammenfassung' else 'Zusammenfassung: '||(j.sources->0->>'title') end) returning id into mid;
  insert into public.summaries(material_id,source_file_id,content,generation_kind)
   values(mid,case when j.kind='document' then (j.sources->0->>'file_id')::uuid else null end,p_content,j.kind) returning id into sid;
  insert into public.summary_generations(summary_id,course_id,document_id,kind,fingerprint,configuration,sources)
   values(sid,j.course_id,j.document_id,j.kind,j.fingerprint,j.configuration,refs);
 end if;
 update public.summary_jobs set checkpoint=case when sid is not null then null else p_checkpoint end,
  completed_steps=p_completed,total_steps=p_total,phase=p_phase,attempts=0,lease_token=null,lease_until=null,
  available_at=now(),status=case when sid is not null then 'completed' else 'queued' end,
  summary_id=coalesce(sid,summary_id),updated_at=now() where id=j.id;
 return true;
end $$;

-- Reuse the existing deployment-managed Vault URL/key; no additional secret.
create function public.dispatch_summary_work() returns void
language plpgsql security definer set search_path='' as $$
declare base text; secret text;
begin
 if not pg_try_advisory_xact_lock(20261002,2) then return; end if;
 if not exists(select 1 from public.summary_jobs where status in ('queued','processing')
  and available_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp())) then return; end if;
 select decrypted_secret into base from vault.decrypted_secrets where name='document_processing_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='document_processing_service_key';
 if base is null or secret is null then return; end if;
 perform net.http_post(url:=replace(base,'/documents-process','/summaries-process'),
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),
  body:='{}'::jsonb,timeout_milliseconds:=90000);
end $$;
select cron.schedule('learning-summaries-dispatch','10 seconds','select public.dispatch_summary_work()');

revoke all on function public.summary_source_snapshot(uuid,uuid),
 public.enqueue_summary(uuid,uuid,text,uuid,jsonb),public.read_summary(uuid,uuid,uuid),
 public.retry_summary(uuid,uuid),public.claim_summary(),
 public.save_summary_step(uuid,uuid,jsonb,integer,integer,text,jsonb,text),public.dispatch_summary_work()
 from public,anon,authenticated;
grant execute on function public.summary_source_snapshot(uuid,uuid),
 public.enqueue_summary(uuid,uuid,text,uuid,jsonb),public.read_summary(uuid,uuid,uuid),
 public.retry_summary(uuid,uuid),public.claim_summary(),
 public.save_summary_step(uuid,uuid,jsonb,integer,integer,text,jsonb,text),public.dispatch_summary_work()
 to service_role;
commit;
