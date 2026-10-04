"use client";

import { useEffect, useState } from "react";
import { assignMaterialToLecture, listLectures, type Lecture } from "@/lib/supabase/queries/lectures";
import { isLectureNotFound } from "./lectureFilter";
import styles from "@/components/documents/documents.module.css";

/**
 * Ordnet diese Unterlage einer Vorlesung des Kurses zu.
 *
 * Die Zuordnung ist optional und jederzeit lösbar. Gibt es im Kurs noch keine
 * Vorlesung, erscheint hier nichts — die Auswahl wäre leer und nur verwirrend.
 */
export default function DocumentLecturePicker({
  courseId,
  materialId,
  initialLectureId,
}: {
  courseId: string;
  materialId: string;
  initialLectureId: string | null;
}) {
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [selected, setSelected] = useState<string>(initialLectureId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listLectures(courseId)
      .then((loaded) => { if (active) setLectures(loaded); })
      .catch(() => { /* Ohne Liste bleibt die Seite nutzbar, die Zuordnung entfällt. */ });
    return () => { active = false; };
  }, [courseId]);

  function change(next: string) {
    const previous = selected;
    setSelected(next);
    setSaving(true);
    setError(null);
    void assignMaterialToLecture(materialId, next || null)
      .catch((assignError: unknown) => {
        setSelected(previous);
        if (isLectureNotFound(assignError)) {
          setError("Diese Vorlesung gibt es nicht mehr. Die Liste wurde aktualisiert.");
          listLectures(courseId).then(setLectures).catch(() => {});
        } else {
          setError("Die Zuordnung konnte nicht gespeichert werden.");
        }
      })
      .finally(() => setSaving(false));
  }

  if (lectures.length === 0) return null;

  return (
    <div className={styles.lecturePicker}>
      <label>
        <span>Vorlesung</span>
        <select value={selected} onChange={(event) => change(event.target.value)} disabled={saving}>
          <option value="">Keiner Vorlesung zugeordnet</option>
          {lectures.map((lecture) => (
            <option key={lecture.id} value={lecture.id}>{lecture.title}</option>
          ))}
        </select>
      </label>
      {error && <p className={styles.errorHint} role="alert">{error}</p>}
    </div>
  );
}
