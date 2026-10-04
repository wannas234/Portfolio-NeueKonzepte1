"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Assessment, AssessmentInput, AssessmentKind, AssessmentStatus } from "@/lib/supabase/queries/grades";
import { parseGermanDecimal, validGrade, validEcts, pointsConsistent } from "./calculations";
import { useDialogA11y } from "@/components/useDialogA11y";
import { KIND_LABELS, STATUS_LABELS } from "./assessmentLabels";
import styles from "@/components/courses/coursesList.module.css";

export default function AssessmentDialog({
  initial,
  onClose,
  onSave,
}: {
  initial?: Assessment;
  onClose: () => void;
  onSave: (input: AssessmentInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<AssessmentKind>(initial?.kind ?? "exam");
  const [status, setStatus] = useState<AssessmentStatus>(initial?.status ?? "planned");
  const [ects, setEcts] = useState(initial ? String(initial.ectsCredits).replace(".", ",") : "");
  const [grade, setGrade] = useState(initial?.grade !== null && initial?.grade !== undefined ? String(initial.grade).replace(".", ",") : "");
  const [date, setDate] = useState(initial?.assessmentDate ?? "");
  const [pointsEarned, setPointsEarned] = useState(
    initial?.pointsEarned !== null && initial?.pointsEarned !== undefined ? String(initial.pointsEarned).replace(".", ",") : "",
  );
  const [pointsMax, setPointsMax] = useState(
    initial?.pointsMax !== null && initial?.pointsMax !== undefined ? String(initial.pointsMax).replace(".", ",") : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { containerRef, handleBackdropClick } = useDialogA11y({ onClose, disabled: saving });

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  function handleStatusChange(next: AssessmentStatus) {
    if (status === "graded" && next !== "graded" && grade.trim() !== "") {
      const confirmed = window.confirm("Beim Wechsel des Status wird die vorhandene Note entfernt. Fortfahren?");
      if (!confirmed) return;
      setGrade("");
    }
    setStatus(next);
  }

  const parsedEcts = parseGermanDecimal(ects);
  const parsedGrade = grade.trim() === "" ? null : parseGermanDecimal(grade);
  const parsedPointsEarned = pointsEarned.trim() === "" ? null : parseGermanDecimal(pointsEarned);
  const parsedPointsMax = pointsMax.trim() === "" ? null : parseGermanDecimal(pointsMax);

  const ectsValid = parsedEcts !== null && validEcts(parsedEcts);
  const gradeValid = status === "graded" ? parsedGrade !== null && validGrade(parsedGrade) : parsedGrade === null;
  const pointsValid = pointsConsistent(parsedPointsEarned, parsedPointsMax);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!title.trim() || !ectsValid || !gradeValid || !pointsValid) return;

    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        kind,
        status,
        ectsCredits: parsedEcts!,
        grade: status === "graded" ? parsedGrade : null,
        assessmentDate: date || null,
        pointsEarned: parsedPointsEarned,
        pointsMax: parsedPointsMax,
        notes: notes.trim(),
      });
    } catch {
      setError("Die Prüfungsleistung konnte nicht gespeichert werden. Bitte versuche es erneut.");
      setSaving(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div ref={containerRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="assessment-dialog-heading">
        <div className={styles.dialogHeader}>
          <h2 id="assessment-dialog-heading">{initial ? "Prüfungsleistung bearbeiten" : "Prüfungsleistung anlegen"}</h2>
          <button type="button" className={styles.closeButton} aria-label="Schließen" onClick={onClose} disabled={saving}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="assessment-title">Titel</label>
            <input
              id="assessment-title"
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="z. B. Klausur Netzwerksicherheit"
              required
              maxLength={200}
              disabled={saving}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="assessment-kind">Art</label>
            <select id="assessment-kind" value={kind} onChange={(event) => setKind(event.target.value as AssessmentKind)} disabled={saving}>
              {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="assessment-status">Status</label>
            <select
              id="assessment-status"
              value={status}
              onChange={(event) => handleStatusChange(event.target.value as AssessmentStatus)}
              disabled={saving}
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="assessment-ects">ECTS</label>
            <input
              id="assessment-ects"
              inputMode="decimal"
              value={ects}
              onChange={(event) => setEcts(event.target.value)}
              placeholder="z. B. 6 oder 4,5"
              required
              aria-invalid={ects.trim() !== "" && !ectsValid}
              aria-describedby="assessment-ects-hint"
              disabled={saving}
            />
            <p id="assessment-ects-hint" className={styles.hint}>Größer als 0, höchstens 60, höchstens eine Nachkommastelle.</p>
          </div>
          <div className={styles.field}>
            <label htmlFor="assessment-grade">Note{status !== "graded" && " (erst bei Status „Bewertet“)"}</label>
            <input
              id="assessment-grade"
              inputMode="decimal"
              value={grade}
              onChange={(event) => setGrade(event.target.value)}
              placeholder="1,0 bis 5,0"
              disabled={saving || status !== "graded"}
              required={status === "graded"}
              aria-invalid={!gradeValid}
              aria-describedby="assessment-grade-hint"
            />
            <p id="assessment-grade-hint" className={styles.hint}>
              {status === "graded" ? "1,0 (beste) bis 5,0 (schlechteste Note)." : "Nur bei Status „Bewertet“ verfügbar."}
            </p>
          </div>
          <div className={styles.field}>
            <label htmlFor="assessment-date">Termin (optional)</label>
            <input id="assessment-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={saving} />
          </div>
          <div className={styles.field}>
            <label htmlFor="assessment-points-earned">Erreichte Punkte (optional)</label>
            <input
              id="assessment-points-earned"
              inputMode="decimal"
              value={pointsEarned}
              onChange={(event) => setPointsEarned(event.target.value)}
              disabled={saving}
              aria-invalid={!pointsValid}
              aria-describedby="assessment-points-hint"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="assessment-points-max">Maximale Punkte (optional)</label>
            <input
              id="assessment-points-max"
              inputMode="decimal"
              value={pointsMax}
              onChange={(event) => setPointsMax(event.target.value)}
              disabled={saving}
              aria-invalid={!pointsValid}
              aria-describedby="assessment-points-hint"
            />
            <p id="assessment-points-hint" className={styles.hint}>Beide Felder zusammen ausfüllen oder beide leer lassen. Erreichte Punkte dürfen die maximalen nicht überschreiten.</p>
          </div>
          <div className={styles.field}>
            <label htmlFor="assessment-notes">Notizen (optional)</label>
            <textarea
              id="assessment-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              disabled={saving}
            />
          </div>
          {error && <p className={styles.hint} role="alert">{error}</p>}
          <button type="submit" className={styles.submitButton} disabled={saving}>
            {saving ? "Wird gespeichert …" : initial ? "Änderungen speichern" : "Prüfungsleistung erstellen"}
          </button>
        </form>
      </div>
    </div>
  );
}
