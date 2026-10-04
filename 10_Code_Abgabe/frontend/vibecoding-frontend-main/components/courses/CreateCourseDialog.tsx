"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./coursesList.module.css";

export default function CreateCourseDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: {
    title: string;
    description: string;
    semester: string | null;
    lecturer: string | null;
    targetGrade: number | null;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [semester, setSemester] = useState("");
  const [lecturer, setLecturer] = useState("");
  const [targetGrade, setTargetGrade] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    titleInputRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // Zielnote als Zahl; eine unleserliche Eingabe wird zu `null` statt zu NaN.
      const grade = Number.parseFloat(targetGrade.replace(",", "."));
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        semester: semester.trim() || null,
        lecturer: lecturer.trim() || null,
        targetGrade: Number.isFinite(grade) ? grade : null,
      });
    } catch {
      setError("Der Kurs konnte nicht erstellt werden. Bitte versuche es erneut.");
      setSaving(false);
    }
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-course-heading"
      >
        <div className={styles.dialogHeader}>
          <h2 id="create-course-heading">Kurs anlegen</h2>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Schließen"
            onClick={onClose}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <form onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="course-title">Name</label>
            <input
              id="course-title"
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="z. B. Neue Konzepte"
              required
              disabled={saving}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="course-description">Beschreibung</label>
            <textarea
              id="course-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Kurzer Kontext zum Kurs"
              disabled={saving}
            />
            <p className={styles.hint}>
              Wird später als Kontext für den KI-Assistenten genutzt.
            </p>
          </div>

          {/* Optionale Angaben (Backend-Migration 20261004090000). Leere Felder werden zu
              `null`; leere oder reine Leerzeichen-Werte weist das Backend ab. */}
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label htmlFor="course-semester">Semester</label>
              <input
                id="course-semester"
                value={semester}
                onChange={(event) => setSemester(event.target.value)}
                placeholder="z. B. WS 2026/27"
                maxLength={100}
                disabled={saving}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="course-lecturer">Dozent/in</label>
              <input
                id="course-lecturer"
                value={lecturer}
                onChange={(event) => setLecturer(event.target.value)}
                placeholder="z. B. Prof. Schmidt"
                maxLength={200}
                disabled={saving}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="course-target-grade">Zielnote</label>
              <input
                id="course-target-grade"
                type="number"
                min={1}
                max={5}
                step={0.1}
                value={targetGrade}
                onChange={(event) => setTargetGrade(event.target.value)}
                placeholder="1,7"
                disabled={saving}
              />
            </div>
          </div>

          {error && <p className={styles.hint} role="alert">{error}</p>}
          <div className={styles.dialogFooter}>
            <button type="button" className={styles.cancelButton} onClick={onClose} disabled={saving}>Abbrechen</button>
            <button type="submit" className={styles.submitButton} disabled={saving}>
              {saving ? "Wird erstellt …" : "Kurs erstellen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
