begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.courses(id, owner_id, title) values
 ('98000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Timing test');
insert into public.materials(id, course_id, created_by, type, title) values
 ('98000000-0000-0000-0000-000000000002', '98000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'source_document', 'Timing document');
insert into public.source_documents(id, material_id) values
 ('98000000-0000-0000-0000-000000000003', '98000000-0000-0000-0000-000000000002');
set local role service_role;
insert into public.document_processing_runs(id, document_id, worker, started_at) values
 ('98000000-0000-0000-0000-000000000004', '98000000-0000-0000-0000-000000000003', 'extraction', '2026-09-30T10:00:00Z');
select is((select status from public.document_processing_runs where id='98000000-0000-0000-0000-000000000004'), 'running', 'Claim starts a running measurement');
update public.document_processing_runs set completed_at='2026-09-30T10:00:02Z', duration_ms=2000, status='completed',
 phases='[{"phase":"download","started_at":"2026-09-30T10:00:00Z","completed_at":"2026-09-30T10:00:01Z","duration_ms":1000,"status":"completed"},{"phase":"text_extraction","started_at":"2026-09-30T10:00:01Z","completed_at":"2026-09-30T10:00:02Z","duration_ms":1000,"status":"completed"}]'
 where id='98000000-0000-0000-0000-000000000004';
insert into public.document_processing_runs(id, document_id, worker, batch_start, started_at) values
 ('98000000-0000-0000-0000-000000000005', '98000000-0000-0000-0000-000000000003', 'indexing', 32, now());
select is((select sum(p.duration_ms) from public.document_processing_runs r cross join lateral jsonb_to_recordset(r.phases) p(duration_ms numeric) where r.document_id='98000000-0000-0000-0000-000000000003'), 2000::numeric, 'Phase JSON supports summed durations');
select throws_ok($$update public.document_processing_runs set duration_ms=-1 where id='98000000-0000-0000-0000-000000000004'$$, '23514', null, 'Negative durations rejected');
select throws_ok($$update public.document_processing_runs set completed_at=null where id='98000000-0000-0000-0000-000000000004'$$, '23514', null, 'Completed runs require end timestamp');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.document_processing_runs where document_id='98000000-0000-0000-0000-000000000003'), 2, 'Owner sees extraction and indexing runs');
select throws_ok($$update public.document_processing_runs set duration_ms=0$$, '42501', null, 'Client cannot forge timings');
select throws_ok($$insert into public.document_processing_runs(id, document_id, worker, started_at) values (gen_random_uuid(), '98000000-0000-0000-0000-000000000003', 'extraction', now())$$, '42501', null, 'Client cannot add timings');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.document_processing_runs where document_id='98000000-0000-0000-0000-000000000003'), 0, 'Foreign timings hidden');
set local role anon;
select throws_ok($$select * from public.document_processing_runs$$, '42501', null, 'Anonymous access denied');
reset role;
delete from public.source_documents where id='98000000-0000-0000-0000-000000000003';
select is((select count(*)::int from public.document_processing_runs where document_id='98000000-0000-0000-0000-000000000003'), 0, 'Document deletion removes timings');
select * from finish();
rollback;
