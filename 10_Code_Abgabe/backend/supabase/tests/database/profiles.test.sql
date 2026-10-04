-- pgTAP-Tests für public.profiles.
-- Ausführen mit: npm run test:db   (setzt einen laufenden lokalen Stack voraus)
--
-- Konvention: Jede Testdatei läuft in einer Transaktion und wird am Ende
-- zurückgerollt – Tests dürfen den lokalen Datenstand nie verändern.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- Struktur
-- ---------------------------------------------------------------------------

select has_table('public', 'profiles', 'Tabelle public.profiles existiert');
select has_column('public', 'profiles', 'id', 'Spalte id existiert');
select has_column('public', 'profiles', 'name', 'Spalte name existiert');
select has_column('public', 'profiles', 'created_at', 'Spalte created_at existiert');
select has_column('public', 'profiles', 'updated_at', 'Spalte updated_at existiert');
select col_is_pk('public', 'profiles', 'id', 'id ist Primary Key');

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

select is(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  true,
  'RLS ist auf public.profiles aktiviert'
);

select policies_are(
  'public',
  'profiles',
  array[
    'Nutzer können ihr eigenes Profil lesen',
    'Nutzer können ihr eigenes Profil ändern'
  ],
  'Genau die zwei erwarteten Policies sind definiert'
);

-- ---------------------------------------------------------------------------
-- Seed-Daten + Trigger
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.profiles where id in (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222'
  )),
  2,
  'Beide Seed-Profile existieren unabhängig von zusätzlichen lokalen Konten'
);

select is(
  (select name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Anna',
  'Trigger handle_new_user übernimmt display_name aus den User-Metadaten in name'
);

-- ---------------------------------------------------------------------------
-- RLS-Verhalten aus Sicht eines angemeldeten Nutzers (Ben)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.profiles),
  1,
  'Angemeldete Nutzer sehen nur ihr eigenes Profil'
);

with versuch as (
  update public.profiles set name = 'Gehackt'
  where id = '11111111-1111-1111-1111-111111111111'
  returning 1
)
select is(
  (select count(*)::int from versuch),
  0,
  'Fremdes Profil kann nicht geändert werden'
);

with versuch as (
  update public.profiles set name = 'Benjamin'
  where id = '22222222-2222-2222-2222-222222222222'
  returning 1
)
select is(
  (select count(*)::int from versuch),
  1,
  'Eigenes Profil kann geändert werden'
);

-- ---------------------------------------------------------------------------
-- RLS-Verhalten für anonyme Zugriffe
-- ---------------------------------------------------------------------------

reset role;
set local role anon;

select throws_ok(
  'select * from public.profiles',
  '42501',
  'permission denied for table profiles',
  'Anonyme Zugriffe haben keine Profilrechte'
);

reset role;

select * from finish();

rollback;
