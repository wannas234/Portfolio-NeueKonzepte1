import { createClient } from "@/lib/supabase/browser";

// Gespeicherte Selbstlern-Quizze und Versuche (Backend-Migration 20261003142000).
//
// Ein Quiz ist unveränderlich: Änderungen entstehen als neue Revision derselben Familie,
// damit alte Versuche weiter auf ihren Stand zeigen. Die Punktzahl berechnet der Server —
// das Frontend zählt nichts selbst nach. Es ist bewusst kein Prüfungsmodus: Besitzer
// dürfen die richtigen Antworten sehen.

import { parseQuizQuestions, type QuizQuestion } from "./quiz-format";

// Reine Regeln liegen in `quiz-format`, damit sie ohne Supabase-Client testbar sind.
export {
  isAttemptComplete,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_QUESTIONS,
  QUIZ_TITLE_MAX,
  validateQuiz,
} from "./quiz-format";
export type { QuizQuestion, QuizValidation } from "./quiz-format";

export type SavedQuiz = {
  id: string;
  familyId: string;
  revision: number;
  title: string;
  sourceMaterialId: string;
  questions: QuizQuestion[];
  createdAt: string;
};

export type QuizAttempt = {
  id: string;
  quizId: string;
  revision: number;
  /** Positionsbezogen: Index je Frage, `null` für offen. */
  answers: (number | null)[];
  score: number | null;
  submittedAt: string | null;
};

function parseAnswers(value: unknown, length: number): (number | null)[] {
  const raw = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_unused, index) => {
    const entry = raw[index];
    return typeof entry === "number" &&
      Number.isInteger(entry) &&
      entry >= 0 &&
      entry <= 3
      ? entry
      : null;
  });
}

export async function listQuizzes(materialId: string): Promise<SavedQuiz[]> {
  const { data, error } = await createClient()
    .from("learning_quizzes")
    .select(
      "id, family_id, revision, title, source_material_id, questions, created_at",
    )
    .eq("source_material_id", materialId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    familyId: row.family_id,
    revision: row.revision,
    title: row.title,
    sourceMaterialId: row.source_material_id,
    questions: parseQuizQuestions(row.questions),
    createdAt: row.created_at,
  }));
}

/**
 * Speichert ein Quiz. `requestId` bleibt über Wiederholungen desselben Klicks gleich.
 * Mit `previousQuizId` entsteht eine neue Revision derselben Familie statt eines zweiten
 * Quiz; ein veralteter Vorgänger ergibt `QUIZ_REVISION_CONFLICT`.
 */
export async function saveQuiz(input: {
  materialId: string;
  title: string;
  questions: QuizQuestion[];
  requestId: string;
  previousQuizId?: string;
}): Promise<{ quizId: string; familyId: string; revision: number }> {
  const { data, error } = await createClient().rpc("save_learning_quiz", {
    p_source_material: input.materialId,
    p_title: input.title.trim(),
    p_questions: input.questions.map((question) => ({
      question: question.question,
      options: question.options,
      correctIndex: question.correctIndex,
      ...(question.explanation ? { explanation: question.explanation } : {}),
      ...(question.source_chunk_ids
        ? { source_chunk_ids: question.source_chunk_ids }
        : {}),
    })),
    p_request_id: input.requestId,
    ...(input.previousQuizId ? { p_previous_quiz: input.previousQuizId } : {}),
  });

  if (error) throw error;
  const row = data as {
    quiz_id?: unknown;
    family_id?: unknown;
    revision?: unknown;
  } | null;
  if (typeof row?.quiz_id !== "string")
    throw new Error("Unerwartete Antwort beim Speichern des Quiz.");
  return {
    quizId: row.quiz_id,
    familyId: typeof row.family_id === "string" ? row.family_id : "",
    revision: typeof row.revision === "number" ? row.revision : 1,
  };
}

function mapAttempt(value: unknown, questionCount: number): QuizAttempt {
  const row = (value ?? {}) as Record<string, unknown>;
  if (typeof row.id !== "string")
    throw new Error("Unerwartete Antwort beim Versuch.");
  return {
    id: row.id,
    quizId: typeof row.quiz_id === "string" ? row.quiz_id : "",
    revision: typeof row.revision === "number" ? row.revision : 1,
    answers: parseAnswers(row.answers, questionCount),
    score: typeof row.score === "number" ? row.score : null,
    submittedAt: typeof row.submitted_at === "string" ? row.submitted_at : null,
  };
}

export async function startAttempt(
  quizId: string,
  questionCount: number,
  requestId: string,
): Promise<QuizAttempt> {
  const { data, error } = await createClient().rpc(
    "start_learning_quiz_attempt",
    {
      p_quiz: quizId,
      p_request_id: requestId,
    },
  );
  if (error) throw error;

  const row = (data ?? {}) as Record<string, unknown>;
  const attemptId = row.attempt_id ?? row.id;
  if (typeof attemptId !== "string")
    throw new Error("Unerwartete Antwort beim Start des Versuchs.");
  return getAttempt(attemptId, questionCount);
}

/**
 * Speichert Zwischenstand oder Abgabe. Bei `submit` müssen alle Fragen beantwortet sein;
 * den Punktestand berechnet der Server. Ein veralteter Stand ergibt `ATTEMPT_CONFLICT`.
 */
export async function saveAttempt(input: {
  attemptId: string;
  answers: (number | null)[];
  expectedRevision: number;
  submit: boolean;
}): Promise<QuizAttempt> {
  const { data, error } = await createClient().rpc(
    "save_learning_quiz_attempt",
    {
      p_attempt: input.attemptId,
      p_answers: input.answers,
      p_expected_revision: input.expectedRevision,
      p_submit: input.submit,
    },
  );
  if (error) throw error;
  return mapAttempt(data, input.answers.length);
}

export async function getAttempt(
  id: string,
  count: number,
): Promise<QuizAttempt> {
  const { data, error } = await createClient()
    .from("learning_quiz_attempts")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return mapAttempt(data, count);
}
export async function listAttempts(
  quizzes: SavedQuiz[],
): Promise<QuizAttempt[]> {
  if (!quizzes.length) return [];
  const { data, error } = await createClient()
    .from("learning_quiz_attempts")
    .select("*")
    .in(
      "quiz_id",
      quizzes.map((q) => q.id),
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((row) =>
    mapAttempt(
      row,
      quizzes.find((q) => q.id === row.quiz_id)!.questions.length,
    ),
  );
}
