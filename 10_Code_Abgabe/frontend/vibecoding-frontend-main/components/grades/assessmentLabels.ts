import type { Assessment } from "@/lib/supabase/queries/grades";

export const KIND_LABELS: Record<Assessment["kind"], string> = {
  exam: "Klausur",
  presentation: "Präsentation",
  assignment: "Abgabe",
  project: "Projekt",
  exercise: "Übung",
  oral_exam: "Mündliche Prüfung",
  other: "Sonstiges",
};

export const STATUS_LABELS: Record<Assessment["status"], string> = {
  planned: "Geplant",
  submitted: "Eingereicht",
  graded: "Bewertet",
};
