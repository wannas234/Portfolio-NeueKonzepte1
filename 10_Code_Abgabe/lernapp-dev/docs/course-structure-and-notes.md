# Kursstruktur und Seitennotizen

`20261004090000_course_structure_and_notes.sql` ergänzt bestehende Kurse und
Materialien. Die Migration benötigt keine der alten `learning-artifacts-schema`-
oder `learning-workflow-schema`-Migrationen.

## Kursmetadaten

Besitzer können `courses.semester` (1–100 Zeichen), `lecturer` (1–200 Zeichen)
und `target_grade` (1,0–5,0, zwei Nachkommastellen) beim Anlegen und Bearbeiten
setzen. Alle drei Felder sind optional; zum Leeren `null` verwenden. Leere oder
nur aus Leerzeichen bestehende Semester-/Dozentenangaben werden abgewiesen.
Die bestehenden Kursrechte gelten auch für diese Felder.

## Vorlesungen

`lectures` enthält `id`, `course_id`, `title`, optional `held_on` sowie serverseitige
Zeitstempel. Der Titel umfasst 1–200 Zeichen nach Trimmen. Nur der Kursbesitzer
kann Vorlesungen lesen, anlegen, bearbeiten oder löschen. Nach dem Anlegen sind
nur `title` und `held_on` änderbar.

`materials.lecture_id` ist eine optionale Zuordnung zu genau einer Vorlesung
desselben Kurses. Sie kann gesetzt, geändert oder mit `null` entfernt werden.
Ein fremder oder nicht passender Vorlesungsverweis ergibt `LECTURE_NOT_FOUND`
(23514). Das Löschen einer Vorlesung entfernt nur die Zuordnung; Materialien und
Notizen bleiben erhalten. Das Löschen eines Kurses entfernt seine Vorlesungen.

Die Zuordnungsspalte ist beim INSERT und UPDATE freigegeben. Bestehende Regeln
für Materialien gelten weiterhin: Quelldokumente entstehen über den vorhandenen
serverseitigen Uploadprozess, nicht durch direkte Client-INSERTs. Ein Client
kann das entstandene Material anschließend einer Vorlesung zuordnen.

## Private Seitennotizen

`document_notes` gehört zum angemeldeten Nutzer und einem eigenen Material vom
Typ `source_document`. Beim Anlegen übergeben:

| Feld          | Bedeutung                                                 |
| ------------- | --------------------------------------------------------- |
| `user_id`     | ID des angemeldeten Nutzers                               |
| `material_id` | Eigenes Quelldokument                                     |
| `page_number` | Positive Seitennummer, beginnend bei 1                    |
| `kind`        | `note` oder `highlight`                                   |
| `body`        | Für `note` nicht leer; maximal 4000 Zeichen               |
| `quote`       | Für `highlight` erforderlich; 1–2000 Zeichen nach Trimmen |

Der Status startet als `open`. Danach sind ausschließlich `body` und `status`
(`open`/`resolved`) änderbar. Seite, Dokument, Art, Zitat und Besitzer bleiben
unveränderlich. Eigene Notizen können gelöscht werden. Beim Löschen des
Quelldokuments werden seine Notizen ebenfalls gelöscht.

Seite und Zitat sind einfache Anker. Die Datenbank prüft weder die tatsächliche
Seitenzahl noch das Vorkommen des Zitats. PDF-Koordinaten und Textoffsets sind
nicht enthalten; eine positionsgenaue Markierung benötigt eine spätere Erweiterung.

## Validierung

`supabase/tests/database/course_structure_and_notes.test.sql` prüft Wertebereiche,
Nutzerisolation, Spaltenrechte, Kurszuordnung und Löschverhalten. Der Test läuft
mit `npm run test:db` und im isolierten Neuaufbau über `npm run test:course-structure`.
Der isolierte Runner prüft zusätzlich die bestehenden
Zusammenfassungen und Materialanalyse. Es gibt keine neue Frontend-Anbindung.
