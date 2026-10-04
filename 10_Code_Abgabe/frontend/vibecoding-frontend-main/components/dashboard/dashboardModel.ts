import type { DashboardDocument } from "../../lib/supabase/queries/dashboard";
import { describeIndexingProgress, type IndexingProgress } from "../courses/documentIndexing";

// Pure view-model logic for the dashboard. `now` is passed in (epoch ms) so the
// behaviour is deterministic; all day arithmetic uses the browser's local time zone,
// like the calendar.

type TimedEvent = { startsAt: string; endsAt: string | null; allDay: boolean };

function endOfLocalDay(iso: string): number {
  const date = new Date(iso);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/** When an event is over. An all-day event lasts until the end of its last local day. */
function eventEnd(event: TimedEvent): number {
  const last = event.endsAt ?? event.startsAt;
  return event.allDay ? endOfLocalDay(last) : new Date(last).getTime();
}

/** Events that have not finished yet (upcoming or ongoing), earliest start first. */
export function upcomingEvents<T extends TimedEvent>(events: T[], now: number, limit = Infinity): T[] {
  return events
    .filter((event) => eventEnd(event) >= now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, limit);
}

/** The earliest upcoming or ongoing event of each course. Events without a course are ignored. */
export function nextEventByCourse<T extends TimedEvent & { courseId: string | null }>(
  events: T[],
  now: number
): Map<string, T> {
  const next = new Map<string, T>();
  for (const event of upcomingEvents(events, now)) {
    if (event.courseId && !next.has(event.courseId)) next.set(event.courseId, event);
  }
  return next;
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Läuft" (started on an earlier day), "Heute", "Morgen" or a short weekday and date. */
export function eventDayLabel(startsAt: string, now: number): string {
  const start = new Date(startsAt);
  const days = Math.round((startOfLocalDay(start) - startOfLocalDay(new Date(now))) / 86_400_000);
  if (days < 0) return "Läuft";
  if (days === 0) return "Heute";
  if (days === 1) return "Morgen";
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" }).format(start);
}

/** The newest documents first, limited. */
export function recentDocuments(documents: DashboardDocument[], limit = 5): DashboardDocument[] {
  return [...documents]
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    .slice(0, limit);
}

export type AttentionItem = { document: DashboardDocument; progress: IndexingProgress };

/**
 * Documents that need attention: still being processed/indexed or failed. Uses the
 * same status semantics as the document views. Failed documents come first; the
 * input order is kept within each group. `total` counts before the limit.
 */
export function attentionDocuments(
  documents: DashboardDocument[],
  limit = 5
): { items: AttentionItem[]; total: number } {
  const relevant = documents
    .map((document) => ({ document, progress: describeIndexingProgress("ready", document.state) }))
    .filter(({ progress }) => progress.tone === "failed" || progress.inProgress);
  const failed = relevant.filter(({ progress }) => progress.tone === "failed");
  const running = relevant.filter(({ progress }) => progress.tone !== "failed");
  return { items: [...failed, ...running].slice(0, limit), total: relevant.length };
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
