export type FilterableEvent = {
  courseId: string | null;
  kind: string;
  title: string;
};

export type EventFilters = {
  courseId: string | "all";
  kind: string | "all";
  query: string;
};

export const defaultFilters: EventFilters = { courseId: "all", kind: "all", query: "" };

export function matchesFilters<T extends FilterableEvent>(event: T, filters: EventFilters): boolean {
  if (filters.courseId !== "all") {
    // "" means "private events (no course)", which is stored as `null`.
    const wantedCourseId = filters.courseId === "" ? null : filters.courseId;
    if (event.courseId !== wantedCourseId) return false;
  }
  if (filters.kind !== "all" && event.kind !== filters.kind) return false;
  const query = filters.query.trim().toLocaleLowerCase("de-DE");
  if (query && !event.title.toLocaleLowerCase("de-DE").includes(query)) return false;
  return true;
}

export function filterEvents<T extends FilterableEvent>(events: T[], filters: EventFilters): T[] {
  return events.filter((event) => matchesFilters(event, filters));
}

export function hasActiveFilters(filters: EventFilters): boolean {
  return filters.courseId !== "all" || filters.kind !== "all" || filters.query.trim() !== "";
}
