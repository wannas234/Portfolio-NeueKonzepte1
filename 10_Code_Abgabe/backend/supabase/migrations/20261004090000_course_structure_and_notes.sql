-- Course metadata, lecture hierarchy and private page notes.
-- Independent of AI generation and calendar import workflows.
begin;

-- Course metadata. Semester/lecturer are optional free text; the target grade
-- is a personal goal per course on the same 1.0-5.0 scale as assessments.
alter table public.courses
  add column semester text check (semester is null or char_length(btrim(semester)) between 1 and 100),
  add column lecturer text check (lecturer is null or char_length(btrim(lecturer)) between 1 and 200),
  add column target_grade numeric(3,2) check (target_grade is null or (target_grade >= 1 and target_grade <= 5));
grant insert (semester, lecturer, target_grade) on public.courses to authenticated;
grant update (semester, lecturer, target_grade) on public.courses to authenticated;

-- Course -> lecture -> document. Ownership is derived through courses.owner_id.
create table public.lectures (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  held_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lectures_course_id_held_on_idx on public.lectures (course_id, held_on, created_at);
create trigger lectures_set_updated_at before update on public.lectures
  for each row execute function public.set_updated_at();
alter table public.lectures enable row level security;
revoke all on public.lectures from public, anon, authenticated;
grant select, delete on public.lectures to authenticated;
grant insert (id, course_id, title, held_on) on public.lectures to authenticated;
grant update (title, held_on) on public.lectures to authenticated;
create policy lectures_owned on public.lectures for all to authenticated
  using (exists (select 1 from public.courses c where c.id = lectures.course_id and c.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.courses c where c.id = lectures.course_id and c.owner_id = (select auth.uid())));

-- A material belongs to at most one lecture of its own course.
alter table public.materials add column lecture_id uuid references public.lectures(id) on delete set null;
create index materials_lecture_id_idx on public.materials (lecture_id) where lecture_id is not null;
grant insert (lecture_id) on public.materials to authenticated;
grant update (lecture_id) on public.materials to authenticated;
create function public.check_material_lecture() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.lecture_id is not null and not exists (
    select 1 from public.lectures l where l.id = new.lecture_id and l.course_id = new.course_id
  ) then
    raise exception 'LECTURE_NOT_FOUND' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.check_material_lecture() from public, anon, authenticated;
create trigger materials_check_lecture before insert or update of lecture_id, course_id on public.materials
  for each row execute function public.check_material_lecture();

-- Page-anchored notes and highlights, private to the user.
create table public.document_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  kind text not null check (kind in ('note', 'highlight')),
  body text not null default '' check (char_length(body) <= 4000),
  quote text check (quote is null or char_length(btrim(quote)) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'note' or char_length(btrim(body)) > 0),
  check (kind <> 'highlight' or quote is not null)
);
create index document_notes_material_idx on public.document_notes (material_id, page_number, created_at);
create index document_notes_open_idx on public.document_notes (user_id, created_at desc) where status = 'open';
create trigger document_notes_set_updated_at before update on public.document_notes
  for each row execute function public.set_updated_at();
alter table public.document_notes enable row level security;
revoke all on public.document_notes from public, anon, authenticated;
grant select, delete on public.document_notes to authenticated;
grant insert (id, user_id, material_id, page_number, kind, body, quote) on public.document_notes to authenticated;
grant update (body, status) on public.document_notes to authenticated;
create policy document_notes_owned on public.document_notes for all to authenticated
  using (user_id = (select auth.uid())
    and exists (select 1 from public.materials m where m.id = material_id and m.type = 'source_document'))
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.materials m where m.id = material_id and m.type = 'source_document'));

commit;
