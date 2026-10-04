"use client";

import type { Course } from "@/lib/supabase/queries/courses";
import type { CalendarEvent } from "@/lib/supabase/queries/calendar";
import { deriveCourseBadge } from "@/lib/courseBadge";
import { formatDateKey, formatEventWhen, localDateKey } from "./dateUtils";
import { useDialogA11y } from "@/components/useDialogA11y";
import { KIND_LABELS } from "./EventDialog";
import styles from "@/components/courses/coursesList.module.css";
import s from "./calendar.module.css";

/** Read-only detail card shown when a user clicks an event; leads into edit/delete. */
export default function EventCard({
  event,
  course,
  onClose,
  onEdit,
  onDelete,
}: {
  event: CalendarEvent;
  course: Course | undefined;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { containerRef, handleBackdropClick } = useDialogA11y({ onClose, disabled: false });
  const badge = course ? deriveCourseBadge(course.title) : null;

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div ref={containerRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="event-card-heading">
        <div className={styles.dialogHeader}>
          <h2 id="event-card-heading">{event.title}</h2>
          <button type="button" className={styles.closeButton} aria-label="Schließen" onClick={onClose}>✕</button>
        </div>

        <div className={s.cardBody}>
          <span className={s.kind} data-kind={event.kind}>{KIND_LABELS[event.kind]}</span>

          <dl className={s.cardFacts}>
            <div>
              <dt>Wann</dt>
              <dd>{formatDateKey(localDateKey(event.startsAt), { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {formatEventWhen(event.startsAt, event.endsAt, event.allDay)}</dd>
            </div>
            <div>
              <dt>Kurs</dt>
              <dd>
                {badge && <span className={s.courseDot} data-color={badge.color} aria-hidden="true" />}
                {course ? course.title : "Ohne Kurs"}
              </dd>
            </div>
            {event.description && (
              <div>
                <dt>Beschreibung</dt>
                <dd>{event.description}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className={s.cardActions}>
          <button type="button" className={styles.submitButton} onClick={onEdit}>Bearbeiten</button>
          <button type="button" className={`${styles.submitButton} ${s.dangerAction}`} onClick={onDelete}>Löschen</button>
        </div>
      </div>
    </div>
  );
}
