begin;
create table public.flashcard_jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 course_id uuid not null references public.courses(id) on delete cascade,
 request_id uuid not null,
 document_ids uuid[] not null,
 requested_count integer check(requested_count between 1 and 300),
 fingerprint text not null,
 sources jsonb not null,
 configuration jsonb not null,
 status text not null default 'queued' check(status in ('queued','processing','estimated','review','completed','failed','cancelled')),
 phase text not null default 'analyze' check(phase in ('analyze','generate')),
 checkpoint jsonb,
 attempts integer not null default 0,
 retries integer not null default 0,
 paid_calls integer not null default 0,
 reserved_tokens bigint not null default 0,
 lease_token uuid,
 lease_until timestamptz,
 error_code text,
 material_id uuid references public.materials(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_id,request_id)
);
create index flashcard_jobs_due on public.flashcard_jobs(created_at) where status in ('queued','processing');
alter table public.flashcard_jobs enable row level security;
revoke all on public.flashcard_jobs from public,anon,authenticated;
grant all on public.flashcard_jobs to service_role;

create function public.flashcard_snapshot(p_course uuid,p_documents uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(s order by s->>'id'),'[]'::jsonb)
 from jsonb_array_elements(public.summary_source_snapshot(p_course)) s where (s->>'id')::uuid=any(p_documents)
$$;
create function public.flashcard_job_view(p_job public.flashcard_jobs) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',p_job.id,'status',p_job.status,'phase',p_job.phase,'error_code',p_job.error_code,
 'material_id',p_job.material_id,'requested_count',p_job.requested_count,
 'analyzed',coalesce((p_job.checkpoint->>'analyzed')::integer,0),
 'total',coalesce(jsonb_array_length(p_job.checkpoint->'chunks'),0),
 'estimated_count',coalesce(jsonb_array_length(p_job.checkpoint->'selected'),0),
 'generated',coalesce((p_job.checkpoint->>'generated')::integer,0),
 'cards',case when p_job.status='review' then p_job.checkpoint->'cards' else '[]'::jsonb end,
 'sources',coalesce(p_job.checkpoint->'sources','[]'::jsonb))
$$;

-- Only the authenticated Edge Function may supply the verified owner ID.
create function public.flashcard_action(p_owner uuid,p_body jsonb,p_configuration jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare action text:=p_body->>'action'; cid uuid; docs uuid[]; src jsonb; fp text;
 j public.flashcard_jobs; request uuid; wanted integer; card jsonb; original jsonb; mid uuid; did uuid; refs jsonb; title text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,8103));
 if action in ('documents','list','analyze') then
  cid:=(p_body->>'course_id')::uuid;
  if not exists(select 1 from public.courses where id=cid and owner_id=p_owner) then raise exception 'TARGET_NOT_FOUND'; end if;
  if action='documents' then
   return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',m.title,'ready',d.processing_status='ready' and f.status='ready' and nullif(btrim(d.extracted_text),'') is not null) order by m.title)
    from public.source_documents d join public.materials m on m.id=d.material_id left join public.files f on f.id=m.file_id where m.course_id=cid),'[]'::jsonb);
  end if;
  if action='list' then
   return coalesce((select jsonb_agg(public.flashcard_job_view(x) order by x.created_at desc) from (select * from public.flashcard_jobs where owner_id=p_owner and course_id=cid and status not in ('cancelled','completed') order by created_at desc limit 20) x),'[]'::jsonb);
  end if;
  request:=(p_body->>'request_id')::uuid;
  if request is null or jsonb_typeof(p_body->'document_ids') is distinct from 'array' then raise exception 'INVALID_REQUEST'; end if;
  select array_agg(distinct value::uuid order by value::uuid) into docs from jsonb_array_elements_text(p_body->'document_ids');
  wanted:=(p_body->>'count')::integer;
  if docs is null or cardinality(docs)>200 or (wanted is not null and (wanted<1 or wanted>300)) then raise exception 'INVALID_REQUEST'; end if;
  select * into j from public.flashcard_jobs where owner_id=p_owner and request_id=request;
  if found then
   if j.course_id<>cid or j.document_ids<>docs or j.requested_count is distinct from wanted then raise exception 'REQUEST_CONFLICT'; end if;
   return public.flashcard_job_view(j);
  end if;
  if p_configuration->>'version' is distinct from 'flashcards-v1' then raise exception 'INVALID_REQUEST'; end if;
  if (select coalesce(sum(length(coalesce(d.extracted_text,''))+length(coalesce(d.pages::text,''))),0) from public.source_documents d join public.materials m on m.id=d.material_id where m.course_id=cid and d.id=any(docs))>1500000 then raise exception 'SOURCE_LIMIT_EXCEEDED'; end if;
  src:=public.flashcard_snapshot(cid,docs);
  if jsonb_array_length(src)<>cardinality(docs) then raise exception 'TARGET_NOT_FOUND'; end if;
  if exists(select 1 from jsonb_array_elements(src) s where s->>'status' is distinct from 'ready' or s->>'file_status' is distinct from 'ready' or nullif(btrim(s->>'text'),'') is null) then raise exception 'SOURCES_NOT_READY'; end if;
  if (select sum(length(s->>'text')) from jsonb_array_elements(src) s)>500000 then raise exception 'SOURCE_LIMIT_EXCEEDED'; end if;
  fp:=md5(src::text||p_configuration::text||coalesce(wanted::text,'auto'));
  select * into j from public.flashcard_jobs where owner_id=p_owner and course_id=cid and fingerprint=fp and status not in ('failed','cancelled') and (status<>'completed' or material_id is not null) order by created_at desc limit 1;
  if found then return public.flashcard_job_view(j); end if;
  if (select count(*) from public.flashcard_jobs where owner_id=p_owner and status in ('queued','processing','estimated','review'))>=4
   or (select count(*) from public.flashcard_jobs where owner_id=p_owner and created_at>now()-interval '1 hour')>=10 then raise exception 'RATE_LIMITED'; end if;
  insert into public.flashcard_jobs(owner_id,course_id,request_id,document_ids,requested_count,fingerprint,sources,configuration)
   values(p_owner,cid,request,docs,wanted,fp,src,p_configuration) returning * into j;
  return public.flashcard_job_view(j);
 end if;
 select * into j from public.flashcard_jobs where id=(p_body->>'job_id')::uuid and owner_id=p_owner for update;
 if not found or not exists(select 1 from public.courses where id=j.course_id and owner_id=p_owner) then raise exception 'TARGET_NOT_FOUND'; end if;
 if action='status' then return public.flashcard_job_view(j); end if;
 if action='cancel' then
  if j.status<>'completed' then update public.flashcard_jobs set status='cancelled',lease_token=null,lease_until=null,updated_at=now() where id=j.id returning * into j; end if;
  return public.flashcard_job_view(j);
 end if;
 if action='save' and j.status='completed' then return public.flashcard_job_view(j); end if;
 if md5(public.flashcard_snapshot(j.course_id,j.document_ids)::text||j.configuration::text||coalesce(j.requested_count::text,'auto'))<>j.fingerprint then raise exception 'SOURCE_CHANGED'; end if;
 if action='generate' then
  if j.status='estimated' then update public.flashcard_jobs set status='queued',phase='generate',updated_at=now() where id=j.id returning * into j; end if;
 elsif action='retry' then
  if j.status<>'failed' then return public.flashcard_job_view(j); end if;
  if j.retries>=3 or j.error_code in ('BUDGET_EXCEEDED','POINT_LIMIT_EXCEEDED','NO_LEARNING_CONTENT','SOURCE_CHANGED') then raise exception 'NEW_REQUEST_REQUIRED'; end if;
  update public.flashcard_jobs set status='queued',attempts=0,retries=retries+1,error_code=null,lease_token=null,lease_until=null,updated_at=now() where id=j.id returning * into j;
 elsif action='save' then
  if j.status<>'review' then raise exception 'INVALID_REQUEST'; end if;
  title:=btrim(p_body->>'title');
  if title is null or length(title) not between 1 and 200 or jsonb_typeof(p_body->'cards') is distinct from 'array' then raise exception 'INVALID_REQUEST'; end if;
  if jsonb_array_length(p_body->'cards') not between 1 and 300 or
   (select count(distinct c->>'id') from jsonb_array_elements(p_body->'cards') c)<>jsonb_array_length(p_body->'cards') then raise exception 'INVALID_REQUEST'; end if;
  insert into public.materials(course_id,created_by,type,title) values(j.course_id,p_owner,'flashcard_deck',title) returning id into mid;
  insert into public.flashcard_decks(material_id,title) values(mid,title) returning id into did;
  for card in select value from jsonb_array_elements(p_body->'cards') loop
   select c into original from jsonb_array_elements(j.checkpoint->'cards') c where c->>'id'=card->>'id';
   if original is null or jsonb_typeof(card->'question') is distinct from 'string' or jsonb_typeof(card->'answer') is distinct from 'string' or length(btrim(card->>'question')) not between 1 and 500 or length(btrim(card->>'answer')) not between 1 and 2000 then raise exception 'INVALID_REQUEST'; end if;
   select jsonb_agg(s) into refs from jsonb_array_elements(j.checkpoint->'sources') s where original->'source_ids' ? (s->>'id');
   insert into public.flashcards(deck_id,question,answer,additional_content) values(did,btrim(card->>'question'),btrim(card->>'answer'),jsonb_build_object('generated',true,'sources',refs,'generation_job_id',j.id));
  end loop;
  update public.flashcard_jobs set status='completed',material_id=mid,updated_at=now() where id=j.id returning * into j;
 else raise exception 'INVALID_REQUEST'; end if;
 return public.flashcard_job_view(j);
end $$;

create function public.claim_flashcard_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.flashcard_jobs;
begin
 select * into j from public.flashcard_jobs where status in ('queued','processing') and (lease_until is null or lease_until<=clock_timestamp()) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 if j.attempts>=3 then
  update public.flashcard_jobs set status='failed',error_code='PROCESSING_FAILED',lease_token=null,lease_until=null,updated_at=now() where id=j.id; return null;
 end if;
 update public.flashcard_jobs set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create function public.reserve_flashcard_call(p_job uuid,p_lease uuid,p_tokens integer) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.flashcard_jobs;
begin
 select * into j from public.flashcard_jobs where id=p_job for update;
 if not found or j.status<>'processing' or j.lease_token is distinct from p_lease or j.lease_until<=clock_timestamp() then return false; end if;
 if p_tokens is null or p_tokens<1 or j.reserved_tokens+p_tokens>(j.configuration->>'tokenBudget')::bigint or j.paid_calls>=(j.configuration->>'maxCalls')::integer then
  update public.flashcard_jobs set status='failed',error_code='BUDGET_EXCEEDED',lease_token=null,lease_until=null,updated_at=now() where id=j.id; return false;
 end if;
 update public.flashcard_jobs set paid_calls=paid_calls+1,reserved_tokens=reserved_tokens+p_tokens where id=j.id;
 return true;
end $$;
create function public.save_flashcard_step(p_job uuid,p_lease uuid,p_checkpoint jsonb,p_status text,p_error text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.flashcard_jobs;
begin
 select * into j from public.flashcard_jobs where id=p_job for update;
 if not found or j.status<>'processing' or j.lease_token is distinct from p_lease or j.lease_until<=clock_timestamp() then return false; end if;
 if md5(public.flashcard_snapshot(j.course_id,j.document_ids)::text||j.configuration::text||coalesce(j.requested_count::text,'auto'))<>j.fingerprint then p_error:='SOURCE_CHANGED'; end if;
 if p_status not in ('queued','estimated','review','failed') or octet_length(p_checkpoint::text)>16000000 then raise exception 'INVALID_REQUEST'; end if;
 update public.flashcard_jobs set checkpoint=coalesce(p_checkpoint,checkpoint),status=case when p_error is not null then 'failed' else p_status end,error_code=p_error,attempts=0,lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 return true;
end $$;
create function public.dispatch_flashcard_work() returns void language plpgsql security definer set search_path='' as $$
declare base text; secret text;
begin
 if not pg_try_advisory_xact_lock(20261003,3) then return; end if;
 if not exists(select 1 from public.flashcard_jobs where status in ('queued','processing') and (lease_until is null or lease_until<=clock_timestamp())) then return; end if;
 select decrypted_secret into base from vault.decrypted_secrets where name='document_processing_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='document_processing_service_key';
 if base is null or secret is null then return; end if;
 perform net.http_post(url:=replace(base,'/documents-process','/flashcards-process'),headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}'::jsonb,timeout_milliseconds:=90000);
end $$;
select cron.schedule('learning-flashcards-dispatch','10 seconds','select public.dispatch_flashcard_work()');
revoke all on function public.flashcard_snapshot(uuid,uuid[]),public.flashcard_job_view(public.flashcard_jobs),public.flashcard_action(uuid,jsonb,jsonb),public.claim_flashcard_job(),public.reserve_flashcard_call(uuid,uuid,integer),public.save_flashcard_step(uuid,uuid,jsonb,text,text),public.dispatch_flashcard_work() from public,anon,authenticated;
grant execute on function public.flashcard_snapshot(uuid,uuid[]),public.flashcard_job_view(public.flashcard_jobs),public.flashcard_action(uuid,jsonb,jsonb),public.claim_flashcard_job(),public.reserve_flashcard_call(uuid,uuid,integer),public.save_flashcard_step(uuid,uuid,jsonb,text,text),public.dispatch_flashcard_work() to service_role;
commit;
