// Central date/time helpers for the calendar. Everything here operates in
// the browser's local timezone consistently - never a raw UTC slice of an
// ISO string, which previously mixed a UTC calendar day
// (`startsAt.slice(0, 10)`) with a local time-of-day
// (`Date.toTimeString()`) and could put events shortly after local midnight
// on the wrong day.

export type DateKey = string; // "YYYY-MM-DD", local calendar day
export type MonthKey = string; // "YYYY-MM"

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKeyOf(date: Date): DateKey {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Local calendar day of an ISO timestamp, e.g. "2026-10-12". */
export function localDateKey(iso: string): DateKey {
  return dateKeyOf(new Date(iso));
}

/** Local wall-clock time of an ISO timestamp, e.g. "23:45". */
export function localTime(iso: string): string {
  const date = new Date(iso);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Local midnight `Date` for a "YYYY-MM-DD" key (no UTC involved). */
export function parseDateKey(key: DateKey): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Combine a form's date + time inputs (interpreted in local time) into an ISO string for storage. */
export function formToIso(dateKey: DateKey, time: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

/** ISO timestamp -> the date-input value to prefill a form with. */
export function isoToFormDate(iso: string): DateKey {
  return localDateKey(iso);
}

/** ISO timestamp -> the time-input value to prefill a form with. */
export function isoToFormTime(iso: string): string {
  return localTime(iso);
}

export function todayKey(): DateKey {
  return dateKeyOf(new Date());
}

export function monthKeyOf(key: DateKey): MonthKey {
  return key.slice(0, 7);
}

/** First day of the month (local) as a DateKey, e.g. "2026-10-01". */
export function monthStartKey(month: MonthKey): DateKey {
  return `${month}-01`;
}

/** Shift a month key by `delta` months, correctly rolling over the year. */
export function addMonths(month: MonthKey, delta: number): MonthKey {
  const [year, m] = month.split("-").map(Number);
  const shifted = new Date(year, m - 1 + delta, 1);
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}`;
}

/**
 * Monday-start grid of DateKeys for a month, padded to full weeks
 * (leading/trailing days from adjacent months included). Length is always a
 * multiple of 7. Uses local Date arithmetic throughout, so it can't
 * misbehave across a month, year, or DST boundary.
 */
export function buildMonthGrid(month: MonthKey): DateKey[] {
  const [year, m] = month.split("-").map(Number);
  const first = new Date(year, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, m, 0).getDate();
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
  return Array.from({ length: totalCells }, (_, index) => dateKeyOf(new Date(year, m - 1, index - offset + 1)));
}

export function formatDateKey(key: DateKey, options: Intl.DateTimeFormatOptions): string {
  return parseDateKey(key).toLocaleDateString("de-DE", options);
}

export function formatMonthLabel(month: MonthKey): string {
  return formatDateKey(monthStartKey(month), { month: "long", year: "numeric" });
}

/** "10:00 Uhr" or, with an end time, "10:00–11:30 Uhr" / with a different end day "10:00 Uhr – 13.10., 09:00 Uhr". */
export function formatTimeRange(startsAt: string, endsAt: string | null): string {
  const startTime = localTime(startsAt);
  if (!endsAt) return `${startTime} Uhr`;
  const startDay = localDateKey(startsAt);
  const endDay = localDateKey(endsAt);
  const endTime = localTime(endsAt);
  if (startDay === endDay) return `${startTime}–${endTime} Uhr`;
  return `${startTime} Uhr – ${formatDateKey(endDay, { day: "2-digit", month: "2-digit" })}, ${endTime} Uhr`;
}

/** Whether a (possibly multi-day) event touches the given local day. */
export function eventTouchesDay(startsAt: string, endsAt: string | null, day: DateKey): boolean {
  const startDay = localDateKey(startsAt);
  const endDay = endsAt ? localDateKey(endsAt) : startDay;
  return day >= startDay && day <= endDay;
}

/** True if the event has not finished yet (used for "upcoming"). */
export function isUpcomingOrOngoing(startsAt: string, endsAt: string | null): boolean {
  const relevant = endsAt ?? startsAt;
  return new Date(relevant).getTime() >= Date.now();
}

/** Chronological comparator for sorting events by start time. */
export function compareByStart(a: { startsAt: string }, b: { startsAt: string }): number {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

/** Local midnight (00:00:00.000) of a day, as an ISO string. Start of an all-day event. */
export function startOfDayIso(dateKey: DateKey): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

/** The last local millisecond (23:59:59.999) of a day, as an ISO string. Inclusive end of an all-day event -
 *  so localDateKey(endOfDayIso(x)) === x, keeping eventTouchesDay's inclusive-range logic correct for all-day events. */
export function endOfDayIso(dateKey: DateKey): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

/** "10:00 Uhr" / a range, or "Ganztägig" (optionally with a date range) when `allDay` is set. */
export function formatEventWhen(startsAt: string, endsAt: string | null, allDay: boolean): string {
  if (allDay) {
    const startDay = localDateKey(startsAt);
    const endDay = endsAt ? localDateKey(endsAt) : startDay;
    if (startDay === endDay) return "Ganztägig";
    return `Ganztägig · ${formatDateKey(startDay, { day: "2-digit", month: "2-digit" })}–${formatDateKey(endDay, { day: "2-digit", month: "2-digit" })}`;
  }
  return formatTimeRange(startsAt, endsAt);
}
