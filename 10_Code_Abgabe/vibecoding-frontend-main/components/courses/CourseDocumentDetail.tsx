"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCourse, type Course } from "@/lib/supabase/queries/courses";
import {
  deleteCourseFile,
  getCourseFileDownloadUrl,
  listCourseFiles,
  type CourseFile,
} from "@/lib/supabase/queries/files";
import {
  indexDocumentStatusesByFile,
  listCourseDocumentStatuses,
  type CourseDocumentStatus,
} from "@/lib/supabase/queries/documents";
import {
  describeIndexingProgress,
  retryStage,
  STATUS_POLL_INTERVAL_MS,
  STATUS_POLL_MAX_ATTEMPTS,
  type IndexingTone,
} from "./documentIndexing";
import DocumentRetryButton from "./DocumentRetryButton";
import DocumentCourseChat from "./DocumentCourseChat";
import DocumentAiActions from "./DocumentAiActions";
import DocumentFlashcards from "./DocumentFlashcards";
import DocumentLecturePicker from "./DocumentLecturePicker";
import DocumentNotes from "./DocumentNotes";
import DocumentQuizzes from "./DocumentQuizzes";
import styles from "@/components/documents/documents.module.css";

const EXTENSION_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "text/plain": "TXT",
};

// The browser can render PDF and plain text inline via <iframe>; Office
// formats have no native inline viewer and fall back to download/open-in-tab.
const INLINE_VIEWABLE_TYPES = new Set(["application/pdf", "text/plain"]);

const TONE_LABELS: Record<IndexingTone, string> = {
  ready: "Bereit",
  active: "Wird analysiert",
  pending: "Warteschlange",
  failed: "Fehlgeschlagen",
};

type Tab = "content" | "chat" | "actions" | "notes" | "flashcards" | "quizzes";

export default function CourseDocumentDetail({
  courseId,
  fileId,
  initialTab = "content",
}: {
  courseId: string;
  fileId: string;
  /** Erlaubt Links direkt in den Notizen-Tab, z. B. von den offenen Notizen. */
  initialTab?: "content" | "notes";
}) {
  const router = useRouter();
  const [course, setCourse] = useState<Course | null | undefined>(undefined);
  const [file, setFile] = useState<CourseFile | null | undefined>(undefined);
  const [documentStatuses, setDocumentStatuses] = useState<CourseDocumentStatus[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  // Seite, zu der der Viewer springen soll (nur PDF: der Browser-Viewer versteht `#page=`).
  const [viewerPage, setViewerPage] = useState<number | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [viewUrlError, setViewUrlError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getCourse(courseId), listCourseFiles(courseId), listCourseDocumentStatuses(courseId)])
      .then(([nextCourse, files, nextStatuses]) => {
        if (!active) return;
        setCourse(nextCourse);
        setFile(files.find((entry) => entry.id === fileId) ?? null);
        setDocumentStatuses(nextStatuses);
      })
      .catch(() => {
        if (!active) return;
        setLoadError("Das Dokument konnte nicht geladen werden. Bitte versuche es erneut.");
        setCourse(null);
        setFile(null);
      });
    return () => { active = false; };
  }, [courseId, fileId]);

  const statusByFile = useMemo(() => indexDocumentStatusesByFile(documentStatuses), [documentStatuses]);
  const progress = useMemo(
    () => (file ? describeIndexingProgress(file.status, statusByFile.get(file.id) ?? null) : null),
    [file, statusByFile]
  );

  const canView = file?.status === "ready" && progress?.tone === "ready";
  const documentStatus = file ? statusByFile.get(file.id) : undefined;
  const retry = file ? retryStage(file.status, documentStatus ?? null) : null;
  const hasUnfinishedDocument = progress?.inProgress ?? false;
  const pollAttemptsRef = useRef(0);

  const refreshDocument = useCallback(async () => {
    const [nextFiles, nextStatuses] = await Promise.all([listCourseFiles(courseId), listCourseDocumentStatuses(courseId)]);
    setFile(nextFiles.find((entry) => entry.id === fileId) ?? null);
    setDocumentStatuses(nextStatuses);
  }, [courseId, fileId]);

  // Follow the status while the document is unfinished, e.g. after a retry was started.
  useEffect(() => {
    if (!hasUnfinishedDocument) {
      pollAttemptsRef.current = 0;
      return;
    }
    const timer = setInterval(() => {
      if (pollAttemptsRef.current >= STATUS_POLL_MAX_ATTEMPTS) {
        clearInterval(timer);
        return;
      }
      pollAttemptsRef.current += 1;
      refreshDocument().catch(() => {
        // A transient status request failure is not worth an error banner; the next tick retries.
      });
    }, STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasUnfinishedDocument, refreshDocument]);
  // The AI tabs are scoped to this document's material. Without it they must not
  // fall back to the whole course, so they stay unavailable until it is indexed.
  const materialId = canView && file ? (statusByFile.get(file.id)?.materialId ?? null) : null;
  // `source_documents.id`: Ziel der Dokumentzusammenfassung, nicht die Material- oder Datei-ID.
  const documentId = canView && file ? (statusByFile.get(file.id)?.documentId ?? null) : null;
  const inlineViewable = file ? INLINE_VIEWABLE_TYPES.has(file.type) : false;

  useEffect(() => {
    if (!file || !canView) return;
    let active = true;
    getCourseFileDownloadUrl(file.id, false)
      .then((url) => { if (active) setViewUrl(url); })
      .catch(() => { if (active) setViewUrlError("Die Vorschau konnte nicht geladen werden."); });
    return () => { active = false; };
  }, [file, canView]);

  async function handleOpen(download: boolean) {
    if (!file) return;
    setActionError(null);
    try {
      const url = await getCourseFileDownloadUrl(file.id, download);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setActionError("Die Datei konnte nicht geöffnet werden.");
    }
  }

  async function confirmDelete() {
    if (!file) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteCourseFile(file.id);
      router.push(`/courses/${courseId}/documents`);
    } catch {
      setActionError("Das Dokument konnte nicht gelöscht werden.");
      setDeleting(false);
    }
  }

  if (course === undefined || file === undefined) {
    return <div className={styles.page}><p className={styles.loading} aria-live="polite">Dokument wird geladen …</p></div>;
  }

  if (course === null || file === null) {
    return (
      <div className={styles.page}>
        <div className={styles.empty} role="alert">
          <h2>Dokument nicht verfügbar</h2>
          <p>{loadError ?? "Dieses Dokument existiert nicht oder du hast keinen Zugriff darauf."}</p>
          <Link href={`/courses/${courseId}/documents`} className={styles.uploadButton}>Zurück zu Unterlagen</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Link href={`/courses/${courseId}/documents`} className={styles.backLink}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m11 5-6 7 6 7M5 12h14" /></svg>
        Zurück zu Unterlagen
      </Link>

      <header className={styles.header}>
        <div>
          <h1>{file.name}</h1>
          <p className={styles.subhead}>{course.title}</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.dangerLink} onClick={() => setConfirmingDelete(true)}>Löschen</button>
          {canView && (
            <button type="button" className={styles.uploadButton} onClick={() => void handleOpen(true)}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V5M7 12l5 5 5-5" /><path d="M4 19h16" /></svg>
              Herunterladen
            </button>
          )}
        </div>
      </header>
      {actionError && <p className={styles.errorHint} role="alert">{actionError}</p>}

      <div className={styles.documentWorkspace}>
      <div className={styles.tabs} role="tablist" aria-label="Dokumentwerkzeuge">
        <button type="button" role="tab" aria-selected={tab === "content"} className={styles.tab} data-active={tab === "content"} onClick={() => setTab("content")}>Inhalt</button>
        <button type="button" role="tab" aria-selected={tab === "chat"} className={styles.tab} data-active={tab === "chat"} onClick={() => setTab("chat")}>Chat</button>
        <button type="button" role="tab" aria-selected={tab === "actions"} className={styles.tab} data-active={tab === "actions"} onClick={() => setTab("actions")}>KI-Aktionen</button>
        <button type="button" role="tab" aria-selected={tab === "notes"} className={styles.tab} data-active={tab === "notes"} onClick={() => setTab("notes")}>Notizen</button>
        <button type="button" role="tab" aria-selected={tab === "flashcards"} className={styles.tab} data-active={tab === "flashcards"} onClick={() => setTab("flashcards")}>Karteikarten</button>
        <button type="button" role="tab" aria-selected={tab === "quizzes"} className={styles.tab} data-active={tab === "quizzes"} onClick={() => setTab("quizzes")}>Tests</button>
      </div>

      {(
        <section className={styles.viewerCard}>
          <div className={styles.viewerHeader}>
            <span>Dokumentvorschau</span>
            {canView && (
              <button type="button" className={styles.viewerLink} onClick={() => void handleOpen(false)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6" /><path d="M10 14 20 4" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg>
                In neuem Tab öffnen
              </button>
            )}
          </div>
          <div className={styles.viewerFrameWrap}>
            {!canView ? (
              <div className={styles.viewerEmpty}>
                <p><strong>{TONE_LABELS[progress!.tone]}</strong></p>
                <p>{progress!.detail ?? "Dieses Dokument ist noch nicht zur Vorschau bereit."}</p>
                {documentStatus && retry && (
                  <DocumentRetryButton
                    documentId={documentStatus.documentId}
                    stage={retry}
                    onRestarted={refreshDocument}
                    className={styles.uploadButton}
                    errorClassName={styles.errorHint}
                  />
                )}
              </div>
            ) : !inlineViewable ? (
              <div className={styles.viewerEmpty}>
                <p><strong>Keine Inline-Vorschau für {EXTENSION_LABELS[file.type] ?? "diesen Dateityp"}.</strong></p>
                <p>Öffne die Datei zum Ansehen in einem neuen Tab oder lade sie herunter.</p>
              </div>
            ) : viewUrlError ? (
              <div className={styles.viewerEmpty}><p>{viewUrlError}</p></div>
            ) : viewUrl ? (
              <iframe key={viewerPage ?? 0} title={file.name} src={viewerPage ? `${viewUrl}#page=${viewerPage}` : viewUrl} className={styles.viewerFrame} />
            ) : (
              <div className={styles.viewerSkeleton} aria-hidden="true" />
            )}
          </div>
        </section>
      )}

      {tab === "content" && materialId && (
        <DocumentLecturePicker
          courseId={courseId}
          materialId={materialId}
          initialLectureId={documentStatus?.lectureId ?? null}
        />
      )}

      {tab === "content" && <aside className={styles.documentTools}>
        <h2>Mit deinen Unterlagen lernen</h2>
        <p>Erstelle eine Zusammenfassung, lerne mit Karteikarten oder stelle Fragen zu diesem Dokument.</p>
        <button type="button" className={styles.uploadButton} onClick={() => setTab("actions")}>Zusammenfassung erstellen</button>
        <button type="button" className={styles.toolLink} onClick={() => setTab("flashcards")}>Karteikarten öffnen →</button>
        <button type="button" className={styles.toolLink} onClick={() => setTab("chat")}>Frage zum Dokument stellen →</button>
      </aside>}

      {(tab === "chat" || tab === "actions" || tab === "notes" || tab === "quizzes") && !materialId && (
        <section className={styles.viewerCard}>
          <div className={styles.viewerEmpty}>
            <p><strong>Noch nicht für dieses Dokument verfügbar.</strong></p>
            <p>Die KI arbeitet nur mit diesem Dokument und braucht dafür den fertig indexierten Text. Aktueller Stand: {progress!.label}</p>
          </div>
        </section>
      )}

      {tab === "chat" && materialId && (
        <section className={styles.viewerCard}>
          <DocumentCourseChat courseId={courseId} courseTitle={course.title} materialId={materialId} />
        </section>
      )}

      {tab === "actions" && materialId && documentId && (
        <section className={styles.viewerCard}>
          <DocumentAiActions courseId={courseId} documentId={documentId} materialId={materialId} />
        </section>
      )}

      {tab === "notes" && materialId && (
        <section className={styles.viewerCard}>
          <DocumentNotes
            materialId={materialId}
            onOpenPage={file.type === "application/pdf" && inlineViewable
              ? (page) => { setViewerPage(page); setTab("content"); }
              : undefined}
          />
        </section>
      )}

      {tab === "flashcards" && (
        <section className={styles.viewerCard}>
          <DocumentFlashcards courseId={courseId} documentId={documentId} />
        </section>
      )}

      {tab === "quizzes" && materialId && (
        <section className={styles.viewerCard}>
          <DocumentQuizzes key={materialId} materialId={materialId} onOpenSource={(page) => {
              void getCourseFileDownloadUrl(file.id, false).then(url => {
                setViewUrlError(null);
                setViewUrl(file.type === "application/pdf" && page ? `${url.split("#")[0]}#page=${page}` : url);
                document.querySelector("iframe")?.scrollIntoView({ behavior: "smooth", block: "center" });
              }).catch(() => setActionError("Die Quelle konnte nicht geöffnet werden."));
            }} />
        </section>
      )}

      </div>

      {confirmingDelete && (
        <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget && !deleting) setConfirmingDelete(false); }}>
          <div className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-document-heading">
            <span className={styles.confirmIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9L6 7Z" /><path d="M10 11v6M14 11v6" /></svg>
            </span>
            <h2 id="delete-document-heading">Dokument löschen?</h2>
            <p>„{file.name}&quot; wird endgültig entfernt. Das kann nicht rückgängig gemacht werden.</p>
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.cancelButton} onClick={() => setConfirmingDelete(false)} disabled={deleting}>Abbrechen</button>
              <button type="button" className={styles.dangerButton} onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? "Wird gelöscht …" : "Löschen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
