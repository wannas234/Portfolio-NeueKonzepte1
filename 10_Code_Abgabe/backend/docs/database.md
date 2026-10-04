# Datenmodell der Lernapp

Das ERM wird durch `20260910180000_core_erm.sql` umgesetzt. Ein Kurs hat
genau einen Besitzer (`courses.owner_id → profiles.id`). Es gibt keine
Mitgliedertabelle. `uploaded_by` und `created_by` verweisen auf Profile.
Die Migration `20260911120000_core_rls.sql` beschränkt Clientzugriffe auf den
eigenen Kurs. Referenz war das ausgelesene lokale Datenbankschema.

| Tabelle                    | Zweck und Beziehungen                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `profiles`                 | Auth-Profil mit `user_id`, `name`, `avatar_url` und Zeitstempeln                                               |
| `courses`                  | Kurs mit Besitzer, Titel und Beschreibung                                                                      |
| `files`                    | Storage-Metadaten eines Kurses, einschließlich Uploader                                                        |
| `materials`                | Kursinhalt mit Ersteller, Typ und optionaler `file_id`                                                         |
| `source_documents`         | Verarbeitungsstatus und extrahierte Inhalte eines Quellenmaterials; siehe [Dokumentverarbeitung](documents.md) |
| `document_processing_jobs` | Private Verarbeitungsaufträge mit Versuchszähler und zeitlich begrenzter Reservierung                          |
| `documents`                | Höchstens ein Dokument pro Material, JSON-Inhalt, Dokumenttyp und optionale Quelldatei                         |
| `presentations`            | Höchstens eine Präsentation pro Material, mit optionaler Quelldatei                                            |
| `presentation_slides`      | Folien mit JSON-Inhalt; Nummer innerhalb der Präsentation eindeutig                                            |
| `summaries`                | Höchstens eine Zusammenfassung pro Material, JSON-Inhalt und optionale Quelldatei                              |
| `flashcard_decks`          | Höchstens ein Kartensatz pro Material                                                                          |
| `flashcards`               | Frage, Antwort und optionale JSON-Zusatzdaten eines Kartensatzes                                               |
| `chunks`                   | Dateiabschnitte mit Text, optionalem Vektor und Seitenzahl sowie JSON-Metadaten                                |
| `content_references`       | Quellenverweis von einem Chunk auf Dokument, Folie, Karte oder Zusammenfassung                                 |
| `document_chunks`          | Eingebettete Abschnitte eines Quelldokuments; siehe [Vektorsuche](rag.md)                                      |
| `document_indexing_jobs`   | Private Indexierungsaufträge mit Fortschrittscursor und zeitlich begrenzter Reservierung                       |
| `chat_conversations`       | Chat zu genau einem Kurs, mit Titel und Zeitstempeln; siehe [Chat](chat.md)                                    |
| `chat_messages`            | Verlauf mit fortlaufender `seq`, Rolle, Inhalt, Antwortanbieter/Modell, Tokenzahlen und Feedback zur Antwort   |
| `chat_message_sources`     | Belegte Quellen einer Antwort mit Zitatnummer, Verweisen und Momentaufnahme der Anzeige                        |
| `chat_requests`            | Reservierung und letzter Versuch pro Request-ID; Statusprojektion für eigene Konversationen lesbar             |
| `chat_admission`           | Private rollende Aufrufzählung je Nutzer; bleibt beim Löschen einer Konversation erhalten                      |
| `chat_execution_leases`    | Private Ausführungsslots, die bis zum Abschluss oder Ablauf auch eine Chatlöschung überleben                   |
| `calendar_events`          | Kalendertermin mit direktem Besitzer und optionalem Kursbezug; siehe unten                                     |
| `grade_assessments`        | Prüfungsleistung eines Kurses mit Gewichtung, optionaler Note und optionalen Punkten; siehe unten              |

## Präzisierungen des Diagramms

- Die gezeichnete optionale Datei-Material-Beziehung wird als `materials.file_id`
  umgesetzt: mehrere Materialien können dieselbe Datei verwenden.
- `flashcard_decks.id` ist der Primärschlüssel; `material_id` ist ein eindeutiger
  Foreign Key, wie bei den anderen Untertypen.
- `materials.type` enthält zusätzlich `flashcard_deck`. `quiz` und
  `source_document` waren im ursprünglichen ERM Typen ohne eigene Untertabelle.
  Ein hochgeladenes Quelldokument wird als Material vom Typ `source_document`
  mit Datei-Zuordnung erfasst. Seit Issue #29 enthält `source_documents` den
  Verarbeitungsstatus und Ergebnisse dieses Materials; `document_processing_jobs`
  verwaltet serverseitige Aufträge. `documents` gehört weiterhin zum Typ `document`.
  Quellenmaterialien werden beim bestätigten Upload serverseitig angelegt und ihre
  Datei-Zuordnung ist anschließend geschützt.
  Siehe [Dokumentverarbeitung](documents.md) für Rechte, Migration und API.
- Generierte `material_type`-Spalten und zusammengesetzte Foreign Keys sichern
  den passenden Untertyp. Ein Material kann ohne Unterdatensatz existieren,
  aber nicht gleichzeitig verschiedene Untertypen erhalten.
- Generierte Zielspalten in `content_references` bilden `target_type`/`target_id`
  auf echte Foreign Keys ab. Clients schreiben nur diese beiden Eingabefelder.
  Ungültige Ziele werden abgewiesen, gelöschte Ziele entfernen ihre Verweise.
- Profile behalten ihre bisherigen IDs. `user_id` wird aus `id` übernommen,
  ist eindeutig und referenziert `auth.users`. Ein Check erzwingt vorerst
  `id = user_id`, damit die vorhandenen Profil-Policies unverändert funktionieren.
  Die Registrierung erstellt weiterhin beide IDs automatisch.
- Das Profilfeld `display_name` heißt jetzt `name`. Auth-Registrierungsmetadaten
  verwenden weiterhin `display_name`; der Auth-Trigger übernimmt den Wert in `name`.
  Bestehende Clients müssen Profilabfragen und Updates entsprechend anpassen.
  `avatar_url` ist zunächst lesbar, erhält aber keine neuen Client-Schreibrechte.
- `chat_conversations` führt bewusst kein eigenes `owner_id`. Ein Kurs hat genau
  einen Besitzer und es gibt keine Mitgliedertabelle, also ist
  `chat_conversations → courses → profiles` bereits eindeutig. Eine zweite Kopie
  könnte von `courses.owner_id` abweichen; die Policies prüfen deshalb nur die
  Kurszugehörigkeit und überlassen die Besitzprüfung der Kurs-RLS.
  Nachrichten und ihre Quellen sind für Clients nur lesbar.
  `reserve_chat_request` prüft atomar Idempotenz und Limits, `complete_chat_request`
  speichert nur mit gültiger Reservierung und erneut geprüftem Kursbesitz.
  `append_chat_exchange` ist ein privater Transaktionshelfer. Die Migrationen
  ergänzen den vorhandenen OpenAI-Index um einen expliziten Anbietervertrag;
  ein Wechsel des Antwortmodells verändert keine Vektoren. Siehe [Chat](chat.md).

## Feedback zu Chat-Antworten

`20260920120000_chat_message_feedback.sql` (Issue #55) ergänzt `chat_messages`
um `helpful boolean` und `helpful_at timestamptz` statt einer eigenen
Feedback-Tabelle: Die Bewertung steht 1:1 zur Antwort, eine zweite Tabelle hätte
dieselbe Beziehung nur über einen zusätzlichen Join und eigene Policies
nachgebildet. `true`/`false`/`null` bedeuten hilfreich, nicht hilfreich und
nicht bewertet. Ein Check-Constraint hält beide Spalten paarweise konsistent,
ein zweiter erlaubt sie nur für `role = 'assistant'`.

Das ist das **erste Schreibrecht von Clients auf `chat_messages`**. Der Radius
bleibt durch das spaltenweise Grant exakt auf `helpful` begrenzt: `content`,
`seq`, `model`, `provider` und die Tokenzahlen haben kein Update-Grant und sind
damit unabhängig von jeder Policy unveränderlich. Die Policy verlangt zusätzlich
Kursbesitz und `role = 'assistant'`. `helpful_at` setzt ein Trigger, damit der
Bewertungszeitpunkt nicht vom Client stammt; er ist die Zeitachse der Auswertung,
denn `created_at` ist der Zeitpunkt der Antwort.

Die Auswertung ist `public.chat_feedback_stats(p_from, p_to)` und liefert je
Anbieter und Modell die Zahl hilfreicher und nicht hilfreicher Antworten. Sie
läuft `security definer`, weil sie bewusst über alle Besitzer hinweg zählt, und
ist ausschließlich für `service_role` ausführbar — eine Betriebssicht, kein
Client-Feature. Getestet in `chat_feedback.test.sql`.

Die Auswertung zeigt den **aktuellen Bewertungszustand**, keine historische
Ereignisreihe. `helpful_at` ist die letzte tatsächliche Bewertungsänderung;
ein identischer erneuter Wert verändert den Zeitstempel nicht. `p_from` ist
inklusive, `p_to` exklusiv. Ein Wechsel von positiv zu negativ verschiebt die
Bewertung in das neue Zeitfenster, ein Zurücknehmen entfernt sie aus der
Auswertung. Auch das Löschen der Konversation entfernt ihr Feedback. Vergangene
Zeitfenster sind daher keine unveränderlichen Berichte.

## Kalendertermine

`calendar_events` (`20260914210000_calendar_events.sql`) folgt nicht dem
Vererbungsmuster der Materialtabellen, sondern dem direkten Besitzmuster von
`courses`: jeder Termin hat ein eigenes `owner_id → profiles.id`, weil nicht
jeder Termin an einen Kurs gebunden ist (z. B. eine private Erinnerung ohne
Kurs). `course_id` ist daher optional und verweist auf `courses(id)`; beim
Anlegen und Ändern erzwingen die Policies zusätzlich, dass ein gesetzter
`course_id` dem Nutzer selbst gehört. `kind` ist `text` mit Check-Constraint
(`lecture`, `exercise`, `study`, `presentation`, `exam`, `deadline`, `other`),
kein natives Enum, analog zu `materials.type`. `updated_at` wird automatisch
gepflegt.

Client-Rechte: CRUD ausschließlich auf eigene Termine (`owner_id = auth.uid()`).
Änderbare Spalten sind `course_id`, `title`, `description`, `kind`, `starts_at`,
`ends_at`; `owner_id`, `id` und Zeitstempel bleiben unveränderlich. Löscht ein
Nutzer einen verknüpften Kurs, werden dessen Termine per Cascade mit entfernt;
private Termine ohne Kurs bleiben davon unberührt. Getestet in
`calendar_events.test.sql`.

`ends_at` bleibt optional (`NULL` erlaubt). Ist es gesetzt, erzwingt
`20260916174001_calendar_events_end_after_start.sql` per Check-Constraint
`ends_at > starts_at` — ein Ende vor oder gleich dem Start wird abgewiesen.
Diese Migration folgt auf die bereits gemergte `calendar_events`-Migration
und ändert diese bewusst nicht nachträglich.

`20260916181129_calendar_events_all_day.sql` ergänzt `all_day boolean not
null default false` als reines Anzeige-/Semantikflag — ein ganztägiger
Termin speichert weiterhin echte `starts_at`/`ends_at`-Werte (lokale
Tagesgrenzen, vom Client berechnet), sodass die bestehende Datumsbereichslogik
und der `ends_at > starts_at`-Constraint unverändert weitergelten.

Typen sind synchron; das klassische CRUD inklusive Terminende und
Ganztägig-Flag ist backendseitig abgeschlossen.

Bewusst nicht Teil des Funktionsumfangs: automatisch erkannte Termine aus der
Dokumentverarbeitung (dafür fehlt aktuell Chunking, Embeddings und ein
LLM-Analyseschritt — eigenes, späteres Projekt), Erinnerungen/Benachrichtigungen
und wiederkehrende Termine. Die Frontend-Anbindung folgt separat.

## Prüfungsleistungen

`grade_assessments` (`20260916161514_grade_assessments.sql`) hat bewusst
**keinen eigenen Besitzer** — anders als `calendar_events` ist jede
Prüfungsleistung zwingend einem Kurs zugeordnet (`course_id not null`), und
Kursbesitz ist darüber bereits eindeutig ableitbar. Ein redundantes
`owner_id` würde nur eine zweite Quelle der Wahrheit schaffen. RLS prüft
daher für alle vier Operationen denselben Join:
`exists (select 1 from public.courses c where c.id = grade_assessments.course_id and c.owner_id = (select auth.uid()))`.

`kind` (`exam`, `presentation`, `assignment`, `project`, `exercise`,
`oral_exam`, `other`) und `status` (`planned`, `submitted`, `graded`) sind
`text` mit Check-Constraint, kein natives Enum, analog zu `materials.type`
und `calendar_events.kind`.

Konsistenz zwischen `status` und `grade` wird durch einen eigenen
Check-Constraint erzwungen: `graded` verlangt eine gesetzte Note, jeder
andere Status verlangt `grade is null`. `points_earned`/`points_max` müssen
gemeinsam `NULL` oder gemeinsam gesetzt sein, mit `points_earned <=
points_max` und `points_max > 0`. `grade` liegt zwischen 1,0 und 5,0. Titel
und Notizen haben Längenlimits (`title` 1–200, `notes` bis 2000 Zeichen).

### ECTS statt Prozentgewichtung

Ursprünglich hatte `grade_assessments` ein `weight`-Feld (0–100 %). Nach dem
Merge der Basismigration nach `dev` (angenommen bereits auf die geteilte
Development-Umgebung deployt) wurde per Folgemigration
`20260916173837_grade_assessments_ects.sql` auf `ects_credits` umgestellt,
statt die gemergte Migration nachträglich zu bearbeiten:

- `ects_credits` ist `numeric` **ohne feste Skala** (nicht `numeric(4,1)`):
  eine feste Skala würde überzählige Nachkommastellen beim Insert still
  runden statt abzuweisen. Der Check-Constraint
  `ects_credits > 0 and ects_credits <= 60 and ects_credits = round(ects_credits, 1)`
  erzwingt Bereich und maximal eine Nachkommastelle gegen den tatsächlich
  eingegebenen Wert.
- Es gibt **keine** automatische Umrechnung von Prozent zu ECTS (unterschiedliche
  Einheiten, keine gültige Formel). Die Tabelle enthielt zum Zeitpunkt der
  Migration ausschließlich lokale Entwicklungs-/Seed-Daten, keine echten
  Nutzerdatensätze; bestehende Zeilen wurden mit einem klar willkürlichen
  Platzhalter (`1`) aufgefüllt, damit `NOT NULL` gesetzt werden konnte.
- Die kursübergreifende Summe der ECTS wird **nicht** auf einen festen Wert
  erzwungen (anders als bei Semesterwochenstunden gibt es keine allgemeingültige
  Zielsumme pro Kurs). Das Frontend zeigt erfasste, bewertete und offene ECTS
  sowie den ECTS-gewichteten Zwischenstand.

Client-Rechte: CRUD auf Prüfungsleistungen des eigenen Kurses. Änderbare
Spalten sind `title`, `kind`, `status`, `ects_credits`, `grade`,
`assessment_date`, `points_earned`, `points_max`, `notes`; `course_id`
bleibt nach dem Anlegen unveränderlich (Kurswechsel erfolgt über
Löschen und Neuanlegen, wie bei anderen unveränderlichen Elternbeziehungen
in diesem Schema). Löscht ein Nutzer den zugehörigen Kurs, werden dessen
Prüfungsleistungen per Cascade mit entfernt. Getestet in
`grade_assessments.test.sql`.

## Constraints, Indizes und Lebenszyklus

Alle Tabellen besitzen UUID-Primärschlüssel. Pflichtbeziehungen sind `NOT NULL`.
Dateigrößen sind nicht negativ; Chunk-Indizes beginnen bei 0, Foliennummern und
Seitenzahlen bei 1. Storage-Bucket und Pfad bilden gemeinsam eine eindeutige
Adresse. Namen und Titel müssen nicht global eindeutig sein.

Indizes decken Kurslisten, Ersteller, Quelldateien und Quellenziele ab.
Unique Constraints indexieren Untertyp-Zuordnungen sowie Chunk- und Folienreihenfolge.
`embedding` verwendet pgvector ohne feste Dimension und darf bis zur Verarbeitung
NULL sein. Modell, Dimension und Suchindex werden mit der RAG-Implementierung
festgelegt; die Seed-Vektoren mit drei Dimensionen sind reine Beispieldaten.

Auth-/Profil- und Kurslöschungen entfernen abhängige Inhalte per Cascade.
Materiallöschungen entfernen Untertypen, Präsentationen ihre Folien und
Kartensätze ihre Karten. Dateilöschungen entfernen Chunks und deren Referenzen,
setzen aber optionale Datei-Verweise auf NULL; erzeugte Inhalte bleiben erhalten.
Die Binärdateien im Storage benötigen einen gesonderten Löschablauf über die
Storage-API. Seeds enthalten nur Metadaten und laden keine Dateien hoch.

Zeitstempel folgen dem ERM: `files`, `chunks` und `content_references` haben nur
`created_at`; die übrigen Tabellen zusätzlich automatisch gepflegtes `updated_at`.

## Zugriff durch RLS

Alle Tabellen haben RLS. `anon` erhält keine Tabellenrechte. Für `authenticated`
gelten folgende Regeln; die Identität stammt ausschließlich aus `auth.uid()`:

| Tabellen                                                     | Clientrechte                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `profiles`                                                   | Eigenes Profil lesen, ausschließlich `name` ändern; Auth verwaltet Erstellung und Löschung  |
| `courses`                                                    | Eigene Kurse erstellen, lesen, bearbeiten und löschen                                       |
| `files`, `materials`                                         | CRUD im eigenen Kurs; `uploaded_by` bzw. `created_by` muss der Nutzer sein                  |
| `documents`, `presentations`, `summaries`, `flashcard_decks` | CRUD über das eigene Material                                                               |
| `presentation_slides`, `flashcards`                          | CRUD über die eigene Präsentation bzw. den eigenen Kartensatz                               |
| `chunks`, `content_references`                               | Eigene Daten lesen; Schreiben ausschließlich durch privilegierte Serververarbeitung         |
| `calendar_events`                                            | CRUD auf eigene Termine; optionaler Kursbezug muss dem Nutzer selbst gehören                |
| `grade_assessments`                                          | CRUD auf Prüfungsleistungen des eigenen Kurses; Kursbesitz wird bei jeder Operation geprüft |

Jede erlaubte Operation hat eine eigene Policy. UPDATE prüft mit `USING` den
vorherigen und mit `WITH CHECK` den neuen Zustand. Die Elternabfragen unterliegen
selbst RLS; es gibt keine zusätzlichen SECURITY-DEFINER-Funktionen. Ohne Nutzer-ID
sind keine Zeilen sichtbar und keine Inserts erlaubt. Fremde UPDATE-/DELETE-Ziele
liefern null betroffene Zeilen; verbotene Inserts und fehlende Spaltenrechte einen
Berechtigungsfehler. Clients müssen Fehler und betroffene Zeilen auswerten.

Spaltenrechte erlauben INSERT mit optional eigener UUID, aber ohne Zeitstempel.
UPDATE erlaubt ausschließlich die bearbeitbaren Inhalte:

| Tabelle               | Änderbare Spalten                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `courses`             | `title`, `description`                                                                                        |
| `files`               | `original_filename`                                                                                           |
| `materials`           | `file_id`, `title`, `description`                                                                             |
| `documents`           | `source_file_id`, `document_type`, `content`                                                                  |
| `presentations`       | `source_file_id`, `title`, `description`                                                                      |
| `summaries`           | `source_file_id`, `content`                                                                                   |
| `flashcard_decks`     | `title`, `description`                                                                                        |
| `presentation_slides` | `slide_number`, `title`, `content`                                                                            |
| `flashcards`          | `question`, `answer`, `additional_content`                                                                    |
| `calendar_events`     | `course_id`, `title`, `description`, `kind`, `starts_at`, `ends_at`, `all_day`                                |
| `grade_assessments`   | `title`, `kind`, `status`, `ects_credits`, `grade`, `assessment_date`, `points_earned`, `points_max`, `notes` |

IDs, Eigentümer, Ersteller, Elternbeziehungen, Materialtyp und Zeitstempel bleiben
bei Client-Updates unveränderlich. Storage-Adresse, MIME-Typ und Dateigröße werden
beim Anlegen erfasst; spätere Korrekturen gehören zum serverseitigen Uploadablauf.
TRUNCATE und andere administrative Tabellenrechte sind nicht freigegeben.
Bestehende Indizes decken Besitzerfilter und die Elternbeziehungen ab.

Optionale Datei-Verweise müssen im selben Kurs liegen, auch wenn beide Kurse
demselben Nutzer gehören. NULL bleibt erlaubt. Quellenreferenzen sind nur sichtbar,
wenn sowohl Chunk als auch Ziel sichtbar sind und zum selben Kurs gehören. Das gilt
für Dokumente, Folien, Karten und Zusammenfassungen. RLS filtert auch inkonsistente
Daten aus, die ein privilegierter Prozess nachträglich schreiben könnte.

Die Migration prüft vorhandene Daten vor der Freigabe und bricht bei abweichenden
Besitzern oder kursübergreifenden Quellen/Zielen atomar ab. Sie repariert oder löscht
keine Daten automatisch. `service_role` umgeht RLS weiterhin: Serverjobs müssen
Uploader/Ersteller, Kurszuordnungen und Quellen/Ziele selbst validieren und bei
Änderungen an Elternzuordnungen alle abhängigen Daten berücksichtigen. Die neuen
Policies ersetzen keine Integritätsconstraints für privilegierte Schreibzugriffe.

`files` schützt nur Metadaten. Tatsächliche Dateien liegen im privaten Bucket
`learning-files` mit eigenen Policies auf `storage.objects`; siehe [Storage](storage.md).
Aus einem frei angegebenen Metadatenpfad darf ein Server keine Download- oder
Löschberechtigung ableiten.

## Prüfung

`core_erm.test.sql` prüft weiterhin Constraints, Untertypen, Quellenziele,
Löschungen, Zeitstempel und RLS-Aktivierung. `core_rls.test.sql` prüft echte
Rollenwechsel mit zwei Nutzern und mehreren Kursen: eigene CRUD-Zugriffe,
verbotene fremde Zugriffe, Quellenzuordnungen, unveränderliche Spalten, fehlende
Identität, anonyme Zugriffe, Serverdaten und Löschkaskaden. Die bestehenden
Profiltests sichern die unveränderten Auth-/Profilrechte ab. Alle Teständerungen
werden durch `ROLLBACK` zurückgenommen.

Prüfen mit `npm run test:db` und `npm run db:lint` nach `npm run db:apply`.

Grundlagen: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
und [PostgreSQL Row Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

## Automatisch generierte Zusammenfassungen

`summary_jobs` und `summary_requests` verwalten private, wiederaufnehmbare
Generierungsaufträge und idempotente Requests. `summary_generations` ergänzt
quellenbezogene Metadaten zu `summaries`. Generierte Originale sind für Clients
schreibgeschützt; manuelle Zusammenfassungen bleiben bearbeitbar. Details und
Frontend-Vertrag: [summaries.md](summaries.md).
