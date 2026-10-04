begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.courses(id,owner_id,title) values
 ('98000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Files test');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$select public.prepare_file_upload('98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000002','test.pdf','application/pdf',20)$$,'Prepare creates metadata');
select lives_ok($$select public.prepare_file_upload('98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000002','test.pdf','application/pdf',20)$$,'Prepare retry succeeds');
select is((select count(*)::int from public.files where course_id='98000000-0000-0000-0000-000000000001'),1,'Retry creates no duplicate');
select is((select status from public.files where upload_key='98000000-0000-0000-0000-000000000002'),'pending','No premature ready');
select throws_ok($$select public.prepare_file_upload('98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000002','different.pdf','application/pdf',20)$$,'23505','UPLOAD_KEY_CONFLICT','Conflicting retry rejected');
select throws_ok($$select public.prepare_file_upload('98000000-0000-0000-0000-000000000001',gen_random_uuid(),'test.pdf','text/plain',20)$$,'22023','INVALID_FILE','MIME and extension must match');
select throws_ok($$select public.prepare_file_upload('98000000-0000-0000-0000-000000000001',gen_random_uuid(),'test.pdf','application/pdf',52428801)$$,'22023','INVALID_FILE','Oversize metadata rejected');
select throws_ok($$update public.files set status='ready'$$,'42501',null,'Client cannot grant readiness');
select throws_ok($$select * from public.file_cleanup_jobs$$,'42501',null,'Client cannot read queue');
select throws_ok($$select public.expire_file_uploads()$$,'42501',null,'Client cannot expire uploads');
select throws_ok($$insert into public.files(course_id,uploaded_by,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
 values ('98000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','learning-files','forged','f.pdf','application/pdf',1)$$,'23514',null,'Direct insert cannot forge storage path');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('learning-files','11111111-1111-1111-1111-111111111111/98000000-0000-0000-0000-000000000001/98000000-0000-0000-0000-000000000099.pdf')$$,'42501',null,'Upload needs metadata');
select lives_ok($$insert into storage.objects(bucket_id,name) select storage_bucket,storage_path from public.files where upload_key='98000000-0000-0000-0000-000000000002'$$,'Pending upload permitted');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$select public.prepare_file_upload('98000000-0000-0000-0000-000000000001',gen_random_uuid(),'test.pdf','application/pdf',20)$$,'42501','COURSE_NOT_FOUND','Foreign course denied');
reset role;
update public.files set status='deleting' where upload_key='98000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(public.can_upload_learning_file((select storage_path from public.files where upload_key='98000000-0000-0000-0000-000000000002')),false,'Deleting prevents new upload');
delete from public.files where upload_key='98000000-0000-0000-0000-000000000002';
select throws_ok($$select public.prepare_file_upload('98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000002','test.pdf','application/pdf',20)$$,'23505','UPLOAD_DELETED','Deleted upload key cannot be reused');
reset role;
select is((select count(*)::int from public.file_cleanup_jobs where upload_key='98000000-0000-0000-0000-000000000002'),1,'Direct delete durably queues cleanup');
select is((select count(*)::int from storage.objects where name like '%/98000000-0000-0000-0000-000000000001/%'),1,'SQL does not delete Storage object rows');
set local role authenticated;
select public.prepare_file_upload('98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000003','test.txt','text/plain',20);
delete from public.courses where id='98000000-0000-0000-0000-000000000001';
reset role;
select is((select count(*)::int from public.file_cleanup_jobs where upload_key='98000000-0000-0000-0000-000000000003'),1,'Course cascade queues cleanup');
insert into public.courses(id,owner_id,title) values
 ('98000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Expiry');
insert into public.files(id,course_id,uploaded_by,storage_bucket,storage_path,original_filename,mime_type,size_bytes,status,updated_at,created_at)
select ('98000000-0000-0000-0000-00000000000' || n)::uuid,'98000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',
 'learning-files','11111111-1111-1111-1111-111111111111/98000000-0000-0000-0000-000000000004/98000000-0000-0000-0000-00000000000' || n || '.txt',
 'test.txt','text/plain',5,state,now()-interval '25 hours',now()-interval '25 hours'
from (values (5,'pending'),(6,'failed'),(7,'deleting'),(8,'ready'),(9,'unverified')) as fixture(n,state);
select public.expire_file_uploads();
select is((select count(*)::int from public.files where course_id='98000000-0000-0000-0000-000000000004'),2,'Expiry preserves ready and legacy files');
select is((select count(*)::int from public.file_cleanup_jobs where file_id in ('98000000-0000-0000-0000-000000000005','98000000-0000-0000-0000-000000000006','98000000-0000-0000-0000-000000000007')),3,'Abandoned uploads and deletions enter queue');
select is((select schedule from cron.job where jobname='learning-files-cleanup'),'*/15 * * * *','Cleanup scheduled every fifteen minutes');
set local role authenticated;
select throws_ok($$select public.configure_file_cleanup('https://abcdefghijklmnopqrst.supabase.co',repeat('x',50))$$,'42501',null,'Clients cannot configure scheduler secrets');
reset role;
select throws_ok($$select public.configure_file_cleanup('http://external.invalid',repeat('x',50))$$,'22023','INVALID_CLEANUP_CONFIG','Scheduler rejects non-project URL');
set local role service_role;
select lives_ok($$select public.configure_file_cleanup('https://abcdefghijklmnopqrst.supabase.co',repeat('x',50))$$,'Deployment can provision Vault configuration');
select lives_ok($$select public.configure_file_cleanup('https://abcdefghijklmnopqrst.supabase.co',repeat('y',50))$$,'Deployment can refresh Vault credentials');
reset role;
select is((select decrypted_secret from vault.decrypted_secrets where name='file_cleanup_service_key'),repeat('y',50),'Credential refresh takes effect');
select * from finish();
rollback;
