"use client";

import { useEffect, useState } from "react";
import { listCourses, type Course } from "@/lib/supabase/queries/courses";
import {
  listCourseAssessments,
  createAssessment,
  updateAssessment,
  deleteAssessment,
  type Assessment,
  type AssessmentInput,
} from "@/lib/supabase/queries/grades";
import { courseGradeSummary } from "../calculations";

// Data access and actions are carried over from the previous grades workspace.
// The new presentation owns no persistence or calculation rules.
export function useGradeCourses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  function fetchCourses() {
    return listCourses()
      .then((nextCourses) => {
        setCourses(nextCourses);
        setSelectedCourseId((current) => current ?? nextCourses[0]?.id ?? null);
      })
      .catch(() => {
        setError("Deine Kurse konnten nicht geladen werden. Bitte versuche es erneut.");
      })
      .finally(() => setLoading(false));
  }

  function loadCourses() {
    setLoading(true);
    setError(null);
    fetchCourses();
  }

  useEffect(() => {
    fetchCourses();
  }, []);

  /** Übernimmt einen gespeicherten Kurs, z. B. nach dem Ändern der Zielnote. */
  function replaceCourse(next: Course) {
    setCourses((current) => current.map((course) => (course.id === next.id ? next : course)));
  }

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  return { courses, loading, error, selectedCourseId, selectedCourse, setSelectedCourseId, loadCourses, replaceCourse };
}

// Undated assessments sort last; the query already orders creation-time ties.
function sortKey(item: Assessment): string {
  return item.assessmentDate ?? "9999-99-99";
}

export function useCourseGrades(courseId: string) {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAssessment, setEditingAssessment] = useState<Assessment | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function fetchAssessments() {
    return listCourseAssessments(courseId)
      .then(setAssessments)
      .catch(() => {
        setError("Die Prüfungsleistungen konnten nicht geladen werden. Bitte versuche es erneut.");
      })
      .finally(() => setLoading(false));
  }

  function loadAssessments() {
    setLoading(true);
    setError(null);
    fetchAssessments();
  }

  useEffect(() => {
    fetchAssessments();
    // The parent remounts the course canvas with key={course.id} on a switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = courseGradeSummary(assessments);
  const sorted = [...assessments].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  async function handleCreate(input: AssessmentInput) {
    setActionError(null);
    try {
      const created = await createAssessment(courseId, input);
      setAssessments((prev) => [...prev, created]);
      setDialogOpen(false);
      setStatusMessage(`„${created.title}“ wurde angelegt.`);
    } catch {
      setActionError("Die Prüfungsleistung konnte nicht angelegt werden.");
      throw new Error("create-assessment-failed");
    }
  }

  async function handleUpdate(input: AssessmentInput) {
    if (!editingAssessment) return;
    setActionError(null);
    try {
      const updated = await updateAssessment(editingAssessment.id, input);
      setAssessments((prev) => prev.map((item) => item.id === updated.id ? updated : item));
      setEditingAssessment(undefined);
      setStatusMessage(`„${updated.title}“ wurde aktualisiert.`);
    } catch {
      setActionError("Die Änderungen konnten nicht gespeichert werden.");
      throw new Error("update-assessment-failed");
    }
  }

  async function handleDelete(assessment: Assessment) {
    if (!window.confirm(`„${assessment.title}“ wirklich löschen?`)) return;
    setDeletingId(assessment.id);
    setActionError(null);
    try {
      await deleteAssessment(assessment.id);
      setAssessments((prev) => prev.filter((item) => item.id !== assessment.id));
      setStatusMessage(`„${assessment.title}“ wurde gelöscht.`);
    } catch {
      setActionError(`„${assessment.title}“ konnte nicht gelöscht werden.`);
    } finally {
      setDeletingId(null);
    }
  }

  return {
    assessments, sorted, summary, loading, error, actionError, statusMessage,
    dialogOpen, editingAssessment, deletingId, loadAssessments,
    setDialogOpen, setEditingAssessment, handleCreate, handleUpdate, handleDelete,
  };
}
