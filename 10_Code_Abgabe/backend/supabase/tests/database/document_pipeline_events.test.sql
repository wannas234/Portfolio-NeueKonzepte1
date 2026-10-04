begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.courses(id,owner_id,title) values
 ('97000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Timings');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.prepare_file_upload('97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000002','scan.pdf','application/pdf',100);
reset role;
create temporary table timing_fixture as select id as file_id, null::uuid as doc, null::uuid as token,
  ('[1,' || repeat('0,',1534) || '0]')::extensions.vector as vector
  from public.files where upload_key='97000000-0000-0000-0000-000000000002';
grant select on timing_fixture to authenticated;
select public.complete_file_upload(file_id,'11111111-1111-1111-1111-111111111111') from timing_fixture;
update timing_fixture f set doc=d.id from public.source_documents d
 join public.materials m on m.id=d.material_id where m.file_id=f.file_id;
create function pg_temp.events() returns text[] language sql as $$
  select coalesce(array_agg(event order by occurred_at, id), '{}') from public.document_pipeline_events
  where document_id=(select doc from timing_fixture);
$$;

select is(pg_temp.events(),array['upload_completed','processing_queued'],'Upload completion and queueing logged');
select is((select detail->>'mime_type' from public.document_pipeline_events
  where document_id=(select doc from timing_fixture) and event='upload_completed'),'application/pdf','Upload event carries file metadata');

-- Gemini: local analysis checkpoint, one paid page per claim, then publish.
update timing_fixture set token=(public.claim_document_processing(doc)->>'lease_token')::uuid;
select public.save_document_processing_checkpoint(doc,token,'{"version":"visual-blocks-v1","model":"gemini","pages":[
  {"page":1,"text":"local","route":"local"},{"page":2,"text":"","route":"visual"}]}',false) from timing_fixture;
select public.save_document_processing_checkpoint(doc,token,'{"version":"visual-blocks-v1","model":"gemini","pages":[
  {"page":1,"text":"local","route":"local"},{"page":2,"text":"OCR","route":"visual","extraction":{"model":"gemini"}}]}',true) from timing_fixture;
update timing_fixture set token=(public.claim_document_processing(doc)->>'lease_token')::uuid;
select public.finish_document_processing(doc,token,'OCR text','[{"page":1,"text":"OCR text"}]') from timing_fixture;
select is(pg_temp.events(),array['upload_completed','processing_queued','processing_claimed','ocr_checkpoint','ocr_checkpoint',
  'processing_claimed','indexing_queued','processing_ready'],'Every claim, OCR checkpoint and completion logged');
select is((select array_agg(detail order by occurred_at) from public.document_pipeline_events
  where document_id=(select doc from timing_fixture) and event='ocr_checkpoint'),
  array['{"pages":2,"visual_pages":1,"visual_done":0}','{"pages":2,"visual_pages":1,"visual_done":1}']::jsonb[],
  'Checkpoints record OCR page progress');
select is((select detail from public.document_pipeline_events
  where document_id=(select doc from timing_fixture) and event='processing_ready'),
  '{"page_count":1,"text_chars":8}'::jsonb,'Completion records extraction size');

-- Indexing in two batches.
update timing_fixture set token=(public.claim_document_indexing(doc)->>'lease_token')::uuid;
select public.finish_document_indexing_batch(doc,token,'gemini','gemini-embedding-2',1536,
  (select jsonb_agg(jsonb_build_object('chunk_index',n,'content','OCR text','page_number',1,'metadata','{}'::jsonb,'embedding',vector::text::jsonb)) from generate_series(0,31) n),33)
  from timing_fixture;
update public.document_indexing_jobs set available_at=now() where document_id=(select doc from timing_fixture);
update timing_fixture set token=(public.claim_document_indexing(doc)->>'lease_token')::uuid;
select public.finish_document_indexing_batch(doc,token,'gemini','gemini-embedding-2',1536,
  jsonb_build_array(jsonb_build_object('chunk_index',32,'content','OCR text','page_number',1,'metadata','{}'::jsonb,'embedding',vector::text::jsonb)),33)
  from timing_fixture;
select is((select array_agg(event order by occurred_at, id) from public.document_pipeline_events
  where document_id=(select doc from timing_fixture) and event like 'indexing%'),
  array['indexing_queued','indexing_claimed','indexing_batch','indexing_claimed','indexing_ready'],'Indexing batches logged');
select is((select detail from public.document_pipeline_events
  where document_id=(select doc from timing_fixture) and event='indexing_batch'),
  '{"stored":32,"next_index":32,"total_chunks":33}'::jsonb,'Batch progress recorded');
select is((select detail->>'chunk_count' from public.document_pipeline_events
  where document_id=(select doc from timing_fixture) and event='indexing_ready'),'33','Final chunk count recorded');

select ok((select processing_started_at is not null and ocr_started_at is not null
  and processing_completed_at > processing_started_at and indexing_completed_at > indexing_started_at
  and total_duration > interval '0' and processing_claims = 2 and indexing_claims = 2 and chunk_count = 33
  from public.document_pipeline_timings where document_id=(select doc from timing_fixture)),'Timings view derives all stages');

-- A retry starts a new run; the view must not blend it with the first one.
update public.source_documents set indexing_status='failed', indexing_error='INDEXING_TIMEOUT'
 where id=(select doc from timing_fixture);
set local role authenticated;
select public.retry_document_indexing(doc) from timing_fixture;
reset role;
select is((select indexing_completed_at from public.document_pipeline_timings
  where document_id=(select doc from timing_fixture)),null::timestamptz,'Retry does not reuse the previous run');

set local role authenticated;
select throws_ok($$select * from public.document_pipeline_events$$,'42501',null,'Timeline is operator-only');
select throws_ok($$select * from public.document_pipeline_timings$$,'42501',null,'Timings view is operator-only');
reset role;
select * from finish();
rollback;
