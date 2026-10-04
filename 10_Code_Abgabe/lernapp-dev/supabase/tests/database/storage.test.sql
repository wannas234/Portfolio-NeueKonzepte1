begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is((select public from storage.buckets where id = 'learning-files'), false, 'Bucket existiert und ist privat');
select is((select file_size_limit from storage.buckets where id = 'learning-files'), 52428800::bigint, '50 MiB Limit');
select is((select allowed_mime_types from storage.buckets where id = 'learning-files'), array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
], 'Explizite MIME-Allowlist');
select is((select relrowsecurity from pg_class where oid = 'storage.objects'::regclass), true, 'Storage RLS aktiv');

insert into public.courses(id, owner_id, title) values
  ('97000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Storage Anna'),
  ('97000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Storage Ben');
-- SQL fixtures only: no underlying Storage blobs; rolled back at the end.
insert into storage.buckets(id, name, public) values ('storage-test-other', 'storage-test-other', false);
insert into storage.objects(bucket_id, name) values
  ('learning-files', '22222222-2222-2222-2222-222222222222/97000000-0000-0000-0000-000000000002/97000000-0000-0000-0000-000000000003.pdf'),
  ('storage-test-other', '11111111-1111-1111-1111-111111111111/other.pdf');

insert into public.files(id, course_id, uploaded_by, storage_bucket, storage_path, original_filename, mime_type, size_bytes)
values ('97000000-0000-0000-0000-000000000003','97000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','learning-files',
'11111111-1111-1111-1111-111111111111/97000000-0000-0000-0000-000000000001/97000000-0000-0000-0000-000000000003.pdf','test.pdf','application/pdf',10);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($test$insert into storage.objects(bucket_id, name) values
  ('learning-files', '11111111-1111-1111-1111-111111111111/97000000-0000-0000-0000-000000000001/97000000-0000-0000-0000-000000000003.pdf')$test$, 'Eigener Upload erlaubt');
select is((select count(*)::int from storage.objects where bucket_id = 'learning-files'), 0, 'Pending Objekt nicht lesbar');
reset role;
update public.files set status = 'ready' where id = '97000000-0000-0000-0000-000000000003';
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'learning-files'), 1, 'Nur eigenes Objekt sichtbar');
select is((select count(*)::int from storage.objects where bucket_id = 'storage-test-other'), 0, 'Policy gibt keine anderen Buckets frei');
select throws_ok($test$insert into storage.objects(bucket_id, name) values
  ('learning-files', '22222222-2222-2222-2222-222222222222/97000000-0000-0000-0000-000000000002/97000000-0000-0000-0000-000000000004.pdf')$test$, '42501', null, 'Fremder Nutzerordner verboten');
select throws_ok($test$insert into storage.objects(bucket_id, name) values
  ('learning-files', '11111111-1111-1111-1111-111111111111/97000000-0000-0000-0000-000000000002/97000000-0000-0000-0000-000000000004.pdf')$test$, '42501', null, 'Fremder Kurs im eigenen Ordner verboten');
select throws_ok($test$insert into storage.objects(bucket_id, name) values
  ('learning-files', '11111111-1111-1111-1111-111111111111/not-a-uuid/file.pdf')$test$, '42501', null, 'Ungueltiger Pfad wird ohne Cast-Fehler abgewiesen');
select throws_ok($test$insert into storage.objects(bucket_id, name) values
  ('storage-test-other', '11111111-1111-1111-1111-111111111111/97000000-0000-0000-0000-000000000001/97000000-0000-0000-0000-000000000003.pdf')$test$, '42501', null, 'Upload in anderen Bucket verboten');
with changed as (update storage.objects set name = name where bucket_id = 'learning-files' returning id)
select is((select count(*)::int from changed), 0, 'Auch eigene Objekte nicht ueberschreibbar');

-- Cleanup is durable and server-managed after parent deletion.
delete from public.courses where id = '97000000-0000-0000-0000-000000000001';
select is((select count(*)::int from storage.objects where bucket_id = 'learning-files'), 0, 'Objekt nach Kursloeschung nicht mehr lesbar');
set local request.jwt.claims = '{"role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'learning-files'), 0, 'Ohne Identitaet keine Objekte');
select throws_ok($test$insert into storage.objects(bucket_id, name) values
  ('learning-files', '11111111-1111-1111-1111-111111111111/97000000-0000-0000-0000-000000000001/97000000-0000-0000-0000-000000000004.pdf')$test$, '42501', null, 'Ohne Identitaet kein Upload');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from storage.objects where bucket_id = 'learning-files'), 0, 'Anonym keine Objekte');
select throws_ok($test$insert into storage.objects(bucket_id, name) values
  ('learning-files', '11111111-1111-1111-1111-111111111111/97000000-0000-0000-0000-000000000001/97000000-0000-0000-0000-000000000004.pdf')$test$, '42501', null, 'Anonymer Upload verboten');
reset role;
select * from finish();
rollback;
