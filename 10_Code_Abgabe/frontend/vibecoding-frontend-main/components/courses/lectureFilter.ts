// Filter der Unterlagenliste nach Vorlesung. Reine Logik, damit sie ohne React testbar ist.

/** `all` = alles, `none` = ohne Vorlesung, sonst die ID einer Vorlesung. */
export type LectureFilter = "all" | "none" | (string & {});

export const LECTURE_FILTER_ALL = "all";
export const LECTURE_FILTER_NONE = "none";

/** Eine Vorlesungs-ID aus der URL gilt nur, wenn es die Vorlesung im Kurs gibt. */
export function resolveLectureFilter(
  requested: string | null | undefined,
  lectures: { id: string }[]
): LectureFilter {
  if (!requested) return LECTURE_FILTER_ALL;
  if (requested === LECTURE_FILTER_NONE) return LECTURE_FILTER_NONE;
  return lectures.some((lecture) => lecture.id === requested) ? requested : LECTURE_FILTER_ALL;
}

/** Query-String für die Unterlagen-Seite; `all` ist der Normalfall und steht nicht in der URL. */
export function lectureFilterSearch(filter: LectureFilter): string {
  return filter === LECTURE_FILTER_ALL ? "" : `?lecture=${encodeURIComponent(filter)}`;
}

/** Gleiche Reihenfolge wie `listLectures`: nach Termin, ohne Termin zuletzt, sonst nach Anlage. */
export function sortLectures<T extends { heldOn: string | null; createdAt: string }>(lectures: T[]): T[] {
  return [...lectures].sort((a, b) => {
    if (a.heldOn !== b.heldOn) {
      if (!a.heldOn) return 1;
      if (!b.heldOn) return -1;
      return a.heldOn < b.heldOn ? -1 : 1;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

export function matchesLectureFilter(lectureId: string | null | undefined, filter: LectureFilter): boolean {
  if (filter === LECTURE_FILTER_ALL) return true;
  if (filter === LECTURE_FILTER_NONE) return !lectureId;
  return lectureId === filter;
}

/** Anzahl Unterlagen je Vorlesung; Einträge ohne Vorlesung werden nicht gezählt. */
export function countByLecture(rows: { lectureId: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.lectureId) counts.set(row.lectureId, (counts.get(row.lectureId) ?? 0) + 1);
  }
  return counts;
}

/** Das Backend meldet eine fremde oder kursfremde Vorlesung mit `LECTURE_NOT_FOUND`. */
export function isLectureNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { message, details } = error as { message?: unknown; details?: unknown };
  return [message, details].some((value) => typeof value === "string" && value.includes("LECTURE_NOT_FOUND"));
}
