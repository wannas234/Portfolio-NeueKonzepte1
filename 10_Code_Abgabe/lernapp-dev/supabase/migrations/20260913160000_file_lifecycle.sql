begin;

-- Existing metadata is not evidence of a completed, validated upload.
alter table public.files add column status text not null default 'unverified'
  check (status in ('unverified', 'pending', 'ready', 'failed', 'deleting'));
alter table public.files alter column status set default 'pending';
alter table public.files add column updated_at timestamptz not null default now();
alter table public.files add column error_code text;
alter table public.files add column upload_key uuid;
create unique index files_upload_key on public.files(uploaded_by, upload_key);
create index files_cleanup_candidates on public.files(updated_at) where status in ('pending', 'failed', 'deleting');
create trigger files_set_updated_at before update on public.files
  for each row execute function public.set_updated_at();

create function public.file_extension(p_mime text) returns text
language sql immutable set search_path = '' as $$
  select case p_mime when 'application/pdf' then 'pdf'
    when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'pptx'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    when 'text/plain' then 'txt' end;
$$;
-- NOT VALID preserves old paths for manual review; new rows and updates are checked.
alter table public.files add constraint files_storage_contract check (
  status = 'unverified' or (
    storage_bucket = 'learning-files' and public.file_extension(mime_type) is not null
    and storage_path = uploaded_by::text || '/' || course_id::text || '/' || id::text || '.' || public.file_extension(mime_type)
    and size_bytes between 1 and 52428800
    and char_length(original_filename) between 1 and 255
  )
) not valid;

-- No foreign keys: jobs must survive file, course and account deletion.
-- Completed jobs are retained as tombstones to prohibit reusing deleted object paths.
create table public.file_cleanup_jobs (
  file_id uuid primary key,
  owner_id uuid not null,
  upload_key uuid,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text
);
alter table public.file_cleanup_jobs enable row level security;
revoke all on public.file_cleanup_jobs from public, anon, authenticated;
grant all on public.file_cleanup_jobs to service_role;
create index file_cleanup_due on public.file_cleanup_jobs(next_attempt_at) where completed_at is null;

create function public.queue_file_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.id::text, 1));
  -- Never turn untrusted legacy metadata into a privileged deletion capability.
  if old.storage_bucket = 'learning-files'
    and public.file_extension(old.mime_type) is not null
    and old.storage_path = old.uploaded_by::text || '/' || old.course_id::text || '/' || old.id::text || '.' || public.file_extension(old.mime_type) then
    insert into public.file_cleanup_jobs(file_id, owner_id, upload_key, storage_path)
      values (old.id, old.uploaded_by, old.upload_key, old.storage_path)
      on conflict (file_id) do nothing;
  end if;
  return old;
end;
$$;
create trigger files_queue_cleanup before delete on public.files
  for each row execute function public.queue_file_cleanup();

create function public.prevent_file_reuse() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.id::text, 1));
  if exists (select 1 from public.file_cleanup_jobs j where j.file_id = new.id
    or (j.owner_id = new.uploaded_by and j.upload_key = new.upload_key)) then
    raise exception 'UPLOAD_DELETED' using errcode = '23505';
  end if;
  return new;
end;
$$;
create trigger files_prevent_reuse before insert on public.files
  for each row execute function public.prevent_file_reuse();

create function public.prepare_file_upload(p_course_id uuid, p_upload_key uuid, p_filename text, p_mime text, p_size bigint)
returns public.files language plpgsql security definer set search_path = '' as $$
declare result public.files; file_id uuid := gen_random_uuid(); uid uuid := auth.uid(); ext text := public.file_extension(p_mime);
begin
  if uid is null or not exists (select 1 from public.courses where id = p_course_id and owner_id = uid) then
    raise exception 'COURSE_NOT_FOUND' using errcode = '42501';
  end if;
  if p_upload_key is null or ext is null or p_size is null or p_size not between 1 and 52428800
    or p_filename is null or char_length(p_filename) not between 1 and 255
    or btrim(p_filename) = '' or lower(right(p_filename, char_length(ext) + 1)) <> '.' || ext then
    raise exception 'INVALID_FILE' using errcode = '22023';
  end if;
  -- Serialize retries, including simultaneous prepare calls for the same key.
  perform pg_advisory_xact_lock(hashtextextended(uid::text || p_upload_key::text, 0));
  select * into result from public.files where uploaded_by = uid and upload_key = p_upload_key;
  if found then
    if result.course_id <> p_course_id or result.original_filename <> p_filename or result.mime_type <> p_mime or result.size_bytes <> p_size then
      raise exception 'UPLOAD_KEY_CONFLICT' using errcode = '23505';
    end if;
    return result;
  end if;
  insert into public.files(id, course_id, uploaded_by, storage_bucket, storage_path, original_filename, mime_type, size_bytes, upload_key)
    values(file_id, p_course_id, uid, 'learning-files', uid::text || '/' || p_course_id::text || '/' || file_id::text || '.' || ext,
      p_filename, p_mime, p_size, p_upload_key) returning * into result;
  return result;
end;
$$;
revoke all on function public.prepare_file_upload(uuid,uuid,text,text,bigint) from public, anon;
grant execute on function public.prepare_file_upload(uuid,uuid,text,text,bigint) to authenticated;

-- Lock the metadata row until the Storage INSERT transaction commits, so deletion
-- cannot complete between authorization and object creation.
create function public.can_upload_learning_file(p_path text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  select f.id into result from public.files f join public.courses c on c.id = f.course_id
    where f.storage_path = p_path and f.storage_bucket = 'learning-files'
      and f.uploaded_by = auth.uid() and c.owner_id = auth.uid()
      and f.status = 'pending' and f.created_at > now() - interval '24 hours'
    for share of f;
  return result is not null;
end;
$$;
revoke all on function public.can_upload_learning_file(text) from public, anon;
grant execute on function public.can_upload_learning_file(text) to authenticated;
drop policy learning_files_insert_owned on storage.objects;
create policy learning_files_insert_owned on storage.objects for insert to authenticated
  with check (bucket_id = 'learning-files' and public.can_upload_learning_file(name));
drop policy learning_files_select_owned on storage.objects;
create policy learning_files_select_owned on storage.objects for select to authenticated
  using (bucket_id = 'learning-files' and exists (
    select 1 from public.files f where f.storage_path = name and f.storage_bucket = bucket_id
      and f.uploaded_by = (select auth.uid()) and f.status = 'ready'));
-- All deletions now go through the file operation or the durable cleanup queue.
drop policy learning_files_delete_owned on storage.objects;

create function public.expire_file_uploads() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.files where id in (
    select id from public.files where (status in ('pending','failed') and updated_at < now() - interval '24 hours')
      or (status = 'deleting' and updated_at < now() - interval '15 minutes')
    order by updated_at limit 100 for update skip locked
  );
end;
$$;
revoke all on function public.expire_file_uploads() from public, anon, authenticated;
grant execute on function public.expire_file_uploads() to service_role;
revoke all on function public.queue_file_cleanup(), public.prevent_file_reuse() from public, anon, authenticated;
commit;
