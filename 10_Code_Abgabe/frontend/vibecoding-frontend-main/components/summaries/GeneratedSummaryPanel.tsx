"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { listCourseDocumentStatuses } from "@/lib/supabase/queries/documents";
import { getLatestGeneratedSummaryId } from "@/lib/supabase/queries/summaries";
import {
  fetchSummaryJob,
  fetchSummaryResult,
  isRetryableSummaryError,
  isSummaryJobFinished,
  retrySummaryGeneration,
  startSummaryGeneration,
  stripSourceMarkers,
  SUMMARY_POLL_INTERVAL_MS,
  SummaryError,
  summaryErrorMessage,
  summaryProgress,
  toSummaryErrorCode,
  type GeneratedSummary,
  type SummaryJob,
  type SummaryTarget,
} from "@/lib/summaryGeneration";
import s from "./summaries.module.css";

type View =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "running"; job: SummaryJob }
  | { kind: "ready"; summary: GeneratedSummary }
  // `blocking`: Bei SOURCES_NOT_READY nennt das Backend die noch nicht fertigen Quellen.
  // Ohne sie wüsste der Nutzer nicht, welche einzelne Unterlage die ganze
  // Kurszusammenfassung blockiert. Leer, solange die Titel noch nachgeladen werden.
  | { kind: "error"; message: string; retryJobId: string | null; blockingDocuments: string[] };

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Die vom Backend generierte Zusammenfassung — für den ganzen Kurs oder, mit
 * `sourceDocumentId`, für ein einzelnes Dokument.
 *
 * Die Generierung ist ein Hintergrundauftrag: starten, Status pollen, Ergebnis lesen. Sie
 * läuft auch weiter, wenn die Seite geschlossen wird — beim nächsten Aufruf findet
 * `getLatestGeneratedSummaryId` das Ergebnis wieder. Der Inhalt ist hier bewusst nur
 * lesbar: generierte Zeilen sind per RLS schreibgeschützt, Bearbeiten geht über eine
 * eigene manuelle Zusammenfassung.
 */
export default function GeneratedSummaryPanel({
  courseId,
  sourceDocumentId,
  heading = "Aus deinen Unterlagen",
  intro = "UniVerse liest die verarbeiteten Unterlagen dieses Kurses und erstellt daraus eine Zusammenfassung mit Quellenangaben. Das läuft im Hintergrund weiter, auch wenn du die Seite verlässt.",
}: {
  courseId: string;
  /** `source_documents.id` — dann wird nur dieses Dokument zusammengefasst. */
  sourceDocumentId?: string;
  heading?: string;
  intro?: string;
}) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const target: SummaryTarget = sourceDocumentId
    ? { type: "document", sourceDocumentId }
    : { type: "course", courseId };
  // Bleibt über Netzwerk-Wiederholungen hinweg gleich; ein neuer Lauf bekommt eine neue ID.
  const requestId = useRef<string | null>(null);

  const loadResult = useCallback(async (summaryId: string) => {
    const summary = await fetchSummaryResult(createClient(), summaryId);
    setView({ kind: "ready", summary });
  }, []);

  /**
   * Zeigt den Fehler sofort und löst danach nach, welche Unterlagen ihn ausgelöst haben.
   * Bei SOURCES_NOT_READY nennt das Backend die betroffenen `source_documents`; erst ihre
   * Titel machen die Meldung handhabbar. Das Nachladen ist bewusst nachgelagert, damit die
   * Meldung nicht darauf wartet — und ein Fehler dabei verschluckt sie nicht.
   */
  const showError = useCallback(async (error: unknown) => {
    setView({ kind: "error", message: summaryErrorMessage(error), retryJobId: null, blockingDocuments: [] });
    const ids = error instanceof SummaryError ? error.sourceDocumentIds : [];
    if (ids.length === 0) return;
    try {
      const statuses = await listCourseDocumentStatuses(courseId);
      const titleById = new Map(statuses.map((status) => [status.documentId, status.title]));
      const titles = ids.map((id) => titleById.get(id) ?? "Unbenannte Unterlage");
      setView((current) => (current.kind === "error" ? { ...current, blockingDocuments: titles } : current));
    } catch {
      /* Die Titel sind nur eine Ergänzung; die Fehlermeldung steht bereits. */
    }
  }, [courseId]);

  // Vorhandenes Ergebnis beim Öffnen nachladen.
  useEffect(() => {
    let active = true;
    getLatestGeneratedSummaryId(courseId, sourceDocumentId)
      .then(async (summaryId) => {
        if (!active) return;
        if (!summaryId) {
          setView({ kind: "none" });
          return;
        }
        await loadResult(summaryId);
      })
      .catch((error: unknown) => {
        if (!active) return;
        // Ein gelöschtes Ergebnis ist kein Fehler, sondern schlicht "noch keine".
        if (error instanceof SummaryError && (error.code === "RESULT_DELETED" || error.code === "SUMMARY_NOT_FOUND")) {
          setView({ kind: "none" });
          return;
        }
        void showError(error);
      });
    return () => { active = false; };
  }, [courseId, sourceDocumentId, loadResult, showError]);

  // Laufenden Auftrag pollen, bis er einen Endzustand erreicht. Die Abhängigkeit ist
  // bewusst nur die Job-ID: hinge der Effekt am ganzen `view`, würde jede Statusantwort
  // das Intervall neu aufsetzen.
  const pollJobId = view.kind === "running" && view.job.jobId ? view.job.jobId : null;

  useEffect(() => {
    if (!pollJobId) return;
    const jobId = pollJobId;
    let active = true;

    const timer = setInterval(() => {
      void (async () => {
        try {
          const job = await fetchSummaryJob(createClient(), jobId);
          if (!active) return;
          if (job.status === "completed" && job.summaryId) {
            await loadResult(job.summaryId);
            return;
          }
          if (job.status === "failed") {
            const code = toSummaryErrorCode(job.errorCode);
            setView({
              kind: "error",
              message: summaryErrorMessage(new SummaryError(code)),
              retryJobId: isRetryableSummaryError(code) ? jobId : null,
              blockingDocuments: [],
            });
            return;
          }
          // Endzustand ohne verwertbares Ergebnis: weiter zu pollen hieße endlos warten.
          if (isSummaryJobFinished(job)) {
            setView({ kind: "error", message: summaryErrorMessage(new SummaryError("INVALID_RESPONSE")), retryJobId: null, blockingDocuments: [] });
            return;
          }
          setView({ kind: "running", job });
        } catch (error) {
          // Ein Aussetzer im Netz beendet den Auftrag nicht — der Server arbeitet weiter.
          if (!active) return;
          if (error instanceof SummaryError && error.code === "NETWORK_ERROR") return;
          void showError(error);
        }
      })();
    }, SUMMARY_POLL_INTERVAL_MS);

    return () => { active = false; clearInterval(timer); };
  }, [pollJobId, loadResult, showError]);

  function applyJob(job: SummaryJob) {
    if (job.status === "completed" && job.summaryId) {
      void loadResult(job.summaryId).catch((error: unknown) => {
        void showError(error);
      });
      return;
    }
    if (job.status === "failed") {
      const code = toSummaryErrorCode(job.errorCode);
      setView({
        kind: "error",
        message: summaryErrorMessage(new SummaryError(code)),
        retryJobId: isRetryableSummaryError(code) ? job.jobId : null,
        blockingDocuments: [],
      });
      return;
    }
    // Endzustand ohne verwertbares Ergebnis: nicht in den Wartezustand zurückfallen.
    if (isSummaryJobFinished(job)) {
      setView({ kind: "error", message: summaryErrorMessage(new SummaryError("INVALID_RESPONSE")), retryJobId: null, blockingDocuments: [] });
      return;
    }
    setView({ kind: "running", job });
  }

  function handleGenerate() {
    requestId.current = crypto.randomUUID();
    setView({ kind: "running", job: { jobId: "", status: "queued", phase: "queued", completedSteps: 0, totalSteps: 0, summaryId: null, errorCode: null } });
    void startSummaryGeneration(createClient(), requestId.current, target)
      .then(applyJob)
      .catch((error: unknown) => {
        void showError(error);
      });
  }

  function handleRetry(jobId: string) {
    setView({ kind: "running", job: { jobId, status: "queued", phase: "queued", completedSteps: 0, totalSteps: 0, summaryId: null, errorCode: null } });
    void retrySummaryGeneration(createClient(), jobId)
      .then(applyJob)
      .catch((error: unknown) => {
        void showError(error);
      });
  }

  return (
    <section className={s.card} aria-labelledby="generated-summary-heading">
      <div className={s.meta}>
        <span className={s.metaInfo}>
          <span className={s.aiTag}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.3 5.6.4-4.3 3.6 1.4 5.4L12 14.3l-4.6 2.9 1.4-5.4L4.5 8.2l5.6-.4L12 2.5Z" /></svg>
            Automatisch erstellt
          </span>
          {view.kind === "ready" && view.summary.createdAt && (
            <>
              <span className={s.dot} aria-hidden="true">·</span>
              <span>{formatDateTime(view.summary.createdAt)}</span>
            </>
          )}
        </span>
        <span className={s.metaActions}>
          {(view.kind === "none" || view.kind === "ready" || view.kind === "error") && (
            <button type="button" className={s.secondaryButton} onClick={handleGenerate}>
              {view.kind === "none" ? "Zusammenfassung erstellen" : "Neu erstellen"}
            </button>
          )}
        </span>
      </div>

      <h2 id="generated-summary-heading" className={s.panelTitle}>{heading}</h2>

      {view.kind === "loading" && <p className={s.status} aria-live="polite">Wird geladen …</p>}

      {view.kind === "none" && (
        <p className={s.panelHint}>
          {intro}
        </p>
      )}

      {view.kind === "running" && <GenerationProgress job={view.job} />}

      {view.kind === "error" && (
        <div className={s.status} data-tone="error" role="alert">
          <p>{view.message}</p>
          {view.blockingDocuments.length > 0 && (
            <div className={s.blockingHint}>
              <p>{view.blockingDocuments.length === 1 ? "Diese Unterlage ist noch nicht so weit:" : "Diese Unterlagen sind noch nicht so weit:"}</p>
              <ul>
                {view.blockingDocuments.map((title, index) => (
                  <li key={`${title}-${index}`}>{title}</li>
                ))}
              </ul>
              <Link href={`/courses/${courseId}/documents`}>Verarbeitungsstand ansehen</Link>
            </div>
          )}
          {view.retryJobId && (
            <button type="button" className={s.secondaryButton} onClick={() => handleRetry(view.retryJobId!)}>
              Erneut versuchen
            </button>
          )}
        </div>
      )}

      {view.kind === "ready" && <SummaryBody summary={view.summary} />}
    </section>
  );
}

function GenerationProgress({ job }: { job: SummaryJob }) {
  const progress = summaryProgress(job);
  return (
    <div className={s.progress} aria-live="polite">
      <div
        className={s.progressTrack}
        role="progressbar"
        aria-label="Fortschritt der Zusammenfassung"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(progress.percent === null ? {} : { "aria-valuenow": progress.percent })}
      >
        <span
          className={s.progressBar}
          data-indeterminate={progress.indeterminate || undefined}
          style={progress.indeterminate ? undefined : { width: `${progress.percent}%` }}
        />
      </div>
      <p className={s.status}>
        {progress.label}
        {progress.indeterminate ? " …" : ` · ${job.completedSteps} von ${job.totalSteps} Schritten`}
      </p>
    </div>
  );
}

function SummaryBody({ summary }: { summary: GeneratedSummary }) {
  const sourceById = new Map(summary.sources.map((source) => [source.id, source]));

  return (
    <>
      {summary.isStale && (
        <p className={s.staleNotice} role="status">
          Seit dieser Zusammenfassung haben sich die Unterlagen des Kurses geändert. Erstelle sie neu,
          damit das Neue enthalten ist.
        </p>
      )}

      {summary.sections.length === 0 ? (
        <p className={s.readOnlyText}>{stripSourceMarkers(summary.text)}</p>
      ) : (
        <div className={s.sections}>
          {summary.sections.map((section, index) => {
            const cited = section.sourceIds.map((id) => sourceById.get(id)).filter((source) => source !== undefined);
            return (
              <article key={`${section.heading}-${index}`} className={s.section}>
                {section.heading && <h3>{section.heading}</h3>}
                <p className={s.readOnlyText}>{stripSourceMarkers(section.text)}</p>
                {cited.length > 0 && (
                  <p className={s.sourceList}>
                    <span className={s.sourceLabel}>Quelle:</span>
                    {cited.map((source) => (
                      <span key={source.id} className={s.sourceChip}>
                        {source.title}
                        {source.page !== null && <span className={s.sourcePage}>S.&nbsp;{source.page}</span>}
                      </span>
                    ))}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      <p className={s.aiDisclaimer}>
        Automatisch erzeugt und nicht geprüft. Vergleiche Wichtiges mit der Originalunterlage.
      </p>
    </>
  );
}
