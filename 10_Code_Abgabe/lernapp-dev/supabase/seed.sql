-- Lokale Testdaten. Läuft automatisch bei `supabase start` und `npm run db:reset`.
--
-- WICHTIG: Dieser Seed wird NIEMALS gegen die Remote-Instanz ausgeführt.
-- Er dient nur dazu, dass alle Kollaboratoren lokal denselben Datenstand haben.
-- Deshalb sind hier feste UUIDs verwendet – Tests und Frontend können sich
-- darauf verlassen.
--
-- Test-Logins (lokal, Supabase Studio: http://127.0.0.1:54323):
--   anna@example.com / password123
--   ben@example.com  / password123
--   test@example.com / test (einfacher Test-User)

-- ---------------------------------------------------------------------------
-- Auth-User anlegen. Der Trigger `on_auth_user_created` legt dazu automatisch
-- den passenden Eintrag in public.profiles an.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated',
    'authenticated',
    'anna@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Anna"}',
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated',
    'authenticated',
    'ben@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Ben"}',
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-3333-3333-333333333333',
    'authenticated',
    'authenticated',
    'test@example.com',
    extensions.crypt('test', extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Test"}',
    '',
    '',
    '',
    ''
  );

-- Identities werden für Login per E-Mail/Passwort benötigt.
insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  u.id::text,
  u.id,
  json_build_object('sub', u.id::text, 'email', u.email),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.email in ('anna@example.com', 'ben@example.com', 'test@example.com');

-- ERM-Beispiel: Storage-Pfade sind Metadaten; es werden keine Dateien hochgeladen.
insert into public.courses(id, owner_id, title) values ('90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Biologie');
insert into public.files(id, course_id, uploaded_by, storage_bucket, storage_path, original_filename, mime_type, size_bytes)
values ('90000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'learning-files', '11111111-1111-1111-1111-111111111111/90000000-0000-0000-0000-000000000001/90000000-0000-0000-0000-000000000002.pdf', 'biology.pdf', 'application/pdf', 100);
insert into public.chunks(id, file_id, chunk_index, content, embedding, page_number)
values ('90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000002', 0, 'Zellen sind die Bausteine des Lebens.', '[0.1,0.2,0.3]', 1);
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('90000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '90000000-0000-0000-0000-000000000002', 'document', 'Zellbiologie');
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '90000000-0000-0000-0000-000000000002', 'presentation', 'Zellbiologie');
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('90000000-0000-0000-0000-000000000006', '90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '90000000-0000-0000-0000-000000000002', 'summary', 'Zellbiologie');
insert into public.materials(id, course_id, created_by, file_id, type, title) values ('90000000-0000-0000-0000-000000000007', '90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '90000000-0000-0000-0000-000000000002', 'flashcard_deck', 'Zellbiologie');
insert into public.documents(id, material_id, source_file_id, document_type, content) values ('90000000-0000-0000-0000-000000000008', '90000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000002', 'notes', '{"text":"Zellbiologie"}');
insert into public.presentations(id, material_id, source_file_id, title) values ('90000000-0000-0000-0000-000000000009', '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002', 'Zellbiologie');
insert into public.summaries(id, material_id, source_file_id, content) values ('90000000-0000-0000-0000-000000000010', '90000000-0000-0000-0000-000000000006', '90000000-0000-0000-0000-000000000002', '{"text":"Zusammenfassung"}');
insert into public.flashcard_decks(id, material_id, title) values ('90000000-0000-0000-0000-000000000011', '90000000-0000-0000-0000-000000000007', 'Zellen');
insert into public.presentation_slides(id, presentation_id, slide_number, title) values ('90000000-0000-0000-0000-000000000012', '90000000-0000-0000-0000-000000000009', 1, 'Die Zelle');
insert into public.flashcards(id, deck_id, question, answer) values ('90000000-0000-0000-0000-000000000013', '90000000-0000-0000-0000-000000000011', 'Was ist eine Zelle?', 'Ein Grundbaustein des Lebens.');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('90000000-0000-0000-0000-000000000003', 'document', '90000000-0000-0000-0000-000000000008');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('90000000-0000-0000-0000-000000000003', 'presentation_slide', '90000000-0000-0000-0000-000000000012');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('90000000-0000-0000-0000-000000000003', 'summary', '90000000-0000-0000-0000-000000000010');
insert into public.content_references(source_chunk_id, target_type, target_id) values ('90000000-0000-0000-0000-000000000003', 'flashcard', '90000000-0000-0000-0000-000000000013');
insert into public.calendar_events(id, owner_id, course_id, title, kind, starts_at) values
 ('90000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', '90000000-0000-0000-0000-000000000001', 'Zellbiologie: Vorlesung', 'lecture', '2026-10-12 09:00+00'),
 ('90000000-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', '90000000-0000-0000-0000-000000000001', 'Klausurvorbereitung', 'study', '2026-10-14 14:00+00'),
 ('90000000-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', null, 'Laborbericht abgeben', 'deadline', '2026-10-28 18:00+00');
