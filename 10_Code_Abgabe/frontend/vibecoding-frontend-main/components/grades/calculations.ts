export type AssessmentStatus = "planned" | "submitted" | "graded";

// The pure calculation inputs a real grade_assessments row reduces to.
export type EctsAssessment = {
  ectsCredits: number;
  grade: number | null;
  status: AssessmentStatus;
};

// Grades and ECTS carry at most one/two decimal digits (numeric with a
// `round(ects_credits, 1)` check, numeric(3,2) for grade). All internal math
// happens on rounded tenths (ECTS) and hundredths (grade) as exact integers,
// so no floating-point drift can ever make a required grade look easier than
// it mathematically is. Only the final, single division to a display number
// is a float operation.
function toTenths(value: number): number {
  return Math.round(value * 10);
}
function toHundredths(value: number): number {
  return Math.round(value * 100);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function validGrade(grade: number): boolean {
  return Number.isFinite(grade) && grade >= 1 && grade <= 5 &&
    Math.abs(grade * 100 - Math.round(grade * 100)) < 1e-9;
}

export function validEcts(ects: number): boolean {
  return Number.isFinite(ects) && ects > 0 && ects <= 60 &&
    Math.abs(ects * 10 - Math.round(ects * 10)) < 1e-9;
}

export type GradeSummary = {
  /** Sum of all assessments' ECTS credits, rounded to 1 decimal. */
  totalEcts: number;
  /** Sum of the ECTS credits of graded assessments, rounded to 1 decimal. */
  gradedEcts: number;
  /** totalEcts - gradedEcts; ECTS of assessments not yet graded. */
  openEcts: number;
  /** ECTS-weighted current standing over graded assessments only, or null if none are graded. */
  average: number | null;
  /** Internal: sum(grade_hundredths * ects_tenths) over graded items. */
  weightedProduct: number;
  /** Internal: sum(ects_tenths) over all items. */
  totalEctsUnits: number;
  /** Internal: sum(ects_tenths) over graded items. */
  gradedEctsUnits: number;
};

export function courseGradeSummary(assessments: EctsAssessment[]): GradeSummary {
  const ectsUnits = assessments.map((item) => toTenths(item.ectsCredits));
  const totalEctsUnits = ectsUnits.reduce((sum, units) => sum + units, 0);

  const gradedIndexes = assessments
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.grade !== null);
  const gradedEctsUnits = gradedIndexes.reduce((sum, { index }) => sum + ectsUnits[index], 0);
  const weightedProduct = gradedIndexes.reduce(
    (sum, { item, index }) => sum + toHundredths(item.grade!) * ectsUnits[index],
    0,
  );

  const totalEcts = round1(totalEctsUnits / 10);
  const gradedEcts = round1(gradedEctsUnits / 10);
  const openEcts = round1((totalEctsUnits - gradedEctsUnits) / 10);

  return {
    totalEcts,
    gradedEcts,
    openEcts,
    average: gradedEctsUnits > 0 ? weightedProduct / (100 * gradedEctsUnits) : null,
    weightedProduct,
    totalEctsUnits,
    gradedEctsUnits,
  };
}

export function parseTarget(input: string): number | null {
  if (!/^[1-5](?:[.,]\d{1,2})?$/.test(input.trim())) return null;
  const target = Number(input.trim().replace(",", "."));
  return validGrade(target) ? target : null;
}

export type TargetResult =
  | { kind: "invalid"; message: string }
  | { kind: "noOpenAssessments" }
  | { kind: "impossible" }
  | { kind: "any" }
  | { kind: "required"; threshold: number; safeGrade: number; conservative: boolean; openEcts: number };

/**
 * Required average grade over the already-recorded open ECTS
 * (totalEcts - gradedEcts). There is no assumed total target (unlike a
 * fixed 100% weighting) -- only assessments the user actually entered
 * count, on either side of the fraction. Never floors past the true
 * threshold in a way that would understate the required grade: safeGrade is
 * the best (numerically lowest, since 1.0 is the best grade) achievable
 * hundredth-grade that still guarantees the target.
 */
export function targetGrade(assessments: EctsAssessment[], target: number | null): TargetResult {
  if (target === null || !validGrade(target)) {
    return { kind: "invalid", message: "Bitte eine Zielnote von 1,0 bis 5,0 mit höchstens zwei Nachkommastellen eingeben." };
  }
  const summary = courseGradeSummary(assessments);
  const openEctsUnits = summary.totalEctsUnits - summary.gradedEctsUnits;
  if (openEctsUnits <= 0) {
    return { kind: "noOpenAssessments" };
  }

  const targetHundredths = toHundredths(target);
  const numerator = targetHundredths * summary.totalEctsUnits - summary.weightedProduct;
  const denominator = 100 * openEctsUnits;

  if (numerator < denominator) return { kind: "impossible" };
  if (numerator > 5 * denominator) return { kind: "any" };

  const safeGradeHundredths = Math.floor((numerator * 100) / denominator);
  return {
    kind: "required",
    threshold: numerator / denominator,
    safeGrade: safeGradeHundredths / 100,
    conservative: (numerator * 100) % denominator !== 0,
    openEcts: round1(openEctsUnits / 10),
  };
}

export function pointsConsistent(pointsEarned: number | null, pointsMax: number | null): boolean {
  if (pointsEarned === null && pointsMax === null) return true;
  if (pointsEarned === null || pointsMax === null) return false;
  return pointsMax > 0 && pointsEarned >= 0 && pointsEarned <= pointsMax;
}

export function statusGradeConsistent(status: AssessmentStatus, grade: number | null): boolean {
  return status === "graded" ? grade !== null : grade === null;
}

export function formatGrade(value: number): string {
  return value.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

export function formatEcts(value: number): string {
  return value.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

/**
 * German-locale decimal input ("2,3" or "2.3") normalized to a JS number, or
 * null if not a plain finite decimal. Does not enforce a value range; use
 * validGrade/validEcts for that.
 */
export function parseGermanDecimal(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}
