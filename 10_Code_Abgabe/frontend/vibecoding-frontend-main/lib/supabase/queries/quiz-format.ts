export type QuizSource = {
  source_document_id: string;
  material_id: string;
  chunk_id: string;
  title: string;
  page_number: number | null;
  excerpt: string;
};
// Reine Regeln für gespeicherte Tests — ohne Supabase-Client, damit sie testbar bleiben.
// Sie spiegeln die Grenzen aus Backend-Migration 20261003142000.

export type QuizQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  sources?: QuizSource[];
  source_chunk_ids?: string[];
};

export const QUIZ_MIN_QUESTIONS = 1;
export const QUIZ_MAX_QUESTIONS = 10;
export const QUIZ_TITLE_MAX = 200;
export const QUIZ_QUESTION_MAX = 1000;
export const QUIZ_OPTION_MAX = 2000;

export type QuizValidation = { ok: true } | { ok: false; message: string };

export function validateQuiz(
  title: string,
  questions: QuizQuestion[],
): QuizValidation {
  const name = title.trim();
  if (name.length === 0)
    return { ok: false, message: "Gib dem Test einen Namen." };
  if (name.length > QUIZ_TITLE_MAX) {
    return {
      ok: false,
      message: `Der Name darf höchstens ${QUIZ_TITLE_MAX} Zeichen haben.`,
    };
  }
  if (
    questions.length < QUIZ_MIN_QUESTIONS ||
    questions.length > QUIZ_MAX_QUESTIONS
  ) {
    return {
      ok: false,
      message: `Ein Test braucht ${QUIZ_MIN_QUESTIONS}–${QUIZ_MAX_QUESTIONS} Fragen.`,
    };
  }
  for (const question of questions) {
    const text = question.question.trim();
    if (text.length === 0 || text.length > QUIZ_QUESTION_MAX) {
      return { ok: false, message: "Jede Frage braucht einen Text." };
    }
    if (
      question.options.length !== 4 ||
      question.options.some((option) => option.trim().length === 0)
    ) {
      return {
        ok: false,
        message: "Jede Frage braucht genau vier ausgefüllte Antworten.",
      };
    }
    if (
      question.options.some((option) => option.trim().length > QUIZ_OPTION_MAX)
    ) {
      return {
        ok: false,
        message: `Eine Antwort darf höchstens ${QUIZ_OPTION_MAX} Zeichen haben.`,
      };
    }
    if (
      !Number.isInteger(question.correctIndex) ||
      question.correctIndex < 0 ||
      question.correctIndex > 3
    ) {
      return {
        ok: false,
        message:
          "Bei jeder Frage muss genau eine richtige Antwort markiert sein.",
      };
    }
  }
  return { ok: true };
}

/**
 * Ein Versuch ist abgabebereit, wenn jede Frage beantwortet ist — das verlangt das
 * Backend bei `submit`, und ein vorher abgeschickter Versuch würde abgelehnt.
 */
export function isAttemptComplete(
  answers: (number | null)[],
  questionCount: number,
): boolean {
  return (
    answers.length === questionCount &&
    questionCount > 0 &&
    answers.every(
      (answer) =>
        typeof answer === "number" &&
        Number.isInteger(answer) &&
        answer >= 0 &&
        answer <= 3,
    )
  );
}

/** Preserve positional identity: reject the whole set instead of dropping questions. */
export function parseQuizQuestions(value: unknown): QuizQuestion[] {
  if (!Array.isArray(value)) throw new Error("Ungültige Quizdaten.");
  const questions = value.map((entry): QuizQuestion => {
    if (!entry || typeof entry !== "object")
      throw new Error("Ungültige Quizdaten.");
    const q = entry as Record<string, unknown>;
    if (
      typeof q.question !== "string" ||
      !Array.isArray(q.options) ||
      q.options.some((x) => typeof x !== "string") ||
      typeof q.correctIndex !== "number"
    )
      throw new Error("Ungültige Quizdaten.");
    const sources = Array.isArray(q.sources)
      ? q.sources.map((entry): QuizSource => {
          const s = entry as Record<string, unknown> | null;
          if (
            !s ||
            typeof s.source_document_id !== "string" ||
            typeof s.material_id !== "string" ||
            typeof s.chunk_id !== "string" ||
            typeof s.title !== "string" ||
            typeof s.excerpt !== "string" ||
            !(
              s.page_number === null ||
              (typeof s.page_number === "number" &&
                Number.isInteger(s.page_number) &&
                s.page_number > 0)
            )
          )
            throw new Error("Ungültige Quellenangabe.");
          return s as QuizSource;
        })
      : [];
    return {
      question: q.question,
      options: q.options as string[],
      correctIndex: q.correctIndex,
      ...(typeof q.explanation === "string"
        ? { explanation: q.explanation }
        : {}),
      sources,
    };
  });
  if (!validateQuiz("Test", questions).ok)
    throw new Error("Ungültige Quizdaten.");
  return questions;
}
