begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.courses(id,owner_id,title) values
 ('95000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Visual extraction');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.prepare_file_upload('95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000002','scan.pdf','application/pdf',500);
select throws_ok($$select public.save_document_processing_checkpoint(gen_random_uuid(),gen_random_uuid(),'{}')$$,'42501',null,'Users cannot write extraction checkpoints');
reset role;
create temporary table throughput_fixture as select id as file_id, null::uuid as document_id,
 null::uuid as token, null::uuid as old_token,
 '{"version":"visual-blocks-v1","model":"gemini-3.6-flash","pages":[{"page":1,"text":"local","route":"local"},{"page":2,"text":"","route":"visual"},{"page":3,"text":"","route":"visual"}]}'::jsonb as checkpoint
 from public.files where upload_key='95000000-0000-0000-0000-000000000002';
grant select, update on throughput_fixture to service_role;
set local role service_role;
select public.complete_file_upload(file_id,'11111111-1111-1111-1111-111111111111') from throughput_fixture;
update throughput_fixture v set document_id=d.id from public.source_documents d
 join public.materials m on m.id=d.material_id where m.file_id=v.file_id;
update throughput_fixture set token=(public.claim_document_processing(document_id)->>'lease_token')::uuid;
select is((select public.save_document_processing_checkpoint(document_id,gen_random_uuid(),checkpoint) from throughput_fixture),false,'Wrong lease cannot save');
select throws_ok($$select public.save_document_processing_checkpoint(document_id,token,'{"version":"visual-blocks-v1","model":"gemini-3.6-flash","pages":[{"page":2,"text":"x","route":"visual"}]}') from throughput_fixture$$,'22023','INVALID_PROCESSING_CHECKPOINT','Checkpoint validates page mapping');
select is((select public.save_document_processing_checkpoint(document_id,token,checkpoint,false) from throughput_fixture),true,'Initial scan is durable before paid work');

reset role;
select is((select schedule from cron.job where jobname='learning-documents-dispatch'),'5 seconds','Fast dispatcher is scheduled independently of minute recovery');
set local role service_role;
select is((select public.save_document_processing_page(document_id,token,'{"page":3,"text":"third","route":"visual","extraction":{"version":"visual-blocks-v1"}}') from throughput_fixture),true,'Out of order third page saved');
select is((select public.save_document_processing_page(document_id,token,'{"page":2,"text":"second","route":"visual","extraction":{"version":"visual-blocks-v1"}}') from throughput_fixture),true,'Second page merges, never overwrites third');
select is((select checkpoint->'pages'->2->>'text' from public.document_processing_jobs where document_id=(select document_id from throughput_fixture)),'third','Earlier parallel result retained');
select is((select public.save_document_processing_page(document_id,token,'{"page":2,"text":"changed","route":"visual","extraction":{"version":"visual-blocks-v1"}}') from throughput_fixture),false,'Successful page immutable');
select is((select public.save_document_processing_page(document_id,gen_random_uuid(),'{"page":2,"text":"second","route":"visual","extraction":{"version":"visual-blocks-v1"}}') from throughput_fixture),false,'Stale lease cannot acknowledge a page');
insert into public.document_worker_events(document_id,worker,run_id,event,detail)
 select document_id,'visual',gen_random_uuid(),'request','{"duration_ms":150,"status":"completed","attempts":[]}' from throughput_fixture;
insert into public.document_worker_events(document_id,worker,run_id,event,detail)
 select document_id,'visual',gen_random_uuid(),'request','{"duration_ms":75,"status":"failed","attempts":[{"duration_ms":75,"status":429}]}' from throughput_fixture;
select is((select gemini_request_ms from public.document_worker_metrics where document_id=(select document_id from throughput_fixture)),225::double precision,'Metrics include real request time from successes and failures');
select is((select failed_requests::int from public.document_worker_metrics where document_id=(select document_id from throughput_fixture)),1,'Failure count is separate');
create temporary table slots as select public.acquire_document_provider_slot('visual',document_id,token) as token from throughput_fixture cross join generate_series(1,3);
select is((select count(token)::int from slots),3,'Global semaphore grants at most three slots');
select is((select public.acquire_document_provider_slot('visual',document_id,token) from throughput_fixture),null::uuid,'Fourth simultaneous slot denied');
select public.release_document_provider_slot(token,0) from slots;
update public.document_provider_limits set starts=starts_per_minute where provider='visual';
select is((select public.acquire_document_provider_slot('visual',document_id,token) from throughput_fixture),null::uuid,'Request quota blocks additional starts');
update public.document_provider_limits set starts=0 where provider='visual';
select public.release_document_provider_slot(public.acquire_document_provider_slot('visual',document_id,token),120000) from throughput_fixture;
select is((select public.acquire_document_provider_slot('visual',document_id,token) from throughput_fixture),null::uuid,'Retry-After cooldown shared across workers');
select is((select public.yield_document_work('visual',document_id,token,5000,true) from throughput_fixture),true,'Transient failure yields durably');
select is((select attempts from public.document_processing_jobs where document_id=(select document_id from throughput_fixture)),1,'Failure preserves retry counter');
select is((select public.claim_document_processing(document_id) from throughput_fixture),null::jsonb,'Retry not claimable before available_at');
update public.document_processing_jobs set available_at=now()-interval '1 second' where document_id=(select document_id from throughput_fixture);
update throughput_fixture set old_token=token,token=(public.claim_document_processing(document_id)->>'lease_token')::uuid;
select is((select public.yield_document_work('visual',document_id,old_token,0,false) from throughput_fixture),false,'Stale worker cannot release new lease');
update public.document_processing_jobs set attempts=3,lease_until=now()-interval '1 second' where document_id=(select document_id from throughput_fixture);
select is((select public.claim_document_processing(document_id) from throughput_fixture),null::jsonb,'Exhausted retries stop automatic processing');
select is((select checkpoint->'pages'->1->>'text' from public.document_processing_jobs where document_id=(select document_id from throughput_fixture)),'second','Exhausted retry keeps paid pages');
select is((select available_at from public.document_processing_jobs where document_id=(select document_id from throughput_fixture)),'infinity'::timestamptz,'Exhausted job is parked, not continuously dispatched');
reset role;
grant select on throughput_fixture to authenticated;
set local role authenticated;
select public.retry_document_processing(document_id) from throughput_fixture;
reset role;
set local role service_role;
update public.document_processing_jobs set available_at=now()-interval '1 second' where document_id=(select document_id from throughput_fixture);
update throughput_fixture set token=(public.claim_document_processing(document_id)->>'lease_token')::uuid;
select is((select checkpoint->'pages'->2->>'text' from public.document_processing_jobs where document_id=(select document_id from throughput_fixture)),'third','Explicit retry resumes paid checkpoint');
update public.files set status='deleting' where id=(select file_id from throughput_fixture);
select is((select public.acquire_document_provider_slot('visual',document_id,token) from throughput_fixture),null::uuid,'Deleting document cannot consume provider slot');
select is((select public.save_document_processing_page(document_id,token,'{"page":2,"text":"second","route":"visual","extraction":{"version":"visual-blocks-v1"}}') from throughput_fixture),false,'Deleting document rejects late result');
delete from public.files where id=(select file_id from throughput_fixture);
select is((select count(*)::int from public.document_provider_slots where document_id=(select document_id from throughput_fixture)),0,'Slots follow source deletion');
reset role;
set local role authenticated;
select throws_ok($$select public.acquire_document_provider_slot('visual',gen_random_uuid(),gen_random_uuid())$$,'42501',null,'Clients cannot acquire provider slots');
select throws_ok($$select public.dispatch_document_work()$$,'42501',null,'Clients cannot wake arbitrary workers');
reset role;
select * from finish();
rollback;
