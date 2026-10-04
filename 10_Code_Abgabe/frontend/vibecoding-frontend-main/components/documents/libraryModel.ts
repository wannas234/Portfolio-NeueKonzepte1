import type { LibraryDocument } from "../../lib/supabase/queries/library";
import { describeIndexingProgress, retryStage, type IndexingProgress, type RetryStage } from "../courses/documentIndexing";

// Pure view-model logic of the global document library: status semantics, search,
// filters and sorting. Everything is deterministic and works on the loaded documents.

export type StatusGroup = "ready" | "processing" | "failed";
export type StatusFilter = "all" | StatusGroup;
export type SortOrder = "newest" | "oldest" | "name";

export type LibraryFilters = {
  query: string;
  /** A course id, or "all". */
  courseId: string;
  status: StatusFilter;
  sort: SortOrder;
};

export const DEFAULT_FILTERS: LibraryFilters = { query: "", courseId: "all", status: "all", sort: "newest" };

export type LibraryEntry = {
  document: LibraryDocument;
  /** The same status the course document views show. */
  progress: IndexingProgress;
  group: StatusGroup;
  retry: RetryStage | null;
};

/**
 * Filter groups derived from the existing status semantics (describeIndexingProgress),
 * not a second definition: failed stays failed, ready stays ready, everything else
 * (waiting, extracting, indexing, deleting) is "processing".
 */
export function statusGroup(progress: IndexingProgress): StatusGroup {
  if (progress.tone === "failed") return "failed";
  if (progress.tone === "ready") return "ready";
  return "processing";
}

export function toEntries(documents: LibraryDocument[]): LibraryEntry[] {
  return documents.map((document) => {
    const progress = describeIndexingProgress(document.fileStatus, document.state);
    return { document, progress, group: statusGroup(progress), retry: retryStage(document.fileStatus, document.state) };
  });
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("de-DE");
}

/** Lower-cased search words; whitespace (any amount, also around) only separates them. */
export function searchTerms(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

/** Every search word must appear in the file name, the course title or the lecture title. */
function matchesTerms(document: LibraryDocument, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = normalize(`${document.name} ${document.courseTitle} ${document.lectureTitle ?? ""}`);
  return terms.every((term) => haystack.includes(term));
}

function compareNames(a: LibraryDocument, b: LibraryDocument): number {
  return a.name.localeCompare(b.name, "de-DE", { numeric: true, sensitivity: "base" });
}

function compareEntries(sort: SortOrder) {
  return (a: LibraryEntry, b: LibraryEntry): number => {
    const x = a.document;
    const y = b.document;
    const byTime = new Date(x.uploadedAt).getTime() - new Date(y.uploadedAt).getTime();
    // Ties always fall back to name and id, so the order never depends on input order.
    const tie = compareNames(x, y) || x.documentId.localeCompare(y.documentId);
    if (sort === "oldest") return byTime || tie;
    if (sort === "name") return compareNames(x, y) || -byTime || x.documentId.localeCompare(y.documentId);
    return -byTime || tie;
  };
}

/** Search, course and status filters combine with AND; sorting is applied last. */
export function applyFilters(entries: LibraryEntry[], filters: LibraryFilters): LibraryEntry[] {
  const terms = searchTerms(filters.query);
  return entries
    .filter(({ document, group }) =>
      (filters.courseId === "all" || document.courseId === filters.courseId)
      && (filters.status === "all" || group === filters.status)
      && matchesTerms(document, terms))
    .sort(compareEntries(filters.sort));
}

export function hasActiveFilters(filters: LibraryFilters): boolean {
  return searchTerms(filters.query).length > 0 || filters.courseId !== "all" || filters.status !== "all";
}

/** The courses that actually have documents, by title. */
export function courseOptions(documents: LibraryDocument[]): { id: string; title: string }[] {
  const byId = new Map(documents.map((document) => [document.courseId, document.courseTitle]));
  return [...byId.entries()]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title, "de-DE", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

const TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "text/plain": "TXT",
};

export function documentTypeLabel(mimeType: string): string {
  return TYPE_LABELS[mimeType] ?? "Datei";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
