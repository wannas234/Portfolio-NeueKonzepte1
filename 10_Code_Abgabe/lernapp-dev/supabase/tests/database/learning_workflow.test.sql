begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.courses(id,owner_id,title) values
 ('a2000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Learning A'),
 ('a2000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Learning B');
insert into public.materials(id,course_id,created_by,type,title) values
 ('a2000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','source_document','Source A'),
 ('a2000000-0000-0000-0000-000000000004','a2000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','source_document','Source B'),
 ('a2000000-0000-0000-0000-000000000005','a2000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','summary','Generated'),
 ('a2000000-0000-0000-0000-000000000006','a2000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','summary','Orphan');
insert into public.summaries(material_id,content,generation_kind) values
 ('a2000000-0000-0000-0000-000000000005','{"text":"Generated text"}','course');
insert into public.source_documents(id,material_id) values
 ('a2000000-0000-0000-0000-000000000070','a2000000-0000-0000-0000-000000000003'),
 ('a2000000-0000-0000-0000-000000000071','a2000000-0000-0000-0000-000000000004');
insert into public.document_chunks(id,document_id,chunk_index,content,page_number,embedding) values
 ('a2000000-0000-0000-0000-000000000080','a2000000-0000-0000-0000-000000000070',0,'Historical excerpt',2,array_fill(0.1::real,array[1536])::extensions.vector),
 ('a2000000-0000-0000-0000-000000000081','a2000000-0000-0000-0000-000000000071',0,'Foreign excerpt',3,array_fill(0.1::real,array[1536])::extensions.vector);
create temporary table ctx(k text primary key,v jsonb);
grant all on ctx to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into ctx values('summary',public.save_course_summary('a2000000-0000-0000-0000-000000000001','Manual','First'));
select lives_ok($$select public.save_course_summary('a2000000-0000-0000-0000-000000000001','Manual edited','Second')$$,'Manual summary updated');
select is((select count(*)::integer from public.summaries s join public.materials m on m.id=s.material_id where m.course_id='a2000000-0000-0000-0000-000000000001' and s.generation_kind='manual'),1,'One manual summary despite orphan and generated summary');
select is((select content->>'text' from public.summaries where material_id='a2000000-0000-0000-0000-000000000005'),'Generated text','Generated content preserved');
select is((select title from public.materials where id='a2000000-0000-0000-0000-000000000005'),'Generated','Generated title preserved');
select throws_ok($$select public.save_course_summary('a2000000-0000-0000-0000-000000000001',null,'Text')$$,'22023','INVALID_SUMMARY','NULL title rejected');
select throws_ok($$select public.save_course_summary('a2000000-0000-0000-0000-000000000002','Wrong','Text')$$,'42501','COURSE_NOT_FOUND','Foreign summary rejected');
insert into ctx values('deck',public.create_manual_deck('a2000000-0000-0000-0000-000000000001','Original','a2000000-0000-0000-0000-000000000020'));
select lives_ok($$select public.update_learning_deck((select (v->>'material_id')::uuid from ctx where k='deck'),'Renamed','Description')$$,'Deck update');
select is(public.create_manual_deck('a2000000-0000-0000-0000-000000000001','Original','a2000000-0000-0000-0000-000000000020'),(select v from ctx where k='deck'),'Retry succeeds after rename');
select is((select title from public.flashcard_decks where id=(select (v->>'deck_id')::uuid from ctx where k='deck')),'Renamed','Deck title updated');
select is((select description from public.materials where id=(select (v->>'material_id')::uuid from ctx where k='deck')),'Description','Material description updated');
select throws_ok($$select public.create_manual_deck('a2000000-0000-0000-0000-000000000001','Different','a2000000-0000-0000-0000-000000000020')$$,'22023','REQUEST_CONFLICT','Different creation payload rejected');
select throws_ok($$select * from public.learning_write_requests$$,'42501',null,'Receipts private');
select throws_ok($$select public.begin_learning_write(gen_random_uuid(),'manual_deck','a2000000-0000-0000-0000-000000000001','{}')$$,'42501',null,'Internal helper private');
insert into public.flashcards(id,deck_id,question,answer) values
 ('a2000000-0000-0000-0000-000000000030',(select (v->>'deck_id')::uuid from ctx where k='deck'),'Q','A'),
 ('a2000000-0000-0000-0000-000000000031',(select (v->>'deck_id')::uuid from ctx where k='deck'),'Q2','A2');
insert into public.flashcard_progress(user_id,card_id,starred) values(auth.uid(),'a2000000-0000-0000-0000-000000000031',true);
select is((select new from public.learning_deck_progress_counts(array[(select (v->>'material_id')::uuid from ctx where k='deck')])),2::bigint,'Starred unreviewed card still new');
select is((select due from public.learning_deck_progress_counts(array[(select (v->>'material_id')::uuid from ctx where k='deck')])),0::bigint,'New cards are separate from due');
insert into ctx values('review',public.record_flashcard_review('a2000000-0000-0000-0000-000000000030',true,'a2000000-0000-0000-0000-000000000040'));
select is(public.record_flashcard_review('a2000000-0000-0000-0000-000000000030',true,'a2000000-0000-0000-0000-000000000040'),(select v from ctx where k='review'),'Review retry replays');
select is((select repetition_count from public.flashcard_progress where card_id='a2000000-0000-0000-0000-000000000030'),1,'Retry does not advance progress');
select throws_ok($$select public.record_flashcard_review('a2000000-0000-0000-0000-000000000030',false,'a2000000-0000-0000-0000-000000000040')$$,'22023','REQUEST_CONFLICT','Review key conflict');
select throws_ok($$update public.flashcard_progress set known=true$$,'42501',null,'Cannot forge progress');
select lives_ok($$select public.record_flashcard_review('a2000000-0000-0000-0000-000000000030',true,gen_random_uuid())$$,'Second review');
select is((select interval_days from public.flashcard_progress where card_id='a2000000-0000-0000-0000-000000000030'),2,'Interval doubles');
select lives_ok($$select public.record_flashcard_review('a2000000-0000-0000-0000-000000000030',false,gen_random_uuid())$$,'Failed recall');
select is((select interval_days from public.flashcard_progress where card_id='a2000000-0000-0000-0000-000000000030'),1,'Failed recall resets interval');
select is((select reviewed from public.learning_deck_progress_counts(array[(select (v->>'material_id')::uuid from ctx where k='deck')])),1::bigint,'Reviewed count');
insert into ctx values('draft',to_jsonb(public.save_learning_draft('a2000000-0000-0000-0000-000000000003','summary','{"text":"Draft"}',0)));
select throws_ok($$select public.save_learning_draft('a2000000-0000-0000-0000-000000000003','summary','{"text":"Lost edit"}',0)$$,'40001','DRAFT_CONFLICT','Stale tab rejected');
select throws_ok($$select public.save_learning_draft('a2000000-0000-0000-0000-000000000003','summary','{}',0)$$,'22023','INVALID_DRAFT','Missing draft text rejected');
select throws_ok($$select public.save_learning_draft('a2000000-0000-0000-0000-000000000003','flashcards','{"cards":[{}]}',0)$$,'22023','INVALID_DRAFT','Malformed draft card rejected');
select throws_ok($$delete from public.learning_drafts$$,'42501',null,'Cannot bypass draft revision check');
select is(public.save_learning_draft('a2000000-0000-0000-0000-000000000003','summary',null,(select (v#>>'{}')::bigint from ctx where k='draft')),0::bigint,'Delete expected revision');
select ok(public.save_learning_draft('a2000000-0000-0000-0000-000000000003','summary','{"text":"New draft"}',0)>(select (v#>>'{}')::bigint from ctx where k='draft'),'Recreated draft has a new revision');
select throws_ok($$select public.save_learning_draft('a2000000-0000-0000-0000-000000000003','summary',null,(select (v#>>'{}')::bigint from ctx where k='draft'))$$,'40001','DRAFT_CONFLICT','Old tab cannot delete recreated draft');
insert into ctx values('questions','[{"question":"Q","options":["A","B","C","D"],"correctIndex":0}]');
insert into ctx values('quiz',public.save_learning_quiz('a2000000-0000-0000-0000-000000000003','Quiz',(select v from ctx where k='questions'),'a2000000-0000-0000-0000-000000000050'));
select is(public.save_learning_quiz('a2000000-0000-0000-0000-000000000003','Quiz',(select v from ctx where k='questions'),'a2000000-0000-0000-0000-000000000050'),(select v from ctx where k='quiz'),'Quiz retry replays');
select throws_ok($$select public.save_learning_quiz('a2000000-0000-0000-0000-000000000003','Quiz','[{}]',gen_random_uuid())$$,'22023','INVALID_QUESTION','Missing question fields rejected');
select throws_ok($$select public.save_learning_quiz('a2000000-0000-0000-0000-000000000003','Quiz','[{"question":"Q","options":["A",null,"C","D"],"correctIndex":0}]',gen_random_uuid())$$,'22023','INVALID_OPTION','NULL option rejected');
select throws_ok($$select public.save_learning_quiz('a2000000-0000-0000-0000-000000000003','Quiz','[{"question":"Q","options":["A","B","C","D"],"correctIndex":0.5}]',gen_random_uuid())$$,'22023','INVALID_QUESTION','Fractional correct index rejected');
select throws_ok($$select public.save_learning_quiz('a2000000-0000-0000-0000-000000000003','Quiz','[{"question":"Q","options":["A","B","C","D"],"correctIndex":"0"}]',gen_random_uuid())$$,'22023','INVALID_QUESTION','String correct index rejected');
select throws_ok($$select public.save_learning_quiz('a2000000-0000-0000-0000-000000000003','Quiz','[{"question":"Q","options":["A","B","C","D"],"correctIndex":0,"source_chunk_ids":["a2000000-0000-0000-0000-000000000099"]}]',gen_random_uuid())$$,'22023','SOURCE_NOT_FOUND','Unrelated source rejected');
insert into ctx values('attempt',public.start_learning_quiz_attempt((select (v->>'quiz_id')::uuid from ctx where k='quiz'),'a2000000-0000-0000-0000-000000000060'));
select is(public.start_learning_quiz_attempt((select (v->>'quiz_id')::uuid from ctx where k='quiz'),'a2000000-0000-0000-0000-000000000060'),(select v from ctx where k='attempt'),'Attempt creation retry replays');
select lives_ok($$select public.save_learning_quiz_attempt((select (v->>'attempt_id')::uuid from ctx where k='attempt'),'[null]',1)$$,'Partial attempt saved');
select throws_ok($$select public.save_learning_quiz_attempt((select (v->>'attempt_id')::uuid from ctx where k='attempt'),'[0]',1)$$,'40001','ATTEMPT_CONFLICT','Stale attempt rejected');
select throws_ok($$select public.save_learning_quiz_attempt((select (v->>'attempt_id')::uuid from ctx where k='attempt'),'[null]',2,true)$$,'22023','INVALID_ANSWERS','Incomplete submission rejected');
select throws_ok($$select public.save_learning_quiz_attempt((select (v->>'attempt_id')::uuid from ctx where k='attempt'),'[0.5]',2,true)$$,'22023','INVALID_ANSWERS','Fractional answer rejected');
insert into ctx values('submitted',public.save_learning_quiz_attempt((select (v->>'attempt_id')::uuid from ctx where k='attempt'),'[0]',2,true));
select is((select (v->>'score')::integer from ctx where k='submitted'),1,'Server calculates score');
select is(public.save_learning_quiz_attempt((select (v->>'attempt_id')::uuid from ctx where k='attempt'),'[0]',2,true),(select v from ctx where k='submitted'),'Submission retry replays');
select throws_ok($$select public.save_learning_quiz_attempt((select (v->>'attempt_id')::uuid from ctx where k='attempt'),'[1]',3,true)$$,'55000','ATTEMPT_SUBMITTED','Completed attempt immutable');
select throws_ok($$update public.learning_quiz_attempts set score=10$$,'42501',null,'Cannot forge score');
select throws_ok($$update public.learning_quizzes set questions='[]'$$,'42501',null,'Cannot rewrite questions');
insert into ctx values('quiz2',public.save_learning_quiz('a2000000-0000-0000-0000-000000000003','Quiz revised',(select v from ctx where k='questions'),gen_random_uuid(),(select (v->>'quiz_id')::uuid from ctx where k='quiz')));
select is((select (v->>'revision')::integer from ctx where k='quiz2'),2,'New quiz revision');
select is((select quiz_id from public.learning_quiz_attempts where id=(select (v->>'attempt_id')::uuid from ctx where k='attempt')),(select (v->>'quiz_id')::uuid from ctx where k='quiz'),'Old attempt retains old quiz');
select throws_ok($$select public.save_learning_quiz('a2000000-0000-0000-0000-000000000003','Stale revision',(select v from ctx where k='questions'),gen_random_uuid(),(select (v->>'quiz_id')::uuid from ctx where k='quiz'))$$,'40001','QUIZ_REVISION_CONFLICT','Stale quiz edit rejected');
select throws_ok($$select public.save_learning_quiz('a2000000-0000-0000-0000-000000000003','Foreign source','[{"question":"Q","options":["A","B","C","D"],"correctIndex":0,"source_chunk_ids":["a2000000-0000-0000-0000-000000000081"]}]',gen_random_uuid())$$,'22023','SOURCE_NOT_FOUND','Real foreign chunk rejected');
insert into ctx values('sourced_quiz',public.save_learning_quiz('a2000000-0000-0000-0000-000000000003','With source','[{"question":"Q","options":["A","B","C","D"],"correctIndex":0,"source_chunk_ids":["a2000000-0000-0000-0000-000000000080"],"sources":[{"excerpt":"Forged"}]}]',gen_random_uuid()));
select is((select questions->0->'sources'->0->>'excerpt' from public.learning_quizzes where id=(select (v->>'quiz_id')::uuid from ctx where k='sourced_quiz')),'Historical excerpt','Source excerpt is server-derived');
reset role;
delete from public.document_chunks where id='a2000000-0000-0000-0000-000000000080';
set local role authenticated;
select is((select questions->0->'sources'->0->>'excerpt' from public.learning_quizzes where id=(select (v->>'quiz_id')::uuid from ctx where k='sourced_quiz')),'Historical excerpt','Reindexing preserves source snapshot');
select is((select questions->0->'sources'->0->>'page_number' from public.learning_quizzes where id=(select (v->>'quiz_id')::uuid from ctx where k='sourced_quiz')),'2','Snapshot preserves page');
set local request.jwt.claims='{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*) from public.learning_quizzes where source_material_id='a2000000-0000-0000-0000-000000000003'),0::bigint,'Foreign quizzes hidden');
select is((select count(*) from public.learning_quiz_attempts where id=(select (v->>'attempt_id')::uuid from ctx where k='attempt')),0::bigint,'Foreign attempts hidden');
select is((select count(*) from public.learning_drafts where source_material_id='a2000000-0000-0000-0000-000000000003'),0::bigint,'Foreign drafts hidden');
select is((select count(*) from public.flashcard_progress where card_id='a2000000-0000-0000-0000-000000000030'),0::bigint,'Foreign progress hidden');
select is((select count(*) from public.flashcard_review_events where card_id='a2000000-0000-0000-0000-000000000030'),0::bigint,'Foreign events hidden');
select is((select count(*) from public.learning_deck_progress_counts(array[(select (v->>'material_id')::uuid from ctx where k='deck')])),0::bigint,'Foreign counts hidden');
select throws_ok($$select public.record_flashcard_review('a2000000-0000-0000-0000-000000000030',true,gen_random_uuid())$$,'42501','CARD_NOT_FOUND','Foreign review rejected');
select throws_ok($$select public.update_learning_deck((select (v->>'material_id')::uuid from ctx where k='deck'),'Wrong','')$$,'42501','DECK_NOT_FOUND','Foreign edit rejected');
select throws_ok($$select public.save_learning_draft('a2000000-0000-0000-0000-000000000003','summary','{"text":"Wrong"}',0)$$,'42501','SOURCE_NOT_FOUND','Foreign draft write rejected');
select throws_ok($$select public.save_learning_quiz_attempt((select (v->>'attempt_id')::uuid from ctx where k='attempt'),'[0]',3,true)$$,'42501','ATTEMPT_NOT_FOUND','Foreign attempt write rejected');
select throws_ok($$select public.start_learning_quiz_attempt((select (v->>'quiz_id')::uuid from ctx where k='quiz'),gen_random_uuid())$$,'42501','QUIZ_NOT_FOUND','Foreign attempt creation rejected');
set local role anon;
select throws_ok($$select public.save_course_summary('a2000000-0000-0000-0000-000000000001','Wrong','Text')$$,'42501',null,'Anonymous summary rejected');
select * from finish();
rollback;
