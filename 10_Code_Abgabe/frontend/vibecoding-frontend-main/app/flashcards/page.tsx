"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeading from "@/components/ui/PageHeading";
import { listCourses, type Course } from "@/lib/supabase/queries/courses";
import { deriveCourseBadge } from "@/lib/courseBadge";
import s from "@/components/courses/coursesList.module.css";

export default function FlashcardsPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    listCourses().then((result) => { if (active) setCourses(result); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  return <div className={s.page}>
    <PageHeading title="Karteikarten" description="Wähle einen Kurs und vertiefe dein Wissen mit deinen Lernkarten." />
    {loading ? <p className={s.loading} role="status">Kurse werden geladen …</p>
      : error ? <div className={s.empty} role="alert"><p>Deine Kurse konnten nicht geladen werden.</p><button className={s.createButton} onClick={() => { setError(false); setLoading(true); setAttempt((value) => value + 1); }}>Erneut versuchen</button></div>
      : !courses.length ? <div className={s.empty}><h2>Noch keine Kurse</h2><p>Lege einen Kurs an, um deine ersten Karteikarten zu erstellen.</p><Link href="/courses" className={s.createButton}>Kurs hinzufügen</Link></div>
      : <ul className={s.grid}>{courses.map((course) => {
        const badge = deriveCourseBadge(course.title);
        return <li key={course.id} className={s.cardWrap}><Link href={`/courses/${course.id}/flashcards`} className={s.card}>
          <span className={s.cover} data-tone={badge.color} aria-hidden="true" />
          <span className={s.icon} data-tone={badge.color} aria-hidden="true">{badge.code}</span>
          <h2 className={s.title}>{course.title}</h2><p className={s.description}>Karteikarten öffnen →</p>
        </Link></li>;
      })}</ul>}
  </div>;
}
