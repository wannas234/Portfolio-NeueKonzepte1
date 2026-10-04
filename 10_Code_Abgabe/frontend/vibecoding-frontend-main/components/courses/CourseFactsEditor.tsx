"use client";

import { useState, type FormEvent } from "react";
import { updateCourse, type Course } from "@/lib/supabase/queries/courses";
import styles from "./coursesList.module.css";

function formatGrade(value: number | null) {
  return value === null ? "" : value.toLocaleString("de-DE", { minimumFractionDigits: 1 });
}

/**
 * Bearbeitet einen Kurs: Titel und Beschreibung sowie Semester, Dozent/in und Zielnote
 * (Backend-Migration 20261004090000).
 *
 * Der Titel ist Pflicht, die übrigen Angaben sind optional. Leere Eingaben werden zu `null` — das Backend weist leere
 * oder reine Leerzeichen-Werte ab, deshalb wird hier nicht ein leerer String gespeichert.
 */
export default function CourseFactsEditor({
  course,
  onSaved,
}: {
  course: Course;
  onSaved: (next: Course) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description);
  const [semester, setSemester] = useState(course.semester ?? "");
  const [lecturer, setLecturer] = useState(course.lecturer ?? "");
  const [targetGrade, setTargetGrade] = useState(formatGrade(course.targetGrade));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasFacts = course.semester || course.lecturer || course.targetGrade !== null;

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Der Kurs braucht einen Titel.");
      return;
    }
    const parsed = Number.parseFloat(targetGrade.replace(",", "."));
    if (targetGrade.trim() && (!Number.isFinite(parsed) || parsed < 1 || parsed > 5)) {
      setError("Die Zielnote muss zwischen 1,0 und 5,0 liegen.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const next = await updateCourse(course.id, {
        title: title.trim(),
        description: description.trim(),
        semester: semester.trim() || null,
        lecturer: lecturer.trim() || null,
        targetGrade: targetGrade.trim() ? parsed : null,
      });
      onSaved(next);
      setEditing(false);
    } catch {
      setError("Die Angaben konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <p className={styles.courseFacts}>
        {course.semester && <span>{course.semester}</span>}
        {course.lecturer && <span>{course.lecturer}</span>}
        {course.targetGrade !== null && <span>Zielnote {formatGrade(course.targetGrade)}</span>}
        <button type="button" className={styles.factsEdit} onClick={() => setEditing(true)}>
          {hasFacts ? "Kurs bearbeiten" : "Kurs bearbeiten · Semester, Dozent/in, Zielnote ergänzen"}
        </button>
      </p>
    );
  }

  return (
    <form className={styles.factsForm} onSubmit={handleSave}>
      <label className={styles.factsWide}>
        <span>Titel</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required disabled={saving} />
      </label>
      <label className={styles.factsWide}>
        <span>Beschreibung</span>
        <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="Worum geht es in diesem Kurs?" disabled={saving} />
      </label>
      <label>
        <span>Semester</span>
        <input value={semester} onChange={(event) => setSemester(event.target.value)} maxLength={100} placeholder="WS 2026/27" disabled={saving} />
      </label>
      <label>
        <span>Dozent/in</span>
        <input value={lecturer} onChange={(event) => setLecturer(event.target.value)} maxLength={200} placeholder="Prof. Schmidt" disabled={saving} />
      </label>
      <label>
        <span>Zielnote</span>
        <input type="number" min={1} max={5} step={0.1} value={targetGrade} onChange={(event) => setTargetGrade(event.target.value)} placeholder="1,7" disabled={saving} />
      </label>
      {error && <p className={styles.hint} role="alert">{error}</p>}
      <div className={styles.factsFormActions}>
        <button type="button" className={styles.cancelButton} onClick={() => setEditing(false)} disabled={saving}>Abbrechen</button>
        <button type="submit" className={styles.submitButton} disabled={saving}>
          {saving ? "Wird gespeichert …" : "Speichern"}
        </button>
      </div>
    </form>
  );
}
