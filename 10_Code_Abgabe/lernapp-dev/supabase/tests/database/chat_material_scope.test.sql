begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.courses(id,owner_id,title) values
 ('97000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Scope'),
 ('97000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Other'),
 ('97000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','Foreign');
insert into public.materials(id,course_id,created_by,type,title) values
 ('97000000-0000-0000-0000-000000000011','97000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','source_document','Selected'),
 ('97000000-0000-0000-0000-000000000012','97000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','source_document','Distractor'),
 ('97000000-0000-0000-0000-000000000013','97000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','source_document','Other'),
 ('97000000-0000-0000-0000-000000000014','97000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','source_document','Foreign');
insert into public.source_documents(id,material_id,processing_status,indexing_status,extracted_text,completed_at)
 select id,id,'ready','ready','Fixture',now() from public.materials where id::text like '97000000%';
create temporary table scope_fixture as select
 ('[1,' || repeat('0,',1534) || '0]')::extensions.vector as vector,
 ('[0,1,' || repeat('0,',1533) || '0]')::extensions.vector as weak_vector;
grant select on scope_fixture to authenticated;
insert into public.document_chunks(document_id,chunk_index,content,embedding,page_number)
 select '97000000-0000-0000-0000-000000000012',n,'TCP TCP TCP',vector,1
 from scope_fixture cross join generate_series(0,29) n;
insert into public.document_chunks(document_id,chunk_index,content,embedding,page_number)
 select id,0,'TCP selected passage',weak_vector,17 from public.source_documents cross join scope_fixture
 where id in ('97000000-0000-0000-0000-000000000011','97000000-0000-0000-0000-000000000013','97000000-0000-0000-0000-000000000014');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.search_document_chunks('97000000-0000-0000-0000-000000000001',
 (select vector from scope_fixture),'gemini','gemini-embedding-2',1536,50,0,'TCP',null)),31,'NULL scope searches whole course');
select results_eq($$select id from public.search_document_chunks('97000000-0000-0000-0000-000000000001',
 (select vector from scope_fixture),'gemini','gemini-embedding-2',1536,8,0,'TCP',null)$$,
 $$select id from public.search_document_chunks('97000000-0000-0000-0000-000000000001',
 (select vector from scope_fixture),'gemini','gemini-embedding-2',1536,8,0,'TCP')$$,'Unscoped ranking unchanged');
select is((select page_number from public.search_document_chunks('97000000-0000-0000-0000-000000000001',
 (select vector from scope_fixture),'gemini','gemini-embedding-2',1536,1,0,'',array['97000000-0000-0000-0000-000000000011']::uuid[])),17,'Vector filter precedes candidate limit and preserves page');
select is((select page_number from public.search_document_chunks('97000000-0000-0000-0000-000000000001',
 (select vector from scope_fixture),'gemini','gemini-embedding-2',1536,1,0.9,'TCP',array['97000000-0000-0000-0000-000000000011']::uuid[])),17,'Lexical filter precedes candidate limit');
select is((select count(distinct material_id)::int from public.search_document_chunks('97000000-0000-0000-0000-000000000001',
 (select vector from scope_fixture),'gemini','gemini-embedding-2',1536,50,0,'TCP',array['97000000-0000-0000-0000-000000000011','97000000-0000-0000-0000-000000000012']::uuid[])),2,'Multiple materials included');
select is((select count(*)::int from public.search_document_chunks('97000000-0000-0000-0000-000000000001',
 (select vector from scope_fixture),'gemini','gemini-embedding-2',1536,8,0,'TCP',array['97000000-0000-0000-0000-000000000013','97000000-0000-0000-0000-000000000014']::uuid[])),0,'Other course and foreign material excluded');
select is((select count(*)::int from public.search_document_chunks('97000000-0000-0000-0000-000000000003',
 (select vector from scope_fixture),'gemini','gemini-embedding-2',1536,8,0,'TCP',array['97000000-0000-0000-0000-000000000014']::uuid[])),0,'RLS protects explicitly selected foreign material');
select throws_ok($$select public.normalize_chat_material_ids('{}')$$,'22023','INVALID_MATERIAL_SCOPE','Empty scope rejected');
select throws_ok($$select public.normalize_chat_material_ids(array[null]::uuid[])$$,'22023','INVALID_MATERIAL_SCOPE','NULL member rejected');
select is(public.normalize_chat_material_ids(array['97000000-0000-0000-0000-000000000012','97000000-0000-0000-0000-000000000011','97000000-0000-0000-0000-000000000011']::uuid[]),array['97000000-0000-0000-0000-000000000011','97000000-0000-0000-0000-000000000012']::uuid[],'Scope normalized');
reset role;
insert into public.chat_conversations(id,course_id) values ('97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000001');
create temporary table reserved_scope as select public.reserve_chat_request(
 '11111111-1111-1111-1111-111111111111','97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000031',
 'Question','openai','test',100,10,array['97000000-0000-0000-0000-000000000011','97000000-0000-0000-0000-000000000012']::uuid[]) as result;
select ok((select result ? 'lease_token' from reserved_scope),'Scoped request reserved');
select is(public.reserve_chat_request('11111111-1111-1111-1111-111111111111','97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000031',
 'Question','openai','test',100,10,array['97000000-0000-0000-0000-000000000012','97000000-0000-0000-0000-000000000011','97000000-0000-0000-0000-000000000011']::uuid[])->>'code','REQUEST_IN_PROGRESS','Reordered duplicated scope identifies same running request');
select is(public.reserve_chat_request('11111111-1111-1111-1111-111111111111','97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000031',
 'Question','openai','test',100,10)->>'code','REQUEST_ID_CONFLICT','Removing scope conflicts while running');
select throws_ok($$select public.complete_chat_request('11111111-1111-1111-1111-111111111111','97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000031',
 (select (result->>'lease_token')::uuid from reserved_scope),'Question','Answer','test',1,1,'[{"material_id":"97000000-0000-0000-0000-000000000013"}]')$$,'22023','INVALID_CITATION','Completion rejects sources outside scope');
select lives_ok($$select public.complete_chat_request('11111111-1111-1111-1111-111111111111','97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000031',
 (select (result->>'lease_token')::uuid from reserved_scope),'Question','Answer','test',1,1,'[]')$$,'Scoped request completes');
select is(public.reserve_chat_request('11111111-1111-1111-1111-111111111111','97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000031',
 'Question','openai','test',100,10,array['97000000-0000-0000-0000-000000000011']::uuid[])->>'code','REQUEST_ID_CONFLICT','Changed scope conflicts after completion');
select is(public.reserve_chat_request('11111111-1111-1111-1111-111111111111','97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000032',
 'Question','openai','test',100,10,array['97000000-0000-0000-0000-000000000013']::uuid[])->>'code','MATERIAL_NOT_FOUND','Reservation rejects material in other course');
select is(public.reserve_chat_request('11111111-1111-1111-1111-111111111111','97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000032',
 'Question','openai','test',100,10,array['97000000-0000-0000-0000-000000000014']::uuid[])->>'code','MATERIAL_NOT_FOUND','Reservation rejects foreign material');
set local role authenticated;
select ok(public.chat_exchange('97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000031',
 array['97000000-0000-0000-0000-000000000012','97000000-0000-0000-0000-000000000011']::uuid[]) is not null,'Replay accepts equivalent scope');
select throws_ok($$select public.chat_exchange('97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000031')$$,'22023','REQUEST_ID_CONFLICT','Replay cannot silently remove scope');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(public.chat_exchange('97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000031',
 array['97000000-0000-0000-0000-000000000011']::uuid[]),null::jsonb,'Foreign replay cannot disclose scope conflict');
reset role;
select * from finish();
rollback;
