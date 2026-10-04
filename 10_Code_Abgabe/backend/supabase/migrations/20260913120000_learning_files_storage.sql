begin;

-- Bucket configuration is data, so it must be explicitly included in migrations.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'learning-files', 'learning-files', false, 52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- UUIDs are compared as text: malformed paths cannot cause UUID cast errors.
-- The file record is not required here; uploads and metadata are separate operations.
create policy learning_files_insert_owned on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'learning-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|pptx|docx|txt)$'
    and exists (
      select 1 from public.courses c
      where c.id::text = (storage.foldername(name))[2]
        and c.owner_id = (select auth.uid())
    )
  );

-- Read/delete remain possible after course or metadata deletion for cleanup.
create policy learning_files_select_owned on storage.objects
  for select to authenticated
  using (
    bucket_id = 'learning-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy learning_files_delete_owned on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'learning-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No anonymous policies or UPDATE policy: replacing/moving existing objects is denied.
commit;
