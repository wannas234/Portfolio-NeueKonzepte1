"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { PRO_PRICE_LABEL } from "@/lib/billing";
import { createClient } from "@/lib/supabase/browser";
import { listCourses, type Course } from "@/lib/supabase/queries/courses";
import { listEvents } from "@/lib/supabase/queries/calendar";
import {
  countDueFlashcards,
  getProfileName,
  listRecentDocuments,
  listUnfinishedDocuments,
} from "@/lib/supabase/queries/dashboard";
import { listOpenNotes, openNoteHref } from "@/lib/supabase/queries/open-notes";
import { deriveCourseBadge } from "@/lib/courseBadge";
import { KIND_LABELS } from "@/components/calendar/EventDialog";
import { formatDateKey, formatEventWhen, localDateKey } from "@/components/calendar/dateUtils";
import { describeIndexingProgress, type IndexingTone } from "@/components/courses/documentIndexing";
import {
  attentionDocuments,
  documentTypeLabel,
  eventDayLabel,
  nextEventByCourse,
  recentDocuments,
  upcomingEvents,
} from "./dashboardModel";
import s from "@/components/home.module.css";

// The dashboard only shows real data of the signed-in user. Every block loads on its
// own, so a failing block shows its own error without taking the page down. No block
// invents stats, counts or progress numbers the backend does not provide.

type Loadable<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };

function useLoadable<T>(load: () => Promise<T>) {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    load()
      .then((data) => { if (active) setState({ status: "ready", data }); })
      .catch(() => { if (active) setState({ status: "error" }); });
    return () => { active = false; };
  }, [load, attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  return [state, reload] as const;
}

const loadCourses = () => listCourses();
const loadEvents = () => listEvents();
const loadRecentDocuments = () => listRecentDocuments(createClient(), 5);
const loadUnfinishedDocuments = () => listUnfinishedDocuments(createClient());
const loadProfileName = () => getProfileName(createClient());
const loadOpenNotes = () => listOpenNotes(createClient(), { limit: 4 });
const loadDueFlashcards = () => countDueFlashcards(createClient());

const MAX_EVENTS = 5;

const TONE_LABELS: Record<IndexingTone, string> = {
  ready: "Bereit",
  active: "Wird verarbeitet",
  pending: "Wartet",
  failed: "Fehlgeschlagen",
};

// Presentational only: a small, static pool of study quotes for the hero. Not user
// data, not a claim about the product — picked deterministically by day so it does
// not shift on every re-render.
const QUOTES = [
  { text: "Wissen ist der Anfang von allem.", author: "Aristoteles" },
  { text: "Bildung ist die mächtigste Waffe, um die Welt zu verändern.", author: "Nelson Mandela" },
  { text: "Erfolg ist die Summe kleiner Anstrengungen, die täglich wiederholt werden.", author: "Robert Collier" },
  { text: "Der Weg ist das Ziel.", author: "Konfuzius" },
];

function dailyQuote(now: number) {
  const dayIndex = Math.floor(now / 86_400_000);
  return QUOTES[dayIndex % QUOTES.length];
}

function greeting(now: number): string {
  const hour = new Date(now).getHours();
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
}

function formatAdded(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

type IconName = "calendar" | "course" | "file" | "history" | "chevron" | "assistant" | "flashcard" | "quiz" | "summary" | "bolt";

const ICONS: Record<IconName, ReactNode> = {
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9.5h16M8 3v3.4M16 3v3.4" /></>,
  course: <><path d="M4 5.5C4 4.67 4.67 4 5.5 4H13v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" /><path d="M20 5.5c0-.83-.67-1.5-1.5-1.5H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" /></>,
  file: <><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" /><path d="M13.6 3.6V8h4.3M9 12.5h6M9 16h6" /></>,
  history: <><path d="M4.5 9a7.5 7.5 0 1 1 .7 6.3" /><path d="M4.3 4.5 4.5 9l4.2-.8" /><path d="M12 8.5V13l3 1.8" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  assistant: <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9l5.6-1.9L12 3.5Z" strokeLinejoin="round" />,
  flashcard: <><rect x="4" y="8" width="13" height="10" rx="2.2" /><path d="M8 8V6.3A2.3 2.3 0 0 1 10.3 4h6.4A2.3 2.3 0 0 1 19 6.3v6.4a2.3 2.3 0 0 1-2.3 2.3H15" /></>,
  quiz: <><path d="M8 3.5h8a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" /><path d="M9.5 3.5h5v2h-5z" /><path d="M9 13l2 2 4-4.5" /></>,
  summary: <><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" /><path d="M13.6 3.6V8h4.3M9 12.5h6M9 15.5h6M9 18.5h3.5" /></>,
  bolt: <path d="M13 3 5.5 13.2h4.8L9.4 21l8.1-10.6h-5l.5-7.4Z" strokeLinejoin="round" />,
};

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function CardHead({
  id,
  icon,
  title,
  action,
  tone,
}: {
  id: string;
  icon: IconName;
  title: string;
  action?: ReactNode;
  tone?: "teal" | "purple" | "blue";
}) {
  return (
    <div className={s.cardHead}>
      <h2 id={id}><span className={s.cardIcon} data-tone={tone}><Icon name={icon} /></span>{title}</h2>
      {action}
    </div>
  );
}

function HeadLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={s.headLink}>
      {children}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
    </Link>
  );
}

function BlockError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={s.blockError} role="alert">
      <p>{message}</p>
      <button type="button" className={s.textButton} onClick={onRetry}>Erneut laden</button>
    </div>
  );
}

function Empty({ icon, title, text, href, cta }: { icon: IconName; title: string; text: string; href: string; cta: string }) {
  return (
    <div className={s.empty}>
      <span className={s.emptyIcon}><Icon name={icon} /></span>
      <div className={s.emptyBody}>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
      <Link href={href} className={s.ctaLink}>{cta}</Link>
    </div>
  );
}

const TOOLS: { icon: IconName; title: string; text: string; href: string }[] = [
  { icon: "assistant", title: "KI-Assistent", text: "Fragen stellen und verstehen", href: "/assistant" },
  { icon: "flashcard", title: "Karteikarten", text: "Aktiv lernen und wiederholen", href: "/documents" },
  { icon: "quiz", title: "Tests", text: "Dein Wissen überprüfen", href: "/documents" },
  { icon: "summary", title: "Zusammenfassen", text: "Unterlagen schnell verstehen", href: "/documents" },
];

export default function DashboardOverview() {
  const [now] = useState(() => Date.now());
  const [name] = useLoadable(loadProfileName);
  const [courses, reloadCourses] = useLoadable(loadCourses);
  const [events, reloadEvents] = useLoadable(loadEvents);
  const [recent, reloadRecent] = useLoadable(loadRecentDocuments);
  const [unfinished] = useLoadable(loadUnfinishedDocuments);
  const [openNotes] = useLoadable(loadOpenNotes);
  const [dueCards] = useLoadable(loadDueFlashcards);

  const courseTitles = useMemo(
    () => new Map(courses.status === "ready" ? courses.data.map((course) => [course.id, course.title]) : []),
    [courses]
  );
  const nextByCourse = useMemo(
    () => (events.status === "ready" ? nextEventByCourse(events.data, now) : new Map()),
    [events, now]
  );
  const attention = useMemo(
    () => (unfinished.status === "ready" ? attentionDocuments(unfinished.data) : { items: [], total: 0 }),
    [unfinished]
  );
  const upcoming = events.status === "ready" ? upcomingEvents(events.data, now, MAX_EVENTS) : [];
  const nextEvent = upcoming[0];

  // The "current" course is the one with the nearest upcoming event, so it reflects
  // real scheduling data. With no upcoming events, the most recently created course
  // (last in the ascending list) is shown instead. Never a fabricated "progress".
  const relevantCourse = useMemo<Course | null>(() => {
    if (courses.status !== "ready" || courses.data.length === 0) return null;
    if (nextEvent?.courseId) {
      const match = courses.data.find((course) => course.id === nextEvent.courseId);
      if (match) return match;
    }
    return courses.data[courses.data.length - 1];
  }, [courses, nextEvent]);

  const displayName = name.status === "ready" ? name.data : null;
  const quote = useMemo(() => dailyQuote(now), [now]);

  return (
    <div className={s.home}>
      <section className={s.hero}>
        <div className={s.heroImage} aria-hidden="true" />
        <div className={s.heroScrim} aria-hidden="true" />
        <div className={s.heroContent}>
          <p className={s.heroEyebrow}>{greeting(now).toUpperCase()}</p>
          {name.status === "loading" ? (
            <div className={s.heroTitleSkeleton} role="status"><span className={s.srOnly}>Wird geladen …</span></div>
          ) : (
            <h1>Hallo, {displayName ?? "zurück"} <span aria-hidden="true">👋</span></h1>
          )}
          <p className={s.heroLead}>Bereit für deine nächste Lerneinheit?</p>
          <blockquote className={s.heroQuote}>
            <span className={s.heroQuoteMark} aria-hidden="true">&ldquo;</span>
            <div>
              <p>{quote.text}</p>
              <cite>— {quote.author}</cite>
            </div>
          </blockquote>
          <Link href="/billing" className={s.heroPremium}>
            <span className={s.heroPremiumMark} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.3 5.6.4-4.3 3.6 1.4 5.4L12 14.3l-4.6 2.9 1.4-5.4L4.5 8.2l5.6-.4L12 2.5Z" /></svg>
            </span>
            <span className={s.heroPremiumText}>
              <strong>UniVerse Pro freischalten</strong>
              <small>Unbegrenzt lernen · {PRO_PRICE_LABEL}</small>
            </span>
            <span className={s.heroPremiumArrow} aria-hidden="true">→</span>
          </Link>
        </div>
        <p className={s.heroTagline} aria-hidden="true">
          <span>Lernen.</span>
          <span>Organisieren.</span>
          <span>Wachsen.</span>
          <span className={s.heroTaglineLast}>Deine Zukunft.</span>
        </p>
      </section>

      <div className={s.summaryRow}>
        <section className={s.card} aria-labelledby="upcoming-heading">
          <CardHead id="upcoming-heading" icon="calendar" title="Nächster Termin" action={<HeadLink href="/calendar">Zum Kalender</HeadLink>} />
          {events.status === "loading" && <div className={s.skeletonRow} aria-hidden="true" />}
          {events.status === "error" && <BlockError message="Deine Termine konnten nicht geladen werden." onRetry={reloadEvents} />}
          {events.status === "ready" && (nextEvent ? (
            <div className={s.nextEvent}>
              <span className={s.dateBadge} aria-hidden="true">
                <b>{formatDateKey(localDateKey(nextEvent.startsAt), { day: "2-digit" })}</b>
                <small>{formatDateKey(localDateKey(nextEvent.startsAt), { month: "short" })}</small>
              </span>
              <div className={s.nextEventBody}>
                <span className={s.rowMeta}>{eventDayLabel(nextEvent.startsAt, now)} · {KIND_LABELS[nextEvent.kind]}</span>
                <strong className={s.eventTitle}>{nextEvent.title}</strong>
                <span className={s.rowSub}>
                  {formatEventWhen(nextEvent.startsAt, nextEvent.endsAt, nextEvent.allDay)}
                  {nextEvent.courseId ? ` · ${courseTitles.get(nextEvent.courseId) ?? ""}` : ""}
                </span>
              </div>
              <Link href="/calendar" className={s.primaryPill}>Details<Icon name="chevron" className={s.pillIcon} /></Link>
            </div>
          ) : (
            <Empty icon="calendar" title="Keine anstehenden Termine" text="Vorlesungen, Abgaben und Prüfungen erscheinen hier." href="/calendar" cta="Termin eintragen" />
          ))}
        </section>

        <section className={s.card} aria-labelledby="course-heading">
          <CardHead id="course-heading" icon="course" title="Aktueller Kurs" action={<HeadLink href="/courses">Alle Kurse</HeadLink>} />
          {courses.status === "loading" && <div className={s.skeletonRow} aria-hidden="true" />}
          {courses.status === "error" && <BlockError message="Deine Kurse konnten nicht geladen werden." onRetry={reloadCourses} />}
          {courses.status === "ready" && (relevantCourse ? (
            <div className={s.currentCourse}>
              <div className={s.currentCourseRow}>
                <span className={s.courseBadge} data-tone={deriveCourseBadge(relevantCourse.title).color} aria-hidden="true">
                  {deriveCourseBadge(relevantCourse.title).code}
                </span>
                <div className={s.rowBody}>
                  <strong className={s.courseTitle}>{relevantCourse.title}</strong>
                  <span className={s.rowSub}>
                    {nextByCourse.get(relevantCourse.id)
                      ? `Nächster Termin: ${eventDayLabel(nextByCourse.get(relevantCourse.id)!.startsAt, now)}`
                      : relevantCourse.description || "Keine Beschreibung hinterlegt."}
                  </span>
                </div>
              </div>
              <Link href={`/courses/${relevantCourse.id}`} className={s.primaryPill} data-tone="purple">Kurs öffnen<Icon name="chevron" className={s.pillIcon} /></Link>
            </div>
          ) : (
            <Empty icon="course" title="Dein erster Kurs wartet" text="Ein Kurs bündelt Unterlagen, Notizen und Termine." href="/courses" cta="Kurs anlegen" />
          ))}
        </section>

        <section className={s.card} aria-labelledby="recent-heading">
          <CardHead id="recent-heading" icon="history" title="Zuletzt hinzugefügt" action={<HeadLink href="/documents">Alle Unterlagen</HeadLink>} />
          {recent.status === "loading" && <div className={s.skeletonRow} aria-hidden="true" />}
          {recent.status === "error" && <BlockError message="Deine Unterlagen konnten nicht geladen werden." onRetry={reloadRecent} />}
          {recent.status === "ready" && (() => {
            const document = recentDocuments(recent.data, 1)[0];
            if (!document) {
              return <Empty icon="file" title="Noch keine Unterlagen" text="Lade in einem Kurs Vorlesungsmaterial hoch." href="/courses" cta="Zu deinen Kursen" />;
            }
            const progress = describeIndexingProgress("ready", document.state);
            return (
              <Link href={`/courses/${document.courseId}/documents/${document.fileId}`} className={s.recentDoc}>
                <span className={s.docType} aria-hidden="true">{documentTypeLabel(document.mimeType)}</span>
                <span className={s.rowBody}>
                  <strong className={s.docName}>{document.name}</strong>
                  <span className={s.rowSub}>{courseTitles.get(document.courseId) ?? "Kurs"} · {formatAdded(document.addedAt)}</span>
                </span>
                <span className={s.chip} data-tone={progress.tone}>{TONE_LABELS[progress.tone]}</span>
                <Icon name="chevron" className={s.chevron} />
              </Link>
            );
          })()}
        </section>
      </div>

      {attention.total > 0 && (
        <section className={`${s.card} ${s.attentionCard}`} aria-labelledby="attention-heading" data-tone={attention.items.some(({ progress }) => progress.tone === "failed") ? "failed" : "info"}>
          <CardHead id="attention-heading" icon="file" title="Verarbeitungsstatus" />
          <ul className={s.docGrid}>
            {attention.items.map(({ document, progress }) => (
              <li key={document.materialId}>
                <Link href={`/courses/${document.courseId}/documents/${document.fileId}`} className={s.docRow} data-attention={progress.tone}>
                  <span className={s.docType} aria-hidden="true">{documentTypeLabel(document.mimeType)}</span>
                  <span className={s.rowBody}>
                    <strong className={s.docName}>{document.name}</strong>
                    <span className={s.rowSub}>{courseTitles.get(document.courseId) ?? "Kurs"} · {progress.label}</span>
                    {progress.detail && <span className={s.rowDetail}>{progress.detail}</span>}
                  </span>
                  <span className={s.chip} data-tone={progress.tone}>{TONE_LABELS[progress.tone]}</span>
                </Link>
              </li>
            ))}
          </ul>
          {attention.total > attention.items.length && <p className={s.more}>Weitere Dokumente findest du in den jeweiligen Kursen.</p>}
        </section>
      )}

      {openNotes.status === "ready" && openNotes.data.total > 0 && (
        <section className={s.card} aria-labelledby="open-notes-heading">
          <CardHead id="open-notes-heading" icon="file" title={`Offene Notizen (${openNotes.data.total})`} />
          <ul className={s.docGrid}>
            {openNotes.data.items.map((note) => (
              <li key={note.id}>
                <Link href={openNoteHref(note)} className={s.docRow}>
                  <span className={s.rowBody}>
                    <strong className={s.docName}>{note.text}</strong>
                    <span className={s.rowSub}>{courseTitles.get(note.courseId) ?? "Kurs"} · {note.materialTitle} · Seite {note.pageNumber}</span>
                  </span>
                  <span className={s.chip}>{note.kind === "highlight" ? "Markierung" : "Notiz"}</span>
                </Link>
              </li>
            ))}
          </ul>
          {openNotes.data.total > openNotes.data.items.length && <p className={s.more}>Weitere offene Notizen findest du in den jeweiligen Unterlagen.</p>}
        </section>
      )}

      <section className={`${s.card} ${s.toolsCard}`} aria-labelledby="tools-heading">
        <CardHead id="tools-heading" icon="bolt" title="Lern-Tools" />
        <div className={s.toolsGrid}>
          {TOOLS.map((tool) => (
            <Link key={tool.title} href={tool.href} className={s.toolCard}>
              <span className={s.toolIcon} data-icon={tool.icon} aria-hidden="true"><Icon name={tool.icon} /></span>
              <span className={s.toolBody}>
                <strong>{tool.title}</strong>
                <span>{tool.icon === "flashcard" && dueCards.status === "ready" && dueCards.data > 0
                  ? `${dueCards.data} ${dueCards.data === 1 ? "Karte" : "Karten"} fällig`
                  : tool.text}</span>
              </span>
              <Icon name="chevron" className={s.chevron} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
