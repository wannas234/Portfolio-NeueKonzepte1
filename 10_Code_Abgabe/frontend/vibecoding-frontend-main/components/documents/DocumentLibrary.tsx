"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeading from "@/components/ui/PageHeading";
import { createClient } from "@/lib/supabase/browser";
import { LIBRARY_LIMIT, listLibraryDocuments, type LibraryDocument } from "@/lib/supabase/queries/library";
import DocumentRetryButton from "@/components/courses/DocumentRetryButton";
import { STATUS_POLL_INTERVAL_MS, STATUS_POLL_MAX_ATTEMPTS, type IndexingTone } from "@/components/courses/documentIndexing";
import {
  DEFAULT_FILTERS,
  applyFilters,
  courseOptions,
  documentTypeLabel,
  formatFileSize,
  hasActiveFilters,
  toEntries,
  type SortOrder,
  type StatusFilter,
} from "./libraryModel";
import s from "./library.module.css";

// Same wording as the per-course document views.
const TONE_LABELS: Record<IndexingTone, string> = {
  ready: "Bereit",
  active: "Wird analysiert",
  pending: "Warteschlange",
  failed: "Fehlgeschlagen",
};

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "ready", label: "Bereit" },
  { value: "processing", label: "In Verarbeitung" },
  { value: "failed", label: "Fehlgeschlagen" },
];

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "newest", label: "Neueste zuerst" },
  { value: "oldest", label: "Älteste zuerst" },
  { value: "name", label: "Name A–Z" },
];

type LibraryState = { status: "loading" } | { status: "error" } | { status: "ready"; documents: LibraryDocument[] };

function formatUploaded(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

export default function DocumentLibrary() {
  const [state, setState] = useState<LibraryState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  useEffect(() => {
    let active = true;
    listLibraryDocuments(createClient())
      .then((documents) => { if (active) setState({ status: "ready", documents }); })
      .catch(() => { if (active) setState({ status: "error" }); });
    return () => { active = false; };
  }, [attempt]);

  function reload() {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  // Reloads the real status without the loading skeleton (after a retry and while polling).
  const refresh = useCallback(async () => {
    const documents = await listLibraryDocuments(createClient());
    setState({ status: "ready", documents });
  }, []);

  const documents = state.status === "ready" ? state.documents : null;
  const entries = useMemo(() => (documents ? toEntries(documents) : []), [documents]);
  const courses = useMemo(() => (documents ? courseOptions(documents) : []), [documents]);
  const visible = useMemo(() => applyFilters(entries, filters), [entries, filters]);
  const hasUnfinished = entries.some(({ progress }) => progress.inProgress);

  // Follow the status while any document is still being processed (e.g. after a retry).
  useEffect(() => {
    if (!hasUnfinished) return;
    let attempts = 0;
    const timer = setInterval(() => {
      if (attempts >= STATUS_POLL_MAX_ATTEMPTS) {
        clearInterval(timer);
        return;
      }
      attempts += 1;
      refresh().catch(() => {
        // A transient status request failure is not worth an error banner; the next tick retries.
      });
    }, STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasUnfinished, refresh]);

  const total = documents?.length ?? 0;
  const filtersActive = hasActiveFilters(filters);

  return (
    <div className={s.page}>
      <PageHeading title="Unterlagen" description="Alle deine Lernmaterialien an einem Ort.">
        <Link href="/courses" className={s.uploadAction}>+ Unterlagen hochladen</Link>
      </PageHeading>

      {state.status === "error" && (
        <div className={s.notice} role="alert">
          <p>Deine Unterlagen konnten nicht geladen werden. Bitte versuche es erneut.</p>
          <button type="button" className={s.textButton} onClick={reload}>Erneut laden</button>
        </div>
      )}

      {state.status === "loading" && (
        <div role="status">
          <span className={s.srOnly}>Unterlagen werden geladen …</span>
          <div className={s.toolbarSkeleton} aria-hidden="true" />
          <ul className={s.list} aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <li key={index} className={s.skeletonRow} />)}
          </ul>
        </div>
      )}

      {documents && total === 0 && (
        <div className={s.empty}>
          <span className={s.emptyIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" /><path d="M13.6 3.6V8h4.3M9 12.5h6M9 16h6" /></svg>
          </span>
          <div className={s.emptyBody}>
            <strong>Du hast noch keine Unterlagen</strong>
            <p>Lade Vorlesungsmaterial in einem Kurs hoch. Hier findest du es dann kursübergreifend wieder.</p>
          </div>
          <Link href="/courses" className={s.ctaLink}>Zu deinen Kursen</Link>
        </div>
      )}

      {documents && total > 0 && (
        <>
          <div className={s.panel}>
          <div className={s.toolbar} role="search">
            <label className={s.searchField}>
              <span className={s.srOnly}>Unterlagen durchsuchen</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                type="search"
                value={filters.query}
                placeholder="Dateiname, Kurs oder Vorlesung suchen …"
                onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              />
            </label>
            <label className={s.selectField}>
              <span className={s.srOnly}>Kurs</span>
              <select value={filters.courseId} onChange={(event) => setFilters((current) => ({ ...current, courseId: event.target.value }))}>
                <option value="all">Alle Kurse</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
              </select>
            </label>
            <label className={s.selectField}>
              <span className={s.srOnly}>Sortierung</span>
              <select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as SortOrder }))}>
                {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <div className={s.statusFilter} role="group" aria-label="Nach Status filtern">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={s.filterButton}
                aria-pressed={filters.status === option.value}
                onClick={() => setFilters((current) => ({ ...current, status: option.value }))}
              >
                {option.label}
              </button>
            ))}
          </div>
          </div>

          <p className={s.summary} aria-live="polite">
            {filtersActive ? `${visible.length} von ${total} Unterlagen` : `${total} ${total === 1 ? "Unterlage" : "Unterlagen"}`}
            {total >= LIBRARY_LIMIT && ` · Es werden die neuesten ${LIBRARY_LIMIT} angezeigt.`}
          </p>

          {visible.length === 0 ? (
            <div className={s.empty}>
              <div className={s.emptyBody}>
                <strong>Keine passenden Unterlagen</strong>
                <p>Zu dieser Suche und diesen Filtern gibt es keine Dokumente.</p>
              </div>
              <button type="button" className={s.ctaButton} onClick={() => setFilters((current) => ({ ...DEFAULT_FILTERS, sort: current.sort }))}>
                Filter zurücksetzen
              </button>
            </div>
          ) : (
            <div>
            <div className={s.tableHead} aria-hidden="true"><span>Name</span><span>Kurs</span><span>Status</span><span>Größe</span><span>Hinzugefügt</span><span /></div>
            <ul className={s.list}>
              {visible.map(({ document, progress, retry }) => (
                <li key={document.fileId} className={s.item}>
                  <Link href={`/courses/${document.courseId}/documents/${document.fileId}`} className={s.row} data-status={progress.tone}>
                    <span className={s.body}>
                      <span className={s.type} aria-hidden="true">{documentTypeLabel(document.mimeType)}</span>
                      <span className={s.nameBody}>
                      <strong className={s.name} title={document.name}>{document.name}</strong>
                      {progress.tone === "failed" && progress.detail && <span className={s.detail}>{progress.detail}</span>}
                      </span>
                    </span>
                    <span className={s.meta} title={document.lectureTitle ? `${document.courseTitle} · ${document.lectureTitle}` : document.courseTitle}>
                      {document.courseTitle}
                      {document.lectureTitle && ` · ${document.lectureTitle}`}
                    </span>
                    <span className={s.chip} data-tone={progress.tone}>{TONE_LABELS[progress.tone]}</span>
                    <span className={s.meta}>{formatFileSize(document.sizeBytes)}</span>
                    <span className={s.meta}>{formatUploaded(document.uploadedAt)}</span>
                    <svg className={s.chevron} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                  </Link>
                  {retry && (
                    <div className={s.retryRow}>
                      <DocumentRetryButton
                        documentId={document.documentId}
                        stage={retry}
                        onRestarted={refresh}
                        className={s.retryButton}
                        errorClassName={s.retryError}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
