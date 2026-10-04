import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countByLecture,
  isLectureNotFound,
  lectureFilterSearch,
  matchesLectureFilter,
  resolveLectureFilter,
  sortLectures,
} from "./lectureFilter.ts";

const lectures = [{ id: "a" }, { id: "b" }];

test("resolveLectureFilter akzeptiert nur bekannte Vorlesungen", () => {
  assert.equal(resolveLectureFilter(null, lectures), "all");
  assert.equal(resolveLectureFilter("none", lectures), "none");
  assert.equal(resolveLectureFilter("b", lectures), "b");
  assert.equal(resolveLectureFilter("gone", lectures), "all");
});

test("matchesLectureFilter", () => {
  assert.equal(matchesLectureFilter(null, "all"), true);
  assert.equal(matchesLectureFilter(null, "none"), true);
  assert.equal(matchesLectureFilter("a", "none"), false);
  assert.equal(matchesLectureFilter("a", "a"), true);
  assert.equal(matchesLectureFilter("a", "b"), false);
  assert.equal(matchesLectureFilter(undefined, "a"), false);
});

test("countByLecture ignoriert Unterlagen ohne Vorlesung", () => {
  const counts = countByLecture([{ lectureId: "a" }, { lectureId: "a" }, { lectureId: null }, { lectureId: "b" }]);
  assert.equal(counts.get("a"), 2);
  assert.equal(counts.get("b"), 1);
  assert.equal(counts.size, 2);
});

test("isLectureNotFound erkennt den Backend-Fehler", () => {
  assert.equal(isLectureNotFound({ message: "LECTURE_NOT_FOUND" }), true);
  assert.equal(isLectureNotFound({ message: "x", details: "LECTURE_NOT_FOUND" }), true);
  assert.equal(isLectureNotFound(new Error("other")), false);
  assert.equal(isLectureNotFound(null), false);
});

test("lectureFilterSearch lässt den Normalfall aus der URL", () => {
  assert.equal(lectureFilterSearch("all"), "");
  assert.equal(lectureFilterSearch("none"), "?lecture=none");
  assert.equal(lectureFilterSearch("a b"), "?lecture=a%20b");
});

test("sortLectures sortiert nach Termin, ohne Termin zuletzt, sonst nach Anlage", () => {
  const sorted = sortLectures([
    { id: "ohne-spaet", heldOn: null, createdAt: "2026-10-02T00:00:00Z" },
    { id: "nov", heldOn: "2026-11-01", createdAt: "2026-10-01T00:00:00Z" },
    { id: "ohne-frueh", heldOn: null, createdAt: "2026-10-01T00:00:00Z" },
    { id: "okt-b", heldOn: "2026-10-15", createdAt: "2026-10-03T00:00:00Z" },
    { id: "okt-a", heldOn: "2026-10-15", createdAt: "2026-10-01T00:00:00Z" },
  ]);
  assert.deepEqual(sorted.map((lecture) => lecture.id), ["okt-a", "okt-b", "nov", "ohne-frueh", "ohne-spaet"]);
});
