"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Course } from "@/lib/supabase/queries/courses";
import type { CalendarEvent, CalendarEventInput, CalendarEventKind } from "@/lib/supabase/queries/calendar";
import { formToIso, isoToFormDate, isoToFormTime, startOfDayIso, endOfDayIso, type DateKey } from "./dateUtils";
import { useDialogA11y } from "@/components/useDialogA11y";
import styles from "@/components/courses/coursesList.module.css";

export const KIND_LABELS: Record<CalendarEventKind, string> = {
  lecture: "Vorlesung",
  exercise: "Übung",
  study: "Lernsession",
  presentation: "Präsentation",
  exam: "Prüfung",
  deadline: "Abgabe",
  other: "Sonstiges",
};

export default function EventDialog({
  courses,
  initial,
  initialDate,
  onClose,
  onSave,
}: {
  courses: Course[];
  initial?: CalendarEvent;
  initialDate?: DateKey;
  onClose: () => void;
  onSave: (input: CalendarEventInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [date, setDate] = useState(initial ? isoToFormDate(initial.startsAt) : initialDate ?? "");
  const [time, setTime] = useState(initial ? isoToFormTime(initial.startsAt) : "09:00");
  const [hasEnd, setHasEnd] = useState(Boolean(initial?.endsAt));
  const [endDate, setEndDate] = useState(initial?.endsAt ? isoToFormDate(initial.endsAt) : "");
  const [endTime, setEndTime] = useState(initial?.endsAt ? isoToFormTime(initial.endsAt) : "");
  const [courseId, setCourseId] = useState<string>(initial?.courseId ?? "");
  const [kind, setKind] = useState<CalendarEventKind>(initial?.kind ?? "lecture");
  const [description, setDescription] = useState(initial?.description ?? "");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { containerRef, handleBackdropClick } = useDialogA11y({ onClose, disabled: saving });

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  function toggleHasEnd(next: boolean) {
    setHasEnd(next);
    if (next && !endDate) {
      setEndDate(date);
      setEndTime(time);
    }
  }

  const startIso = allDay ? (date ? startOfDayIso(date) : null) : date && time ? formToIso(date, time) : null;
  const endIso = allDay
    ? hasEnd && endDate ? endOfDayIso(endDate) : null
    : hasEnd && endDate && endTime ? formToIso(endDate, endTime) : null;
  const endValid = !hasEnd || (
    allDay
      ? Boolean(endDate) && endDate >= date
      : Boolean(endDate && endTime && startIso && endIso && new Date(endIso).getTime() > new Date(startIso).getTime())
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!title.trim() || !startIso || !endValid) return;

    setSaving(true);
    setError(null);
    try {
      await onSave({
        courseId: courseId || null,
        title: title.trim(),
        description: description.trim(),
        kind,
        startsAt: startIso,
        endsAt: endIso,
        allDay,
      });
    } catch {
      setError("Der Termin konnte nicht gespeichert werden. Bitte versuche es erneut.");
      setSaving(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div ref={containerRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="event-dialog-heading">
        <div className={styles.dialogHeader}>
          <h2 id="event-dialog-heading">{initial ? "Termin bearbeiten" : "Termin anlegen"}</h2>
          <button type="button" className={styles.closeButton} aria-label="Schließen" onClick={onClose} disabled={saving}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="event-title">Titel</label>
            <input
              id="event-title"
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="z. B. Vorlesung Netzwerksicherheit"
              required
              disabled={saving}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="event-all-day">
              <input
                id="event-all-day"
                type="checkbox"
                checked={allDay}
                onChange={(event) => setAllDay(event.target.checked)}
                disabled={saving}
                style={{ width: "auto", display: "inline-block", marginRight: 8 }}
              />
              Ganztägig
            </label>
          </div>
          <div className={styles.field}>
            <label htmlFor="event-date">Startdatum</label>
            <input
              id="event-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
              disabled={saving}
            />
          </div>
          {!allDay && (
            <div className={styles.field}>
              <label htmlFor="event-time">Startzeit</label>
              <input
                id="event-time"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                required
                disabled={saving}
              />
            </div>
          )}
          <div className={styles.field}>
            <label htmlFor="event-has-end">
              <input
                id="event-has-end"
                type="checkbox"
                checked={hasEnd}
                onChange={(event) => toggleHasEnd(event.target.checked)}
                disabled={saving}
                style={{ width: "auto", display: "inline-block", marginRight: 8 }}
              />
              {allDay ? "Über mehrere Tage" : "Ende festlegen"}
            </label>
          </div>
          {hasEnd && (
            <>
              <div className={styles.field}>
                <label htmlFor="event-end-date">Enddatum</label>
                <input
                  id="event-end-date"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  required={hasEnd}
                  disabled={saving}
                  aria-invalid={!endValid}
                  aria-describedby="event-end-hint"
                />
              </div>
              {!allDay && (
                <div className={styles.field}>
                  <label htmlFor="event-end-time">Endzeit</label>
                  <input
                    id="event-end-time"
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    required={hasEnd}
                    disabled={saving}
                    aria-invalid={!endValid}
                    aria-describedby="event-end-hint"
                  />
                </div>
              )}
              <p id="event-end-hint" className={styles.hint}>
                {allDay ? "Das Enddatum darf nicht vor dem Startdatum liegen." : "Das Ende muss nach dem Start liegen."}
              </p>
            </>
          )}
          <div className={styles.field}>
            <label htmlFor="event-kind">Art</label>
            <select
              id="event-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as CalendarEventKind)}
              disabled={saving}
            >
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="event-course">Kurs</label>
            <select
              id="event-course"
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              disabled={saving}
            >
              <option value="">Kein Kurs</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="event-description">Beschreibung</label>
            <textarea
              id="event-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optionaler Kontext zum Termin"
              disabled={saving}
            />
          </div>
          {error && <p className={styles.hint} role="alert">{error}</p>}
          <button type="submit" className={styles.submitButton} disabled={saving}>
            {saving ? "Wird gespeichert …" : initial ? "Änderungen speichern" : "Termin erstellen"}
          </button>
        </form>
      </div>
    </div>
  );
}
