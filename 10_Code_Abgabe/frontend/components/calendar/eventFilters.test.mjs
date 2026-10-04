// Run with Node 22+: node --test components/calendar/eventFilters.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters, filterEvents, hasActiveFilters, matchesFilters } from "./eventFilters.ts";

const events = [
  { courseId: "c1", kind: "lecture", title: "Netzwerksicherheit" },
  { courseId: "c1", kind: "exam", title: "Klausur Netzwerksicherheit" },
  { courseId: "c2", kind: "lecture", title: "Datenbanken" },
  { courseId: null, kind: "deadline", title: "Projektabgabe" },
];

test("no active filters returns every event unchanged", () => {
  assert.equal(hasActiveFilters(defaultFilters), false);
  assert.deepEqual(filterEvents(events, defaultFilters), events);
});

test("course filter narrows to that course only", () => {
  const result = filterEvents(events, { ...defaultFilters, courseId: "c1" });
  assert.equal(result.length, 2);
  assert.ok(result.every((event) => event.courseId === "c1"));
});

test("empty-string course filter means 'no course' (private events)", () => {
  const result = filterEvents(events, { ...defaultFilters, courseId: "" });
  assert.deepEqual(result, [events[3]]);
});

test("kind filter narrows to that kind only", () => {
  const result = filterEvents(events, { ...defaultFilters, kind: "lecture" });
  assert.equal(result.length, 2);
  assert.ok(result.every((event) => event.kind === "lecture"));
});

test("text search matches the title case- and umlaut-insensitively for plain substrings", () => {
  const result = filterEvents(events, { ...defaultFilters, query: "netzwerk" });
  assert.equal(result.length, 2);
  assert.equal(filterEvents(events, { ...defaultFilters, query: "  " }).length, events.length, "whitespace-only query is not a filter");
});

test("combined filters apply together (AND, not OR)", () => {
  const result = filterEvents(events, { courseId: "c1", kind: "exam", query: "klausur" });
  assert.deepEqual(result, [events[1]]);
});

test("a filter combination that matches nothing returns an empty list, not an error", () => {
  assert.deepEqual(filterEvents(events, { ...defaultFilters, kind: "presentation" }), []);
});

test("hasActiveFilters reports true as soon as any single filter deviates from default", () => {
  assert.equal(hasActiveFilters({ ...defaultFilters, courseId: "c1" }), true);
  assert.equal(hasActiveFilters({ ...defaultFilters, kind: "exam" }), true);
  assert.equal(hasActiveFilters({ ...defaultFilters, query: "x" }), true);
  assert.equal(matchesFilters(events[0], defaultFilters), true);
});
