begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Anna owns a conversation with three answers, Ben an unrelated course.
insert into public.courses(id,owner_id,title) values
 ('98000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Statistik'),
 ('98000000-0000-0000-0000-000000000011','22222222-2222-2222-2222-222222222222','Fremdkurs');
insert into public.chat_conversations(id,course_id) values
 ('98000000-0000-0000-0000-000000000020','98000000-0000-0000-0000-000000000001');
select public.append_chat_exchange('98000000-0000-0000-0000-000000000020',
 '56555555-5555-5555-5555-555555555551','Was ist der Median?','Der mittlere Wert.','feedback-test-model');
select public.append_chat_exchange('98000000-0000-0000-0000-000000000020',
 '56555555-5555-5555-5555-555555555552','Und der Modus?','Der häufigste Wert.','feedback-test-model');
select public.append_chat_exchange('98000000-0000-0000-0000-000000000020',
 '56555555-5555-5555-5555-555555555553','Und die Spannweite?','Maximum minus Minimum.','feedback-other-model');
update public.chat_messages set provider='gemini'
 where conversation_id='98000000-0000-0000-0000-000000000020' and role='assistant';

-- A rating belongs to an answer; the constraint holds even without RLS in the way.
select throws_ok($$update public.chat_messages set helpful=true
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=1$$,
 '23514',null,'Questions cannot carry a rating');
select is((select helpful_at from public.chat_messages
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=2),null,'Answers start unrated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$update public.chat_messages set helpful=true
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=2$$,'Owner rates an answer');
select isnt((select helpful_at from public.chat_messages
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=2),null,'Rating is stamped server side');

-- The new update path must not widen into the answer itself.
select throws_ok($$update public.chat_messages set content='Gefälscht'
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=2$$,
 '42501',null,'Client still cannot rewrite answers');
select throws_ok($$update public.chat_messages set helpful_at=now()
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=2$$,
 '42501',null,'Client cannot set the rating timestamp');
select throws_ok($$update public.chat_messages set model='gpt-frei'
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=2$$,
 '42501',null,'Client cannot relabel the model');

-- The policy hides questions from the update instead of raising: nothing changes.
select lives_ok($$update public.chat_messages set helpful=false
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=1$$,'Rating a question is a no-op');
select is((select helpful from public.chat_messages
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=1),null,'Question stays unrated');

select lives_ok($$update public.chat_messages set helpful=false
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=2$$,'Owner changes the rating');
select is((select helpful from public.chat_messages
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=2),false,'Changed rating is stored');
select lives_ok($$update public.chat_messages set helpful=true
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=4$$,'Second answer rated');
select lives_ok($$update public.chat_messages set helpful=null
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=4$$,'Owner withdraws a rating');
select is((select helpful_at from public.chat_messages
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=4),null,'Withdrawn rating drops its timestamp');
select lives_ok($$update public.chat_messages set helpful=true
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=4$$,'Answer rated again');
select lives_ok($$update public.chat_messages set helpful=true
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=6$$,'Answer of another model rated');
select throws_ok($$select public.chat_feedback_stats()$$,'42501',null,'Client cannot read the aggregate');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$update public.chat_messages set helpful=true
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=2$$,'Foreign rating is a no-op');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select helpful from public.chat_messages
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=2),false,'Owner rating survives the foreign attempt');

-- A fixed historical stamp makes a same-value update observable even though
-- now() is constant throughout this test transaction.
reset role;
update public.chat_messages set helpful_at='2026-01-10T12:00:00Z'
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=6;
set local role authenticated;
update public.chat_messages set helpful=true
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=6;
select is((select helpful_at from public.chat_messages
 where conversation_id='98000000-0000-0000-0000-000000000020' and seq=6),
 '2026-01-10T12:00:00Z'::timestamptz,'Identical rating preserves the timestamp');
select is((public.chat_exchange('98000000-0000-0000-0000-000000000020',
 '56555555-5555-5555-5555-555555555553')->'messages'->1->>'helpful')::boolean,
 true,'Restored exchange includes current feedback');
select is((public.chat_exchange('98000000-0000-0000-0000-000000000020',
 '56555555-5555-5555-5555-555555555553')->'messages'->1->>'helpful_at')::timestamptz,
 '2026-01-10T12:00:00Z'::timestamptz,'Restored exchange includes feedback timestamp');

-- Both owners contribute; the same model name on another provider stays separate.
reset role;
insert into public.chat_conversations(id,course_id) values
 ('98000000-0000-0000-0000-000000000021','98000000-0000-0000-0000-000000000011');
select public.append_chat_exchange('98000000-0000-0000-0000-000000000021',
 '56555555-5555-5555-5555-555555555554','Frage','Antwort','feedback-test-model');
update public.chat_messages set provider='openai'
 where conversation_id='98000000-0000-0000-0000-000000000021' and role='assistant';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
update public.chat_messages set helpful=true
 where conversation_id='98000000-0000-0000-0000-000000000021' and seq=2;
reset role;
-- Keep assertions independent of unrelated local ratings.
update public.chat_messages set helpful_at='2026-01-10T12:00:00Z'
 where conversation_id in ('98000000-0000-0000-0000-000000000020','98000000-0000-0000-0000-000000000021')
 and helpful is not null;
set local role service_role;
select set_eq($$select provider,model,helpful_count,not_helpful_count
 from public.chat_feedback_stats('2026-01-10T12:00:00Z','2026-01-10T12:00:01Z')
 where model in ('feedback-test-model','feedback-other-model')$$,
 $$values ('gemini','feedback-test-model',1::bigint,1::bigint),
 ('gemini','feedback-other-model',1::bigint,0::bigint),('openai','feedback-test-model',1::bigint,0::bigint)$$,
 'Aggregate includes both owners, separates providers and includes lower boundary');
select is((select count(*)::int from public.chat_feedback_stats('2026-01-10T11:59:59Z','2026-01-10T12:00:00Z')
 where model in ('feedback-test-model','feedback-other-model')),0,'Upper time boundary is exclusive');
select is((select count(*)::int from public.chat_feedback_stats('2026-01-10T12:00:01Z','2026-01-10T12:00:02Z')
 where model in ('feedback-test-model','feedback-other-model')),0,'Ratings before lower boundary are excluded');

reset role;
delete from public.courses where id in
 ('98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000011');
select is((select count(*)::int from public.chat_feedback_stats('2026-01-10T12:00:00Z','2026-01-10T12:00:01Z')
 where model in ('feedback-test-model','feedback-other-model')),0,'Deleted conversations drop their ratings');

select * from finish();
rollback;
