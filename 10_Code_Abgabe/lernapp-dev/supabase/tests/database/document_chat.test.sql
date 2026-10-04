begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Anna owns an indexed lecture, Ben an unrelated one in his own course.
insert into public.courses(id,owner_id,title) values
 ('97000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Mikroökonomie'),
 ('97000000-0000-0000-0000-000000000011','22222222-2222-2222-2222-222222222222','Fremdkurs');
insert into public.materials(id,course_id,created_by,type,title) values
 ('97000000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','source_document','Vorlesung 03'),
 ('97000000-0000-0000-0000-000000000012','97000000-0000-0000-0000-000000000011','22222222-2222-2222-2222-222222222222','source_document','Fremdskript');
insert into public.source_documents(id,material_id,processing_status,indexing_status,extracted_text,pages,page_count,completed_at) values
 ('97000000-0000-0000-0000-000000000003','97000000-0000-0000-0000-000000000002','ready','ready','Preiselastizität','[{"page":17,"text":"Preiselastizität"}]',17,now()),
 ('97000000-0000-0000-0000-000000000013','97000000-0000-0000-0000-000000000012','ready','ready','Fremd','[{"page":1,"text":"Fremd"}]',1,now());
insert into public.document_chunks(id,document_id,chunk_index,content,page_number,embedding) values
 ('97000000-0000-0000-0000-000000000004','97000000-0000-0000-0000-000000000003',0,'Die Preiselastizität misst die Mengenreaktion.',17,('[1,' || repeat('0,',1534) || '0]')::extensions.vector),
 ('97000000-0000-0000-0000-000000000005','97000000-0000-0000-0000-000000000003',1,'Berechnet als Quotient zweier Änderungsraten.',18,('[0,1,' || repeat('0,',1533) || '0]')::extensions.vector),
 ('97000000-0000-0000-0000-000000000014','97000000-0000-0000-0000-000000000013',0,'Fremder Inhalt.',1,('[1,' || repeat('0,',1534) || '0]')::extensions.vector);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$insert into public.chat_conversations(id,course_id) values
 ('97000000-0000-0000-0000-000000000020','97000000-0000-0000-0000-000000000001')$$,'Owner opens a conversation');
select throws_ok($$insert into public.chat_conversations(id,course_id) values
 ('97000000-0000-0000-0000-000000000021','97000000-0000-0000-0000-000000000011')$$,'42501',null,'Conversation needs an own course');
select is((select title from public.chat_conversations where id='97000000-0000-0000-0000-000000000020'),'Neuer Chat','Default title until the first question');
select throws_ok($$insert into public.chat_messages(conversation_id,seq,role,content,request_id)
 values ('97000000-0000-0000-0000-000000000020',1,'user','Gefälscht',gen_random_uuid())$$,'42501',null,'Client cannot write messages');
select throws_ok($$select public.append_chat_exchange('97000000-0000-0000-0000-000000000020',
 gen_random_uuid(),'Frage','Antwort','test-model')$$,'42501',null,'Client cannot append an exchange');

-- Exercise the now-private append helper as its owner. The leased API is tested separately.
reset role;
select throws_ok($$select public.append_chat_exchange('97000000-0000-0000-0000-0000000000ff',
 gen_random_uuid(),'Frage','Antwort','test-model')$$,'P0002','CONVERSATION_NOT_FOUND','Unknown conversation rejected');
-- A cited chunk must belong to the course of the conversation.
select throws_ok($$select public.append_chat_exchange('97000000-0000-0000-0000-000000000020',
 gen_random_uuid(),'Frage','Antwort [1]','test-model',jsonb_build_array(jsonb_build_object(
 'citation_no',1,'chunk_id','97000000-0000-0000-0000-000000000014',
 'source_document_id','97000000-0000-0000-0000-000000000013','material_id','97000000-0000-0000-0000-000000000012',
 'material_title','Fremdskript','page_number',1,'excerpt','Fremd','similarity',0.9)))$$,
 '22023','INVALID_CHAT_EXCHANGE','Foreign course chunk rejected');
select throws_ok($$select public.append_chat_exchange('97000000-0000-0000-0000-000000000020',
 gen_random_uuid(),'   ','Antwort','test-model')$$,'22023','INVALID_CHAT_EXCHANGE','Empty question rejected');
select is((select count(*)::int from public.chat_messages where conversation_id='97000000-0000-0000-0000-000000000020'),0,'Rejected exchanges store nothing');

-- The model saw eight passages and cited only the second and the fifth.
create temporary table chat_sources as select jsonb_build_array(
 jsonb_build_object('citation_no',2,'chunk_id','97000000-0000-0000-0000-000000000004',
  'source_document_id','97000000-0000-0000-0000-000000000003','material_id','97000000-0000-0000-0000-000000000002',
  'material_title','Vorlesung 03','page_number',17,'excerpt','Die Preiselastizität misst die Mengenreaktion.','similarity',0.83),
 jsonb_build_object('citation_no',5,'chunk_id','97000000-0000-0000-0000-000000000005',
  'source_document_id','97000000-0000-0000-0000-000000000003','material_id','97000000-0000-0000-0000-000000000002',
  'material_title','Vorlesung 03','page_number',18,'excerpt','Berechnet als Quotient zweier Änderungsraten.','similarity',0.71)) as value;
grant select on chat_sources to authenticated,service_role;
create temporary table chat_result as select '55555555-5555-5555-5555-555555555551'::uuid as request, null::jsonb as payload;
grant select,update on chat_result to authenticated,service_role;
update chat_result set payload = public.append_chat_exchange('97000000-0000-0000-0000-000000000020',
 request,'Was bedeutet Preiselastizität?','Sie misst die Mengenreaktion [2] und wird als Quotient berechnet [5].',
 'test-model',(select value from chat_sources));
select is((select jsonb_array_length(payload->'messages') from chat_result),2,'Exchange returns both messages');
select is((select payload->'messages'->0->>'seq' from chat_result),'1','Question is the first message');
select is((select payload->'messages'->1->>'seq' from chat_result),'2','Answer follows the question');
select is((select jsonb_array_length(payload->'sources') from chat_result),2,'Only cited passages are stored');
select is((select payload->'sources'->0->>'citation_no' from chat_result),'2','Citation numbers may start above one');
select is((select payload->'sources'->1->>'page_number' from chat_result),'18','Page reference preserved');
select is((select title from public.chat_conversations where id='97000000-0000-0000-0000-000000000020'),
 'Was bedeutet Preiselastizität?','First question names the conversation');

-- The client lost the response and retries with the same request id.
select is((select public.append_chat_exchange('97000000-0000-0000-0000-000000000020',request,
 'Was bedeutet Preiselastizität?','Eine andere Antwort','test-model') from chat_result),
 (select payload from chat_result),'Replay returns the stored exchange');
select is((select count(*)::int from public.chat_messages where conversation_id='97000000-0000-0000-0000-000000000020'),2,'Replay appends nothing');

select lives_ok($$select public.append_chat_exchange('97000000-0000-0000-0000-000000000020',
 '55555555-5555-5555-5555-555555555552','Wie berechnet man sie?','Als Quotient [1].','test-model',
 jsonb_build_array(jsonb_build_object('citation_no',1,'chunk_id','97000000-0000-0000-0000-000000000005',
 'source_document_id','97000000-0000-0000-0000-000000000003','material_id','97000000-0000-0000-0000-000000000002',
 'material_title','Vorlesung 03','page_number',18,'excerpt','Berechnet als Quotient zweier Änderungsraten.',
 'similarity',0.77)))$$,'Follow-up question continues the conversation');
select is((select max(seq)::int from public.chat_messages where conversation_id='97000000-0000-0000-0000-000000000020'),4,'Sequence continues without gaps');
select is((select title from public.chat_conversations where id='97000000-0000-0000-0000-000000000020'),
 'Was bedeutet Preiselastizität?','Later questions keep the title');

set local role authenticated;
select is((select count(*)::int from public.chat_messages where conversation_id='97000000-0000-0000-0000-000000000020'),4,'Owner reads the transcript');
select is((select count(*)::int from public.chat_message_sources),3,'Owner reads the citations');
select is((select public.chat_exchange('97000000-0000-0000-0000-000000000020','55555555-5555-5555-5555-555555555551')),
 (select payload from chat_result),'Owner reloads an exchange by request id');
select is((select public.chat_exchange('97000000-0000-0000-0000-000000000020','55555555-5555-5555-5555-555555555559')),
 null::jsonb,'Unknown request id has no exchange');
select throws_ok($$update public.chat_messages set content='Gefälscht'$$,'42501',null,'Client cannot rewrite answers');
select throws_ok($$delete from public.chat_message_sources$$,'42501',null,'Client cannot drop citations');
select lives_ok($$update public.chat_conversations set title='Elastizität'
 where id='97000000-0000-0000-0000-000000000020'$$,'Owner renames the conversation');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.chat_conversations),0,'Foreign conversation hidden');
select is((select count(*)::int from public.chat_messages),0,'Foreign transcript hidden');
select is((select count(*)::int from public.chat_message_sources),0,'Foreign citations hidden');
select is((select public.chat_exchange('97000000-0000-0000-0000-000000000020','55555555-5555-5555-5555-555555555551')),
 null::jsonb,'Foreign exchange not readable by request id');

-- Reindexing replaces chunks and materials can be removed; citations survive both.
reset role;
delete from public.document_chunks where id='97000000-0000-0000-0000-000000000004';
select is((select count(*)::int from public.chat_message_sources where chunk_id is null),1,'Deleted chunk unlinks its citation');
select is((select material_title from public.chat_message_sources where chunk_id is null),'Vorlesung 03','Snapshot outlives the chunk');
delete from public.materials where id='97000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.chat_message_sources where material_id is null and source_document_id is null),3,'Deleted material unlinks all citations');
select is((select count(*)::int from public.chat_message_sources where page_number = 17),1,'Page reference outlives the material');
select is((select count(*)::int from public.chat_messages where conversation_id='97000000-0000-0000-0000-000000000020'),4,'Transcript outlives its sources');

create temporary table deleted_chat_message_ids as
 select id from public.chat_messages where conversation_id='97000000-0000-0000-0000-000000000020';
delete from public.courses where id='97000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.chat_conversations where id='97000000-0000-0000-0000-000000000020'),0,'Course deletion removes conversations');
select is((select count(*)::int from public.chat_messages where id in (select id from deleted_chat_message_ids)),0,'Conversation deletion removes messages');
select is((select count(*)::int from public.chat_message_sources where message_id in (select id from deleted_chat_message_ids)),0,'Message deletion removes citations');

select * from finish();
rollback;
