import { createClient } from "@/lib/supabase/browser";
import { mapEvent, type CalendarEvent, type CalendarEventInput } from "./calendar-map";

export type { CalendarEvent, CalendarEventInput, CalendarEventKind } from "./calendar-map";

const COLUMNS =
  "id, owner_id, course_id, title, description, kind, starts_at, ends_at, all_day, created_at, updated_at";

export async function listEvents(): Promise<CalendarEvent[]> {
  const { data, error } = await createClient()
    .from("calendar_events")
    .select(COLUMNS)
    .order("starts_at", { ascending: true });

  if (error) throw error;
  return data.map(mapEvent);
}

export async function createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Nicht angemeldet.");

  const { data, error } = await supabase
    .from("calendar_events")
    .insert({
      owner_id: userData.user.id,
      course_id: input.courseId,
      title: input.title,
      description: input.description,
      kind: input.kind,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      all_day: input.allDay,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapEvent(data);
}

export async function updateEvent(id: string, input: CalendarEventInput): Promise<CalendarEvent> {
  const { data, error } = await createClient()
    .from("calendar_events")
    .update({
      course_id: input.courseId,
      title: input.title,
      description: input.description,
      kind: input.kind,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      all_day: input.allDay,
    })
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapEvent(data);
}

export async function deleteEvent(id: string): Promise<void> {
  // Without .select(), a delete that matches zero rows (wrong id, or the row
  // is hidden by RLS) still reports no error - it would silently look like
  // success. Request the deleted row back and fail loudly if none came back.
  const { data, error } = await createClient()
    .from("calendar_events")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Kein Termin gelöscht.");
}
