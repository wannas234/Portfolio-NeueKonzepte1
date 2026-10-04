-- Enforce that an optional end must lie strictly after the start.
-- calendar_events was already merged to dev, hence a follow-up migration.
begin;

alter table public.calendar_events
  add constraint calendar_events_ends_after_starts_check
  check (ends_at is null or ends_at > starts_at);

commit;
