"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteCourse, getCourse, type Course } from "@/lib/supabase/queries/courses";
import {
  deleteCourseFile,
  getCourseFileDownloadUrl,
  listCourseFiles,
  uploadCourseFile,
  type CourseFile,
} from "@/lib/supabase/queries/files";
import {
  indexDocumentStatusesByFile,
  listCourseDocumentStatuses,
  type CourseDocumentStatus,
} from "@/lib/supabase/queries/documents";
import { deriveCourseBadge } from "@/lib/courseBadge";
import DocumentIndexingStatus from "./DocumentIndexingStatus";
import DocumentRetryButton from "./DocumentRetryButton";
import { describeIndexingProgress, retryStage, STATUS_POLL_INTERVAL_MS, STATUS_POLL_MAX_ATTEMPTS } from "./documentIndexing";
import {
  DOCUMENT_UPLOAD_ACCEPT,
  DOCUMENT_UPLOAD_ERROR_MESSAGES,
  DOCUMENT_UPLOAD_HINT,
  validateDocumentFile,
} from "@/lib/documentUpload";
import CourseFactsEditor from "./CourseFactsEditor";
import CourseOpenNotes from "./CourseOpenNotes";
import CourseLectures from "./CourseLectures";
import styles from "./coursesList.module.css";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

export default function CourseDetailClient({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [course, setCourse] = useState<Course | null | undefined>(undefined);
  const [files, setFiles] = useState<CourseFile[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [documentStatuses, setDocumentStatuses] = useState<CourseDocumentStatus[]>([]);
  const pollAttemptsRef = useRef(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [titleValue, setTitleValue] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const dialogFileInputRef = useRef<HTMLInputElement>(null);

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

  const statusByFile = useMemo(
    () => indexDocumentStatusesByFile(documentStatuses),
    [documentStatuses]
  );

  const fileProgress = useMemo(
    () =>
      files.map((file) => ({
        file,
        progress: describeIndexingProgress(file.status, statusByFile.get(file.id) ?? null),
      })),
    [files, statusByFile]
  );

  const hasUnfinishedDocuments = fileProgress.some((entry) => entry.progress.inProgress);

  const refreshStatuses = useCallback(async () => {
    const [nextFiles, nextStatuses] = await Promise.all([
      listCourseFiles(courseId),
      listCourseDocumentStatuses(courseId),
    ]);
    return { nextFiles, nextStatuses };
  }, [courseId]);

  // Reloads the real status after a retry was started; the unfinished document then
  // keeps the polling below running until it is ready or failed again.
  async function handleRetryRestarted() {
    const { nextFiles, nextStatuses } = await refreshStatuses();
    setFiles(nextFiles);
    setDocumentStatuses(nextStatuses);
  }

  // Poll while at least one document is still being verified, extracted or
  // indexed. Navigating away or reaching a final state stops the interval.
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
        .catch(() => {
          // A transient status request failure is not worth an error banner;
          // the next tick retries.
        });
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
      // A fresh upload starts its own pipeline run; allow the full poll budget.
      pollAttemptsRef.current = 0;
      const { nextStatuses } = await refreshStatuses();
      setDocumentStatuses(nextStatuses);
      setDialogOpen(false);
      setSelectedFile(null);
      setTitleValue("");
    } catch (error) {
      setDialogError(uploadErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(file: CourseFile) {
    setActionError(null);
    try {
      const url = await getCourseFileDownloadUrl(file.id, true);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setActionError(
        file.status === "ready"
          ? "Der Download konnte nicht gestartet werden."
          : "Diese Datei ist noch nicht zum Download bereit."
      );
    }
  }

  async function handleRemoveFile(id: string) {
    setActionError(null);
    setRemovingId(id);
    try {
      await deleteCourseFile(id);
      setFiles((prev) => prev.filter((file) => file.id !== id));
      setDocumentStatuses((prev) => prev.filter((status) => status.fileId !== id));
    } catch {
      setActionError("Der Dateieintrag konnte nicht entfernt werden.");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleDeleteCourse() {
    if (!window.confirm("Diesen Kurs wirklich löschen? Das kann nicht rückgängig gemacht werden.")) {
      return;
    }
    setActionError(null);
    try {
      await deleteCourse(courseId);
      router.push("/courses");
    } catch {
      setActionError("Der Kurs konnte nicht gelöscht werden.");
    }
  }

  if (course === undefined) return null;

  if (course === null) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <h2>{loadError ? "Kurs nicht verfügbar" : "Kurs nicht gefunden"}</h2>
          <p>{loadError ?? "Dieser Kurs existiert nicht oder du hast keinen Zugriff darauf."}</p>
          <Link href="/courses" className={styles.createButton}>
            Zurück zur Kursübersicht
          </Link>
        </div>
      </div>
    );
  }

  const badge = deriveCourseBadge(course.title);

  return (
    <div className={styles.page}>
      <Link href="/courses" className={styles.backLink}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m11 5-6 7 6 7M5 12h14" /></svg>
        Zurück zur Kursübersicht
      </Link>

      <header className={styles.courseHeader}>
        <span className={styles.icon} data-tone={badge.color}>{badge.code}</span>
        <div>
          <h1>{course.title}</h1>
          <p className={styles.subhead}>{course.description || "Keine Beschreibung hinterlegt."}</p>
          {/* Optionale Kursangaben, direkt hier bearbeitbar. */}
          <CourseFactsEditor course={course} onSaved={setCourse} />
        </div>
      </header>

      <CourseLectures courseId={courseId} />
      <CourseOpenNotes courseId={courseId} />

      <div className={styles.toolGrid}>
        <Link href={`/courses/${courseId}/flashcards`} className={styles.toolCard}>
          <div className={styles.toolCardHead}>
            <span className={styles.toolIcon} data-tone="violet">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="13" height="15" rx="2.4" /><path d="M9 10h4M9 14h4" /></svg>
            </span>
            <span className={styles.toolArrow} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </div>
          <h3>Karteikarten</h3>
          <p>Aus deinem Vorlesungsmaterial lernen.</p>
        </Link>
        <Link href={`/courses/${courseId}/summaries`} className={styles.toolCard}>
          <div className={styles.toolCardHead}>
            <span className={styles.toolIcon} data-tone="blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h9l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>
            </span>
            <span className={styles.toolArrow} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </div>
          <h3>Zusammenfassung</h3>
          <p>Das Wesentliche aus deinen Vorlesungen.</p>
        </Link>
      </div>

      <section className={styles.uploadSection}>
        <div className={styles.sectionHead}>
          <h2>Vorlesungsfolien &amp; Übungen<span className={styles.tag}>{files.length}</span></h2>
          <button type="button" className={styles.uploadLabel} onClick={openDialog}>
            <span aria-hidden="true">+</span> Datei hochladen
          </button>
        </div>
        <p className={styles.uploadHint}>
          {DOCUMENT_UPLOAD_HINT}.
        </p>
        {actionError && <p className={styles.uploadHint} role="alert">{actionError}</p>}

        {files.length > 0 && (
          <ul className={styles.fileList}>
            {fileProgress.map(({ file, progress }) => (
              <li key={file.id} className={styles.fileRow}>
                {file.status === "ready" ? (
                  <button
                    type="button"
                    className={styles.fileName}
                    onClick={() => handleDownload(file)}
                    title="Herunterladen"
                  >
                    {file.name}
                  </button>
                ) : (
                  <span className={styles.fileName}>{file.name}</span>
                )}
                <DocumentIndexingStatus
                  fileName={file.name}
                  progress={progress}
                  action={(() => {
                    const docStatus = statusByFile.get(file.id);
                    const stage = retryStage(file.status, docStatus ?? null);
                    return docStatus && stage ? (
                      <DocumentRetryButton
                        documentId={docStatus.documentId}
                        stage={stage}
                        onRestarted={handleRetryRestarted}
                        className={styles.retryButton}
                        errorClassName={styles.indexDetail}
                      />
                    ) : null;
                  })()}
                />
                <small>{formatSize(file.size)}</small>
                <button
                  type="button"
                  className={styles.fileRemove}
                  aria-label={`${file.name} entfernen`}
                  onClick={() => handleRemoveFile(file.id)}
                  disabled={removingId === file.id}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9L6 7Z" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={styles.dangerZone}>
        <button
          type="button"
          className={styles.dangerLink}
          onClick={handleDeleteCourse}
        >
          Kurs löschen
        </button>
      </div>

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
                <label htmlFor="course-document-title">Dokumenttitel</label>
                <input
                  id="course-document-title"
                  value={titleValue}
                  onChange={(event) => setTitleValue(event.target.value)}
                  placeholder="z. B. Vorlesung 3 Notizen"
                  disabled={uploading}
                  required
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="course-document-file">Datei</label>
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
                    id="course-document-file"
                    className={styles.dropzoneHidden}
                    type="file"
                    accept={DOCUMENT_UPLOAD_ACCEPT}
                    onChange={handleDialogFileChange}
                    disabled={uploading}
                  />
                </div>
              </div>
              {dialogError && <p className={styles.hint} role="alert">{dialogError}</p>}
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
    </div>
  );
}
