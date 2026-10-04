"use client";

import Link from "next/link";
import PageHeading from "@/components/ui/PageHeading";
import type { Course } from "@/lib/supabase/queries/courses";
import type { Assessment } from "@/lib/supabase/queries/grades";
import { deriveCourseBadge } from "@/lib/courseBadge";
import AssessmentDialog from "../AssessmentDialog";
import { KIND_LABELS, STATUS_LABELS } from "../assessmentLabels";
import { formatGrade, formatEcts } from "../calculations";
import { useGradeCourses, useCourseGrades } from "./useGradeData";
import GoalEditor from "./GoalEditor";
import s from "./GradeStudio.module.css";

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("de-DE", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export default function GradeStudio() {
  const data = useGradeCourses();

  return (
    <div className={s.studio}>
      <PageHeading title="Noten" description="Behalte den Überblick über deine Leistungen.">
        {data.courses.length > 0 && (
          <div className={s.contextSwitcher}>
            <label htmlFor="grades-course-select">Kurs</label>
            <select id="grades-course-select" value={data.selectedCourseId ?? ""}
              onChange={(event) => data.setSelectedCourseId(event.target.value)}>
              {data.courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
            </select>
          </div>
        )}
      </PageHeading>

      {data.loading ? <div className={s.pageState} role="status">Deine Kurse werden geladen …</div>
        : data.error && data.courses.length === 0 ? (
          <div className={s.pageState} role="alert"><h2>Noten nicht verfügbar.</h2><p>{data.error}</p>
            <button className={s.primaryAction} onClick={data.loadCourses}>Erneut versuchen</button></div>
        ) : data.courses.length === 0 ? (
          <div className={s.pageState}><span className={s.micro}>NOCH KEIN KURS</span><h2>Erst ein Kurs,<br />dann Noten.</h2>
            <p>Leg zuerst einen Kurs an, um Prüfungsleistungen und Noten zu verwalten.</p>
            <Link href="/courses" className={s.primaryAction}>+ Kurs anlegen</Link></div>
        ) : data.selectedCourse && <CourseCanvas key={data.selectedCourse.id} course={data.selectedCourse} onCourseSaved={data.replaceCourse} />}
    </div>
  );
}

function CourseCanvas({ course, onCourseSaved }: { course: Course; onCourseSaved: (next: Course) => void }) {
  const data = useCourseGrades(course.id);
  const { summary } = data;

  if (data.loading) return <div className={s.pageState} role="status">Prüfungsleistungen werden geladen …</div>;
  if (data.error && data.assessments.length === 0) return (
    <div className={s.pageState} role="alert"><h2>Leistungen nicht verfügbar.</h2><p>{data.error}</p>
      <button className={s.primaryAction} onClick={data.loadAssessments}>Erneut versuchen</button></div>
  );

  return (
    <>
      <div className={s.container}>
        <div className={s.stats} aria-label="Leistungsübersicht für diesen Kurs">
          <div><strong>{summary.average === null ? "—" : formatGrade(summary.average)}</strong><span>Notendurchschnitt im Kurs</span></div>
          <div><strong>{data.assessments.filter((item) => item.grade !== null).length}</strong><span>Bewertete Leistungen</span></div>
          <div><strong>{data.assessments.filter((item) => item.grade === null).length}</strong><span>Ausstehende Bewertungen</span></div>
        </div>
        <details className={s.planning}>
        <summary>Notenziel und Berechnung</summary>
        <div className={s.overviewGrid}>
          <section className={s.card} aria-labelledby="standing-heading">
            <div className={s.railHeading}><h2 id="standing-heading">Dein Stand</h2><span className={s.courseCode}>{deriveCourseBadge(course.title).code}</span></div>
            <p className={s.averageLabel}>ECTS-GEWICHTETER SCHNITT</p>
            <div className={s.average} aria-label={summary.average === null ? "Noch kein Notenschnitt" : `Ungefähr ${formatGrade(summary.average)}`}>
              {summary.average !== null && <span aria-hidden="true">≈</span>}
              <strong aria-hidden="true">{summary.average === null ? "—" : formatGrade(summary.average)}</strong>
            </div>
            <div className={s.averageBasis}><span>Grundlage</span><strong>{formatEcts(summary.gradedEcts)} bewertete ECTS</strong></div>
            <p className={s.standingNote}>{summary.average === null ? "Dein Schnitt erscheint mit der ersten bewerteten Leistung." : "Dein Zwischenstand aus bereits bewerteten Leistungen. Keine offizielle Hochschulnote."}</p>
          </section>
          <GoalEditor assessments={data.assessments} course={course} onCourseSaved={onCourseSaved} />
        </div>
        </details>

        <section className={s.transcript} aria-labelledby="record-heading">
          <header className={s.recordHeading}>
            <p className={s.micro}>{course.title} / LEISTUNGSVERZEICHNIS</p>
            <div className={s.recordTitle}><h2 id="record-heading">Leistungen.</h2><span aria-label={`${data.assessments.length} Prüfungsleistungen`}>{String(data.assessments.length).padStart(2, "0")}</span></div>
            <div className={s.recordToolbar}><p>Prüfungsleistungen</p><button className={s.addAction} onClick={() => data.setDialogOpen(true)}><span aria-hidden="true">+</span> Leistung hinzufügen</button></div>
          </header>

          {data.actionError && <p className={s.actionError} role="alert">{data.actionError}</p>}
          <p role="status" className={s.srOnly}>{data.statusMessage}</p>

          {data.sorted.length === 0 ? (
            <div className={s.emptyRecord}><span aria-hidden="true">00</span><h3>Hier beginnt dein Leistungsbild.</h3><p>Erfasse deine erste Prüfung, Abgabe oder Präsentation.</p><button className={s.textAction} onClick={() => data.setDialogOpen(true)}>Erste Leistung hinzufügen</button></div>
          ) : (
            <><div className={s.tableHead} aria-hidden="true"><span>Prüfung</span><span>Kurs</span><span>Note / LP</span><span>Datum</span><span>Aktionen</span></div><ol className={s.recordList}>
              {data.sorted.map((item) => <AssessmentEntry key={item.id} item={item} courseTitle={course.title}
                deleting={data.deletingId === item.id} onEdit={() => data.setEditingAssessment(item)} onDelete={() => data.handleDelete(item)} />)}
            </ol></>
          )}

          <footer className={s.recordFooter}>
            <div className={s.totalEcts}><span>ERFASSTE ECTS</span><strong>{formatEcts(summary.totalEcts)}</strong></div>
            <dl className={s.ectsBalance}><div><dt>Bewertet</dt><dd>{formatEcts(summary.gradedEcts)} ECTS</dd></div><div><dt>Offen</dt><dd>{formatEcts(summary.openEcts)} ECTS</dd></div></dl>
          </footer>
        </section>
      </div>

      {data.dialogOpen && <AssessmentDialog onClose={() => data.setDialogOpen(false)} onSave={data.handleCreate} />}
      {data.editingAssessment && <AssessmentDialog initial={data.editingAssessment} onClose={() => data.setEditingAssessment(undefined)} onSave={data.handleUpdate} />}
    </>
  );
}

function AssessmentEntry({ item, courseTitle, deleting, onEdit, onDelete }: {
  item: Assessment; courseTitle: string; deleting: boolean; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <li className={s.entry}>
      <div className={s.entryBody}>
        <div className={s.entryClassification}><span>{KIND_LABELS[item.kind]}</span><span className={s.entryStatus} data-status={item.status}>{STATUS_LABELS[item.status]}</span></div>
        <h3>{item.title}</h3>
        <div className={s.entryMeta}>
          {item.pointsEarned !== null && item.pointsMax !== null && <span>{formatGrade(item.pointsEarned)} / {formatGrade(item.pointsMax)} Punkte</span>}
        </div>
        {item.notes && <p className={s.entryNotes}>{item.notes}</p>}
      </div>
      <span className={s.entryCourse}>{courseTitle}</span>
      <div className={s.entryResult}><strong aria-label={item.grade === null ? "Noch nicht bewertet" : `Note ${formatGrade(item.grade)}`}>{item.grade === null ? "—" : formatGrade(item.grade)}</strong><span>{formatEcts(item.ectsCredits)} ECTS</span></div>
      <span className={s.entryDate}>{item.assessmentDate ? <time dateTime={item.assessmentDate}>{formatDate(item.assessmentDate)}</time> : "—"}</span>
      <div className={s.entryActions}><button onClick={onEdit} disabled={deleting} aria-label={`${item.title} bearbeiten`}>Bearbeiten</button><button onClick={onDelete} disabled={deleting} aria-label={`${item.title} löschen`}>{deleting ? "Wird gelöscht …" : "Löschen"}</button></div>
    </li>
  );
}
