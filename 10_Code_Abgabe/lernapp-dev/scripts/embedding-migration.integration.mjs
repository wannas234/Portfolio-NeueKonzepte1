import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { root } from './environment.mjs';

test('Gemini migration archives OpenAI vectors, resets leases and preserves citations atomically', () => {
  const config = readFileSync(`${root}supabase/config.toml`, 'utf8');
  const project = config.match(/^project_id = "([a-zA-Z0-9_-]+)"/m)?.[1];
  assert.ok(project, 'Local container name must come from config.toml');
  const migration = readFileSync(
    `${root}supabase/migrations/20260916120000_gemini_embedding_index.sql`,
    'utf8',
  )
    .replace(/^begin;\s*/, '')
    .replace(/commit;\s*$/, '');
  // Reconstruct an old index inside ONE rollback-only transaction. Neither the
  // fixtures nor the reconstructed schema survive this test, even on failure.
  const sql = `
  begin;
  set local lock_timeout = '5s';
  delete from public.document_chunks;
  drop table embedding_archive.openai_document_chunks;
  alter table public.document_chunks
    drop constraint document_chunks_embedding_model_check,
    drop constraint document_chunks_embedding_provider_check,
    alter column embedding_model set default 'text-embedding-3-small',
    alter column embedding_provider set default 'openai',
    add constraint document_chunks_embedding_model_check check (embedding_model = 'text-embedding-3-small'),
    add constraint document_chunks_embedding_provider_check check (embedding_provider = 'openai');
  insert into public.courses(id,owner_id,title) values
    ('96000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Migration test');
  insert into public.materials(id,course_id,created_by,type,title) values
    ('96000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','source_document','Original title');
  insert into public.source_documents(id,material_id,processing_status,indexing_status,extracted_text,completed_at) values
    ('96000000-0000-0000-0000-000000000003','96000000-0000-0000-0000-000000000002','ready','ready','Original text',now());
  insert into public.document_chunks(id,document_id,chunk_index,content,embedding) values
    ('96000000-0000-0000-0000-000000000004','96000000-0000-0000-0000-000000000003',0,'Original text',('[1,' || repeat('0,',1534) || '0]')::extensions.vector);
  insert into public.chat_conversations(id,course_id) values
    ('96000000-0000-0000-0000-000000000005','96000000-0000-0000-0000-000000000001');
  select public.append_chat_exchange('96000000-0000-0000-0000-000000000005',gen_random_uuid(),'Question','Answer [1]','test-model',
    jsonb_build_array(jsonb_build_object('citation_no',1,'chunk_id','96000000-0000-0000-0000-000000000004',
    'source_document_id','96000000-0000-0000-0000-000000000003','material_id','96000000-0000-0000-0000-000000000002',
    'material_title','Original title','page_number',null,'excerpt','Original text','similarity',1)));
  update public.document_indexing_jobs set next_index=5, attempts=2,
    lease_token='96000000-0000-0000-0000-000000000006',lease_until=now()+interval '1 minute'
    where document_id='96000000-0000-0000-0000-000000000003';
  ${migration}
  do $$ begin
    if not exists(select 1 from embedding_archive.openai_document_chunks
      where id='96000000-0000-0000-0000-000000000004' and embedding_provider='openai'
      and embedding_model='text-embedding-3-small' and content='Original text') then raise exception 'Archive lost provenance'; end if;
    if exists(select 1 from public.document_chunks) then raise exception 'Old vectors still searchable'; end if;
    if not exists(select 1 from public.source_documents where id='96000000-0000-0000-0000-000000000003'
      and indexing_status='pending' and extracted_text='Original text') then raise exception 'Document not requeued'; end if;
    if not exists(select 1 from public.document_indexing_jobs where document_id='96000000-0000-0000-0000-000000000003'
      and next_index=0 and attempts=0 and lease_token is null and lease_until is null) then raise exception 'Old lease survived'; end if;
    if not exists(select 1 from public.chat_message_sources where source_document_id='96000000-0000-0000-0000-000000000003'
      and chunk_id is null and excerpt='Original text' and material_title='Original title') then raise exception 'Citation snapshot lost'; end if;
    if public.finish_document_indexing_batch('96000000-0000-0000-0000-000000000003',
      '96000000-0000-0000-0000-000000000006','gemini','gemini-embedding-2',1536,'[]',0) then raise exception 'Old lease published'; end if;
    if has_schema_privilege('authenticated','embedding_archive','usage') then raise exception 'Archive exposed'; end if;
  end $$;
  delete from public.courses where id='96000000-0000-0000-0000-000000000001';
  do $$ begin
    if exists(select 1 from embedding_archive.openai_document_chunks where id='96000000-0000-0000-0000-000000000004') then raise exception 'Archive did not follow deletion'; end if;
  end $$;
  rollback;`;
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      `supabase_db_${project}`,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
    ],
    {
      input: sql,
      encoding: 'utf8',
      timeout: 60000,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
