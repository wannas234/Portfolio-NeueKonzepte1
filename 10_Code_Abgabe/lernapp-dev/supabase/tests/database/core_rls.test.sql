begin;

create extension if not exists pgtap with schema extensions;

-- Independent fixtures: one foreign course, two own courses.

select plan(288);

insert into public.courses(id, owner_id, title) values ('93000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Biologie');
insert into public.files(id, course_id, uploaded_by, storage_bucket, storage_path, original_filename, mime_type, size_bytes)
values ('93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'learning-files', '22222222-2222-2222-2222-222222222222/93000000-0000-0000-0000-000000000001/93000000-0000-0000-0000-000000000002.pdf', 'biology.pdf', 'application/pdf', 100);
insert into public.chunks(id, file_id, chunk_index, content, embedding, page_number)
values ('93000000-0000-0000-0000-000000000003', '93000000-0000-0000-0000-000000000002', 0, 'Zellen sind die Bausteine des Lebens.', '[0.1,0.2,0.3]', 1);
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('93000000-0000-0000-0000-000000000004', '93000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '93000000-0000-0000-0000-000000000002', 'document', 'Zellbiologie');
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('93000000-0000-0000-0000-000000000005', '93000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '93000000-0000-0000-0000-000000000002', 'presentation', 'Zellbiologie');
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('93000000-0000-0000-0000-000000000006', '93000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '93000000-0000-0000-0000-000000000002', 'summary', 'Zellbiologie');
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('93000000-0000-0000-0000-000000000007', '93000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '93000000-0000-0000-0000-000000000002', 'flashcard_deck', 'Zellbiologie');
insert into public.documents(id, material_id, source_file_id, document_type, content) values ('93000000-0000-0000-0000-000000000008', '93000000-0000-0000-0000-000000000004', '93000000-0000-0000-0000-000000000002', 'notes', '{"text":"Zellbiologie"}');
insert into public.presentations(id, material_id, source_file_id, title) values ('93000000-0000-0000-0000-000000000009', '93000000-0000-0000-0000-000000000005', '93000000-0000-0000-0000-000000000002', 'Zellbiologie');
insert into public.summaries(id, material_id, source_file_id, content) values ('93000000-0000-0000-0000-000000000010', '93000000-0000-0000-0000-000000000006', '93000000-0000-0000-0000-000000000002', '{"text":"Zusammenfassung"}');
insert into public.flashcard_decks(id, material_id, title) values ('93000000-0000-0000-0000-000000000011', '93000000-0000-0000-0000-000000000007', 'Zellen');
insert into public.presentation_slides(id, presentation_id, slide_number, title) values ('93000000-0000-0000-0000-000000000012', '93000000-0000-0000-0000-000000000009', 1, 'Die Zelle');
insert into public.flashcards(id, deck_id, question, answer) values ('93000000-0000-0000-0000-000000000013', '93000000-0000-0000-0000-000000000011', 'Was ist eine Zelle?', 'Ein Grundbaustein des Lebens.');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('93000000-0000-0000-0000-000000000003', 'document', '93000000-0000-0000-0000-000000000008');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('93000000-0000-0000-0000-000000000003', 'presentation_slide', '93000000-0000-0000-0000-000000000012');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('93000000-0000-0000-0000-000000000003', 'summary', '93000000-0000-0000-0000-000000000010');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('93000000-0000-0000-0000-000000000003', 'flashcard', '93000000-0000-0000-0000-000000000013');


insert into public.courses(id, owner_id, title) values ('94000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Biologie');
insert into public.files(id, course_id, uploaded_by, storage_bucket, storage_path, original_filename, mime_type, size_bytes)
values ('94000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'learning-files', '11111111-1111-1111-1111-111111111111/94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000002.pdf', 'biology.pdf', 'application/pdf', 100);
insert into public.chunks(id, file_id, chunk_index, content, embedding, page_number)
values ('94000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000002', 0, 'Zellen sind die Bausteine des Lebens.', '[0.1,0.2,0.3]', 1);
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('94000000-0000-0000-0000-000000000004', '94000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '94000000-0000-0000-0000-000000000002', 'document', 'Zellbiologie');
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('94000000-0000-0000-0000-000000000005', '94000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '94000000-0000-0000-0000-000000000002', 'presentation', 'Zellbiologie');
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('94000000-0000-0000-0000-000000000006', '94000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '94000000-0000-0000-0000-000000000002', 'summary', 'Zellbiologie');
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('94000000-0000-0000-0000-000000000007', '94000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '94000000-0000-0000-0000-000000000002', 'flashcard_deck', 'Zellbiologie');
insert into public.documents(id, material_id, source_file_id, document_type, content) values ('94000000-0000-0000-0000-000000000008', '94000000-0000-0000-0000-000000000004', '94000000-0000-0000-0000-000000000002', 'notes', '{"text":"Zellbiologie"}');
insert into public.presentations(id, material_id, source_file_id, title) values ('94000000-0000-0000-0000-000000000009', '94000000-0000-0000-0000-000000000005', '94000000-0000-0000-0000-000000000002', 'Zellbiologie');
insert into public.summaries(id, material_id, source_file_id, content) values ('94000000-0000-0000-0000-000000000010', '94000000-0000-0000-0000-000000000006', '94000000-0000-0000-0000-000000000002', '{"text":"Zusammenfassung"}');
insert into public.flashcard_decks(id, material_id, title) values ('94000000-0000-0000-0000-000000000011', '94000000-0000-0000-0000-000000000007', 'Zellen');
insert into public.presentation_slides(id, presentation_id, slide_number, title) values ('94000000-0000-0000-0000-000000000012', '94000000-0000-0000-0000-000000000009', 1, 'Die Zelle');
insert into public.flashcards(id, deck_id, question, answer) values ('94000000-0000-0000-0000-000000000013', '94000000-0000-0000-0000-000000000011', 'Was ist eine Zelle?', 'Ein Grundbaustein des Lebens.');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('94000000-0000-0000-0000-000000000003', 'document', '94000000-0000-0000-0000-000000000008');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('94000000-0000-0000-0000-000000000003', 'presentation_slide', '94000000-0000-0000-0000-000000000012');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('94000000-0000-0000-0000-000000000003', 'summary', '94000000-0000-0000-0000-000000000010');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('94000000-0000-0000-0000-000000000003', 'flashcard', '94000000-0000-0000-0000-000000000013');


set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok($test$insert into public.courses(id, owner_id, title) values ('92000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Biologie')$test$, 'courses: eigener Insert erlaubt');

select lives_ok($test$insert into public.files(id, course_id, uploaded_by, storage_bucket, storage_path, original_filename, mime_type, size_bytes)
values ('92000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'learning-files', '11111111-1111-1111-1111-111111111111/92000000-0000-0000-0000-000000000001/92000000-0000-0000-0000-000000000002.pdf', 'biology.pdf', 'application/pdf', 100)$test$, 'files: eigener Insert erlaubt');

select lives_ok($test$insert into public.materials(id, course_id, created_by, file_id, type, title) values ('92000000-0000-0000-0000-000000000004', '92000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '92000000-0000-0000-0000-000000000002', 'document', 'Zellbiologie')$test$, 'materials: eigener Insert erlaubt');

select lives_ok($test$insert into public.materials(id, course_id, created_by, file_id, type, title) values ('92000000-0000-0000-0000-000000000005', '92000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '92000000-0000-0000-0000-000000000002', 'presentation', 'Zellbiologie')$test$, 'materials: eigener Insert erlaubt');

select lives_ok($test$insert into public.materials(id, course_id, created_by, file_id, type, title) values ('92000000-0000-0000-0000-000000000006', '92000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '92000000-0000-0000-0000-000000000002', 'summary', 'Zellbiologie')$test$, 'materials: eigener Insert erlaubt');

select lives_ok($test$insert into public.materials(id, course_id, created_by, file_id, type, title) values ('92000000-0000-0000-0000-000000000007', '92000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '92000000-0000-0000-0000-000000000002', 'flashcard_deck', 'Zellbiologie')$test$, 'materials: eigener Insert erlaubt');

select lives_ok($test$insert into public.documents(id, material_id, source_file_id, document_type, content) values ('92000000-0000-0000-0000-000000000008', '92000000-0000-0000-0000-000000000004', '92000000-0000-0000-0000-000000000002', 'notes', '{"text":"Zellbiologie"}')$test$, 'documents: eigener Insert erlaubt');

select lives_ok($test$insert into public.presentations(id, material_id, source_file_id, title) values ('92000000-0000-0000-0000-000000000009', '92000000-0000-0000-0000-000000000005', '92000000-0000-0000-0000-000000000002', 'Zellbiologie')$test$, 'presentations: eigener Insert erlaubt');

select lives_ok($test$insert into public.summaries(id, material_id, source_file_id, content) values ('92000000-0000-0000-0000-000000000010', '92000000-0000-0000-0000-000000000006', '92000000-0000-0000-0000-000000000002', '{"text":"Zusammenfassung"}')$test$, 'summaries: eigener Insert erlaubt');

select lives_ok($test$insert into public.flashcard_decks(id, material_id, title) values ('92000000-0000-0000-0000-000000000011', '92000000-0000-0000-0000-000000000007', 'Zellen')$test$, 'flashcard_decks: eigener Insert erlaubt');

select lives_ok($test$insert into public.presentation_slides(id, presentation_id, slide_number, title) values ('92000000-0000-0000-0000-000000000012', '92000000-0000-0000-0000-000000000009', 1, 'Die Zelle')$test$, 'presentation_slides: eigener Insert erlaubt');

select lives_ok($test$insert into public.flashcards(id, deck_id, question, answer) values ('92000000-0000-0000-0000-000000000013', '92000000-0000-0000-0000-000000000011', 'Was ist eine Zelle?', 'Ein Grundbaustein des Lebens.')$test$, 'flashcards: eigener Insert erlaubt');

reset role;

insert into public.chunks(id, file_id, chunk_index, content, embedding, page_number)
values ('92000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000002', 0, 'Zellen sind die Bausteine des Lebens.', '[0.1,0.2,0.3]', 1);

insert into public.content_references(source_chunk_id, target_type, target_id) values ('92000000-0000-0000-0000-000000000003', 'document', '92000000-0000-0000-0000-000000000008');

insert into public.content_references(source_chunk_id, target_type, target_id) values ('92000000-0000-0000-0000-000000000003', 'presentation_slide', '92000000-0000-0000-0000-000000000012');

insert into public.content_references(source_chunk_id, target_type, target_id) values ('92000000-0000-0000-0000-000000000003', 'summary', '92000000-0000-0000-0000-000000000010');

insert into public.content_references(source_chunk_id, target_type, target_id) values ('92000000-0000-0000-0000-000000000003', 'flashcard', '92000000-0000-0000-0000-000000000013');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.courses where id = '92000000-0000-0000-0000-000000000001'), 1, 'courses: eigene Daten sichtbar');

select is((select count(*)::int from public.courses where id = '93000000-0000-0000-0000-000000000001'), 0, 'courses: fremde Daten unsichtbar');

select throws_ok($test$truncate public.courses$test$, '42501', null, 'courses: TRUNCATE verboten');

with changed as (update public.courses set title='Bearbeitet' where id = '93000000-0000-0000-0000-000000000001' returning id) select is((select count(*)::int from changed), 0, 'courses: fremdes Update trifft keine Zeile');

with changed as (delete from public.courses where id = '93000000-0000-0000-0000-000000000001' returning id) select is((select count(*)::int from changed), 0, 'courses: fremdes Delete trifft keine Zeile');

with changed as (update public.courses set title='Bearbeitet' where id = '92000000-0000-0000-0000-000000000001' returning id) select is((select count(*)::int from changed), 1, 'courses: eigenes Update erlaubt');

select throws_ok($test$update public.courses set id=id where id = '92000000-0000-0000-0000-000000000001'$test$, '42501', null, 'courses: id unveränderlich');

select throws_ok($test$update public.courses set created_at=created_at where id = '92000000-0000-0000-0000-000000000001'$test$, '42501', null, 'courses: created_at unveränderlich');

select is((select count(*)::int from public.files where id = '92000000-0000-0000-0000-000000000002'), 1, 'files: eigene Daten sichtbar');

select is((select count(*)::int from public.files where id = '93000000-0000-0000-0000-000000000002'), 0, 'files: fremde Daten unsichtbar');

select throws_ok($test$truncate public.files$test$, '42501', null, 'files: TRUNCATE verboten');

with changed as (update public.files set original_filename='Bearbeitet' where id = '93000000-0000-0000-0000-000000000002' returning id) select is((select count(*)::int from changed), 0, 'files: fremdes Update trifft keine Zeile');

with changed as (delete from public.files where id = '93000000-0000-0000-0000-000000000002' returning id) select is((select count(*)::int from changed), 0, 'files: fremdes Delete trifft keine Zeile');

with changed as (update public.files set original_filename='Bearbeitet' where id = '92000000-0000-0000-0000-000000000002' returning id) select is((select count(*)::int from changed), 1, 'files: eigenes Update erlaubt');

select throws_ok($test$update public.files set id=id where id = '92000000-0000-0000-0000-000000000002'$test$, '42501', null, 'files: id unveränderlich');

select throws_ok($test$update public.files set created_at=created_at where id = '92000000-0000-0000-0000-000000000002'$test$, '42501', null, 'files: created_at unveränderlich');

select is((select count(*)::int from public.materials where id = '92000000-0000-0000-0000-000000000004'), 1, 'materials: eigene Daten sichtbar');

select is((select count(*)::int from public.materials where id = '93000000-0000-0000-0000-000000000004'), 0, 'materials: fremde Daten unsichtbar');

select throws_ok($test$truncate public.materials$test$, '42501', null, 'materials: TRUNCATE verboten');

with changed as (update public.materials set title='Bearbeitet' where id = '93000000-0000-0000-0000-000000000004' returning id) select is((select count(*)::int from changed), 0, 'materials: fremdes Update trifft keine Zeile');

with changed as (delete from public.materials where id = '93000000-0000-0000-0000-000000000004' returning id) select is((select count(*)::int from changed), 0, 'materials: fremdes Delete trifft keine Zeile');

with changed as (update public.materials set title='Bearbeitet' where id = '92000000-0000-0000-0000-000000000004' returning id) select is((select count(*)::int from changed), 1, 'materials: eigenes Update erlaubt');

select throws_ok($test$update public.materials set id=id where id = '92000000-0000-0000-0000-000000000004'$test$, '42501', null, 'materials: id unveränderlich');

select throws_ok($test$update public.materials set created_at=created_at where id = '92000000-0000-0000-0000-000000000004'$test$, '42501', null, 'materials: created_at unveränderlich');

select is((select count(*)::int from public.documents where id = '92000000-0000-0000-0000-000000000008'), 1, 'documents: eigene Daten sichtbar');

select is((select count(*)::int from public.documents where id = '93000000-0000-0000-0000-000000000008'), 0, 'documents: fremde Daten unsichtbar');

select throws_ok($test$truncate public.documents$test$, '42501', null, 'documents: TRUNCATE verboten');

with changed as (update public.documents set content='{"edited":true}'::jsonb where id = '93000000-0000-0000-0000-000000000008' returning id) select is((select count(*)::int from changed), 0, 'documents: fremdes Update trifft keine Zeile');

with changed as (delete from public.documents where id = '93000000-0000-0000-0000-000000000008' returning id) select is((select count(*)::int from changed), 0, 'documents: fremdes Delete trifft keine Zeile');

with changed as (update public.documents set content='{"edited":true}'::jsonb where id = '92000000-0000-0000-0000-000000000008' returning id) select is((select count(*)::int from changed), 1, 'documents: eigenes Update erlaubt');

select throws_ok($test$update public.documents set id=id where id = '92000000-0000-0000-0000-000000000008'$test$, '42501', null, 'documents: id unveränderlich');

select throws_ok($test$update public.documents set created_at=created_at where id = '92000000-0000-0000-0000-000000000008'$test$, '42501', null, 'documents: created_at unveränderlich');

select is((select count(*)::int from public.presentations where id = '92000000-0000-0000-0000-000000000009'), 1, 'presentations: eigene Daten sichtbar');

select is((select count(*)::int from public.presentations where id = '93000000-0000-0000-0000-000000000009'), 0, 'presentations: fremde Daten unsichtbar');

select throws_ok($test$truncate public.presentations$test$, '42501', null, 'presentations: TRUNCATE verboten');

with changed as (update public.presentations set title='Bearbeitet' where id = '93000000-0000-0000-0000-000000000009' returning id) select is((select count(*)::int from changed), 0, 'presentations: fremdes Update trifft keine Zeile');

with changed as (delete from public.presentations where id = '93000000-0000-0000-0000-000000000009' returning id) select is((select count(*)::int from changed), 0, 'presentations: fremdes Delete trifft keine Zeile');

with changed as (update public.presentations set title='Bearbeitet' where id = '92000000-0000-0000-0000-000000000009' returning id) select is((select count(*)::int from changed), 1, 'presentations: eigenes Update erlaubt');

select throws_ok($test$update public.presentations set id=id where id = '92000000-0000-0000-0000-000000000009'$test$, '42501', null, 'presentations: id unveränderlich');

select throws_ok($test$update public.presentations set created_at=created_at where id = '92000000-0000-0000-0000-000000000009'$test$, '42501', null, 'presentations: created_at unveränderlich');

select is((select count(*)::int from public.summaries where id = '92000000-0000-0000-0000-000000000010'), 1, 'summaries: eigene Daten sichtbar');

select is((select count(*)::int from public.summaries where id = '93000000-0000-0000-0000-000000000010'), 0, 'summaries: fremde Daten unsichtbar');

select throws_ok($test$truncate public.summaries$test$, '42501', null, 'summaries: TRUNCATE verboten');

with changed as (update public.summaries set content='{"edited":true}'::jsonb where id = '93000000-0000-0000-0000-000000000010' returning id) select is((select count(*)::int from changed), 0, 'summaries: fremdes Update trifft keine Zeile');

with changed as (delete from public.summaries where id = '93000000-0000-0000-0000-000000000010' returning id) select is((select count(*)::int from changed), 0, 'summaries: fremdes Delete trifft keine Zeile');

with changed as (update public.summaries set content='{"edited":true}'::jsonb where id = '92000000-0000-0000-0000-000000000010' returning id) select is((select count(*)::int from changed), 1, 'summaries: eigenes Update erlaubt');

select throws_ok($test$update public.summaries set id=id where id = '92000000-0000-0000-0000-000000000010'$test$, '42501', null, 'summaries: id unveränderlich');

select throws_ok($test$update public.summaries set created_at=created_at where id = '92000000-0000-0000-0000-000000000010'$test$, '42501', null, 'summaries: created_at unveränderlich');

select is((select count(*)::int from public.flashcard_decks where id = '92000000-0000-0000-0000-000000000011'), 1, 'flashcard_decks: eigene Daten sichtbar');

select is((select count(*)::int from public.flashcard_decks where id = '93000000-0000-0000-0000-000000000011'), 0, 'flashcard_decks: fremde Daten unsichtbar');

select throws_ok($test$truncate public.flashcard_decks$test$, '42501', null, 'flashcard_decks: TRUNCATE verboten');

with changed as (update public.flashcard_decks set title='Bearbeitet' where id = '93000000-0000-0000-0000-000000000011' returning id) select is((select count(*)::int from changed), 0, 'flashcard_decks: fremdes Update trifft keine Zeile');

with changed as (delete from public.flashcard_decks where id = '93000000-0000-0000-0000-000000000011' returning id) select is((select count(*)::int from changed), 0, 'flashcard_decks: fremdes Delete trifft keine Zeile');

with changed as (update public.flashcard_decks set title='Bearbeitet' where id = '92000000-0000-0000-0000-000000000011' returning id) select is((select count(*)::int from changed), 1, 'flashcard_decks: eigenes Update erlaubt');

select throws_ok($test$update public.flashcard_decks set id=id where id = '92000000-0000-0000-0000-000000000011'$test$, '42501', null, 'flashcard_decks: id unveränderlich');

select throws_ok($test$update public.flashcard_decks set created_at=created_at where id = '92000000-0000-0000-0000-000000000011'$test$, '42501', null, 'flashcard_decks: created_at unveränderlich');

select is((select count(*)::int from public.presentation_slides where id = '92000000-0000-0000-0000-000000000012'), 1, 'presentation_slides: eigene Daten sichtbar');

select is((select count(*)::int from public.presentation_slides where id = '93000000-0000-0000-0000-000000000012'), 0, 'presentation_slides: fremde Daten unsichtbar');

select throws_ok($test$truncate public.presentation_slides$test$, '42501', null, 'presentation_slides: TRUNCATE verboten');

with changed as (update public.presentation_slides set title='Bearbeitet' where id = '93000000-0000-0000-0000-000000000012' returning id) select is((select count(*)::int from changed), 0, 'presentation_slides: fremdes Update trifft keine Zeile');

with changed as (delete from public.presentation_slides where id = '93000000-0000-0000-0000-000000000012' returning id) select is((select count(*)::int from changed), 0, 'presentation_slides: fremdes Delete trifft keine Zeile');

with changed as (update public.presentation_slides set title='Bearbeitet' where id = '92000000-0000-0000-0000-000000000012' returning id) select is((select count(*)::int from changed), 1, 'presentation_slides: eigenes Update erlaubt');

select throws_ok($test$update public.presentation_slides set id=id where id = '92000000-0000-0000-0000-000000000012'$test$, '42501', null, 'presentation_slides: id unveränderlich');

select throws_ok($test$update public.presentation_slides set created_at=created_at where id = '92000000-0000-0000-0000-000000000012'$test$, '42501', null, 'presentation_slides: created_at unveränderlich');

select is((select count(*)::int from public.flashcards where id = '92000000-0000-0000-0000-000000000013'), 1, 'flashcards: eigene Daten sichtbar');

select is((select count(*)::int from public.flashcards where id = '93000000-0000-0000-0000-000000000013'), 0, 'flashcards: fremde Daten unsichtbar');

select throws_ok($test$truncate public.flashcards$test$, '42501', null, 'flashcards: TRUNCATE verboten');

with changed as (update public.flashcards set question='Bearbeitet' where id = '93000000-0000-0000-0000-000000000013' returning id) select is((select count(*)::int from changed), 0, 'flashcards: fremdes Update trifft keine Zeile');

with changed as (delete from public.flashcards where id = '93000000-0000-0000-0000-000000000013' returning id) select is((select count(*)::int from changed), 0, 'flashcards: fremdes Delete trifft keine Zeile');

with changed as (update public.flashcards set question='Bearbeitet' where id = '92000000-0000-0000-0000-000000000013' returning id) select is((select count(*)::int from changed), 1, 'flashcards: eigenes Update erlaubt');

select throws_ok($test$update public.flashcards set id=id where id = '92000000-0000-0000-0000-000000000013'$test$, '42501', null, 'flashcards: id unveränderlich');

select throws_ok($test$update public.flashcards set created_at=created_at where id = '92000000-0000-0000-0000-000000000013'$test$, '42501', null, 'flashcards: created_at unveränderlich');

select is((select count(*)::int from public.chunks where id = '92000000-0000-0000-0000-000000000003'), 1, 'chunks: eigene Daten sichtbar');

select is((select count(*)::int from public.chunks where id = '93000000-0000-0000-0000-000000000003'), 0, 'chunks: fremde Daten unsichtbar');

select throws_ok($test$truncate public.chunks$test$, '42501', null, 'chunks: TRUNCATE verboten');

select throws_ok($test$update public.chunks set content=content$test$, '42501', null, 'chunks: Client-Schreiben verboten');

select throws_ok($test$delete from public.chunks$test$, '42501', null, 'chunks: Client-Schreiben verboten');

select throws_ok($test$insert into public.chunks default values$test$, '42501', null, 'chunks: Client-Schreiben verboten');

select is((select count(*)::int from public.content_references where source_chunk_id = '92000000-0000-0000-0000-000000000003'), 4, 'content_references: eigene Daten sichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id = '93000000-0000-0000-0000-000000000003'), 0, 'content_references: fremde Daten unsichtbar');

select throws_ok($test$truncate public.content_references$test$, '42501', null, 'content_references: TRUNCATE verboten');

select throws_ok($test$update public.content_references set target_type=target_type$test$, '42501', null, 'content_references: Client-Schreiben verboten');

select throws_ok($test$delete from public.content_references$test$, '42501', null, 'content_references: Client-Schreiben verboten');

select throws_ok($test$insert into public.content_references default values$test$, '42501', null, 'content_references: Client-Schreiben verboten');

select throws_ok($test$insert into public.courses(id, owner_id, title) values ('96000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Biologie')$test$, '42501', null, 'courses: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$insert into public.files(id, course_id, uploaded_by, storage_bucket, storage_path, original_filename, mime_type, size_bytes)
values ('96000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'learning-files', '11111111-1111-1111-1111-111111111111/93000000-0000-0000-0000-000000000001/96000000-0000-0000-0000-000000000002.pdf', 'biology.pdf', 'application/pdf', 100)$test$, '42501', null, 'files: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$insert into public.materials(id, course_id, created_by, file_id, type, title) values ('96000000-0000-0000-0000-000000000004', '93000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000002', 'document', 'Zellbiologie')$test$, '42501', null, 'materials: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$insert into public.materials(id, course_id, created_by, file_id, type, title) values ('96000000-0000-0000-0000-000000000005', '93000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000002', 'presentation', 'Zellbiologie')$test$, '42501', null, 'materials: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$insert into public.materials(id, course_id, created_by, file_id, type, title) values ('96000000-0000-0000-0000-000000000006', '93000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000002', 'summary', 'Zellbiologie')$test$, '42501', null, 'materials: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$insert into public.materials(id, course_id, created_by, file_id, type, title) values ('96000000-0000-0000-0000-000000000007', '93000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000002', 'flashcard_deck', 'Zellbiologie')$test$, '42501', null, 'materials: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$insert into public.documents(id, material_id, source_file_id, document_type, content) values ('96000000-0000-0000-0000-000000000008', '93000000-0000-0000-0000-000000000004', '93000000-0000-0000-0000-000000000002', 'notes', '{"text":"Zellbiologie"}')$test$, '42501', null, 'documents: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$insert into public.presentations(id, material_id, source_file_id, title) values ('96000000-0000-0000-0000-000000000009', '93000000-0000-0000-0000-000000000005', '93000000-0000-0000-0000-000000000002', 'Zellbiologie')$test$, '42501', null, 'presentations: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$insert into public.summaries(id, material_id, source_file_id, content) values ('96000000-0000-0000-0000-000000000010', '93000000-0000-0000-0000-000000000006', '93000000-0000-0000-0000-000000000002', '{"text":"Zusammenfassung"}')$test$, '42501', null, 'summaries: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$insert into public.flashcard_decks(id, material_id, title) values ('96000000-0000-0000-0000-000000000011', '93000000-0000-0000-0000-000000000007', 'Zellen')$test$, '42501', null, 'flashcard_decks: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$insert into public.presentation_slides(id, presentation_id, slide_number, title) values ('96000000-0000-0000-0000-000000000012', '93000000-0000-0000-0000-000000000009', 1, 'Die Zelle')$test$, '42501', null, 'presentation_slides: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$insert into public.flashcards(id, deck_id, question, answer) values ('96000000-0000-0000-0000-000000000013', '93000000-0000-0000-0000-000000000011', 'Was ist eine Zelle?', 'Ein Grundbaustein des Lebens.')$test$, '42501', null, 'flashcards: fremder Besitzer oder Parent abgewiesen');

select throws_ok($test$update public.courses set owner_id=owner_id where id='92000000-0000-0000-0000-000000000001'$test$, '42501', null, 'courses: owner_id unveränderlich');

select throws_ok($test$update public.files set course_id=course_id where id='92000000-0000-0000-0000-000000000002'$test$, '42501', null, 'files: course_id unveränderlich');

select throws_ok($test$update public.files set uploaded_by=uploaded_by where id='92000000-0000-0000-0000-000000000002'$test$, '42501', null, 'files: uploaded_by unveränderlich');

select throws_ok($test$update public.materials set course_id=course_id where id='92000000-0000-0000-0000-000000000004'$test$, '42501', null, 'materials: course_id unveränderlich');

select throws_ok($test$update public.materials set created_by=created_by where id='92000000-0000-0000-0000-000000000004'$test$, '42501', null, 'materials: created_by unveränderlich');

select throws_ok($test$update public.materials set type=type where id='92000000-0000-0000-0000-000000000004'$test$, '42501', null, 'materials: type unveränderlich');

select throws_ok($test$update public.documents set material_id=material_id where id='92000000-0000-0000-0000-000000000008'$test$, '42501', null, 'documents: material_id unveränderlich');

select throws_ok($test$update public.presentations set material_id=material_id where id='92000000-0000-0000-0000-000000000009'$test$, '42501', null, 'presentations: material_id unveränderlich');

select throws_ok($test$update public.summaries set material_id=material_id where id='92000000-0000-0000-0000-000000000010'$test$, '42501', null, 'summaries: material_id unveränderlich');

select throws_ok($test$update public.flashcard_decks set material_id=material_id where id='92000000-0000-0000-0000-000000000011'$test$, '42501', null, 'flashcard_decks: material_id unveränderlich');

select throws_ok($test$update public.presentation_slides set presentation_id=presentation_id where id='92000000-0000-0000-0000-000000000012'$test$, '42501', null, 'presentation_slides: presentation_id unveränderlich');

select throws_ok($test$update public.flashcards set deck_id=deck_id where id='92000000-0000-0000-0000-000000000013'$test$, '42501', null, 'flashcards: deck_id unveränderlich');

select throws_ok($test$update public.files set storage_path=storage_path where id='92000000-0000-0000-0000-000000000002'$test$, '42501', null, 'files: storage_path unveränderlich');

select throws_ok($test$update public.files set storage_bucket=storage_bucket where id='92000000-0000-0000-0000-000000000002'$test$, '42501', null, 'files: storage_bucket unveränderlich');

select throws_ok($test$update public.materials set file_id='93000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000004'$test$, '42501', null, 'materials: Quelle aus anderem Kurs 93000000 abgewiesen');

select throws_ok($test$update public.materials set file_id='94000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000004'$test$, '42501', null, 'materials: Quelle aus anderem Kurs 94000000 abgewiesen');

select lives_ok($test$update public.materials set file_id=null where id='92000000-0000-0000-0000-000000000004'$test$, 'materials: optionale Quelle darf NULL sein');

select lives_ok($test$update public.materials set file_id='92000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000004'$test$, 'materials: eigene Quelle wieder zuordnen');

select throws_ok($test$update public.documents set source_file_id='93000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000008'$test$, '42501', null, 'documents: Quelle aus anderem Kurs 93000000 abgewiesen');

select throws_ok($test$update public.documents set source_file_id='94000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000008'$test$, '42501', null, 'documents: Quelle aus anderem Kurs 94000000 abgewiesen');

select lives_ok($test$update public.documents set source_file_id=null where id='92000000-0000-0000-0000-000000000008'$test$, 'documents: optionale Quelle darf NULL sein');

select lives_ok($test$update public.documents set source_file_id='92000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000008'$test$, 'documents: eigene Quelle wieder zuordnen');

select throws_ok($test$update public.presentations set source_file_id='93000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000009'$test$, '42501', null, 'presentations: Quelle aus anderem Kurs 93000000 abgewiesen');

select throws_ok($test$update public.presentations set source_file_id='94000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000009'$test$, '42501', null, 'presentations: Quelle aus anderem Kurs 94000000 abgewiesen');

select lives_ok($test$update public.presentations set source_file_id=null where id='92000000-0000-0000-0000-000000000009'$test$, 'presentations: optionale Quelle darf NULL sein');

select lives_ok($test$update public.presentations set source_file_id='92000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000009'$test$, 'presentations: eigene Quelle wieder zuordnen');

select throws_ok($test$update public.summaries set source_file_id='93000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000010'$test$, '42501', null, 'summaries: Quelle aus anderem Kurs 93000000 abgewiesen');

select throws_ok($test$update public.summaries set source_file_id='94000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000010'$test$, '42501', null, 'summaries: Quelle aus anderem Kurs 94000000 abgewiesen');

select lives_ok($test$update public.summaries set source_file_id=null where id='92000000-0000-0000-0000-000000000010'$test$, 'summaries: optionale Quelle darf NULL sein');

select lives_ok($test$update public.summaries set source_file_id='92000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000010'$test$, 'summaries: eigene Quelle wieder zuordnen');

select throws_ok($test$insert into public.files(course_id,uploaded_by,storage_bucket,storage_path,original_filename,mime_type,size_bytes) values ('92000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','b','forged','f','text/plain',1)$test$, '42501', null, 'Fremder Uploader im eigenen Kurs verboten');

select throws_ok($test$insert into public.materials(course_id,created_by,type,title) values ('92000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','quiz','Forged')$test$, '42501', null, 'Fremder Ersteller im eigenen Kurs verboten');

set local request.jwt.claims = '{"role":"authenticated"}';

select is((select count(*)::int from public.courses), 0, 'courses: ohne sub keine Daten');

select is((select count(*)::int from public.files), 0, 'files: ohne sub keine Daten');

select is((select count(*)::int from public.materials), 0, 'materials: ohne sub keine Daten');

select is((select count(*)::int from public.documents), 0, 'documents: ohne sub keine Daten');

select is((select count(*)::int from public.presentations), 0, 'presentations: ohne sub keine Daten');

select is((select count(*)::int from public.summaries), 0, 'summaries: ohne sub keine Daten');

select is((select count(*)::int from public.flashcard_decks), 0, 'flashcard_decks: ohne sub keine Daten');

select is((select count(*)::int from public.presentation_slides), 0, 'presentation_slides: ohne sub keine Daten');

select is((select count(*)::int from public.flashcards), 0, 'flashcards: ohne sub keine Daten');

select is((select count(*)::int from public.chunks), 0, 'chunks: ohne sub keine Daten');

select is((select count(*)::int from public.content_references), 0, 'content_references: ohne sub keine Daten');

select is((select count(*)::int from public.profiles), 0, 'profiles: ohne sub keine Daten');

select throws_ok($test$insert into public.courses(owner_id,title) values ('11111111-1111-1111-1111-111111111111','No identity')$test$, '42501', null, 'Ohne sub kein Insert');

reset role;

set local role anon;

select throws_ok($test$select * from public.courses$test$, '42501', null, 'courses: anon gesperrt');

select throws_ok($test$insert into public.courses default values$test$, '42501', null, 'courses: anon gesperrt');

select throws_ok($test$update public.courses set id=id$test$, '42501', null, 'courses: anon gesperrt');

select throws_ok($test$delete from public.courses$test$, '42501', null, 'courses: anon gesperrt');

select throws_ok($test$select * from public.files$test$, '42501', null, 'files: anon gesperrt');

select throws_ok($test$insert into public.files default values$test$, '42501', null, 'files: anon gesperrt');

select throws_ok($test$update public.files set id=id$test$, '42501', null, 'files: anon gesperrt');

select throws_ok($test$delete from public.files$test$, '42501', null, 'files: anon gesperrt');

select throws_ok($test$select * from public.materials$test$, '42501', null, 'materials: anon gesperrt');

select throws_ok($test$insert into public.materials default values$test$, '42501', null, 'materials: anon gesperrt');

select throws_ok($test$update public.materials set id=id$test$, '42501', null, 'materials: anon gesperrt');

select throws_ok($test$delete from public.materials$test$, '42501', null, 'materials: anon gesperrt');

select throws_ok($test$select * from public.documents$test$, '42501', null, 'documents: anon gesperrt');

select throws_ok($test$insert into public.documents default values$test$, '42501', null, 'documents: anon gesperrt');

select throws_ok($test$update public.documents set id=id$test$, '42501', null, 'documents: anon gesperrt');

select throws_ok($test$delete from public.documents$test$, '42501', null, 'documents: anon gesperrt');

select throws_ok($test$select * from public.presentations$test$, '42501', null, 'presentations: anon gesperrt');

select throws_ok($test$insert into public.presentations default values$test$, '42501', null, 'presentations: anon gesperrt');

select throws_ok($test$update public.presentations set id=id$test$, '42501', null, 'presentations: anon gesperrt');

select throws_ok($test$delete from public.presentations$test$, '42501', null, 'presentations: anon gesperrt');

select throws_ok($test$select * from public.summaries$test$, '42501', null, 'summaries: anon gesperrt');

select throws_ok($test$insert into public.summaries default values$test$, '42501', null, 'summaries: anon gesperrt');

select throws_ok($test$update public.summaries set id=id$test$, '42501', null, 'summaries: anon gesperrt');

select throws_ok($test$delete from public.summaries$test$, '42501', null, 'summaries: anon gesperrt');

select throws_ok($test$select * from public.flashcard_decks$test$, '42501', null, 'flashcard_decks: anon gesperrt');

select throws_ok($test$insert into public.flashcard_decks default values$test$, '42501', null, 'flashcard_decks: anon gesperrt');

select throws_ok($test$update public.flashcard_decks set id=id$test$, '42501', null, 'flashcard_decks: anon gesperrt');

select throws_ok($test$delete from public.flashcard_decks$test$, '42501', null, 'flashcard_decks: anon gesperrt');

select throws_ok($test$select * from public.presentation_slides$test$, '42501', null, 'presentation_slides: anon gesperrt');

select throws_ok($test$insert into public.presentation_slides default values$test$, '42501', null, 'presentation_slides: anon gesperrt');

select throws_ok($test$update public.presentation_slides set id=id$test$, '42501', null, 'presentation_slides: anon gesperrt');

select throws_ok($test$delete from public.presentation_slides$test$, '42501', null, 'presentation_slides: anon gesperrt');

select throws_ok($test$select * from public.flashcards$test$, '42501', null, 'flashcards: anon gesperrt');

select throws_ok($test$insert into public.flashcards default values$test$, '42501', null, 'flashcards: anon gesperrt');

select throws_ok($test$update public.flashcards set id=id$test$, '42501', null, 'flashcards: anon gesperrt');

select throws_ok($test$delete from public.flashcards$test$, '42501', null, 'flashcards: anon gesperrt');

select throws_ok($test$select * from public.chunks$test$, '42501', null, 'chunks: anon gesperrt');

select throws_ok($test$insert into public.chunks default values$test$, '42501', null, 'chunks: anon gesperrt');

select throws_ok($test$update public.chunks set id=id$test$, '42501', null, 'chunks: anon gesperrt');

select throws_ok($test$delete from public.chunks$test$, '42501', null, 'chunks: anon gesperrt');

select throws_ok($test$select * from public.content_references$test$, '42501', null, 'content_references: anon gesperrt');

select throws_ok($test$insert into public.content_references default values$test$, '42501', null, 'content_references: anon gesperrt');

select throws_ok($test$update public.content_references set id=id$test$, '42501', null, 'content_references: anon gesperrt');

select throws_ok($test$delete from public.content_references$test$, '42501', null, 'content_references: anon gesperrt');

select throws_ok($test$select * from public.profiles$test$, '42501', null, 'profiles: anon gesperrt');

select throws_ok($test$insert into public.profiles default values$test$, '42501', null, 'profiles: anon gesperrt');

select throws_ok($test$update public.profiles set id=id$test$, '42501', null, 'profiles: anon gesperrt');

select throws_ok($test$delete from public.profiles$test$, '42501', null, 'profiles: anon gesperrt');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is((select count(*)::int from public.courses where id = '93000000-0000-0000-0000-000000000001'), 1, 'courses: B behält seine Daten');

select is((select title from public.courses where id = '93000000-0000-0000-0000-000000000001'), 'Biologie', 'courses: fremdes Update hat Daten nicht verändert');

select is((select count(*)::int from public.courses where id = '92000000-0000-0000-0000-000000000001'), 0, 'courses: A auch für B unsichtbar');

select is((select count(*)::int from public.files where id = '93000000-0000-0000-0000-000000000002'), 1, 'files: B behält seine Daten');

select is((select original_filename from public.files where id = '93000000-0000-0000-0000-000000000002'), 'biology.pdf', 'files: fremdes Update hat Daten nicht verändert');

select is((select count(*)::int from public.files where id = '92000000-0000-0000-0000-000000000002'), 0, 'files: A auch für B unsichtbar');

select is((select count(*)::int from public.materials where id = '93000000-0000-0000-0000-000000000004'), 1, 'materials: B behält seine Daten');

select is((select title from public.materials where id = '93000000-0000-0000-0000-000000000004'), 'Zellbiologie', 'materials: fremdes Update hat Daten nicht verändert');

select is((select count(*)::int from public.materials where id = '92000000-0000-0000-0000-000000000004'), 0, 'materials: A auch für B unsichtbar');

select is((select count(*)::int from public.documents where id = '93000000-0000-0000-0000-000000000008'), 1, 'documents: B behält seine Daten');

select is((select count(*)::int from public.documents where id = '92000000-0000-0000-0000-000000000008'), 0, 'documents: A auch für B unsichtbar');

select is((select count(*)::int from public.presentations where id = '93000000-0000-0000-0000-000000000009'), 1, 'presentations: B behält seine Daten');

select is((select title from public.presentations where id = '93000000-0000-0000-0000-000000000009'), 'Zellbiologie', 'presentations: fremdes Update hat Daten nicht verändert');

select is((select count(*)::int from public.presentations where id = '92000000-0000-0000-0000-000000000009'), 0, 'presentations: A auch für B unsichtbar');

select is((select count(*)::int from public.summaries where id = '93000000-0000-0000-0000-000000000010'), 1, 'summaries: B behält seine Daten');

select is((select count(*)::int from public.summaries where id = '92000000-0000-0000-0000-000000000010'), 0, 'summaries: A auch für B unsichtbar');

select is((select count(*)::int from public.flashcard_decks where id = '93000000-0000-0000-0000-000000000011'), 1, 'flashcard_decks: B behält seine Daten');

select is((select title from public.flashcard_decks where id = '93000000-0000-0000-0000-000000000011'), 'Zellen', 'flashcard_decks: fremdes Update hat Daten nicht verändert');

select is((select count(*)::int from public.flashcard_decks where id = '92000000-0000-0000-0000-000000000011'), 0, 'flashcard_decks: A auch für B unsichtbar');

select is((select count(*)::int from public.presentation_slides where id = '93000000-0000-0000-0000-000000000012'), 1, 'presentation_slides: B behält seine Daten');

select is((select title from public.presentation_slides where id = '93000000-0000-0000-0000-000000000012'), 'Die Zelle', 'presentation_slides: fremdes Update hat Daten nicht verändert');

select is((select count(*)::int from public.presentation_slides where id = '92000000-0000-0000-0000-000000000012'), 0, 'presentation_slides: A auch für B unsichtbar');

select is((select count(*)::int from public.flashcards where id = '93000000-0000-0000-0000-000000000013'), 1, 'flashcards: B behält seine Daten');

select is((select question from public.flashcards where id = '93000000-0000-0000-0000-000000000013'), 'Was ist eine Zelle?', 'flashcards: fremdes Update hat Daten nicht verändert');

select is((select count(*)::int from public.flashcards where id = '92000000-0000-0000-0000-000000000013'), 0, 'flashcards: A auch für B unsichtbar');

select is((select count(*)::int from public.chunks where id = '93000000-0000-0000-0000-000000000003'), 1, 'chunks: B behält seine Daten');

select is((select count(*)::int from public.chunks where id = '92000000-0000-0000-0000-000000000003'), 0, 'chunks: A auch für B unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id = '93000000-0000-0000-0000-000000000003'), 4, 'content_references: B behält seine Daten');

select is((select count(*)::int from public.content_references where source_chunk_id = '92000000-0000-0000-0000-000000000003'), 0, 'content_references: A auch für B unsichtbar');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok($test$insert into public.materials(course_id,created_by,type,title,file_id) values ('92000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','quiz','Invalid source','93000000-0000-0000-0000-000000000002')$test$, '42501', null, 'materials: Insert mit kursfremder Quelle verboten');

select throws_ok($test$insert into public.materials(course_id,created_by,type,title,file_id) values ('92000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','quiz','Invalid source','94000000-0000-0000-0000-000000000002')$test$, '42501', null, 'materials: Insert mit kursfremder Quelle verboten');

select throws_ok($test$insert into public.documents(material_id,document_type,source_file_id) values ('92000000-0000-0000-0000-000000000004','notes','93000000-0000-0000-0000-000000000002')$test$, '42501', null, 'documents: Insert mit kursfremder Quelle verboten');

select throws_ok($test$insert into public.documents(material_id,document_type,source_file_id) values ('92000000-0000-0000-0000-000000000004','notes','94000000-0000-0000-0000-000000000002')$test$, '42501', null, 'documents: Insert mit kursfremder Quelle verboten');

select throws_ok($test$insert into public.presentations(material_id,title,source_file_id) values ('92000000-0000-0000-0000-000000000005','Invalid source','93000000-0000-0000-0000-000000000002')$test$, '42501', null, 'presentations: Insert mit kursfremder Quelle verboten');

select throws_ok($test$insert into public.presentations(material_id,title,source_file_id) values ('92000000-0000-0000-0000-000000000005','Invalid source','94000000-0000-0000-0000-000000000002')$test$, '42501', null, 'presentations: Insert mit kursfremder Quelle verboten');

select throws_ok($test$insert into public.summaries(material_id,source_file_id) values ('92000000-0000-0000-0000-000000000006','93000000-0000-0000-0000-000000000002')$test$, '42501', null, 'summaries: Insert mit kursfremder Quelle verboten');

select throws_ok($test$insert into public.summaries(material_id,source_file_id) values ('92000000-0000-0000-0000-000000000006','94000000-0000-0000-0000-000000000002')$test$, '42501', null, 'summaries: Insert mit kursfremder Quelle verboten');

reset role;

-- Simulate a faulty privileged worker: neither endpoint may disclose the link.

insert into public.content_references(source_chunk_id,target_type,target_id) values ('92000000-0000-0000-0000-000000000003','document','93000000-0000-0000-0000-000000000008');

insert into public.content_references(source_chunk_id,target_type,target_id) values ('93000000-0000-0000-0000-000000000003','document','92000000-0000-0000-0000-000000000008');

insert into public.content_references(source_chunk_id,target_type,target_id) values ('92000000-0000-0000-0000-000000000003','document','94000000-0000-0000-0000-000000000008');

insert into public.content_references(source_chunk_id,target_type,target_id) values ('92000000-0000-0000-0000-000000000003','presentation_slide','93000000-0000-0000-0000-000000000012');

insert into public.content_references(source_chunk_id,target_type,target_id) values ('93000000-0000-0000-0000-000000000003','presentation_slide','92000000-0000-0000-0000-000000000012');

insert into public.content_references(source_chunk_id,target_type,target_id) values ('92000000-0000-0000-0000-000000000003','presentation_slide','94000000-0000-0000-0000-000000000012');

insert into public.content_references(source_chunk_id,target_type,target_id) values ('92000000-0000-0000-0000-000000000003','summary','93000000-0000-0000-0000-000000000010');

insert into public.content_references(source_chunk_id,target_type,target_id) values ('93000000-0000-0000-0000-000000000003','summary','92000000-0000-0000-0000-000000000010');

insert into public.content_references(source_chunk_id,target_type,target_id) values ('92000000-0000-0000-0000-000000000003','summary','94000000-0000-0000-0000-000000000010');

insert into public.content_references(source_chunk_id,target_type,target_id) values ('92000000-0000-0000-0000-000000000003','flashcard','93000000-0000-0000-0000-000000000013');

insert into public.content_references(source_chunk_id,target_type,target_id) values ('93000000-0000-0000-0000-000000000003','flashcard','92000000-0000-0000-0000-000000000013');

insert into public.content_references(source_chunk_id,target_type,target_id) values ('92000000-0000-0000-0000-000000000003','flashcard','94000000-0000-0000-0000-000000000013');

set local role authenticated;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='document' and target_id='93000000-0000-0000-0000-000000000008'), 0, 'document: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='93000000-0000-0000-0000-000000000003' and target_type='document' and target_id='92000000-0000-0000-0000-000000000008'), 0, 'document: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='document' and target_id='94000000-0000-0000-0000-000000000008'), 0, 'document: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='presentation_slide' and target_id='93000000-0000-0000-0000-000000000012'), 0, 'presentation_slide: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='93000000-0000-0000-0000-000000000003' and target_type='presentation_slide' and target_id='92000000-0000-0000-0000-000000000012'), 0, 'presentation_slide: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='presentation_slide' and target_id='94000000-0000-0000-0000-000000000012'), 0, 'presentation_slide: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='summary' and target_id='93000000-0000-0000-0000-000000000010'), 0, 'summary: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='93000000-0000-0000-0000-000000000003' and target_type='summary' and target_id='92000000-0000-0000-0000-000000000010'), 0, 'summary: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='summary' and target_id='94000000-0000-0000-0000-000000000010'), 0, 'summary: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='flashcard' and target_id='93000000-0000-0000-0000-000000000013'), 0, 'flashcard: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='93000000-0000-0000-0000-000000000003' and target_type='flashcard' and target_id='92000000-0000-0000-0000-000000000013'), 0, 'flashcard: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='flashcard' and target_id='94000000-0000-0000-0000-000000000013'), 0, 'flashcard: inkonsistente Referenz bleibt unsichtbar');

reset role;

set local role authenticated;

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='document' and target_id='93000000-0000-0000-0000-000000000008'), 0, 'document: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='93000000-0000-0000-0000-000000000003' and target_type='document' and target_id='92000000-0000-0000-0000-000000000008'), 0, 'document: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='document' and target_id='94000000-0000-0000-0000-000000000008'), 0, 'document: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='presentation_slide' and target_id='93000000-0000-0000-0000-000000000012'), 0, 'presentation_slide: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='93000000-0000-0000-0000-000000000003' and target_type='presentation_slide' and target_id='92000000-0000-0000-0000-000000000012'), 0, 'presentation_slide: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='presentation_slide' and target_id='94000000-0000-0000-0000-000000000012'), 0, 'presentation_slide: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='summary' and target_id='93000000-0000-0000-0000-000000000010'), 0, 'summary: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='93000000-0000-0000-0000-000000000003' and target_type='summary' and target_id='92000000-0000-0000-0000-000000000010'), 0, 'summary: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='summary' and target_id='94000000-0000-0000-0000-000000000010'), 0, 'summary: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='flashcard' and target_id='93000000-0000-0000-0000-000000000013'), 0, 'flashcard: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='93000000-0000-0000-0000-000000000003' and target_type='flashcard' and target_id='92000000-0000-0000-0000-000000000013'), 0, 'flashcard: inkonsistente Referenz bleibt unsichtbar');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_type='flashcard' and target_id='94000000-0000-0000-0000-000000000013'), 0, 'flashcard: inkonsistente Referenz bleibt unsichtbar');

reset role;

delete from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_id::text like '93000000%';

delete from public.content_references where source_chunk_id='93000000-0000-0000-0000-000000000003' and target_id::text like '92000000%';

delete from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003' and target_id::text like '94000000%';

set local role authenticated;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

savepoint file_delete_check;

select lives_ok($test$delete from public.files where id='92000000-0000-0000-0000-000000000002'$test$, 'Datei löschen mit abhängigen Inhalten erlaubt');

select is((select count(*)::int from public.materials where id='92000000-0000-0000-0000-000000000004' and file_id is null), 1, 'materials: Inhalt bleibt nach Dateilöschung ohne Quelle sichtbar');

select is((select count(*)::int from public.documents where id='92000000-0000-0000-0000-000000000008' and source_file_id is null), 1, 'documents: Inhalt bleibt nach Dateilöschung ohne Quelle sichtbar');

select is((select count(*)::int from public.presentations where id='92000000-0000-0000-0000-000000000009' and source_file_id is null), 1, 'presentations: Inhalt bleibt nach Dateilöschung ohne Quelle sichtbar');

select is((select count(*)::int from public.summaries where id='92000000-0000-0000-0000-000000000010' and source_file_id is null), 1, 'summaries: Inhalt bleibt nach Dateilöschung ohne Quelle sichtbar');

rollback to savepoint file_delete_check;

savepoint cascade_check;

with removed as (delete from public.courses where id='92000000-0000-0000-0000-000000000001' returning id) select is((select count(*)::int from removed), 1, 'Eigenen Kurs löschen erlaubt');

select is((select count(*)::int from public.courses where id='92000000-0000-0000-0000-000000000001'), 0, 'courses: Kurs-Cascade entfernt eigene Daten');

select is((select count(*)::int from public.files where id='92000000-0000-0000-0000-000000000002'), 0, 'files: Kurs-Cascade entfernt eigene Daten');

select is((select count(*)::int from public.materials where id='92000000-0000-0000-0000-000000000004'), 0, 'materials: Kurs-Cascade entfernt eigene Daten');

select is((select count(*)::int from public.documents where id='92000000-0000-0000-0000-000000000008'), 0, 'documents: Kurs-Cascade entfernt eigene Daten');

select is((select count(*)::int from public.presentations where id='92000000-0000-0000-0000-000000000009'), 0, 'presentations: Kurs-Cascade entfernt eigene Daten');

select is((select count(*)::int from public.summaries where id='92000000-0000-0000-0000-000000000010'), 0, 'summaries: Kurs-Cascade entfernt eigene Daten');

select is((select count(*)::int from public.flashcard_decks where id='92000000-0000-0000-0000-000000000011'), 0, 'flashcard_decks: Kurs-Cascade entfernt eigene Daten');

select is((select count(*)::int from public.presentation_slides where id='92000000-0000-0000-0000-000000000012'), 0, 'presentation_slides: Kurs-Cascade entfernt eigene Daten');

select is((select count(*)::int from public.flashcards where id='92000000-0000-0000-0000-000000000013'), 0, 'flashcards: Kurs-Cascade entfernt eigene Daten');

select is((select count(*)::int from public.chunks where id='92000000-0000-0000-0000-000000000003'), 0, 'chunks: Kurs-Cascade entfernt eigene Daten');

select is((select count(*)::int from public.content_references where source_chunk_id='92000000-0000-0000-0000-000000000003'), 0, 'Quellenreferenzen durch Cascade entfernt');

rollback to savepoint cascade_check;

with removed as (delete from public.flashcards where id='92000000-0000-0000-0000-000000000013' returning id) select is((select count(*)::int from removed), 1, 'flashcards: eigenes Delete erlaubt');

with removed as (delete from public.presentation_slides where id='92000000-0000-0000-0000-000000000012' returning id) select is((select count(*)::int from removed), 1, 'presentation_slides: eigenes Delete erlaubt');

with removed as (delete from public.flashcard_decks where id='92000000-0000-0000-0000-000000000011' returning id) select is((select count(*)::int from removed), 1, 'flashcard_decks: eigenes Delete erlaubt');

with removed as (delete from public.summaries where id='92000000-0000-0000-0000-000000000010' returning id) select is((select count(*)::int from removed), 1, 'summaries: eigenes Delete erlaubt');

with removed as (delete from public.presentations where id='92000000-0000-0000-0000-000000000009' returning id) select is((select count(*)::int from removed), 1, 'presentations: eigenes Delete erlaubt');

with removed as (delete from public.documents where id='92000000-0000-0000-0000-000000000008' returning id) select is((select count(*)::int from removed), 1, 'documents: eigenes Delete erlaubt');

with removed as (delete from public.materials where id='92000000-0000-0000-0000-000000000004' returning id) select is((select count(*)::int from removed), 1, 'materials: eigenes Delete erlaubt');

with removed as (delete from public.files where id='92000000-0000-0000-0000-000000000002' returning id) select is((select count(*)::int from removed), 1, 'files: eigenes Delete erlaubt');

with removed as (delete from public.courses where id='92000000-0000-0000-0000-000000000001' returning id) select is((select count(*)::int from removed), 1, 'courses: eigenes Delete erlaubt');

reset role;

select * from finish();

rollback;
