"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { listOpenNotes, openNoteHref, type OpenNotes } from "@/lib/supabase/queries/open-notes";
import styles from "./coursesList.module.css";

const MAX_NOTES = 5;

/**
 * Offene Seitennotizen dieses Kurses: was beim Durcharbeiten der Unterlagen noch ungeklärt
 * geblieben ist. Ohne offene Notizen (oder wenn das Laden scheitert) erscheint nichts —
 * die Kursseite soll daran nicht hängen.
 */
export default function CourseOpenNotes({ courseId }: { courseId: string }) {
  const [notes, setNotes] = useState<OpenNotes | null>(null);

  useEffect(() => {
    let active = true;
    listOpenNotes(createClient(), { courseId, limit: MAX_NOTES })
      .then((loaded) => { if (active) setNotes(loaded); })
      .catch(() => { /* Optionaler Block. */ });
    return () => { active = false; };
  }, [courseId]);

  if (!notes || notes.total === 0) return null;

  return (
    <section className={styles.lectureSection} aria-labelledby="open-notes-heading">
      <div className={styles.sectionHead}>
        <div>
          <h2 id="open-notes-heading">Offene Notizen<span className={styles.tag}>{notes.total}</span></h2>
          <p>Stellen in deinen Unterlagen, die du noch klären wolltest.</p>
        </div>
      </div>
      <ul className={styles.openNotes}>
        {notes.items.map((note) => (
          <li key={note.id}>
            <Link href={openNoteHref(note)} className={styles.openNote}>
              <span className={styles.openNoteMeta}>
                {note.materialTitle} · Seite {note.pageNumber} · {note.kind === "highlight" ? "Markierung" : "Notiz"}
              </span>
              <span className={styles.openNoteText}>{note.text}</span>
            </Link>
          </li>
        ))}
      </ul>
      {notes.total > notes.items.length && (
        <p className={styles.openNotesMore}>Weitere offene Notizen findest du in den jeweiligen Unterlagen.</p>
      )}
    </section>
  );
}
