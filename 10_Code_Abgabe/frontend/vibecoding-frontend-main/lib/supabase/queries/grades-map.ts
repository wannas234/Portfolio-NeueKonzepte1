import type { Tables } from "../database.types";

export type AssessmentKind =
  | "exam"
  | "presentation"
  | "assignment"
  | "project"
  | "exercise"
  | "oral_exam"
  | "other";

export type AssessmentStatus = "planned" | "submitted" | "graded";

export type Assessment = {
  id: string;
  courseId: string;
  title: string;
  kind: AssessmentKind;
  status: AssessmentStatus;
  ectsCredits: number;
  grade: number | null;
  assessmentDate: string | null;
  pointsEarned: number | null;
  pointsMax: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type AssessmentInput = {
  title: string;
  kind: AssessmentKind;
  status: AssessmentStatus;
  ectsCredits: number;
  grade: number | null;
  assessmentDate: string | null;
  pointsEarned: number | null;
  pointsMax: number | null;
  notes: string;
};

type AssessmentRow = Tables<"grade_assessments">;

// grade/ects_credits/points are numeric columns; the generated client type is
// `number` but the driver can hand back a numeric string for large/precise
// values. Normalize defensively so callers always get a real number.
function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

export function mapAssessment(row: AssessmentRow): Assessment {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    kind: row.kind as AssessmentKind,
    status: row.status as AssessmentStatus,
    ectsCredits: toNumber(row.ects_credits),
    grade: row.grade === null ? null : toNumber(row.grade),
    assessmentDate: row.assessment_date,
    pointsEarned: row.points_earned === null ? null : toNumber(row.points_earned),
    pointsMax: row.points_max === null ? null : toNumber(row.points_max),
    notes: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
