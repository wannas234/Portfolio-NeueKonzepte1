-- Private, single-owner courses. Based on the inspected local public schema.
-- No SECURITY DEFINER helpers: parent lookups also enforce their own RLS.
begin;

-- Abort atomically on inconsistent legacy data before enabling client access.
-- Privileged ingestion must continue to enforce the same course relationships.
do $$
begin
  if exists (select 1 from public.files f join public.courses c on c.id=f.course_id where f.uploaded_by <> c.owner_id)
    or exists (select 1 from public.materials m join public.courses c on c.id=m.course_id left join public.files f on f.id=m.file_id where m.created_by <> c.owner_id or f.course_id <> m.course_id)
    or exists (select 1 from public.documents t join public.materials m on m.id=t.material_id join public.files f on f.id=t.source_file_id where f.course_id <> m.course_id)
    or exists (select 1 from public.presentations t join public.materials m on m.id=t.material_id join public.files f on f.id=t.source_file_id where f.course_id <> m.course_id)
    or exists (select 1 from public.summaries t join public.materials m on m.id=t.material_id join public.files f on f.id=t.source_file_id where f.course_id <> m.course_id)
    or exists (select 1 from public.content_references where not (exists (
    select 1 from public.chunks ch join public.files f on f.id = ch.file_id
    where ch.id = content_references.source_chunk_id
      and ((content_references.target_type = 'document' and exists (
        select 1 from public.documents t
        join public.materials m on m.id = t.material_id
        where t.id = content_references.target_id and m.course_id = f.course_id))
        or (content_references.target_type = 'summary' and exists (
        select 1 from public.summaries t
        join public.materials m on m.id = t.material_id
        where t.id = content_references.target_id and m.course_id = f.course_id))
        or (content_references.target_type = 'presentation_slide' and exists (
        select 1 from public.presentation_slides t join public.presentations p on p.id = t.presentation_id
        join public.materials m on m.id = p.material_id
        where t.id = content_references.target_id and m.course_id = f.course_id))
        or (content_references.target_type = 'flashcard' and exists (
        select 1 from public.flashcards t join public.flashcard_decks p on p.id = t.deck_id
        join public.materials m on m.id = p.material_id
        where t.id = content_references.target_id and m.course_id = f.course_id)))))) then
    raise exception 'Core RLS: inconsistent owner or cross-course source/target; repair data before migration';
  end if;
end;
$$;

-- Profiles already allow only SELECT and UPDATE(name) on the caller's row.
-- Keep their Auth-managed creation/deletion and existing policies.

-- courses: immutable identity, ownership, parent and creation timestamps.
alter table public.courses enable row level security;
revoke all on public.courses from public, anon, authenticated;
grant select, delete on public.courses to authenticated;
grant insert (id, owner_id, title, description) on public.courses to authenticated;
grant update (title, description) on public.courses to authenticated;

create policy courses_select_owned on public.courses
  for select to authenticated using ((select auth.uid()) = courses.owner_id);
create policy courses_insert_owned on public.courses
  for insert to authenticated with check ((select auth.uid()) = courses.owner_id);
create policy courses_update_owned on public.courses
  for update to authenticated using ((select auth.uid()) = courses.owner_id)
  with check ((select auth.uid()) = courses.owner_id);
create policy courses_delete_owned on public.courses
  for delete to authenticated using ((select auth.uid()) = courses.owner_id);

-- files: immutable identity, ownership, parent and creation timestamps.
alter table public.files enable row level security;
revoke all on public.files from public, anon, authenticated;
grant select, delete on public.files to authenticated;
grant insert (id, course_id, uploaded_by, storage_bucket, storage_path, original_filename, mime_type, size_bytes) on public.files to authenticated;
grant update (original_filename) on public.files to authenticated;

create policy files_select_owned on public.files
  for select to authenticated using ((select auth.uid()) = files.uploaded_by
    and exists (select 1 from public.courses c where c.id = files.course_id));
create policy files_insert_owned on public.files
  for insert to authenticated with check ((select auth.uid()) = files.uploaded_by
    and exists (select 1 from public.courses c where c.id = files.course_id));
create policy files_update_owned on public.files
  for update to authenticated using ((select auth.uid()) = files.uploaded_by
    and exists (select 1 from public.courses c where c.id = files.course_id))
  with check ((select auth.uid()) = files.uploaded_by
    and exists (select 1 from public.courses c where c.id = files.course_id));
create policy files_delete_owned on public.files
  for delete to authenticated using ((select auth.uid()) = files.uploaded_by
    and exists (select 1 from public.courses c where c.id = files.course_id));

-- materials: immutable identity, ownership, parent and creation timestamps.
alter table public.materials enable row level security;
revoke all on public.materials from public, anon, authenticated;
grant select, delete on public.materials to authenticated;
grant insert (id, course_id, created_by, file_id, type, title, description) on public.materials to authenticated;
grant update (file_id, title, description) on public.materials to authenticated;

create policy materials_select_owned on public.materials
  for select to authenticated using ((select auth.uid()) = materials.created_by
    and exists (select 1 from public.courses c where c.id = materials.course_id)
    and (materials.file_id is null or exists (
      select 1 from public.files f
      where f.id = materials.file_id and f.course_id = materials.course_id)));
create policy materials_insert_owned on public.materials
  for insert to authenticated with check ((select auth.uid()) = materials.created_by
    and exists (select 1 from public.courses c where c.id = materials.course_id)
    and (materials.file_id is null or exists (
      select 1 from public.files f
      where f.id = materials.file_id and f.course_id = materials.course_id)));
create policy materials_update_owned on public.materials
  for update to authenticated using ((select auth.uid()) = materials.created_by
    and exists (select 1 from public.courses c where c.id = materials.course_id)
    and (materials.file_id is null or exists (
      select 1 from public.files f
      where f.id = materials.file_id and f.course_id = materials.course_id)))
  with check ((select auth.uid()) = materials.created_by
    and exists (select 1 from public.courses c where c.id = materials.course_id)
    and (materials.file_id is null or exists (
      select 1 from public.files f
      where f.id = materials.file_id and f.course_id = materials.course_id)));
create policy materials_delete_owned on public.materials
  for delete to authenticated using ((select auth.uid()) = materials.created_by
    and exists (select 1 from public.courses c where c.id = materials.course_id)
    and (materials.file_id is null or exists (
      select 1 from public.files f
      where f.id = materials.file_id and f.course_id = materials.course_id)));

-- documents: immutable identity, ownership, parent and creation timestamps.
alter table public.documents enable row level security;
revoke all on public.documents from public, anon, authenticated;
grant select, delete on public.documents to authenticated;
grant insert (id, material_id, source_file_id, document_type, content) on public.documents to authenticated;
grant update (source_file_id, document_type, content) on public.documents to authenticated;

create policy documents_select_owned on public.documents
  for select to authenticated using (exists (select 1 from public.materials m
      where m.id = documents.material_id
        and (documents.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = documents.source_file_id and f.course_id = m.course_id))));
create policy documents_insert_owned on public.documents
  for insert to authenticated with check (exists (select 1 from public.materials m
      where m.id = documents.material_id
        and (documents.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = documents.source_file_id and f.course_id = m.course_id))));
create policy documents_update_owned on public.documents
  for update to authenticated using (exists (select 1 from public.materials m
      where m.id = documents.material_id
        and (documents.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = documents.source_file_id and f.course_id = m.course_id))))
  with check (exists (select 1 from public.materials m
      where m.id = documents.material_id
        and (documents.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = documents.source_file_id and f.course_id = m.course_id))));
create policy documents_delete_owned on public.documents
  for delete to authenticated using (exists (select 1 from public.materials m
      where m.id = documents.material_id
        and (documents.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = documents.source_file_id and f.course_id = m.course_id))));

-- presentations: immutable identity, ownership, parent and creation timestamps.
alter table public.presentations enable row level security;
revoke all on public.presentations from public, anon, authenticated;
grant select, delete on public.presentations to authenticated;
grant insert (id, material_id, source_file_id, title, description) on public.presentations to authenticated;
grant update (source_file_id, title, description) on public.presentations to authenticated;

create policy presentations_select_owned on public.presentations
  for select to authenticated using (exists (select 1 from public.materials m
      where m.id = presentations.material_id
        and (presentations.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = presentations.source_file_id and f.course_id = m.course_id))));
create policy presentations_insert_owned on public.presentations
  for insert to authenticated with check (exists (select 1 from public.materials m
      where m.id = presentations.material_id
        and (presentations.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = presentations.source_file_id and f.course_id = m.course_id))));
create policy presentations_update_owned on public.presentations
  for update to authenticated using (exists (select 1 from public.materials m
      where m.id = presentations.material_id
        and (presentations.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = presentations.source_file_id and f.course_id = m.course_id))))
  with check (exists (select 1 from public.materials m
      where m.id = presentations.material_id
        and (presentations.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = presentations.source_file_id and f.course_id = m.course_id))));
create policy presentations_delete_owned on public.presentations
  for delete to authenticated using (exists (select 1 from public.materials m
      where m.id = presentations.material_id
        and (presentations.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = presentations.source_file_id and f.course_id = m.course_id))));

-- summaries: immutable identity, ownership, parent and creation timestamps.
alter table public.summaries enable row level security;
revoke all on public.summaries from public, anon, authenticated;
grant select, delete on public.summaries to authenticated;
grant insert (id, material_id, source_file_id, content) on public.summaries to authenticated;
grant update (source_file_id, content) on public.summaries to authenticated;

create policy summaries_select_owned on public.summaries
  for select to authenticated using (exists (select 1 from public.materials m
      where m.id = summaries.material_id
        and (summaries.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = summaries.source_file_id and f.course_id = m.course_id))));
create policy summaries_insert_owned on public.summaries
  for insert to authenticated with check (exists (select 1 from public.materials m
      where m.id = summaries.material_id
        and (summaries.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = summaries.source_file_id and f.course_id = m.course_id))));
create policy summaries_update_owned on public.summaries
  for update to authenticated using (exists (select 1 from public.materials m
      where m.id = summaries.material_id
        and (summaries.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = summaries.source_file_id and f.course_id = m.course_id))))
  with check (exists (select 1 from public.materials m
      where m.id = summaries.material_id
        and (summaries.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = summaries.source_file_id and f.course_id = m.course_id))));
create policy summaries_delete_owned on public.summaries
  for delete to authenticated using (exists (select 1 from public.materials m
      where m.id = summaries.material_id
        and (summaries.source_file_id is null or exists (
          select 1 from public.files f
          where f.id = summaries.source_file_id and f.course_id = m.course_id))));

-- flashcard_decks: immutable identity, ownership, parent and creation timestamps.
alter table public.flashcard_decks enable row level security;
revoke all on public.flashcard_decks from public, anon, authenticated;
grant select, delete on public.flashcard_decks to authenticated;
grant insert (id, material_id, title, description) on public.flashcard_decks to authenticated;
grant update (title, description) on public.flashcard_decks to authenticated;

create policy flashcard_decks_select_owned on public.flashcard_decks
  for select to authenticated using (exists (select 1 from public.materials m
      where m.id = flashcard_decks.material_id));
create policy flashcard_decks_insert_owned on public.flashcard_decks
  for insert to authenticated with check (exists (select 1 from public.materials m
      where m.id = flashcard_decks.material_id));
create policy flashcard_decks_update_owned on public.flashcard_decks
  for update to authenticated using (exists (select 1 from public.materials m
      where m.id = flashcard_decks.material_id))
  with check (exists (select 1 from public.materials m
      where m.id = flashcard_decks.material_id));
create policy flashcard_decks_delete_owned on public.flashcard_decks
  for delete to authenticated using (exists (select 1 from public.materials m
      where m.id = flashcard_decks.material_id));

-- presentation_slides: immutable identity, ownership, parent and creation timestamps.
alter table public.presentation_slides enable row level security;
revoke all on public.presentation_slides from public, anon, authenticated;
grant select, delete on public.presentation_slides to authenticated;
grant insert (id, presentation_id, slide_number, title, content) on public.presentation_slides to authenticated;
grant update (slide_number, title, content) on public.presentation_slides to authenticated;

create policy presentation_slides_select_owned on public.presentation_slides
  for select to authenticated using (exists (select 1 from public.presentations p where p.id = presentation_slides.presentation_id));
create policy presentation_slides_insert_owned on public.presentation_slides
  for insert to authenticated with check (exists (select 1 from public.presentations p where p.id = presentation_slides.presentation_id));
create policy presentation_slides_update_owned on public.presentation_slides
  for update to authenticated using (exists (select 1 from public.presentations p where p.id = presentation_slides.presentation_id))
  with check (exists (select 1 from public.presentations p where p.id = presentation_slides.presentation_id));
create policy presentation_slides_delete_owned on public.presentation_slides
  for delete to authenticated using (exists (select 1 from public.presentations p where p.id = presentation_slides.presentation_id));

-- flashcards: immutable identity, ownership, parent and creation timestamps.
alter table public.flashcards enable row level security;
revoke all on public.flashcards from public, anon, authenticated;
grant select, delete on public.flashcards to authenticated;
grant insert (id, deck_id, question, answer, additional_content) on public.flashcards to authenticated;
grant update (question, answer, additional_content) on public.flashcards to authenticated;

create policy flashcards_select_owned on public.flashcards
  for select to authenticated using (exists (select 1 from public.flashcard_decks d where d.id = flashcards.deck_id));
create policy flashcards_insert_owned on public.flashcards
  for insert to authenticated with check (exists (select 1 from public.flashcard_decks d where d.id = flashcards.deck_id));
create policy flashcards_update_owned on public.flashcards
  for update to authenticated using (exists (select 1 from public.flashcard_decks d where d.id = flashcards.deck_id))
  with check (exists (select 1 from public.flashcard_decks d where d.id = flashcards.deck_id));
create policy flashcards_delete_owned on public.flashcards
  for delete to authenticated using (exists (select 1 from public.flashcard_decks d where d.id = flashcards.deck_id));

-- Server-managed data: clients can only read within their own course.
alter table public.chunks enable row level security;
revoke all on public.chunks from public, anon, authenticated;
grant select on public.chunks to authenticated;
create policy chunks_select_owned on public.chunks
  for select to authenticated using (exists (select 1 from public.files f where f.id = chunks.file_id));

-- Server-managed data: clients can only read within their own course.
alter table public.content_references enable row level security;
revoke all on public.content_references from public, anon, authenticated;
grant select on public.content_references to authenticated;
create policy content_references_select_owned on public.content_references
  for select to authenticated using (exists (
    select 1 from public.chunks ch join public.files f on f.id = ch.file_id
    where ch.id = content_references.source_chunk_id
      and ((content_references.target_type = 'document' and exists (
        select 1 from public.documents t
        join public.materials m on m.id = t.material_id
        where t.id = content_references.target_id and m.course_id = f.course_id))
        or (content_references.target_type = 'summary' and exists (
        select 1 from public.summaries t
        join public.materials m on m.id = t.material_id
        where t.id = content_references.target_id and m.course_id = f.course_id))
        or (content_references.target_type = 'presentation_slide' and exists (
        select 1 from public.presentation_slides t join public.presentations p on p.id = t.presentation_id
        join public.materials m on m.id = p.material_id
        where t.id = content_references.target_id and m.course_id = f.course_id))
        or (content_references.target_type = 'flashcard' and exists (
        select 1 from public.flashcards t join public.flashcard_decks p on p.id = t.deck_id
        join public.materials m on m.id = p.material_id
        where t.id = content_references.target_id and m.course_id = f.course_id)))));

commit;
