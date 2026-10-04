"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  countLectureDocuments,
  createLecture,
  deleteLecture,
  LECTURE_TITLE_MAX,
  listLectures,
  updateLecture,
  type Lecture,
} from "@/lib/supabase/queries/lectures";
import { sortLectures } from "./lectureFilter";
import styles from "./coursesList.module.css";

function formatHeldOn(value: string | null) {
  if (!value) return "Kein Termin";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? "Kein Termin"
    : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDocumentCount(count: number) {
  return count === 1 ? "1 Unterlage" : `${count} Unterlagen`;
}

/**
 * Die Vorlesungen eines Kurses (Backend-Migration 20261004090000).
 *
 * Damit entsteht die Ebene Kurs → Vorlesung → Dokument. Die Zuordnung einzelner
 * Unterlagen passiert auf der Unterlagen-Seite; hier werden die Vorlesungen selbst
 * gepflegt (Titel und Termin bleiben nach dem Anlegen änderbar). Eine gelöschte Vorlesung nimmt keine Unterlagen mit — das Backend löst
 * nur die Zuordnung.
 */
export default function CourseLectures({ courseId }: { courseId: string }) {
  const [lectures, setLectures] = useState<Lecture[] | undefined>(undefined);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [heldOn, setHeldOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editHeldOn, setEditHeldOn] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listLectures(courseId)
      .then((loaded) => { if (active) setLectures(loaded); })
      .catch(() => {
        if (!active) return;
        setLectures([]);
        setError("Die Vorlesungen konnten nicht geladen werden.");
      });
    // Die Anzahl ist nur Beiwerk; ohne sie bleibt die Liste nutzbar.
    countLectureDocuments(courseId)
      .then((loaded) => { if (active) setCounts(loaded); })
      .catch(() => {});
    return () => { active = false; };
  }, [courseId]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createLecture(courseId, { title, heldOn: heldOn || null });
      setLectures((current) => sortLectures([...(current ?? []), created]));
      setTitle("");
      setHeldOn("");
      setAdding(false);
    } catch {
      setError("Die Vorlesung konnte nicht angelegt werden.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(lecture: Lecture) {
    setEditingId(lecture.id);
    setEditTitle(lecture.title);
    setEditHeldOn(lecture.heldOn ?? "");
    setError(null);
  }

  async function handleEdit(event: FormEvent<HTMLFormElement>, lecture: Lecture) {
    event.preventDefault();
    if (!editTitle.trim()) return;
    const titleChanged = editTitle.trim() !== lecture.title;
    const heldOnChanged = (editHeldOn || null) !== lecture.heldOn;
    if (!titleChanged && !heldOnChanged) {
      setEditingId(null);
      return;
    }
    setBusyId(lecture.id);
    setError(null);
    try {
      const updated = await updateLecture(lecture.id, {
        ...(titleChanged ? { title: editTitle } : {}),
        ...(heldOnChanged ? { heldOn: editHeldOn || null } : {}),
      });
      // Ein geänderter Termin verschiebt die Vorlesung in der Liste.
      setLectures((current) => sortLectures((current ?? []).map((entry) => (entry.id === updated.id ? updated : entry))));
      setEditingId(null);
    } catch {
      setError("Die Vorlesung konnte nicht gespeichert werden.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(lecture: Lecture) {
    if (!window.confirm(`„${lecture.title}“ wirklich löschen? Die zugeordneten Unterlagen bleiben erhalten.`)) return;
    setBusyId(lecture.id);
    setError(null);
    try {
      await deleteLecture(lecture.id);
      setLectures((current) => (current ?? []).filter((entry) => entry.id !== lecture.id));
    } catch {
      setError("Die Vorlesung konnte nicht gelöscht werden.");
    } finally {
      setBusyId(null);
    }
  }

  if (lectures === undefined) return null;

  return (
    <section className={styles.lectureSection} aria-labelledby="lectures-heading">
      <div className={styles.sectionHead}>
        <div>
          <h2 id="lectures-heading">Vorlesungen</h2>
          <p>
            {lectures.length === 0
              ? "Gliedere den Kurs in einzelne Vorlesungen und ordne deine Unterlagen zu."
              : `${lectures.length} ${lectures.length === 1 ? "Vorlesung" : "Vorlesungen"}`}
          </p>
        </div>
        {!adding && (
          <button type="button" className={styles.secondaryButton} onClick={() => setAdding(true)}>
            Vorlesung hinzufügen
          </button>
        )}
      </div>

      {adding && (
        <form className={styles.lectureForm} onSubmit={handleAdd}>
          <label>
            <span>Titel</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="z. B. VL 3 – Kryptographie"
              maxLength={LECTURE_TITLE_MAX}
              autoFocus
              disabled={saving}
            />
          </label>
          <label>
            <span>Termin (optional)</span>
            <input type="date" value={heldOn} onChange={(event) => setHeldOn(event.target.value)} disabled={saving} />
          </label>
          <div className={styles.lectureFormActions}>
            <button type="button" className={styles.cancelButton} onClick={() => setAdding(false)} disabled={saving}>
              Abbrechen
            </button>
            <button type="submit" className={styles.submitButton} disabled={saving || !title.trim()}>
              {saving ? "Wird angelegt …" : "Anlegen"}
            </button>
          </div>
        </form>
      )}

      {error && <p className={styles.hint} role="alert">{error}</p>}

      {lectures.length > 0 && (
        <ul className={styles.lectureList}>
          {lectures.map((lecture) => (
            <li key={lecture.id}>
              {editingId === lecture.id ? (
                <form className={styles.lectureForm} onSubmit={(event) => void handleEdit(event, lecture)}>
                  <label>
                    <span>Titel</span>
                    <input
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      maxLength={LECTURE_TITLE_MAX}
                      autoFocus
                      disabled={busyId === lecture.id}
                    />
                  </label>
                  <label>
                    <span>Termin (optional)</span>
                    <input
                      type="date"
                      value={editHeldOn}
                      onChange={(event) => setEditHeldOn(event.target.value)}
                      disabled={busyId === lecture.id}
                    />
                  </label>
                  <div className={styles.lectureFormActions}>
                    <button type="button" className={styles.cancelButton} onClick={() => setEditingId(null)} disabled={busyId === lecture.id}>
                      Abbrechen
                    </button>
                    <button type="submit" className={styles.submitButton} disabled={busyId === lecture.id || !editTitle.trim()}>
                      {busyId === lecture.id ? "Wird gespeichert …" : "Speichern"}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <span className={styles.lectureTitle}>{lecture.title}</span>
                  <span className={styles.lectureDate}>{formatHeldOn(lecture.heldOn)}</span>
                  <Link href={`/courses/${courseId}/documents?lecture=${lecture.id}`} className={styles.lectureDocs}>
                    {formatDocumentCount(counts.get(lecture.id) ?? 0)}
                  </Link>
                  <span className={styles.lectureActions}>
                    <button type="button" onClick={() => startEdit(lecture)} disabled={busyId === lecture.id}>
                      Bearbeiten
                    </button>
                    <button type="button" data-tone="danger" onClick={() => void handleDelete(lecture)} disabled={busyId === lecture.id}>
                      Löschen
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
