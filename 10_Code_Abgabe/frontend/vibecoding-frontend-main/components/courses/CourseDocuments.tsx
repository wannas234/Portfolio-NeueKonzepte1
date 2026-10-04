"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getCourse, type Course } from "@/lib/supabase/queries/courses";
import {
  deleteCourseFile,
  listCourseFiles,
  uploadCourseFile,
  type CourseFile,
} from "@/lib/supabase/queries/files";
import {
  deleteOrphanedDocument,
  indexDocumentStatusesByFile,
  listCourseDocumentStatuses,
  type CourseDocumentStatus,
} from "@/lib/supabase/queries/documents";
import { listLectures, type Lecture } from "@/lib/supabase/queries/lectures";
import {
  LECTURE_FILTER_ALL,
  LECTURE_FILTER_NONE,
  lectureFilterSearch,
  matchesLectureFilter,
  resolveLectureFilter,
  type LectureFilter,
} from "./lectureFilter";
import DocumentRetryButton from "./DocumentRetryButton";
import {
  describeIndexingProgress,
  retryStage,
  STATUS_POLL_INTERVAL_MS,
  STATUS_POLL_MAX_ATTEMPTS,
  type IndexingTone,
} from "./documentIndexing";
import {
  DOCUMENT_UPLOAD_ACCEPT,
  DOCUMENT_UPLOAD_ERROR_MESSAGES,
  DOCUMENT_UPLOAD_HINT,
  validateDocumentFile,
} from "@/lib/documentUpload";
import styles from "@/components/documents/documents.module.css";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Minute${minutes === 1 ? "" : "n"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Stunde${hours === 1 ? "" : "n"}`;
  const days = Math.round(hours / 24);
  return `vor ${days} Tag${days === 1 ? "" : "en"}`;
}

const EXTENSION_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "text/plain": "TXT",
};

const TONE_MAP: Record<IndexingTone, "ready" | "processing" | "queued" | "failed"> = {
  ready: "ready",
  active: "processing",
  pending: "queued",
  failed: "failed",
};

const TONE_LABELS: Record<IndexingTone, string> = {
  ready: "Bereit",
  active: "Wird analysiert",
  pending: "Warteschlange",
  failed: "Fehlgeschlagen",
};

const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  ...DOCUMENT_UPLOAD_ERROR_MESSAGES,
  COURSE_NOT_FOUND: "Dieser Kurs wurde nicht gefunden. Bitte lade die Seite neu.",
  UPLOAD_KEY_CONFLICT: "Der Upload-Vorgang steht in Konflikt. Bitte versuche es erneut.",
  UPLOAD_DELETED: "Dieser Upload wurde bereits gelöscht. Bitte versuche es erneut.",
  UNAUTHENTICATED: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
};

function uploadErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return UPLOAD_ERROR_MESSAGES[code] ?? "Die Datei konnte nicht hochgeladen werden.";
}

function splitName(fileName: string): { base: string; extension: string } {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return { base: fileName, extension: "" };
  return { base: fileName.slice(0, dot), extension: fileName.slice(dot) };
}

function renameFile(file: File, title: string): File {
  const { extension } = splitName(file.name);
  const trimmed = title.trim();
  if (!trimmed) return file;
  return new File([file], `${trimmed}${extension}`, { type: file.type, lastModified: file.lastModified });
}

export default function CourseDocuments({ courseId, initialLecture = null }: { courseId: string; initialLecture?: string | null }) {
  const [course, setCourse] = useState<Course | null | undefined>(undefined);
  const [files, setFiles] = useState<CourseFile[]>([]);
  const [documentStatuses, setDocumentStatuses] = useState<CourseDocumentStatus[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [lectureFilter, setLectureFilter] = useState<LectureFilter>(LECTURE_FILTER_ALL);
  const pathname = usePathname();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removingOrphan, setRemovingOrphan] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [titleValue, setTitleValue] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CourseFile | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const dialogFileInputRef = useRef<HTMLInputElement>(null);
  const pollAttemptsRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(tone: "success" | "error", message: string) {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ tone, message });
    toastTimerRef.current = setTimeout(() => setToast(null), 4500);
  }

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getCourse(courseId), listCourseFiles(courseId), listCourseDocumentStatuses(courseId)])
      .then(([nextCourse, nextFiles, nextStatuses]) => {
        if (!active) return;
        setCourse(nextCourse);
        setFiles(nextFiles);
        setDocumentStatuses(nextStatuses);
      })
      .catch(() => {
        if (!active) return;
        setLoadError("Der Kurs konnte nicht geladen werden. Bitte versuche es erneut.");
        setCourse(null);
      });
    return () => { active = false; };
  }, [courseId]);

  // Vorlesungen sind Beiwerk: schlägt das Laden fehl, bleibt die Liste ungefiltert nutzbar.
  useEffect(() => {
    let active = true;
    listLectures(courseId)
      .then((loaded) => {
        if (!active) return;
        setLectures(loaded);
        setLectureFilter(resolveLectureFilter(initialLecture, loaded));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [courseId, initialLecture]);

  // Der Filter steht in der URL, damit er Neuladen und Zurück-Navigation übersteht.
  // `replaceState` statt Router: kein neuer Server-Render, kein neues Laden der Vorlesungen.
  function selectLectureFilter(next: LectureFilter) {
    setLectureFilter(next);
    window.history.replaceState(null, "", `${pathname}${lectureFilterSearch(next)}`);
  }

  const lectureTitleById = useMemo(() => new Map(lectures.map((lecture) => [lecture.id, lecture.title])), [lectures]);

  const statusByFile = useMemo(() => indexDocumentStatusesByFile(documentStatuses), [documentStatuses]);

  const fileProgress = useMemo(
    () => files.map((file) => ({ file, progress: describeIndexingProgress(file.status, statusByFile.get(file.id) ?? null) })),
    [files, statusByFile]
  );

  const visibleFiles = useMemo(
    () => fileProgress.filter(({ file }) => matchesLectureFilter(statusByFile.get(file.id)?.lectureId, lectureFilter)),
    [fileProgress, statusByFile, lectureFilter]
  );

  const hasUnfinishedDocuments = fileProgress.some((entry) => entry.progress.inProgress);

  // Lerneinheiten, deren Datei gelöscht wurde: das Backend setzt dabei nur `file_id` auf
  // null, die Einheit bleibt Quelle des Kurses und wird nie fertig. Sie blockiert damit
  // jede Kurszusammenfassung, taucht aber in der Dateiliste oben nicht mehr auf.
  // Kriterium ist ausdrücklich `fileId === null`, nicht "Datei nicht in der Liste" —
  // die Dateiliste ist auf 50 Einträge begrenzt.
  const orphanedDocuments = useMemo(
    () => documentStatuses.filter((status) => status.fileId === null),
    [documentStatuses]
  );

  const refreshStatuses = useCallback(async () => {
    const [nextFiles, nextStatuses] = await Promise.all([listCourseFiles(courseId), listCourseDocumentStatuses(courseId)]);
    return { nextFiles, nextStatuses };
  }, [courseId]);

  // Reloads the real status after a retry was started; the unfinished document then
  // keeps the polling below running until it is ready or failed again.
  async function handleRetryRestarted() {
    const { nextFiles, nextStatuses } = await refreshStatuses();
    setFiles(nextFiles);
    setDocumentStatuses(nextStatuses);
  }

  async function handleRemoveOrphan(materialId: string) {
    setRemovingOrphan(materialId);
    setActionError(null);
    try {
      await deleteOrphanedDocument(materialId);
      setDocumentStatuses((current) => current.filter((status) => status.materialId !== materialId));
    } catch {
      setActionError("Der Eintrag konnte nicht entfernt werden. Bitte versuche es erneut.");
    } finally {
      setRemovingOrphan(null);
    }
  }

  useEffect(() => {
    if (!hasUnfinishedDocuments) {
      pollAttemptsRef.current = 0;
      return;
    }
    let active = true;
    const timer = setInterval(() => {
      if (pollAttemptsRef.current >= STATUS_POLL_MAX_ATTEMPTS) {
        clearInterval(timer);
        return;
      }
      pollAttemptsRef.current += 1;
      refreshStatuses()
        .then(({ nextFiles, nextStatuses }) => {
          if (!active) return;
          setFiles(nextFiles);
          setDocumentStatuses(nextStatuses);
        })
        .catch(() => {});
    }, STATUS_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [hasUnfinishedDocuments, refreshStatuses]);

  function openDialog() {
    setSelectedFile(null);
    setTitleValue("");
    setDialogError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (uploading) return;
    setDialogOpen(false);
    setSelectedFile(null);
    setTitleValue("");
    setDialogError(null);
  }

  useEffect(() => {
    if (!dialogOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDialog();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, uploading]);

  function pickFile(file: File | undefined) {
    if (!file) return;
    const validation = validateDocumentFile(file);
    if (!validation.ok) {
      setSelectedFile(null);
      setTitleValue("");
      setDialogError(DOCUMENT_UPLOAD_ERROR_MESSAGES[validation.code]);
      return;
    }
    setSelectedFile(file);
    setTitleValue(splitName(file.name).base);
    setDialogError(null);
  }

  function handleDialogFileChange(event: ChangeEvent<HTMLInputElement>) {
    pickFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    pickFile(event.dataTransfer.files?.[0]);
  }

  async function handleUploadSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;
    setUploading(true);
    setDialogError(null);
    try {
      const named = renameFile(selectedFile, titleValue);
      const uploaded = await uploadCourseFile(courseId, named);
      setFiles((prev) => [uploaded, ...prev]);
      pollAttemptsRef.current = 0;
      const { nextStatuses } = await refreshStatuses();
      setDocumentStatuses(nextStatuses);
      setDialogOpen(false);
      setSelectedFile(null);
      setTitleValue("");
      showToast("success", `„${uploaded.name}" wurde erfolgreich hochgeladen.`);
    } catch (error) {
      setDialogError(uploadErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    const file = deleteTarget;
    if (!file) return;
    setActionError(null);
    setRemovingId(file.id);
    try {
      await deleteCourseFile(file.id);
      setFiles((prev) => prev.filter((entry) => entry.id !== file.id));
      setDocumentStatuses((prev) => prev.filter((status) => status.fileId !== file.id));
      setDeleteTarget(null);
      showToast("success", `„${file.name}" wurde gelöscht.`);
    } catch {
      setActionError("Der Dateieintrag konnte nicht entfernt werden.");
    } finally {
      setRemovingId(null);
    }
  }

  if (course === undefined) return <div className={styles.page}><p className={styles.loading} aria-live="polite">Unterlagen werden geladen …</p></div>;

  if (course === null) {
    return (
      <div className={styles.page}>
        <div className={styles.empty} role="alert">
          <h2>Kurs nicht verfügbar</h2>
          <p>{loadError ?? "Dieser Kurs existiert nicht oder du hast keinen Zugriff darauf."}</p>
          <Link href="/courses" className={styles.uploadButton}>Zurück zur Kursübersicht</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Link href={`/courses/${courseId}`} className={styles.backLink}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m11 5-6 7 6 7M5 12h14" /></svg>
        {course.title}
      </Link>

      <header className={styles.header}>
        <div>
          <h1>Unterlagen</h1>
          <p className={styles.subhead}>Verwalte und organisiere deine Lernmaterialien.</p>
        </div>
        <button type="button" className={styles.uploadButton} onClick={openDialog}>
          <span aria-hidden="true">+</span> Hochladen
        </button>
      </header>
      {actionError && <p className={styles.errorHint} role="alert">{actionError}</p>}

      {orphanedDocuments.length > 0 && (
        <section className={styles.orphanBox} aria-labelledby="orphan-heading">
          <h2 id="orphan-heading">Übrig gebliebene Einträge</h2>
          <p>
            Zu diesen Lerneinheiten gibt es keine Datei mehr. Sie zählen trotzdem als Quelle des
            Kurses und verhindern, dass eine Kurszusammenfassung erstellt werden kann.
          </p>
          <ul>
            {orphanedDocuments.map((status) => (
              <li key={status.materialId}>
                <span>{status.title}</span>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => void handleRemoveOrphan(status.materialId)}
                  disabled={removingOrphan === status.materialId}
                >
                  {removingOrphan === status.materialId ? "Wird entfernt …" : "Entfernen"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lectures.length > 0 && files.length > 0 && (
        <div className={styles.lectureFilter}>
          <label>
            <span>Vorlesung</span>
            <select value={lectureFilter} onChange={(event) => selectLectureFilter(event.target.value)}>
              <option value={LECTURE_FILTER_ALL}>Alle Unterlagen</option>
              {lectures.map((lecture) => (
                <option key={lecture.id} value={lecture.id}>{lecture.title}</option>
              ))}
              <option value={LECTURE_FILTER_NONE}>Ohne Vorlesung</option>
            </select>
          </label>
        </div>
      )}

      {files.length === 0 ? (
        <div className={styles.empty}>
          <h2>Noch keine Unterlagen.</h2>
          <p>Lade Vorlesungsfolien oder Notizen hoch, um sie diesem Kurs zuzuordnen.</p>
          <button type="button" className={styles.uploadButton} onClick={openDialog}>
            <span aria-hidden="true">+</span> Hochladen
          </button>
        </div>
      ) : visibleFiles.length === 0 ? (
        <div className={styles.empty}>
          <h2>Keine Unterlagen in dieser Auswahl.</h2>
          <button type="button" className={styles.textButton} onClick={() => selectLectureFilter(LECTURE_FILTER_ALL)}>
            Alle Unterlagen anzeigen
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {visibleFiles.map(({ file, progress }) => {
            const docStatus = statusByFile.get(file.id);
            const stage = retryStage(file.status, docStatus ?? null);
            return (
            <article key={file.id} className={styles.cardWrap}>
              <Link href={`/courses/${courseId}/documents/${file.id}`} className={styles.cardLink}>
                <div className={styles.thumb}>
                  <span className={styles.thumbType}>{EXTENSION_LABELS[file.type] ?? "Datei"}</span>
                  <span className={styles.thumbPage} aria-hidden="true">
                    <span className={styles.thumbCorner} />
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" /><path d="M13.6 3.6V8h4.3M9 12.5h6M9 16h4" /></svg>
                  </span>
                </div>
                <p className={styles.title}>{file.name}</p>
                <p className={styles.size}>{formatSize(file.size)}</p>
                <div className={styles.badges}>
                  <span className={styles.badge} data-tone={TONE_MAP[progress.tone]}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
                    {TONE_LABELS[progress.tone]}
                  </span>
                  {docStatus?.lectureId && lectureTitleById.has(docStatus.lectureId) && (
                    <span className={styles.badge} data-tone="purple">{lectureTitleById.get(docStatus.lectureId)}</span>
                  )}
                </div>
                {progress.detail && <p className={styles.badgeDetail}>{progress.detail}</p>}
                <p className={styles.uploaded}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
                  Hochgeladen {formatRelative(file.createdAt)}
                </p>
              </Link>
              {docStatus && stage && (
                <div className={styles.retryRow}>
                  <DocumentRetryButton
                    documentId={docStatus.documentId}
                    stage={stage}
                    onRestarted={handleRetryRestarted}
                    className={styles.viewerLink}
                    errorClassName={styles.errorHint}
                  />
                </div>
              )}
              <button
                type="button"
                className={styles.deleteButton}
                onClick={() => setDeleteTarget(file)}
                disabled={removingId === file.id}
                aria-label={`${file.name} löschen`}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9L6 7Z" /><path d="M10 11v6M14 11v6" /></svg>
              </button>
            </article>
            );
          })}
        </div>
      )}

      {dialogOpen && (
        <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="upload-document-heading">
            <div className={styles.dialogHeader}>
              <div>
                <h2 id="upload-document-heading">Dokument hochladen</h2>
                <p className={styles.dialogSubhead}>Füge diesem Kurs ein neues Dokument hinzu.</p>
              </div>
              <button type="button" className={styles.closeButton} aria-label="Schließen" onClick={closeDialog}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>
            <form onSubmit={handleUploadSubmit}>
              <div className={styles.field}>
                <label htmlFor="document-title">Dokumenttitel</label>
                <input
                  id="document-title"
                  value={titleValue}
                  onChange={(event) => setTitleValue(event.target.value)}
                  placeholder="z. B. Vorlesung 3 Notizen"
                  disabled={uploading}
                  required
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="document-file">Datei</label>
                <div
                  className={styles.dropzone}
                  data-active={dragActive}
                  onClick={() => !uploading && dialogFileInputRef.current?.click()}
                  onDragOver={(event) => { event.preventDefault(); if (!uploading) setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={uploading ? undefined : handleDrop}
                  role="button"
                  tabIndex={0}
                >
                  <span className={styles.dropzoneIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
                  </span>
                  {uploading ? (
                    <>
                      <p className={styles.dropzoneFile}>Wird hochgeladen …</p>
                      <div className={styles.progressTrack}><div className={styles.progressFill} /></div>
                    </>
                  ) : selectedFile ? (
                    <>
                      <p className={styles.dropzoneFile}>{selectedFile.name}</p>
                      <small>{DOCUMENT_UPLOAD_HINT}</small>
                    </>
                  ) : (
                    <>
                      <p>Datei hierher ziehen oder klicken zum Auswählen</p>
                      <small>{DOCUMENT_UPLOAD_HINT}</small>
                    </>
                  )}
                  <input
                    ref={dialogFileInputRef}
                    id="document-file"
                    className={styles.dropzoneHidden}
                    type="file"
                    accept={DOCUMENT_UPLOAD_ACCEPT}
                    onChange={handleDialogFileChange}
                    disabled={uploading}
                  />
                </div>
              </div>
              {dialogError && <p className={styles.errorHint} role="alert">{dialogError}</p>}
              <div className={styles.dialogFooter}>
                <button type="button" className={styles.cancelButton} onClick={closeDialog} disabled={uploading}>Abbrechen</button>
                <button type="submit" className={styles.submitButton} disabled={uploading || !selectedFile}>
                  {uploading ? "Wird hochgeladen …" : "Hochladen"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}>
          <div className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-document-heading">
            <span className={styles.confirmIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9L6 7Z" /><path d="M10 11v6M14 11v6" /></svg>
            </span>
            <h2 id="delete-document-heading">Dokument löschen?</h2>
            <p>„{deleteTarget.name}&quot; wird endgültig entfernt. Das kann nicht rückgängig gemacht werden.</p>
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.cancelButton} onClick={() => setDeleteTarget(null)} disabled={removingId === deleteTarget.id}>Abbrechen</button>
              <button type="button" className={styles.dangerButton} onClick={() => void confirmDelete()} disabled={removingId === deleteTarget.id}>
                {removingId === deleteTarget.id ? "Wird gelöscht …" : "Löschen"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={styles.toast} data-tone={toast.tone} role="status">
          <span className={styles.toastIcon} aria-hidden="true">
            {toast.tone === "success" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
            )}
          </span>
          <span>{toast.message}</span>
          <button type="button" className={styles.toastClose} aria-label="Meldung schließen" onClick={() => setToast(null)}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
