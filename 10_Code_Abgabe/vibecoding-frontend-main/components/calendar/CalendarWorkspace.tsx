"use client";

import { useEffect, useState } from "react";
import PageHeading from "@/components/ui/PageHeading";
import s from "./calendar.module.css";
import { listCourses, type Course } from "@/lib/supabase/queries/courses";
import {
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
  type CalendarEvent,
  type CalendarEventInput,
} from "@/lib/supabase/queries/calendar";
import { deriveCourseBadge } from "@/lib/courseBadge";
import EventDialog, { KIND_LABELS } from "./EventDialog";
import EventCard from "./EventCard";
import {
  addMonths,
  buildMonthGrid,
  compareByStart,
  eventTouchesDay,
  formatDateKey,
  formatEventWhen,
  formatMonthLabel,
  isUpcomingOrOngoing,
  localDateKey,
  monthKeyOf,
  monthStartKey,
  todayKey,
  type DateKey,
} from "./dateUtils";
import { defaultFilters, filterEvents, hasActiveFilters, type EventFilters } from "./eventFilters";

function EventList({
  items,
  courseById,
  onOpen,
  onDelete,
}: {
  items: CalendarEvent[];
  courseById: Map<string, Course>;
  onOpen: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
}) {
  return <ol className={s.eventList}>{items.map((event) => {
    const course = event.courseId ? courseById.get(event.courseId) : undefined;
    const badge = course ? deriveCourseBadge(course.title) : null;
    return (
      <li key={event.id}>
        <time className={s.eventTime} dateTime={event.startsAt}>{formatEventWhen(event.startsAt, event.endsAt, event.allDay)}</time>
        <button type="button" className={s.eventOpenArea} onClick={() => onOpen(event)}>
          <span className={s.kind} data-kind={event.kind}>{KIND_LABELS[event.kind]}</span>
          <h3>{event.title}</h3>
          <p>
            {badge && <span className={s.courseDot} data-color={badge.color} aria-hidden="true" />}
            {course ? course.title : "Ohne Kurs"}
          </p>
          {event.description && <small>{event.description}</small>}
        </button>
        <div className={s.eventActions}>
          <button type="button" onClick={() => onOpen(event)}>Ansehen</button>
          <button type="button" className={s.dangerAction} onClick={() => onDelete(event)}>Löschen</button>
        </div>
      </li>
    );
  })}</ol>;
}

export default function CalendarWorkspace() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewingEvent, setViewingEvent] = useState<CalendarEvent | undefined>(undefined);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | undefined>(undefined);
  const [filters, setFilters] = useState<EventFilters>(defaultFilters);

  const [month, setMonth] = useState(() => monthKeyOf(todayKey()));
  const [selected, setSelected] = useState<DateKey>(todayKey());

  function fetchData() {
    return Promise.all([listEvents(), listCourses()])
      .then(([nextEvents, nextCourses]) => {
        setEvents(nextEvents);
        setCourses(nextCourses);
      })
      .catch(() => {
        setLoadError("Dein Kalender konnte nicht geladen werden. Bitte versuche es erneut.");
      })
      .finally(() => {
        setLoading(false);
      });
  }

  function loadData() {
    setLoading(true);
    setLoadError(null);
    fetchData();
  }

  useEffect(() => {
    fetchData();
  }, []);

  const courseById = new Map(courses.map((course) => [course.id, course]));
  const visibleEvents = filterEvents(events, filters);

  const days = buildMonthGrid(month);
  const monthEvents = visibleEvents.filter((event) => days.some((day) => monthKeyOf(day) === month && eventTouchesDay(event.startsAt, event.endsAt, day)));
  const selectedEvents = visibleEvents
    .filter((event) => eventTouchesDay(event.startsAt, event.endsAt, selected))
    .sort(compareByStart);
  const upcoming = visibleEvents
    .filter((event) => isUpcomingOrOngoing(event.startsAt, event.endsAt))
    .sort(compareByStart)
    .slice(0, 6);
  const monthLabel = formatMonthLabel(month);
  const today = todayKey();

  function changeMonth(delta: number) {
    const next = addMonths(month, delta);
    setMonth(next);
    setSelected(monthStartKey(next));
  }

  function goToToday() {
    setMonth(monthKeyOf(today));
    setSelected(today);
  }

  function selectDay(day: DateKey) {
    setSelected(day);
    if (monthKeyOf(day) !== month) setMonth(monthKeyOf(day));
  }

  async function handleCreate(input: CalendarEventInput) {
    setActionError(null);
    try {
      const created = await createEvent(input);
      setEvents((prev) => [...prev, created]);
      setDialogOpen(false);
      setStatusMessage(`„${created.title}“ wurde angelegt.`);
    } catch {
      setActionError("Der Termin konnte nicht angelegt werden.");
      throw new Error("create-event-failed");
    }
  }

  async function handleUpdate(input: CalendarEventInput) {
    if (!editingEvent) return;
    setActionError(null);
    try {
      const updated = await updateEvent(editingEvent.id, input);
      setEvents((prev) => prev.map((event) => (event.id === updated.id ? updated : event)));
      setEditingEvent(undefined);
      setStatusMessage(`„${updated.title}“ wurde aktualisiert.`);
    } catch {
      setActionError("Der Termin konnte nicht gespeichert werden.");
      throw new Error("update-event-failed");
    }
  }

  async function handleDelete(event: CalendarEvent) {
    if (!window.confirm(`„${event.title}“ wirklich löschen?`)) return;
    setActionError(null);
    try {
      await deleteEvent(event.id);
      setEvents((prev) => prev.filter((item) => item.id !== event.id));
      setViewingEvent((current) => (current?.id === event.id ? undefined : current));
      setStatusMessage(`„${event.title}“ wurde gelöscht.`);
    } catch {
      setActionError("Der Termin konnte nicht gelöscht werden.");
    }
  }

  if (loading) {
    return <div className={s.page} aria-live="polite">Dein Kalender wird geladen …</div>;
  }

  if (loadError && events.length === 0) {
    return (
      <div className={s.page}>
        <div className={s.empty} role="alert">
          <h2>Kalender nicht verfügbar</h2>
          <p>{loadError}</p>
          <button type="button" className={s.createButton} onClick={loadData}>Erneut versuchen</button>
        </div>
      </div>
    );
  }

  const kindOptions = Object.entries(KIND_LABELS);
  const courseOptions = [...new Set(events.filter((event) => event.courseId).map((event) => event.courseId!))]
    .map((id) => courseById.get(id))
    .filter((course): course is Course => Boolean(course));

  return (
    <div className={s.page}>
      <PageHeading title="Kalender" description={`Alle wichtigen Termine und Deadlines auf einen Blick. ${upcoming.length} anstehend.`}>
        <div className={s.mastheadActions}>
          <div className={s.todayBadge}><span>HEUTE</span><strong>{Number(today.slice(-2))}</strong><small>{formatDateKey(today, { month: "long", year: "numeric" })}</small></div>
          <button type="button" className={s.createButton} onClick={() => setDialogOpen(true)}>+ Termin hinzufügen</button>
        </div>
      </PageHeading>
      {actionError && <p className={s.errorHint} role="alert">{actionError}</p>}
      <p role="status" aria-live="polite" className={s.visuallyHidden}>{statusMessage}</p>

      <div className={s.filterBar} role="group" aria-label="Termine filtern">
        <div className={s.filterField}>
          <label htmlFor="calendar-filter-course">Kurs</label>
          <select id="calendar-filter-course" value={filters.courseId} onChange={(event) => setFilters((prev) => ({ ...prev, courseId: event.target.value }))}>
            <option value="all">Alle Kurse</option>
            <option value="">Ohne Kurs</option>
            {courseOptions.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
        </div>
        <div className={s.filterField}>
          <label htmlFor="calendar-filter-kind">Art</label>
          <select id="calendar-filter-kind" value={filters.kind} onChange={(event) => setFilters((prev) => ({ ...prev, kind: event.target.value }))}>
            <option value="all">Alle Arten</option>
            {kindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className={s.filterField}>
          <label htmlFor="calendar-filter-query">Suche</label>
          <input id="calendar-filter-query" type="search" value={filters.query} placeholder="Titel durchsuchen" onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))} />
        </div>
        {hasActiveFilters(filters) && (
          <button type="button" className={s.resetFilters} onClick={() => setFilters(defaultFilters)}>Filter zurücksetzen</button>
        )}
      </div>

      <div className={s.layout}>
        <div className={s.calendarColumn}>
          <section className={s.calendar} aria-labelledby="calendar-month">
            <header className={s.toolbar}>
              <div><p className={s.micro}>DEIN MONAT</p><h2 id="calendar-month" aria-live="polite" aria-atomic="true">{monthLabel}</h2></div>
              <div className={s.navigation}>
                <button type="button" onClick={goToToday}>Heute</button>
                <button type="button" aria-label="Vorheriger Monat" onClick={() => changeMonth(-1)}><span aria-hidden="true">‹</span></button>
                <button type="button" aria-label="Nächster Monat" onClick={() => changeMonth(1)}><span aria-hidden="true">›</span></button>
              </div>
            </header>
            <div className={s.desktopCalendar}>
              <table className={s.monthTable} aria-labelledby="calendar-month">
                <thead><tr>{["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"].map((day) => <th scope="col" key={day}><abbr title={day}>{day.slice(0, 2)}</abbr></th>)}</tr></thead>
                <tbody>{Array.from({ length: days.length / 7 }, (_, week) => (
                  <tr key={week}>{days.slice(week * 7, week * 7 + 7).map((day) => {
                    const dayEvents = visibleEvents.filter((event) => eventTouchesDay(event.startsAt, event.endsAt, day));
                    const remaining = dayEvents.length - 2;
                    return <td key={day} data-outside={monthKeyOf(day) !== month} data-selected={selected === day}>
                      <div className={s.dayCell}>
                        <button
                          type="button"
                          className={s.daySelect}
                          aria-pressed={selected === day}
                          aria-controls="calendar-day-details"
                          aria-label={`${formatDateKey(day, { dateStyle: "full" })}${day === today ? ", Heute" : ""}, ${dayEvents.length} Termine auswählen`}
                          onClick={() => selectDay(day)}
                        >
                          <span className={s.dayNumber} data-today={day === today}>{Number(day.slice(-2))}</span>
                        </button>
                        {dayEvents.slice(0, 2).map((event) => (
                          <button
                            type="button"
                            key={event.id}
                            className={s.calendarEvent}
                            data-kind={event.kind}
                            onClick={() => setViewingEvent(event)}
                            aria-label={`${event.title}, ${formatEventWhen(event.startsAt, event.endsAt, event.allDay)}, ${KIND_LABELS[event.kind]} — Termin öffnen`}
                          >
                            <span>{formatEventWhen(event.startsAt, event.endsAt, event.allDay)} · {KIND_LABELS[event.kind]}</span>
                            <strong>{event.title}</strong>
                          </button>
                        ))}
                        {remaining > 0 && <button type="button" className={s.more} onClick={() => selectDay(day)}>+{remaining} weitere{remaining === 1 ? "r Termin" : " Termine"}</button>}
                      </div>
                    </td>;
                  })}</tr>
                ))}</tbody>
              </table>
              <div className={s.calendarFoot}><span><i aria-hidden="true" /> Heute · {formatDateKey(today, { day: "numeric", month: "numeric" })}</span><span>Tag auswählen für Details</span></div>
            </div>
            <div className={s.agenda}>
              <p className={s.agendaLabel}>MONATSAGENDA</p>
              {[...new Set(days.filter((day) => monthKeyOf(day) === month).filter((day) => monthEvents.some((event) => eventTouchesDay(event.startsAt, event.endsAt, day))))].map((day) => <section key={day} className={s.agendaDay}>
                <h3><time dateTime={day}>{formatDateKey(day, { weekday: "long", day: "numeric", month: "long" })}</time>{day === today && <span>Heute</span>}</h3>
                <EventList items={monthEvents.filter((event) => eventTouchesDay(event.startsAt, event.endsAt, day))} courseById={courseById} onOpen={setViewingEvent} onDelete={handleDelete} />
              </section>)}
            </div>
            {monthEvents.length === 0 && (
              <p className={s.empty}>
                {hasActiveFilters(filters)
                  ? "Für diese Filterkombination sind in diesem Monat keine Termine vorhanden."
                  : `Für ${monthLabel} sind keine Termine eingetragen.`}
              </p>
            )}
          </section>
          <section id="calendar-day-details" className={s.dayDetails} aria-labelledby="selected-day-heading">
            <div className={s.sectionHeader}>
              <h2 id="selected-day-heading" aria-live="polite">{formatDateKey(selected, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2>
              <button type="button" className={s.createButton} onClick={() => setDialogOpen(true)}>+ Termin an diesem Tag</button>
            </div>
            {selectedEvents.length ? <EventList items={selectedEvents} courseById={courseById} onOpen={setViewingEvent} onDelete={handleDelete} /> : <p className={s.empty}>Für diesen Tag sind keine Termine eingetragen.</p>}
          </section>
        </div>
        <aside className={s.upcoming} aria-labelledby="upcoming-heading">
          <div className={s.sectionHeader}><h2 id="upcoming-heading">Als Nächstes</h2><small>{String(upcoming.length).padStart(2, "0")} TERMINE</small></div>
          <ol className={s.upcomingList}>{upcoming.map((event) => {
            const day = localDateKey(event.startsAt);
            return (
              <li key={event.id}>
                <button type="button" className={s.upcomingItem} onClick={() => setViewingEvent(event)}>
                  <time className={s.dateBadge} dateTime={day}><strong>{Number(day.slice(-2))}</strong><span>{formatDateKey(day, { month: "short" })}</span></time>
                  <div><span className={s.kind} data-kind={event.kind}>{KIND_LABELS[event.kind]}</span><h3>{event.title}</h3><p>{event.courseId ? courseById.get(event.courseId)?.title : "Ohne Kurs"}</p><time dateTime={event.startsAt}>{formatEventWhen(event.startsAt, event.endsAt, event.allDay)}</time></div>
                </button>
              </li>
            );
          })}</ol>
          {upcoming.length === 0 && (
            <p className={s.empty}>
              {hasActiveFilters(filters) ? "Keine anstehenden Termine für diese Filter." : "Keine anstehenden Termine."}
            </p>
          )}
        </aside>
      </div>
      {dialogOpen && (
        <EventDialog courses={courses} initialDate={selected} onClose={() => setDialogOpen(false)} onSave={handleCreate} />
      )}
      {viewingEvent && !editingEvent && (
        <EventCard
          event={viewingEvent}
          course={viewingEvent.courseId ? courseById.get(viewingEvent.courseId) : undefined}
          onClose={() => setViewingEvent(undefined)}
          onEdit={() => {
            setEditingEvent(viewingEvent);
            setViewingEvent(undefined);
          }}
          onDelete={() => handleDelete(viewingEvent)}
        />
      )}
      {editingEvent && (
        <EventDialog
          courses={courses}
          initial={editingEvent}
          onClose={() => setEditingEvent(undefined)}
          onSave={handleUpdate}
        />
      )}
    </div>
  );
}
