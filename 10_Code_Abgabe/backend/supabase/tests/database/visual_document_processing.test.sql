begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.courses(id,owner_id,title) values
 ('94000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Visual extraction');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.prepare_file_upload('94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000002','scan.pdf','application/pdf',500);
select throws_ok($$select public.save_document_processing_checkpoint(gen_random_uuid(),gen_random_uuid(),'{}')$$,'42501',null,'Users cannot write extraction checkpoints');
reset role;
create temporary table visual_fixture as select id as file_id, null::uuid as document_id,
 null::uuid as token, null::uuid as old_token,
 '{"version":"visual-blocks-v1","model":"gemini-3.6-flash","pages":[{"page":1,"text":"local","route":"local"},{"page":2,"text":"","route":"visual"}]}'::jsonb as checkpoint
 from public.files where upload_key='94000000-0000-0000-0000-000000000002';
grant select, update on visual_fixture to service_role;
set local role service_role;
select public.complete_file_upload(file_id,'11111111-1111-1111-1111-111111111111') from visual_fixture;
update visual_fixture v set document_id=d.id from public.source_documents d
 join public.materials m on m.id=d.material_id where m.file_id=v.file_id;
update visual_fixture set token=(public.claim_document_processing(document_id)->>'lease_token')::uuid;
select is((select public.save_document_processing_checkpoint(document_id,gen_random_uuid(),checkpoint) from visual_fixture),false,'Wrong lease cannot save');
select throws_ok($$select public.save_document_processing_checkpoint(document_id,token,'{"version":"visual-blocks-v1","model":"gemini-3.6-flash","pages":[{"page":2,"text":"x","route":"visual"}]}') from visual_fixture$$,'22023','INVALID_PROCESSING_CHECKPOINT','Checkpoint validates page mapping');
select is((select public.save_document_processing_checkpoint(document_id,token,checkpoint,false) from visual_fixture),true,'Initial scan is durable before paid work');
select is((select attempts from public.document_processing_jobs where document_id=(select document_id from visual_fixture)),1,'Initial save does not reset attempts');
select is((select public.claim_document_processing(document_id) from visual_fixture),null::jsonb,'Retained lease prevents duplicate model calls');
select is((select extracted_text from public.source_documents where id=(select document_id from visual_fixture)),null::text,'Partial extraction is not published');
select is((select count(*)::int from public.document_indexing_jobs where document_id=(select document_id from visual_fixture)),0,'Partial pages not indexed');
select is((select public.save_document_processing_checkpoint(document_id,token,checkpoint,true) from visual_fixture),true,'Progress releases lease');
select is((select attempts from public.document_processing_jobs where document_id=(select document_id from visual_fixture)),0,'Completed batch resets retry budget');
update visual_fixture set old_token=token;
create temporary table resumed as select public.claim_document_processing(document_id) as value from visual_fixture;
select is((select value->'checkpoint' from resumed),(select checkpoint from visual_fixture),'Next worker receives exact saved progress');
update visual_fixture set token=(select (value->>'lease_token')::uuid from resumed);
select is((select public.save_document_processing_checkpoint(document_id,old_token,checkpoint) from visual_fixture),false,'Stale worker cannot overwrite progress');
update public.document_processing_jobs set lease_until=now()-interval '1 second' where document_id=(select document_id from visual_fixture);
select is((select public.save_document_processing_checkpoint(document_id,token,checkpoint) from visual_fixture),false,'Expired worker cannot save');
update visual_fixture set token=(public.claim_document_processing(document_id)->>'lease_token')::uuid;
update public.files set status='deleting' where id=(select file_id from visual_fixture);
select is((select public.save_document_processing_checkpoint(document_id,token,checkpoint) from visual_fixture),false,'Deleting source rejects checkpoint');
delete from public.files where id=(select file_id from visual_fixture);
select is((select count(*)::int from public.document_processing_jobs where document_id=(select document_id from visual_fixture)),0,'Source deletion removes private checkpoint');
select is((select public.save_document_processing_checkpoint(document_id,token,checkpoint) from visual_fixture),false,'Late save cannot resurrect deleted job');
reset role;
select * from finish();
rollback;
