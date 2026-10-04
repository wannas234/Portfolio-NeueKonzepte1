-- All-day flag for calendar events. calendar_events was already merged to
-- dev, hence a follow-up migration. Purely a display/semantic flag: an
-- all-day event still stores real starts_at/ends_at (local day boundaries,
-- computed by the client), so existing date-range logic and the
-- ends_at > starts_at constraint keep working unchanged.
begin;

alter table public.calendar_events add column all_day boolean not null default false;

grant insert (all_day) on public.calendar_events to authenticated;
grant update (all_day) on public.calendar_events to authenticated;

commit;
