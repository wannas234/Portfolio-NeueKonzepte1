import type { Tables } from "../database.types";

export type CalendarEventKind =
  | "lecture"
  | "exercise"
  | "study"
  | "presentation"
  | "exam"
  | "deadline"
  | "other";

export type CalendarEvent = {
  id: string;
  ownerId: string;
  courseId: string | null;
  title: string;
  description: string;
  kind: CalendarEventKind;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CalendarEventInput = {
  courseId: string | null;
  title: string;
  description: string;
  kind: CalendarEventKind;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
};

type CalendarEventRow = Tables<"calendar_events">;

export function mapEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    ownerId: row.owner_id,
    courseId: row.course_id,
    title: row.title,
    description: row.description ?? "",
    kind: row.kind as CalendarEventKind,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
