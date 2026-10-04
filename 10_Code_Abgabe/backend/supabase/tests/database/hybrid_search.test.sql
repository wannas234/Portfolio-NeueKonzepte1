begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.courses(id,owner_id,title) values
 ('99000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Hybrid'),
 ('99000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Other course'),
 ('99000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','Foreign course');
insert into public.materials(id,course_id,created_by,type,title)
 select id,id,owner_id,'source_document',title from public.courses where id::text like '99000000%';
insert into public.source_documents(id,material_id,processing_status,indexing_status,extracted_text,completed_at)
 select id,id,'ready','ready','Fixture',now() from public.materials where id::text like '99000000%';
create temporary table hybrid_fixture as select
 ('[1,' || repeat('0,',1534) || '0]')::extensions.vector as vector,
 ('[0,1,' || repeat('0,',1533) || '0]')::extensions.vector as weak_vector;
grant select on hybrid_fixture to authenticated;
-- All three relevant documents have weak vector similarity. This fixed corpus
-- measures ranking behavior independently of a paid or changing embedding model.
insert into public.document_chunks(document_id,chunk_index,content,embedding)
 select '99000000-0000-0000-0000-000000000001',n,'Allgemeiner Lernstoff ohne Fachbegriffe',vector
 from hybrid_fixture cross join generate_series(0,9) n;
insert into public.document_chunks(document_id,chunk_index,content,embedding)
 select '99000000-0000-0000-0000-000000000001',n,term,weak_vector
 from hybrid_fixture cross join (values (10,'TCP'),(11,'Preiselastizität'),(12,'4711')) t(n,term);
insert into public.document_chunks(document_id,chunk_index,content,embedding)
 select id,0,'TCP Preiselastizität 4711',vector from public.source_documents cross join hybrid_fixture
 where id in ('99000000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000003');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::integer from (values ('TCP'),('Preiselastizität'),('4711')) q(term)
 cross join lateral public.search_document_chunks('99000000-0000-0000-0000-000000000001',
 (select vector from hybrid_fixture),'gemini','gemini-embedding-2',1536,1,0) s where s.content=q.term),0,
 'Vector baseline: Recall@1 = 0/3 on weakly embedded exact terms');
select is((select count(*)::integer from (values ('TCP'),('Preiselastizität'),('4711')) q(term)
 cross join lateral public.search_document_chunks('99000000-0000-0000-0000-000000000001',
 (select vector from hybrid_fixture),'gemini','gemini-embedding-2',1536,1,0,q.term) s where s.content=q.term),3,
 'Hybrid: Recall@1 = 3/3 on acronym, technical term and number');
select is((select content from public.search_document_chunks('99000000-0000-0000-0000-000000000001',
 (select vector from hybrid_fixture),'gemini','gemini-embedding-2',1536,1,0.9,'TCP')),'TCP',
 'Lexical match survives vector threshold; other owned and foreign courses excluded');
select is((select similarity from public.search_document_chunks('99000000-0000-0000-0000-000000000001',
 (select vector from hybrid_fixture),'gemini','gemini-embedding-2',1536,1,0.9,'TCP')),0::double precision,
 'similarity remains cosine, not the fusion score');
select results_eq($$select id from public.search_document_chunks('99000000-0000-0000-0000-000000000001',
 (select vector from hybrid_fixture),'gemini','gemini-embedding-2',1536,8,0,'')$$,
 $$select id from public.search_document_chunks('99000000-0000-0000-0000-000000000001',
 (select vector from hybrid_fixture),'gemini','gemini-embedding-2',1536,8,0)$$,'Empty query preserves vector ordering');
select results_eq($$select id from public.search_document_chunks('99000000-0000-0000-0000-000000000001',
 (select vector from hybrid_fixture),'gemini','gemini-embedding-2',1536,8,0,'unfindablekeyword')$$,
 $$select id from public.search_document_chunks('99000000-0000-0000-0000-000000000001',
 (select vector from hybrid_fixture),'gemini','gemini-embedding-2',1536,8,0)$$,'No lexical hits preserves semantic results');
select is((select count(*)::integer from public.search_document_chunks('99000000-0000-0000-0000-000000000003',
 (select vector from hybrid_fixture),'gemini','gemini-embedding-2',1536,10,0,'TCP')),0,'Foreign course is hidden in both branches');
select throws_ok($$select * from public.search_document_chunks('99000000-0000-0000-0000-000000000001',
 (select vector from hybrid_fixture),'openai','gemini-embedding-2',1536,10,0,'TCP')$$,
 '22023','EMBEDDING_CONTRACT_MISMATCH','Lexical search cannot bypass embedding provenance');
select throws_ok($$select * from public.search_document_chunks('99000000-0000-0000-0000-000000000001',
 (select vector from hybrid_fixture),'gemini','gemini-embedding-2',1536,10,0,repeat('x',1801))$$,
 '22023','INVALID_SEARCH','Query length bounded');
reset role;
update public.source_documents set indexing_status='processing' where id='99000000-0000-0000-0000-000000000001';
set local role authenticated;
select is((select count(*)::integer from public.search_document_chunks('99000000-0000-0000-0000-000000000001',
 (select vector from hybrid_fixture),'gemini','gemini-embedding-2',1536,10,0,'TCP')),0,'Partial documents excluded');
select is((select prosecdef from pg_proc where oid=
 'public.search_document_chunks(uuid,extensions.vector,text,text,integer,integer,double precision,text)'::regprocedure),false,'Hybrid RPC remains SECURITY INVOKER');
set local role anon;
select throws_ok($$select * from public.search_document_chunks(gen_random_uuid(),'[1,0]'::extensions.vector,
 'gemini','gemini-embedding-2',1536,10,0,'TCP')$$,'42501',null,'Anonymous hybrid search denied');
reset role;
select * from finish();
rollback;
