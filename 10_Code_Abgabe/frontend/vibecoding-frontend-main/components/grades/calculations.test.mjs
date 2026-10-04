// Run with Node 22+: node --test components/grades/calculations.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  courseGradeSummary,
  targetGrade,
  parseTarget,
  parseGermanDecimal,
  pointsConsistent,
  statusGradeConsistent,
  formatGrade,
} from "./calculations.ts";
import { mapAssessment } from "../../lib/supabase/queries/grades-map.ts";

// Mixed course: two graded, one open (5 ECTS still open).
const mixed = [
  { ectsCredits: 3, grade: 2.0, status: "graded" },
  { ectsCredits: 2, grade: 1.7, status: "graded" },
  { ectsCredits: 5, grade: null, status: "planned" },
];
// Fully graded course: nothing open.
const fullyGraded = [
  { ectsCredits: 7, grade: 2.3, status: "graded" },
  { ectsCredits: 3, grade: 1.7, status: "graded" },
];
// Fully ungraded.
const ungraded = [
  { ectsCredits: 4, grade: null, status: "submitted" },
  { ectsCredits: 6, grade: null, status: "planned" },
];

test("ECTS-weighted current standing only includes graded assessments", () => {
  const summary = courseGradeSummary(mixed);
  assert.equal(summary.average, 1.88);
  assert.equal(summary.gradedEcts, 5);
  assert.equal(summary.totalEcts, 10);
  assert.equal(summary.openEcts, 5);
});

test("a course with nothing graded yet has no numeric average", () => {
  const summary = courseGradeSummary(ungraded);
  assert.equal(summary.average, null);
  assert.equal(summary.gradedEcts, 0);
  assert.equal(summary.openEcts, 10);
});

test("total/graded/open ECTS sums over an empty course are all zero", () => {
  const summary = courseGradeSummary([]);
  assert.equal(summary.totalEcts, 0);
  assert.equal(summary.gradedEcts, 0);
  assert.equal(summary.openEcts, 0);
  assert.equal(summary.average, null);
});

test("target grade with multiple still-open assessments sums their combined ECTS", () => {
  const twoOpen = [
    { ectsCredits: 3, grade: 2.0, status: "graded" },
    { ectsCredits: 2, grade: null, status: "planned" },
    { ectsCredits: 5, grade: null, status: "planned" },
  ];
  const result = targetGrade(twoOpen, 2);
  assert.equal(result.kind, "required");
  assert.equal(result.openEcts, 7);
  assert.equal(result.safeGrade, 2);
  assert.equal(result.conservative, false);
});

test("no assessments at all leaves nothing to calculate, without inventing a remaining weight", () => {
  assert.equal(targetGrade([], 2).kind, "noOpenAssessments");
});

test("no graded assessment yet: the required average equals the target itself", () => {
  const result = targetGrade(ungraded, 2);
  assert.equal(result.kind, "required");
  assert.equal(result.safeGrade, 2);
  assert.equal(result.openEcts, 10);
});

test("an unreachable target is reported as impossible", () => {
  const result = targetGrade([
    { ectsCredits: 9, grade: 4.0, status: "graded" },
    { ectsCredits: 1, grade: null, status: "planned" },
  ], 2);
  assert.equal(result.kind, "impossible");
});

test("a target already guaranteed even with the worst remaining grade is reported as reachable", () => {
  const result = targetGrade([
    { ectsCredits: 9, grade: 1.0, status: "graded" },
    { ectsCredits: 1, grade: null, status: "planned" },
  ], 1.5);
  assert.equal(result.kind, "any");
});

test("a fully graded course has no open ECTS left for the target calculator", () => {
  assert.equal(targetGrade(fullyGraded, 2).kind, "noOpenAssessments");
});

test("invalid target inputs never produce a numeric requirement", () => {
  for (const input of ["", " ", "abc", "0", "5,01", "1,234", "NaN", "Infinity", "2e0", "2,", "2.1.2"]) {
    assert.equal(parseTarget(input), null, input);
    assert.equal(targetGrade(mixed, parseTarget(input)).kind, "invalid");
  }
  for (const value of [NaN, Infinity, -Infinity, 0, 5.01, null]) {
    assert.equal(targetGrade(mixed, value).kind, "invalid");
  }
});

test("German-locale decimal input is accepted and normalized", () => {
  assert.equal(parseTarget(" 2,12 "), 2.12);
  assert.equal(parseTarget("2.12"), 2.12);
  assert.equal(parseTarget("1,0"), 1);
  assert.equal(parseTarget("5,0"), 5);
  assert.equal(parseGermanDecimal("2,3"), 2.3);
  assert.equal(parseGermanDecimal("2.3"), 2.3);
  assert.equal(parseGermanDecimal("  7  "), 7);
  assert.equal(parseGermanDecimal(""), null);
  assert.equal(parseGermanDecimal("abc"), null);
});

test("a rounded requirement never relaxes the exact grade threshold (conservative rounding)", () => {
  const thirds = [
    { ectsCredits: 3, grade: 1.7, status: "graded" },
    { ectsCredits: 7, grade: null, status: "planned" },
  ];
  const result = targetGrade(thirds, 2);
  assert.equal(result.kind, "required");
  assert.equal(result.conservative, true);
  assert.equal(result.safeGrade, 2.12);
  assert.ok(result.safeGrade <= result.threshold);
  assert.ok((1.7 * 3 + result.safeGrade * 7) / 10 <= 2);
  assert.ok((1.7 * 3 + (result.safeGrade + 0.01) * 7) / 10 > 2);
});

test("exact boundary requirements 1.0 and 5.0 remain reachable", () => {
  const single = [
    { ectsCredits: 3, grade: 1.7, status: "graded" },
    { ectsCredits: 7, grade: null, status: "planned" },
  ];
  assert.equal(targetGrade(single, 1.21).safeGrade, 1);
  assert.equal(targetGrade(single, 4.01).safeGrade, 5);
  assert.equal(targetGrade(single, 1.20).kind, "impossible");
  assert.equal(targetGrade(single, 4.02).kind, "any");
});

test("ECTS validation: half-credits accepted, out-of-range or too-precise values rejected via validEcts", async () => {
  const { validEcts } = await import("./calculations.ts");
  assert.equal(validEcts(6), true);
  assert.equal(validEcts(4.5), true);
  assert.equal(validEcts(0.1), true);
  assert.equal(validEcts(60), true);
  assert.equal(validEcts(0), false);
  assert.equal(validEcts(-1), false);
  assert.equal(validEcts(60.1), false);
  assert.equal(validEcts(2.55), false);
  assert.equal(validEcts(NaN), false);
});

test("points must be both present or both absent, earned within [0, max], and max positive", () => {
  assert.equal(pointsConsistent(null, null), true);
  assert.equal(pointsConsistent(8, 10), true);
  assert.equal(pointsConsistent(10, 10), true);
  assert.equal(pointsConsistent(0, 10), true);
  assert.equal(pointsConsistent(8, null), false);
  assert.equal(pointsConsistent(null, 10), false);
  assert.equal(pointsConsistent(11, 10), false);
  assert.equal(pointsConsistent(-1, 10), false);
  assert.equal(pointsConsistent(5, 0), false);
  assert.equal(pointsConsistent(5, -3), false);
});

test("status and grade presence must agree: graded requires a grade, others forbid one", () => {
  assert.equal(statusGradeConsistent("graded", 2.0), true);
  assert.equal(statusGradeConsistent("graded", null), false);
  assert.equal(statusGradeConsistent("planned", null), true);
  assert.equal(statusGradeConsistent("planned", 2.0), false);
  assert.equal(statusGradeConsistent("submitted", null), true);
  assert.equal(statusGradeConsistent("submitted", 2.0), false);
});

test("formatGrade renders German-locale decimals", () => {
  assert.equal(formatGrade(2), "2,0");
  assert.equal(formatGrade(2.12), "2,12");
});

test("database rows map to the frontend model with numeric coercion", () => {
  const row = {
    id: "a1", course_id: "c1", title: "Klausur", kind: "exam", status: "graded",
    ects_credits: "6.0", grade: "2.30", assessment_date: "2026-11-20",
    points_earned: "45.00", points_max: "50.00", notes: null,
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-02T00:00:00Z",
  };
  const mapped = mapAssessment(row);
  assert.equal(mapped.ectsCredits, 6);
  assert.equal(mapped.grade, 2.3);
  assert.equal(mapped.pointsEarned, 45);
  assert.equal(mapped.pointsMax, 50);
  assert.equal(mapped.notes, "");
  assert.equal(mapped.courseId, "c1");

  const withoutGradeOrPoints = mapAssessment({
    ...row, grade: null, points_earned: null, points_max: null, notes: "Wichtig",
  });
  assert.equal(withoutGradeOrPoints.grade, null);
  assert.equal(withoutGradeOrPoints.pointsEarned, null);
  assert.equal(withoutGradeOrPoints.notes, "Wichtig");
});
