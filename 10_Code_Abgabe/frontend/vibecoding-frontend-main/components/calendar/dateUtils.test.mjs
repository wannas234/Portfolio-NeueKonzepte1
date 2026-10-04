// Run with Node 22+: node --test components/calendar/dateUtils.test.mjs
// Fixed to a real DST-observing zone so the "Sommerzeit/Winterzeit" cases
// below are deterministic. Must be set before any Date is constructed.
process.env.TZ = "Europe/Berlin";

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  localDateKey,
  localTime,
  formToIso,
  isoToFormDate,
  isoToFormTime,
  addMonths,
  buildMonthGrid,
  monthKeyOf,
  monthStartKey,
  compareByStart,
  eventTouchesDay,
  isUpcomingOrOngoing,
  formatTimeRange,
  startOfDayIso,
  endOfDayIso,
  formatEventWhen,
} from "./dateUtils.ts";

test("an event shortly before local midnight stays on that calendar day", () => {
  const iso = formToIso("2026-10-12", "23:45");
  assert.equal(localDateKey(iso), "2026-10-12");
  assert.equal(localTime(iso), "23:45");
});

test("an event shortly after local midnight lands on the next calendar day, not the previous UTC day", () => {
  const iso = formToIso("2026-10-13", "00:15");
  assert.equal(localDateKey(iso), "2026-10-13");
  assert.equal(localTime(iso), "00:15");
});

test("form <-> ISO round-trip is exact across a month boundary", () => {
  const iso = formToIso("2026-10-31", "22:00");
  assert.equal(isoToFormDate(iso), "2026-10-31");
  assert.equal(isoToFormTime(iso), "22:00");
});

test("form <-> ISO round-trip is exact across a year boundary", () => {
  const iso = formToIso("2026-12-31", "23:30");
  assert.equal(isoToFormDate(iso), "2026-12-31");
  assert.equal(isoToFormTime(iso), "23:30");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2027-01", -1), "2026-12");
});

test("form <-> ISO round-trip survives the CEST (summer time) transition", () => {
  // Europe/Berlin switches to summer time on the last Sunday of March 2026 (29th).
  const before = formToIso("2026-03-01", "14:00"); // standard time, UTC+1
  const after = formToIso("2026-04-01", "14:00"); // summer time, UTC+2
  assert.equal(isoToFormDate(before), "2026-03-01");
  assert.equal(isoToFormTime(before), "14:00");
  assert.equal(isoToFormDate(after), "2026-04-01");
  assert.equal(isoToFormTime(after), "14:00");
  // The UTC instants differ by exactly the DST offset change (one hour) plus
  // the 31-day gap, proving the local wall-clock time was preserved on both
  // sides rather than the UTC instant.
  assert.notEqual(new Date(before).getUTCHours(), new Date(after).getUTCHours());
});

test("form <-> ISO round-trip survives the CET (winter time) transition", () => {
  // Europe/Berlin switches back to standard time on the last Sunday of October 2026 (25th).
  const before = formToIso("2026-10-20", "09:00"); // still summer time
  const after = formToIso("2026-11-01", "09:00"); // standard time again
  assert.equal(isoToFormDate(before), "2026-10-20");
  assert.equal(isoToFormTime(before), "09:00");
  assert.equal(isoToFormDate(after), "2026-11-01");
  assert.equal(isoToFormTime(after), "09:00");
});

test("buildMonthGrid always returns full Monday-start weeks covering the whole month", () => {
  for (const month of ["2026-02", "2026-10", "2026-12", "2027-01", "2024-02"]) {
    const grid = buildMonthGrid(month);
    assert.equal(grid.length % 7, 0, month);
    assert.ok(grid.includes(monthStartKey(month)), `${month} should include its own first day`);
    const inMonth = grid.filter((key) => monthKeyOf(key) === month);
    const [year, m] = month.split("-").map(Number);
    const daysInMonth = new Date(year, m, 0).getDate();
    assert.equal(inMonth.length, daysInMonth, month);
  }
});

test("buildMonthGrid bridges a year boundary correctly (December into January)", () => {
  const grid = buildMonthGrid("2026-12");
  assert.ok(grid.some((key) => key.startsWith("2027-01")), "should include leading January days if needed, or trail into it");
  assert.ok(grid.includes("2026-12-31"));
});

test("compareByStart sorts chronologically regardless of input order", () => {
  const events = [
    { startsAt: formToIso("2026-10-12", "14:00") },
    { startsAt: formToIso("2026-10-12", "09:00") },
    { startsAt: formToIso("2026-10-11", "23:00") },
  ];
  const sorted = [...events].sort(compareByStart);
  assert.deepEqual(sorted.map((e) => e.startsAt), [events[2].startsAt, events[1].startsAt, events[0].startsAt]);
});

test("a multi-day event touches every local day from start to end, inclusive", () => {
  const startsAt = formToIso("2026-10-12", "09:00");
  const endsAt = formToIso("2026-10-14", "11:00");
  assert.equal(eventTouchesDay(startsAt, endsAt, "2026-10-11"), false);
  assert.equal(eventTouchesDay(startsAt, endsAt, "2026-10-12"), true);
  assert.equal(eventTouchesDay(startsAt, endsAt, "2026-10-13"), true);
  assert.equal(eventTouchesDay(startsAt, endsAt, "2026-10-14"), true);
  assert.equal(eventTouchesDay(startsAt, endsAt, "2026-10-15"), false);
});

test("a single-day event only touches its own day", () => {
  const startsAt = formToIso("2026-10-12", "09:00");
  assert.equal(eventTouchesDay(startsAt, null, "2026-10-12"), true);
  assert.equal(eventTouchesDay(startsAt, null, "2026-10-13"), false);
});

test("isUpcomingOrOngoing uses the end time when present, otherwise the start", () => {
  const pastStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.equal(isUpcomingOrOngoing(pastStart, futureEnd), true, "ongoing (started, not yet ended)");
  const pastEnd = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  assert.equal(isUpcomingOrOngoing(pastStart, pastEnd), false, "fully in the past");
  const futureStart = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.equal(isUpcomingOrOngoing(futureStart, null), true, "purely future, no end");
});

test("formatTimeRange shows a single time, a same-day range, or a cross-day range", () => {
  const start = formToIso("2026-10-12", "10:00");
  assert.equal(formatTimeRange(start, null), "10:00 Uhr");
  assert.equal(formatTimeRange(start, formToIso("2026-10-12", "11:30")), "10:00–11:30 Uhr");
  assert.match(formatTimeRange(start, formToIso("2026-10-14", "09:00")), /^10:00 Uhr – 14\.10\., 09:00 Uhr$/);
});

test("startOfDayIso/endOfDayIso bracket a full local day", () => {
  const start = startOfDayIso("2026-11-01");
  const end = endOfDayIso("2026-11-01");
  assert.equal(localDateKey(start), "2026-11-01");
  assert.equal(localTime(start), "00:00");
  assert.equal(localDateKey(end), "2026-11-01", "23:59:59.999 local must still be the same calendar day");
  assert.equal(localTime(end), "23:59");
  assert.ok(new Date(end).getTime() > new Date(start).getTime());
});

test("an all-day event touches exactly the days it spans (inclusive end-of-day representation)", () => {
  const startsAt = startOfDayIso("2026-11-01");
  const endsAt = endOfDayIso("2026-11-03");
  assert.equal(eventTouchesDay(startsAt, endsAt, "2026-10-31"), false);
  assert.equal(eventTouchesDay(startsAt, endsAt, "2026-11-01"), true);
  assert.equal(eventTouchesDay(startsAt, endsAt, "2026-11-02"), true);
  assert.equal(eventTouchesDay(startsAt, endsAt, "2026-11-03"), true);
  assert.equal(eventTouchesDay(startsAt, endsAt, "2026-11-04"), false);
});

test("formatEventWhen shows 'Ganztägig' for a single all-day event, with a date range for multi-day", () => {
  const single = startOfDayIso("2026-11-01");
  assert.equal(formatEventWhen(single, null, true), "Ganztägig");
  assert.equal(formatEventWhen(single, endOfDayIso("2026-11-01"), true), "Ganztägig");
  assert.match(formatEventWhen(single, endOfDayIso("2026-11-03"), true), /^Ganztägig · 01\.11\.–03\.11\.$/);
});

test("formatEventWhen falls back to the normal time range when not all-day", () => {
  const start = formToIso("2026-11-01", "09:00");
  assert.equal(formatEventWhen(start, null, false), "09:00 Uhr");
});
