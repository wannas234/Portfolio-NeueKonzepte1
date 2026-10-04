begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.courses(id,owner_id,title) values
 ('b1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Workflow A'),
 ('b1000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Workflow B');
insert into public.materials(id,course_id,created_by,type,title) values
 ('b1000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','source_document','Source A'),
 ('b1000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','source_document','Source B');
insert into public.lectures(id,course_id,title) values
 ('b1000000-0000-0000-0000-000000000005','b1000000-0000-0000-0000-000000000002','Foreign lecture');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- course metadata and lectures
select lives_ok($$update public.courses set semester='WS 26/27',lecturer='Prof. X',target_grade=1.7 where id='b1000000-0000-0000-0000-000000000001'$$,'Course metadata editable');
select throws_ok($$update public.courses set target_grade=6 where id='b1000000-0000-0000-0000-000000000001'$$,'23514',null,'Target grade range enforced');
select lives_ok($$insert into public.lectures(id,course_id,title,held_on) values('b1000000-0000-0000-0000-000000000006','b1000000-0000-0000-0000-000000000001','Lecture 1','2026-10-05')$$,'Lecture created');
select throws_ok($$insert into public.lectures(course_id,title) values('b1000000-0000-0000-0000-000000000002','Wrong')$$,'42501',null,'Foreign course lecture rejected');
select lives_ok($$update public.materials set lecture_id='b1000000-0000-0000-0000-000000000006' where id='b1000000-0000-0000-0000-000000000003'$$,'Document assigned to lecture');
select throws_ok($$update public.materials set lecture_id='b1000000-0000-0000-0000-000000000005' where id='b1000000-0000-0000-0000-000000000003'$$,'23514','LECTURE_NOT_FOUND','Foreign lecture cannot be assigned');
-- notes
select lives_ok($$insert into public.document_notes(user_id,material_id,page_number,kind,body) values('11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000003',2,'note','Check this')$$,'Note created');
select lives_ok($$insert into public.document_notes(user_id,material_id,page_number,kind,quote) values('11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000003',2,'highlight','Key sentence')$$,'Highlight created');
select throws_ok($$insert into public.document_notes(user_id,material_id,page_number,kind,body) values('11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000003',1,'note','  ')$$,'23514',null,'Empty note rejected');
select throws_ok($$insert into public.document_notes(user_id,material_id,page_number,kind,body) values('11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000004',1,'note','x')$$,'42501',null,'Foreign document note rejected');
select lives_ok($$update public.document_notes set status='resolved' where kind='note'$$,'Note resolved');


-- Columns stay immutable even for the owner.
select throws_ok($$update public.lectures set course_id='b1000000-0000-0000-0000-000000000002'$$,'42501',null,'Lecture course immutable');
select throws_ok($$update public.document_notes set page_number=3$$,'42501',null,'Note page immutable');
select throws_ok($$update public.document_notes set kind='highlight'$$,'42501',null,'Note kind immutable');
select throws_ok($$update public.document_notes set user_id='22222222-2222-2222-2222-222222222222'$$,'42501',null,'Note owner immutable');
select throws_ok($$update public.document_notes set material_id='b1000000-0000-0000-0000-000000000004'$$,'42501',null,'Note document immutable');
select throws_ok($$update public.document_notes set quote='Changed'$$,'42501',null,'Highlight quote immutable');
select throws_ok($$update public.document_notes set status='invalid'$$,'23514',null,'Invalid note status rejected');
select throws_ok($$update public.document_notes set body=' ' where kind='note'$$,'23514',null,'Note cannot be emptied');
select throws_ok($$update public.courses set semester=' ' where id='b1000000-0000-0000-0000-000000000001'$$,'23514',null,'Blank semester rejected');
select throws_ok($$update public.courses set lecturer=repeat('x',201) where id='b1000000-0000-0000-0000-000000000001'$$,'23514',null,'Lecturer length bounded');
select throws_ok($$update public.courses set target_grade=0.9 where id='b1000000-0000-0000-0000-000000000001'$$,'23514',null,'Grade lower bound enforced');
select lives_ok($$insert into public.materials(id,course_id,created_by,type,title,lecture_id) values('b1000000-0000-0000-0000-000000000009','b1000000-0000-0000-0000-000000000001',auth.uid(),'summary','Assigned on insert','b1000000-0000-0000-0000-000000000006')$$,'Lecture assignment on insert allowed');
select throws_ok($$insert into public.materials(course_id,created_by,type,title,lecture_id) values('b1000000-0000-0000-0000-000000000001',auth.uid(),'source_document','Wrong lecture','b1000000-0000-0000-0000-000000000005')$$,'23514','LECTURE_NOT_FOUND','Cross-course insert rejected');
insert into public.materials(id,course_id,created_by,type,title) values('b1000000-0000-0000-0000-000000000010','b1000000-0000-0000-0000-000000000001',auth.uid(),'summary','Not a source');
select throws_ok($$insert into public.document_notes(user_id,material_id,page_number,kind,body) values(auth.uid(),'b1000000-0000-0000-0000-000000000010',1,'note','Wrong type')$$,'42501',null,'Notes require a source document');
select throws_ok($$insert into public.document_notes(user_id,material_id,page_number,kind,body) values(auth.uid(),'b1000000-0000-0000-0000-000000000003',0,'note','Invalid page')$$,'23514',null,'Page must be positive');
select throws_ok($$insert into public.document_notes(user_id,material_id,page_number,kind) values(auth.uid(),'b1000000-0000-0000-0000-000000000003',1,'highlight')$$,'23514',null,'Highlight needs a quote');
select throws_ok($$insert into public.document_notes(user_id,material_id,page_number,kind,body) values('22222222-2222-2222-2222-222222222222','b1000000-0000-0000-0000-000000000003',1,'note','Forged owner')$$,'42501',null,'Cannot forge note owner');
select ok(not has_function_privilege('authenticated','public.check_material_lecture()','EXECUTE'),'Trigger helper is private');
select lives_ok($$delete from public.lectures where id='b1000000-0000-0000-0000-000000000006'$$,'Lecture deleted');
select is((select lecture_id from public.materials where id='b1000000-0000-0000-0000-000000000003'),null,'Document survives lecture deletion');


select is((select count(*) from public.document_notes),2::bigint,'Lecture deletion preserves notes');
set local request.jwt.claims='{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*) from public.document_notes),0::bigint,'Foreign notes hidden');
select is((select count(*) from public.lectures),1::bigint,'Only own lecture visible');
with changed as (update public.courses set target_grade=2 where id='b1000000-0000-0000-0000-000000000001' returning id) select is(count(*),0::bigint,'Foreign metadata not editable') from changed;
with changed as (delete from public.document_notes returning id) select is(count(*),0::bigint,'Foreign notes not deletable') from changed;
set local request.jwt.claims='{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$delete from public.materials where id='b1000000-0000-0000-0000-000000000003'$$,'Source deletion allowed');
select is((select count(*) from public.document_notes),0::bigint,'Source deletion cascades notes');
select lives_ok($$update public.courses set semester=null,lecturer=null,target_grade=null where id='b1000000-0000-0000-0000-000000000001'$$,'Optional metadata can be cleared');
set local role anon;
select throws_ok($$select * from public.lectures$$,'42501',null,'Anonymous lectures denied');
select throws_ok($$select * from public.document_notes$$,'42501',null,'Anonymous notes denied');
select * from finish();
rollback;
