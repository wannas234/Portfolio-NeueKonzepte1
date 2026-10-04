"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  generateQuiz,
  listQuizJobs,
  changeQuizJob,
  quizError,
  type QuizJob,
} from "@/lib/quizGeneration";
import { QuizAttemptWriter } from "@/lib/quizAttemptWriter";
import {
  isAttemptComplete,
  listQuizzes,
  listAttempts,
  getAttempt,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_QUESTIONS,
  saveAttempt,
  startAttempt,
  type QuizAttempt,
  type SavedQuiz,
} from "@/lib/supabase/queries/learningQuizzes";
import styles from "@/components/documents/documents.module.css";

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
        .format(date)
        .toUpperCase();
}

function QuizTaking({
  quiz,
  answers,
  onAnswer,
  onFinish,
  busy,
}: {
  quiz: SavedQuiz;
  answers: (number | null)[];
  onAnswer: (questionIndex: number, optionIndex: number) => void;
  onFinish: () => void;
  busy: boolean;
}) {
  const [index, setIndex] = useState(0);
  const question = quiz.questions[index];
  const answered = answers.filter((answer) => answer !== null).length;
  const isLast = index === quiz.questions.length - 1;

  if (!question) return null;

  return (
    <div className={styles.quizTaking}>
      <div className={styles.quizProgressRow}>
        <span>
          Frage {index + 1} von {quiz.questions.length}
        </span>
        <span>{answered} beantwortet</span>
      </div>
      <div className={styles.quizProgressTrack}>
        <div
          className={styles.quizProgressFill}
          style={{ width: `${((index + 1) / quiz.questions.length) * 100}%` }}
        />
      </div>

      <div className={styles.quizQuestionCard}>
        <span className={styles.quizQuestionTag}>
          <span aria-hidden="true" />
          Frage {index + 1}
        </span>
        <p className={styles.quizQuestionText}>{question.question}</p>
        <div
          className={styles.quizOptions}
          role="radiogroup"
          aria-label={question.question}
        >
          {question.options.map((option, optionIndex) => (
            <button
              type="button"
              key={optionIndex}
              role="radio"
              aria-checked={answers[index] === optionIndex}
              className={styles.quizOption}
              data-selected={answers[index] === optionIndex}
              onClick={() => onAnswer(index, optionIndex)}
              disabled={busy}
            >
              <span className={styles.quizOptionDot} aria-hidden="true" />
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.quizNav}>
        <button
          type="button"
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          disabled={index === 0}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 5-7 7 7 7" />
          </svg>
          Zurück
        </button>
        <div className={styles.quizDots}>
          {quiz.questions.map((_unused, dotIndex) => (
            <button
              type="button"
              key={dotIndex}
              className={styles.quizDot}
              data-current={dotIndex === index}
              data-answered={answers[dotIndex] !== null}
              aria-label={`Zu Frage ${dotIndex + 1}`}
              onClick={() => setIndex(dotIndex)}
            >
              {dotIndex + 1}
            </button>
          ))}
        </div>
        {/* Das Backend lehnt eine Abgabe mit offenen Fragen ab — dieselbe Regel hier. */}
        {isLast ? (
          <button
            type="button"
            className={styles.quizNavPrimary}
            onClick={onFinish}
            disabled={
              busy || !isAttemptComplete(answers, quiz.questions.length)
            }
          >
            {busy ? "Wird ausgewertet …" : "Auswerten"}
          </button>
        ) : (
          <button
            type="button"
            className={styles.quizNavPrimary}
            onClick={() =>
              setIndex((current) =>
                Math.min(quiz.questions.length - 1, current + 1),
              )
            }
          >
            Weiter
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 5 7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function QuizResults({
  quiz,
  attempt,
  onBack,
  onOpenSource,
}: {
  quiz: SavedQuiz;
  attempt: QuizAttempt;
  onBack: () => void;
  onOpenSource: (page: number | null) => void;
}) {
  // Die Punktzahl kommt vom Server; hier wird nichts nachgerechnet.
  const correctCount = attempt.score ?? 0;
  const score =
    quiz.questions.length > 0
      ? Math.round((correctCount / quiz.questions.length) * 100)
      : 0;

  return (
    <div className={styles.quizResults}>
      <div className={styles.quizScoreCard}>
        <span className={styles.quizScoreIcon} aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" />
            <path d="M7 5H4a3 3 0 0 0 3 5M17 5h3a3 3 0 0 1-3 5" />
          </svg>
        </span>
        <p className={styles.quizScoreLabel}>DEINE PUNKTZAHL</p>
        <p
          className={styles.quizScoreValue}
          data-tone={score >= 70 ? "good" : score >= 40 ? "mid" : "low"}
        >
          {score}%
        </p>
        <p className={styles.quizScoreNote}>
          {score >= 70
            ? "Stark!"
            : score >= 40
              ? "Auf dem richtigen Weg."
              : "Weiter üben!"}
        </p>
        <p className={styles.quizScoreStats}>
          {correctCount} von {quiz.questions.length} richtig
        </p>
      </div>

      <ul className={styles.quizReviewList}>
        {quiz.questions.map((question, index) => {
          const given = attempt.answers[index];
          const right = given === question.correctIndex;
          return (
            <li
              key={index}
              className={styles.quizReviewItem}
              data-correct={right || undefined}
            >
              <p className={styles.quizReviewQuestion}>
                {index + 1}. {question.question}
              </p>
              <p className={styles.quizReviewAnswer}>
                Deine Antwort:{" "}
                {given === null ? "keine" : question.options[given]}
              </p>
              {question.explanation && (
                <p className={styles.quizReviewAnswer}>
                  {question.explanation}
                </p>
              )}
              {question.sources?.map((source) => (
                <div key={source.chunk_id}>
                  <button
                    type="button"
                    className={styles.viewerLink}
                    onClick={() => onOpenSource(source.page_number)}
                  >
                    {source.title}
                    {source.page_number
                      ? ` · Seite ${source.page_number}`
                      : " · Quelle öffnen"}
                  </button>
                  <details>
                    <summary>Quellenauszug</summary>
                    <p>{source.excerpt}</p>
                  </details>
                </div>
              ))}
              {!right && (
                <p className={styles.quizReviewAnswer} data-tone="correct">
                  Richtig: {question.options[question.correctIndex]}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <button type="button" className={styles.uploadButton} onClick={onBack}>
        Zurück zur Übersicht
      </button>
    </div>
  );
}

export default function DocumentQuizzes({
  materialId,
  onOpenSource,
}: {
  materialId: string;
  onOpenSource: (page: number | null) => void;
}) {
  const [quizzes, setQuizzes] = useState<SavedQuiz[] | undefined>(undefined);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [jobs, setJobs] = useState<QuizJob[]>([]);
  const [active, setActive] = useState<{
    quiz: SavedQuiz;
    writer: QuizAttemptWriter;
  } | null>(null);
  const [results, setResults] = useState<{
    quiz: SavedQuiz;
    attempt: QuizAttempt;
  } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [count, setCount] = useState(5);
  const [pendingRequest, setPendingRequest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, redraw] = useState(0);
  const mounted = useRef(false);
  const generationRequest = useRef<{ id: string; count: number } | null>(null);
  const attemptRequests = useRef(new Map<string, string>());
  const operation = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const loaded = await listQuizzes(materialId);
        const savedAttempts = await listAttempts(loaded);
        if (stopped) return;
        setQuizzes(loaded);
        setAttempts(savedAttempts);
        const nextJobs = await listQuizJobs(materialId);
        if (stopped) return;
        setJobs(nextJobs);
      } catch (failure) {
        if (!stopped)
          setError(
            failure instanceof Error
              ? failure.message
              : "Tests konnten nicht geladen werden.",
          );
      } finally {
        if (!stopped) timer = setTimeout(refresh, 4000);
      }
    }
    void refresh();
    return () => {
      stopped = true;
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [materialId]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (active?.writer.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Die Aktion konnte nicht gespeichert werden. Bitte erneut versuchen.",
        );
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function handleGenerate(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      generationRequest.current ??= { id: crypto.randomUUID(), count };
      setPendingRequest(true);
      const request = generationRequest.current;
      const job = await generateQuiz(materialId, request.count, request.id);
      generationRequest.current = null;
      if (!mounted.current) return;
      setPendingRequest(false);
      setJobs((current) => [job, ...current.filter((j) => j.id !== job.id)]);
      setDialogOpen(false);
    });
  }
  function openAttempt(quiz: SavedQuiz, attempt: QuizAttempt) {
    if (!mounted.current) return;
    if (attempt.submittedAt) {
      setResults({ quiz, attempt });
      setActive(null);
      return;
    }
    const writer = new QuizAttemptWriter(attempt, saveAttempt, () => {
      if (mounted.current) redraw((n) => n + 1);
    });
    setActive({ quiz, writer });
    setResults(null);
  }
  async function start(quiz: SavedQuiz) {
    await run(async () => {
      const id = attemptRequests.current.get(quiz.id) ?? crypto.randomUUID();
      attemptRequests.current.set(quiz.id, id);
      const attempt = await startAttempt(quiz.id, quiz.questions.length, id);
      attemptRequests.current.delete(quiz.id);
      openAttempt(quiz, attempt);
    });
  }
  async function finish() {
    if (!active) return;
    await run(async () => {
      const attempt = await active.writer.submit();
      if (mounted.current && attempt.submittedAt) {
        setResults({ quiz: active.quiz, attempt });
        setActive(null);
      }
    });
  }

  if (active) {
    const writer = active.writer;
    const conflict = /ATTEMPT_CONFLICT|ATTEMPT_SUBMITTED/.test(
      String((writer.error as { message?: string } | null)?.message),
    );
    return (
      <>
        {error && (
          <p role="alert" className={styles.errorHint}>
            {error}
          </p>
        )}
        <p aria-live="polite">
          {writer.error
            ? "Antworten sind noch nicht gespeichert."
            : writer.dirty || writer.busy
              ? "Antworten werden gespeichert …"
              : "Alle Antworten gespeichert."}
        </p>
        {writer.error && (
          <div role="alert">
            <p>
              {conflict
                ? "Dieser Versuch wurde in einem anderen Tab geändert. Deine lokalen Antworten bleiben sichtbar. Lade den gespeicherten Stand, um fortzufahren."
                : "Speichern fehlgeschlagen. Deine Antworten bleiben hier erhalten."}
            </p>
            {conflict ? (
              <button
                type="button"
                onClick={() =>
                  void run(async () =>
                    openAttempt(
                      active.quiz,
                      await getAttempt(
                        writer.saved.id,
                        active.quiz.questions.length,
                      ),
                    ),
                  )
                }
              >
                Gespeicherten Stand übernehmen (lokale Änderungen verwerfen)
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await writer.retry();
                    if (writer.saved.submittedAt)
                      openAttempt(active.quiz, writer.saved);
                  })
                }
              >
                Speichern erneut versuchen
              </button>
            )}
          </div>
        )}
        <QuizTaking
          quiz={active.quiz}
          answers={writer.answers}
          onAnswer={(q, o) => writer.answer(q, o)}
          onFinish={() => void finish()}
          busy={busy || !!writer.error}
        />
        <button
          type="button"
          disabled={writer.dirty || writer.busy || busy}
          onClick={() => setActive(null)}
        >
          Zur Übersicht
        </button>
      </>
    );
  }
  if (results)
    return (
      <QuizResults
        quiz={results.quiz}
        attempt={results.attempt}
        onBack={() => setResults(null)}
        onOpenSource={onOpenSource}
      />
    );

  return (
    <div className={styles.quizPanel}>
      <div className={styles.sectionHead}>
        <div>
          <h2>Tests</h2>
          <p>
            {quizzes
              ? `${quizzes.length} Tests gespeichert`
              : "Tests werden geladen …"}
          </p>
        </div>
        <button
          type="button"
          className={styles.uploadButton}
          onClick={() => setDialogOpen(true)}
          disabled={busy}
        >
          Test erstellen
        </button>
      </div>
      {error && (
        <p className={styles.errorHint} role="alert">
          {error}
        </p>
      )}
      {dialogOpen && (
        <form className={styles.quizSetup} onSubmit={handleGenerate}>
          <label>
            <span>Anzahl Fragen</span>
            <input
              type="number"
              min={QUIZ_MIN_QUESTIONS}
              max={QUIZ_MAX_QUESTIONS}
              value={count}
              onChange={(e) => {
                setCount(Number(e.target.value));
                generationRequest.current = null;
              }}
              disabled={busy || pendingRequest}
            />
          </label>
          <div className={styles.quizSetupActions}>
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              disabled={busy}
            >
              Schließen
            </button>
            <button
              type="submit"
              className={styles.uploadButton}
              disabled={busy}
            >
              {busy
                ? "Wird gestartet …"
                : pendingRequest
                  ? "Anfrage erneut versuchen"
                  : "Erstellen"}
            </button>
          </div>
          <p className={styles.quizSetupHint}>
            KI-generiert aus dieser Unterlage. Bei wenig geeignetem Inhalt
            entstehen weniger Fragen. Die Erstellung läuft auch nach dem
            Schließen weiter.
          </p>
        </form>
      )}
      <ul className={styles.quizList} aria-label="Generierungsaufträge">
        {jobs
          .filter((j) => j.status !== "cancelled")
          .map((job) => (
            <li key={job.id}>
              <div>
                <strong>
                  {job.status === "completed"
                    ? "Test gespeichert"
                    : job.status === "failed"
                      ? "Erstellung fehlgeschlagen"
                      : job.phase === "analyze"
                        ? "Unterlage wird analysiert …"
                        : "Fragen werden erstellt …"}
                </strong>
                <small>
                  {job.status === "completed"
                    ? `${job.generated_count} von bis zu ${job.requested_count} Fragen erstellt`
                    : job.status === "failed"
                      ? quizError(job.error_code)
                      : "Läuft im Hintergrund"}
                </small>
              </div>
              {job.status === "failed" &&
                ![
                  "SOURCE_CHANGED",
                  "BUDGET_EXCEEDED",
                  "POINT_LIMIT_EXCEEDED",
                  "NO_LEARNING_CONTENT",
                ].includes(job.error_code ?? "") && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const next = await changeQuizJob("retry", job.id);
                        if (mounted.current)
                          setJobs((js) =>
                            js.map((j) => (j.id === next.id ? next : j)),
                          );
                      })
                    }
                  >
                    Erneut versuchen
                  </button>
                )}
              {["queued", "processing", "failed"].includes(job.status) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const next = await changeQuizJob("cancel", job.id);
                      if (mounted.current)
                        setJobs((js) =>
                          js.map((j) => (j.id === next.id ? next : j)),
                        );
                    })
                  }
                >
                  Auftrag abbrechen
                </button>
              )}
            </li>
          ))}
      </ul>
      <ul className={styles.quizList} aria-label="Gespeicherte Tests">
        {quizzes?.map((quiz) => (
          <li key={quiz.id}>
            <div>
              <strong>{quiz.title}</strong>
              <small>
                {quiz.questions.length} Fragen · Fassung {quiz.revision} ·{" "}
                {formatShortDate(quiz.createdAt)}
              </small>
              {attempts
                .filter((a) => a.quizId === quiz.id)
                .map((attempt, i) => (
                  <div key={attempt.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () =>
                          openAttempt(
                            quiz,
                            await getAttempt(attempt.id, quiz.questions.length),
                          ),
                        )
                      }
                    >
                      {attempt.submittedAt
                        ? `Ergebnis ansehen: ${attempt.score}/${quiz.questions.length}`
                        : `Versuch fortsetzen (${i + 1})`}
                    </button>
                  </div>
                ))}
            </div>
            <button
              type="button"
              className={styles.uploadButton}
              disabled={busy}
              onClick={() => void start(quiz)}
            >
              Neuer Versuch
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
