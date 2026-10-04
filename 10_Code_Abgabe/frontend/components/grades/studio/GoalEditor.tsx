"use client";

import { useState } from "react";
import { updateCourse, type Course } from "@/lib/supabase/queries/courses";
import { courseGradeSummary, formatGrade, formatEcts, parseTarget, targetGrade, type EctsAssessment } from "../calculations";
import s from "./GradeStudio.module.css";

const DEFAULT_TARGET = "2,0";

// Die Zielnote gehört zum Kurs (`courses.target_grade`). Das Feld rechnet sofort mit jeder
// Eingabe; gespeichert wird erst auf Knopfdruck, damit Ausprobieren das Ziel nicht ändert.
export default function GoalEditor({
  assessments,
  course,
  onCourseSaved,
}: {
  assessments: EctsAssessment[];
  course: Course;
  onCourseSaved: (next: Course) => void;
}) {
  const saved = course.targetGrade === null ? null : formatGrade(course.targetGrade);
  const [input, setInput] = useState(saved ?? DEFAULT_TARGET);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const target = parseTarget(input);
  const result = targetGrade(assessments, target);
  const summary = courseGradeSummary(assessments);
  const unchanged = target !== null && target === course.targetGrade;

  async function save(next: number | null) {
    setSaving(true);
    setSaveError(null);
    try {
      onCourseSaved(await updateCourse(course.id, { targetGrade: next }));
    } catch {
      setSaveError("Die Zielnote konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={s.card} aria-labelledby="goal-heading">
      <div className={s.railHeading}>
        <h2 id="goal-heading">Dein Ziel</h2>
        <span className={s.courseCode}>ZIELRECHNER</span>
      </div>
      <label className={s.goalLabel} htmlFor="target-grade">Gewünschte Gesamtnote</label>
      <div className={s.goalControl}>
        <input id="target-grade" type="text" inputMode="decimal" value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-invalid={result.kind === "invalid"} aria-describedby="target-help target-result" />
        <button type="button" className={s.resetButton} onClick={() => void save(target)} disabled={saving || target === null || unchanged}>
          {saving ? "Wird gespeichert …" : unchanged ? "Gespeichert" : "Als Zielnote speichern"}
        </button>
        <button type="button" className={s.resetButton} onClick={() => setInput(saved ?? DEFAULT_TARGET)} disabled={saving}>Zurücksetzen</button>
      </div>
      <p className={s.goalSaved}>
        {saved === null ? "Für diesen Kurs ist noch keine Zielnote gespeichert." : `Gespeicherte Zielnote: ${saved}`}
        {saved !== null && <> · <button type="button" className={s.goalClear} onClick={() => void save(null)} disabled={saving}>Entfernen</button></>}
      </p>
      {saveError && <p className={s.goalSaved} role="alert">{saveError}</p>}
      <div id="target-result" className={s.goalResult} role="status" aria-atomic="true">
        {result.kind === "invalid" && <p>{result.message}</p>}
        {result.kind === "noOpenAssessments" && <>
          <h3>{summary.totalEcts === 0 ? "Dein erster Schritt fehlt noch." : "Alles bewertet."}</h3>
          <p>{summary.totalEcts === 0
            ? "Für diesen Kurs sind noch keine Prüfungsleistungen erfasst — leg zuerst eine an."
            : "Keine offene Leistung: Alle erfassten ECTS sind bereits bewertet. Es gibt nichts mehr zu berechnen."}</p>
        </>}
        {result.kind === "impossible" && <>
          <h3>Ziel rechnerisch nicht erreichbar.</h3>
          <p>Selbst mit 1,0 in den verbleibenden {formatEcts(summary.openEcts)} offenen ECTS lässt sich diese Zielnote nicht mehr erreichen.</p>
        </>}
        {result.kind === "any" && <>
          <h3>Auch mit 5,0 erreichbar.</h3>
          <p>Die Zielnote wird selbst mit 5,0 in den verbleibenden {formatEcts(summary.openEcts)} offenen ECTS erreicht. Das ist keine Aussage zum Bestehen der Prüfung.</p>
        </>}
        {result.kind === "required" && <>
          <p className={s.micro}>NÖTIG ÜBER DIE OFFENEN {formatEcts(result.openEcts)} ECTS</p>
          <h3 className={s.requiredGrade}>{formatGrade(result.safeGrade)} <small>oder besser</small></h3>
          <p>Damit erreichst du rechnerisch die Gesamtnote {formatGrade(target!)} oder besser — bezogen auf die bisher erfassten {formatEcts(summary.totalEcts)} ECTS.</p>
          {result.conservative && <p>Konservativ auf zwei Nachkommastellen abgerundet: Die exakte Obergrenze wird nicht gelockert.</p>}
        </>}
      </div>
      <details className={s.goalMethod}>
        <summary>Berechnung & Hinweise</summary>
        <p id="target-help">1,0 bis 5,0 · höchstens zwei Nachkommastellen, Komma oder Punkt. Die Rechnung folgt jeder Eingabe; gespeichert wird die Zielnote erst mit „Als Zielnote speichern“.</p>
        <p>(Zielnote × erfasste ECTS − Summe aus Note × ECTS der bewerteten Leistungen) ÷ offene ECTS.</p>
        <p>Nur bereits erfasste Leistungen zählen. Jede Note fließt linear mit ihren ECTS ein; 1,0 ist die beste und 5,0 die schlechteste Note.</p>
        <p>Unverbindliche Rechnung. Hochschulspezifische Notenstufen, Rundungs-, Bestehens- und Prüfungsordnungsregeln werden nicht berücksichtigt.</p>
      </details>
    </section>
  );
}
