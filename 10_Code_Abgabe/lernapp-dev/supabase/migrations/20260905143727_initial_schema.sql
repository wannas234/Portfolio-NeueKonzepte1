-- Initiales Schema: Benutzerprofile.
--
-- Diese Migration dient zugleich als Referenz-Beispiel für die Konventionen
-- in diesem Projekt: eine Tabelle, RLS aktiviert, explizite Policies pro
-- Operation, Trigger für updated_at. Neue Migrations bitte immer mit
-- `npm run db:new -- <name>` erzeugen und niemals bereits gemergte
-- Migrationsdateien nachträglich ändern.

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Öffentliches Profil zu einem Auth-User. 1:1 an auth.users gekoppelt.';

-- ---------------------------------------------------------------------------
-- updated_at automatisch pflegen
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profil automatisch bei Registrierung anlegen
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy "Profile sind für angemeldete Nutzer lesbar"
  on public.profiles
  for select
  to authenticated
  using (true);

create policy "Nutzer können ihr eigenes Profil anlegen"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Nutzer können ihr eigenes Profil ändern"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Nutzer können ihr eigenes Profil löschen"
  on public.profiles
  for delete
  to authenticated
  using ((select auth.uid()) = id);
