"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createCourse, deleteCourse, listCourses, type Course } from "@/lib/supabase/queries/courses";
import { deriveCourseBadge } from "@/lib/courseBadge";
import CreateCourseDialog from "@/components/courses/CreateCourseDialog";
import PageHeading from "@/components/ui/PageHeading";
import styles from "@/components/courses/coursesList.module.css";

function formatCreatedAt(iso: string) {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(iso));
}

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const visibleCourses = courses.filter((course) => `${course.title} ${course.description ?? ""}`.toLocaleLowerCase("de").includes(search.toLocaleLowerCase("de")));

  function fetchCourses() {
    return listCourses()
      .then((nextCourses) => {
        setCourses(nextCourses);
      })
      .catch(() => {
        setError("Deine Kurse konnten nicht geladen werden. Bitte versuche es erneut.");
      })
      .finally(() => {
        setLoading(false);
      });
  }

  function loadCourses() {
    setLoading(true);
    setError(null);
    fetchCourses();
  }

  useEffect(() => {
    fetchCourses();
  }, []);

  async function handleCreate(input: {
    title: string;
    description: string;
    semester: string | null;
    lecturer: string | null;
    targetGrade: number | null;
  }) {
    setError(null);
    try {
      const course = await createCourse(input);
      setCourses((prev) => [...prev, course]);
      setDialogOpen(false);
    } catch {
      setError("Der Kurs konnte nicht erstellt werden.");
      throw new Error("create-course-failed");
    }
  }

  async function handleDelete(course: Course) {
    if (!window.confirm(`"${course.title}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    setError(null);
    setDeletingId(course.id);
    try {
      await deleteCourse(course.id);
      setCourses((prev) => prev.filter((entry) => entry.id !== course.id));
    } catch {
      setError("Der Kurs konnte nicht gelöscht werden.");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className={styles.page}><p className={styles.loading} aria-live="polite">Kurse werden geladen …</p></div>;

  if (error && courses.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.empty} role="alert">
          <h2>Kurse nicht verfügbar</h2>
          <p>{error}</p>
          <button type="button" className={styles.createButton} onClick={loadCourses}>Erneut versuchen</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeading title="Kurse" description="Verwalte deine Kurse und verfolge deinen Lernfortschritt.">
        <button type="button" className={styles.createButton} onClick={() => setDialogOpen(true)}>
          <span aria-hidden="true">+</span> Kurs hinzufügen
        </button>
      </PageHeading>
      <div className={styles.filterBar}>
        <span className={styles.filterActive}>Alle Kurse ({courses.length})</span>
        <label className={styles.searchField}><span className={styles.srOnly}>Kurse durchsuchen</span><input type="search" placeholder="Kurse durchsuchen …" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      </div>

      {error && <p className={styles.errorHint} role="alert">{error}</p>}

      {courses.length === 0 ? (
        <div className={styles.empty}>
          <h2>Dein erster Kurs wartet.</h2>
          <p>Leg einen Kurs an, um Vorlesungsmaterial, Notizen und Termine daran zu verknüpfen.</p>
          <button type="button" className={styles.createButton} onClick={() => setDialogOpen(true)}>+ Kurs anlegen</button>
        </div>
      ) : (
        <ul className={styles.grid}>
          {visibleCourses.map((course) => {
            const badge = deriveCourseBadge(course.title);
            return (
              <li key={course.id} className={styles.cardWrap}>
                <Link href={`/courses/${course.id}`} className={styles.card}>
                  <span className={styles.cover} data-tone={badge.color} aria-hidden="true" />
                  <span className={styles.icon} data-tone={badge.color} aria-hidden="true">{badge.code}</span>
                  <h2 className={styles.title}>{course.title}</h2>
                  <p className={styles.description}>{course.description || "Keine Beschreibung hinterlegt."}</p>
                </Link>
                <div className={styles.cardActions}>
                  <Link href={`/courses/${course.id}/flashcards`} className={styles.actionButton} data-tone="violet">
                    <span className={styles.actionIcon} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="13" height="15" rx="2.4" /><path d="M9 10h4M9 14h4" /></svg>
                    </span>
                    Karteikarten
                  </Link>
                  <Link href={`/courses/${course.id}/documents`} className={styles.actionButton} data-tone="blue">
                    <span className={styles.actionIcon} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" /><path d="M13.6 3.6V8h4.3M9 12.5h6M9 16h6" /></svg>
                    </span>
                    Unterlagen
                  </Link>
                </div>
                <hr className={styles.divider} />
                <p className={styles.createdAt}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
                  Angelegt am {formatCreatedAt(course.createdAt)}
                </p>
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleDelete(course);
                  }}
                  disabled={deletingId === course.id}
                  aria-label={`Kurs „${course.title}“ löschen`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9L6 7Z" /><path d="M10 11v6M14 11v6" /></svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {courses.length > 0 && visibleCourses.length === 0 && <p className={styles.empty} role="status">Keine Kurse zu dieser Suche gefunden.</p>}

      {dialogOpen && <CreateCourseDialog onClose={() => setDialogOpen(false)} onCreate={handleCreate} />}
    </div>
  );
}
