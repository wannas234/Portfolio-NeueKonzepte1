-- Calendar events. Direct ownership like courses, since an event may exist
-- without a course (private deadlines/reminders).
begin;

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  description text,
  kind text not null check (kind in ('lecture','exercise','study','presentation','exam','deadline','other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from anon, authenticated;
create trigger calendar_events_set_updated_at before update on public.calendar_events
  for each row execute function public.set_updated_at();

create index calendar_events_owner_id_starts_at_idx on public.calendar_events (owner_id, starts_at);
create index calendar_events_course_id_idx on public.calendar_events (course_id) where course_id is not null;

grant select, delete on public.calendar_events to authenticated;
grant insert (id, owner_id, course_id, title, description, kind, starts_at, ends_at) on public.calendar_events to authenticated;
grant update (course_id, title, description, kind, starts_at, ends_at) on public.calendar_events to authenticated;

create policy calendar_events_select_owned on public.calendar_events
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy calendar_events_insert_owned on public.calendar_events
  for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and (course_id is null or exists (
      select 1 from public.courses c where c.id = course_id and c.owner_id = (select auth.uid())
    ))
  );

create policy calendar_events_update_owned on public.calendar_events
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and (course_id is null or exists (
      select 1 from public.courses c where c.id = course_id and c.owner_id = (select auth.uid())
    ))
  );

create policy calendar_events_delete_owned on public.calendar_events
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

commit;
