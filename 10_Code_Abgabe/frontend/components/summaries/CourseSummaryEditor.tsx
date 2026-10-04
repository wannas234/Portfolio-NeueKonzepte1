"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCourse, type Course } from "@/lib/supabase/queries/courses";
import { deriveCourseBadge } from "@/lib/courseBadge";
import {
  deleteCourseSummary,
  getCourseSummary,
  saveCourseSummary,
} from "@/lib/supabase/queries/summaries";
import GeneratedSummaryPanel from "./GeneratedSummaryPanel";
import s from "./summaries.module.css";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default function CourseSummaryEditor({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<Course | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getCourse(courseId).then((value) => { if (active) setCourse(value); }).catch(() => { if (active) setCourse(null); });
    getCourseSummary(courseId)
      .then((summary) => {
        if (!active) return;
        if (summary) {
          setMaterialId(summary.materialId);
          setText(summary.text);
          setUpdatedAt(summary.updatedAt);
        } else {
          setEditing(true);
        }
      })
      .catch(() => { if (active) setError("Die Zusammenfassung konnte nicht geladen werden."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const summary = await saveCourseSummary(courseId, { title: "Zusammenfassung", text });
      setMaterialId(summary.materialId);
      setUpdatedAt(summary.updatedAt);
      setEditing(false);
    } catch {
      setError("Die Zusammenfassung konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!materialId) return;
    if (!window.confirm("Diese Zusammenfassung wirklich löschen? Das kann nicht rückgängig gemacht werden.")) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteCourseSummary(materialId);
      setMaterialId(null);
      setUpdatedAt(null);
      setText("");
      setEditing(true);
    } catch {
      setError("Die Zusammenfassung konnte nicht gelöscht werden.");
    } finally {
      setDeleting(false);
    }
  }

  const busy = saving || deleting;
  const badge = course ? deriveCourseBadge(course.title) : null;

  return (
    <div className={s.page}>
      <Link href={`/courses/${courseId}`} className={s.backLink}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m11 5-6 7 6 7M5 12h14" /></svg>
        Zurück zum Kurs
      </Link>

      <header className={s.courseHeader}>
        {badge && <span className={s.icon} data-tone={badge.color}>{badge.code}</span>}
        <div>
          <h1>Zusammenfassung</h1>
          <p className={s.subhead}>{course === undefined ? "Kurs wird geladen …" : course === null ? "Kurs nicht gefunden." : course.title}</p>
        </div>
      </header>

      <div className={s.stack}>
      <GeneratedSummaryPanel courseId={courseId} />

      {loading ? (
        <p className={s.status} aria-live="polite">Zusammenfassung wird geladen …</p>
      ) : error && !updatedAt && !editing ? (
        <div className={s.empty} role="alert"><h2>Nicht verfügbar</h2><p>{error} Bitte lade die Seite erneut.</p></div>
      ) : (
        <div className={s.card}>
          <h2 className={s.panelTitle}>Deine eigene Zusammenfassung</h2>
          <div className={s.meta}>
            <span className={s.metaInfo}>
              {updatedAt ? (
                <>
                  <span>Zuletzt bearbeitet: {formatDate(updatedAt)}</span>
                  <span className={s.dot} aria-hidden="true">·</span>
                  <span>{wordCount(text)} Wörter</span>
                </>
              ) : (
                <span>Noch nicht gespeichert</span>
              )}
            </span>
            {!editing && (
              <span className={s.metaActions}>
                <button type="button" className={s.secondaryButton} onClick={() => setEditing(true)}>
                  Bearbeiten
                </button>
                {materialId && (
                  <button type="button" className={s.dangerButton} onClick={handleDelete} disabled={busy}>
                    {deleting ? "Wird gelöscht …" : "Löschen"}
                  </button>
                )}
              </span>
            )}
          </div>

          {editing ? (
            <>
              <label className={s.field}>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Schreib hier deine Zusammenfassung für diesen Kurs …"
                  disabled={busy}
                />
              </label>
              <div className={s.actions}>
                <button type="button" className={s.primaryButton} onClick={handleSave} disabled={busy || !text.trim()}>
                  {saving ? "Wird gespeichert …" : "Speichern"}
                </button>
                {updatedAt && (
                  <button type="button" className={s.secondaryButton} onClick={() => setEditing(false)} disabled={busy}>
                    Abbrechen
                  </button>
                )}
                {error && <span className={s.status} data-tone="error">{error}</span>}
              </div>
            </>
          ) : (
            <>
              <p className={s.readOnlyText}>{text}</p>
              {error && <p className={s.status} data-tone="error" role="alert">{error}</p>}
            </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
