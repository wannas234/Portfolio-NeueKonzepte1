-- ERM Learn App. New tables deliberately have no client policies.
begin;
create extension if not exists vector with schema extensions;

-- Preserve existing profile IDs and their existing policies during this migration.
alter table public.profiles rename column display_name to name;
alter table public.profiles add column user_id uuid;
update public.profiles set user_id = id;
alter table public.profiles alter column user_id set not null;
alter table public.profiles add constraint profiles_user_id_key unique (user_id);
alter table public.profiles add constraint profiles_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.profiles add constraint profiles_identity_matches check (id = user_id);
alter table public.profiles add column avatar_url text;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare profile_name text;
begin
  if jsonb_typeof(new.raw_user_meta_data -> 'display_name') = 'string' then
    profile_name := regexp_replace(new.raw_user_meta_data ->> 'display_name',
      '^[[:space:]]+|[[:space:]]+$', '', 'g');
  end if;
  if profile_name is null or char_length(profile_name) not between 1 and 60 then
    profile_name := 'Lernende Person';
  end if;
  insert into public.profiles (id, user_id, name) values (new.id, new.id, profile_name);
  return new;
end;
$$;

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.courses enable row level security;
revoke all on public.courses from anon, authenticated;
create trigger courses_set_updated_at before update on public.courses
  for each row execute function public.set_updated_at();

create table public.files (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  storage_bucket text not null check (btrim(storage_bucket) <> ''),
  storage_path text not null check (btrim(storage_path) <> ''),
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (btrim(mime_type) <> ''),
  size_bytes bigint not null check (size_bytes >= 0),
  unique (storage_bucket, storage_path),
  created_at timestamptz not null default now()
);
alter table public.files enable row level security;
revoke all on public.files from anon, authenticated;

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  file_id uuid references public.files(id) on delete set null,
  type text not null check (type in ('source_document', 'document', 'presentation', 'summary', 'quiz', 'flashcard_deck')),
  title text not null check (btrim(title) <> ''),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.materials enable row level security;
revoke all on public.materials from anon, authenticated;
create trigger materials_set_updated_at before update on public.materials
  for each row execute function public.set_updated_at();

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null unique references public.materials(id) on delete cascade,
  source_file_id uuid references public.files(id) on delete set null,
  document_type text not null check (document_type in ('notes', 'summary', 'study_guide', 'cheat_sheet')),
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.documents enable row level security;
revoke all on public.documents from anon, authenticated;
create trigger documents_set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

create table public.presentations (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null unique references public.materials(id) on delete cascade,
  source_file_id uuid references public.files(id) on delete set null,
  title text not null check (btrim(title) <> ''),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.presentations enable row level security;
revoke all on public.presentations from anon, authenticated;
create trigger presentations_set_updated_at before update on public.presentations
  for each row execute function public.set_updated_at();

create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null unique references public.materials(id) on delete cascade,
  source_file_id uuid references public.files(id) on delete set null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.summaries enable row level security;
revoke all on public.summaries from anon, authenticated;
create trigger summaries_set_updated_at before update on public.summaries
  for each row execute function public.set_updated_at();

create table public.flashcard_decks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null unique references public.materials(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.flashcard_decks enable row level security;
revoke all on public.flashcard_decks from anon, authenticated;
create trigger flashcard_decks_set_updated_at before update on public.flashcard_decks
  for each row execute function public.set_updated_at();

create table public.presentation_slides (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  slide_number integer not null check (slide_number >= 1),
  title text not null,
  content jsonb not null default '{}'::jsonb,
  unique (presentation_id, slide_number),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.presentation_slides enable row level security;
revoke all on public.presentation_slides from anon, authenticated;
create trigger presentation_slides_set_updated_at before update on public.presentation_slides
  for each row execute function public.set_updated_at();

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.flashcard_decks(id) on delete cascade,
  question text not null check (btrim(question) <> ''),
  answer text not null check (btrim(answer) <> ''),
  additional_content jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.flashcards enable row level security;
revoke all on public.flashcards from anon, authenticated;
create trigger flashcards_set_updated_at before update on public.flashcards
  for each row execute function public.set_updated_at();

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (btrim(content) <> ''),
  embedding extensions.vector,
  page_number integer check (page_number >= 1),
  metadata jsonb not null default '{}'::jsonb,
  unique (file_id, chunk_index),
  created_at timestamptz not null default now()
);
alter table public.chunks enable row level security;
revoke all on public.chunks from anon, authenticated;

create table public.content_references (
  id uuid primary key default gen_random_uuid(),
  source_chunk_id uuid not null references public.chunks(id) on delete cascade,
  target_type text not null check (target_type in ('document', 'presentation_slide', 'flashcard', 'summary')),
  target_id uuid not null,
  unique (source_chunk_id, target_type, target_id),
  created_at timestamptz not null default now()
);
alter table public.content_references enable row level security;
revoke all on public.content_references from anon, authenticated;
create index courses_owner_id_created_at_idx on public.courses (owner_id, created_at);
create index files_course_id_created_at_idx on public.files (course_id, created_at);
create index files_uploaded_by_idx on public.files (uploaded_by);
create index materials_course_id_created_at_idx on public.materials (course_id, created_at);
create index materials_created_by_idx on public.materials (created_by);
create index materials_file_id_idx on public.materials (file_id);
create index documents_source_file_id_idx on public.documents (source_file_id);
create index presentations_source_file_id_idx on public.presentations (source_file_id);
create index summaries_source_file_id_idx on public.summaries (source_file_id);
create index flashcards_deck_id_idx on public.flashcards (deck_id);
create index content_references_target_type_target_id_idx on public.content_references (target_type, target_id);
alter table public.content_references add column document_id uuid
  generated always as (case when target_type = 'document' then target_id end) stored
  references public.documents(id) on delete cascade;
create index content_references_document_idx on public.content_references (document_id);
alter table public.content_references add column presentation_slide_id uuid
  generated always as (case when target_type = 'presentation_slide' then target_id end) stored
  references public.presentation_slides(id) on delete cascade;
create index content_references_presentation_slide_idx on public.content_references (presentation_slide_id);
alter table public.content_references add column flashcard_id uuid
  generated always as (case when target_type = 'flashcard' then target_id end) stored
  references public.flashcards(id) on delete cascade;
create index content_references_flashcard_idx on public.content_references (flashcard_id);
alter table public.content_references add column summary_id uuid
  generated always as (case when target_type = 'summary' then target_id end) stored
  references public.summaries(id) on delete cascade;
create index content_references_summary_idx on public.content_references (summary_id);
alter table public.materials add constraint materials_id_type_key unique (id, type);
alter table public.documents add column material_type text
  generated always as ('document'::text) stored;
alter table public.documents add constraint documents_material_type_fkey
  foreign key (material_id, material_type) references public.materials(id, type) on delete cascade;
alter table public.presentations add column material_type text
  generated always as ('presentation'::text) stored;
alter table public.presentations add constraint presentations_material_type_fkey
  foreign key (material_id, material_type) references public.materials(id, type) on delete cascade;
alter table public.summaries add column material_type text
  generated always as ('summary'::text) stored;
alter table public.summaries add constraint summaries_material_type_fkey
  foreign key (material_id, material_type) references public.materials(id, type) on delete cascade;
alter table public.flashcard_decks add column material_type text
  generated always as ('flashcard_deck'::text) stored;
alter table public.flashcard_decks add constraint flashcard_decks_material_type_fkey
  foreign key (material_id, material_type) references public.materials(id, type) on delete cascade;
commit;
