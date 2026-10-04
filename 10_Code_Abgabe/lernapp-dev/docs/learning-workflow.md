# Lernfunktionen: manuelle Inhalte, Fortschritt, Entwürfe und Quiz

Die Migrationen `20261003140000` bis `20261003142000` ergänzen den vorhandenen
Summary- und Karteikarten-Workflow. Sie enthalten keine Frontend-Anbindung und
keine neue KI-Generierung. Generierte Zusammenfassungen bleiben in `summaries`
mit `generation_kind=document|course`; generierte Decks werden weiterhin über
`flashcard_jobs` gespeichert. Deren Quellenmodelle bleiben unverändert.

## Berechtigungen und Wiederholungen

Alle öffentlichen Schreib-RPCs prüfen `auth.uid()` und den Kursbesitz, laufen mit
festem leerem `search_path` und sind nur für `authenticated` freigegeben. RLS
schützt lesbare Tabellen. Die interne Funktion `begin_learning_write` und die
Tabelle `learning_write_requests` sind für Clients gesperrt.

Für Deck-Erstellung, Kartenreviews, Quiz-Erstellung und Beginn eines Quizversuchs
erzeugt der Client **eine UUID pro Benutzeraktion** und behält sie für Retries.
Gleiche ID und gleiche Eingaben geben das ursprüngliche Ergebnis zurück, auch bei
parallelen Requests. Andere Eingaben oder ein anderer Aktionstyp mit derselben ID
führen zu `REQUEST_CONFLICT` (22023). Die IDs gelten pro Nutzer über diese Aktionen
hinweg. Fehlgeschlagene Transaktionen hinterlassen keinen Beleg.

Die gespeicherten Ergebnisse sind Antworten auf den ursprünglichen Request,
keine aktuellen Ansichten. Nach einem Retry aktuelle Tabellen neu laden.
Request-Belege werden beim Löschen des Kurses oder Nutzers entfernt. Es gibt
bewusst keine zeitbasierte Bereinigung, die alte Retries wieder als neue Aktionen
behandeln würde.

## Manuelle Inhalte

| RPC                    | Parameter                                | Rückgabe                                  |
| ---------------------- | ---------------------------------------- | ----------------------------------------- |
| `save_course_summary`  | `p_course`, `p_title`, `p_text`          | `material_id`, `summary_id`, `updated_at` |
| `create_manual_deck`   | `p_course`, `p_title`, `p_request_id`    | `material_id`, `deck_id`                  |
| `update_learning_deck` | `p_material`, `p_title`, `p_description` | void                                      |

`save_course_summary` sperrt den Kurs während der Transaktion. Es aktualisiert
nur die älteste **manuelle** Summary ohne `source_file_id`, oder legt eine neue
an. Verwaiste Materialien werden ignoriert, bestehende Duplikate nicht gelöscht.
Generierte Kurszusammenfassungen werden niemals ausgewählt. Der Schutz vor
parallelen Erst-Speicherungen gilt für Aufrufe dieses RPCs; bestehende direkte
Schreibrechte auf manuelle Summaries werden nicht verändert.

Summary-Titel: 1–200 Zeichen; Text: 1–30000 Zeichen, jeweils nach Trimmen.
Ein manuelles Deck startet leer; Karten können über die bestehenden
Karten-Schreibrechte hinzugefügt werden. Nach einer Umbenennung funktioniert ein
Retry der ursprünglichen Deck-Erstellung weiterhin. Nach dem Löschen des Decks
liefert derselbe Request `RESULT_DELETED` (55000).

`update_learning_deck` ändert Material und Deck gemeinsam. Titel: 1–200 Zeichen,
Beschreibung: höchstens 2000 Zeichen; leer oder null entfernt die Beschreibung.
Dies gilt auch für vorhandene KI-generierte Decks.

## Lernfortschritt

`record_flashcard_review(p_card, p_known, p_request_id)` liefert den gespeicherten
Fortschritt als JSON. Ein erfolgreicher Review startet bei einem Tag und verdoppelt
danach das Intervall bis maximal 365 Tage. Ein fehlgeschlagener Review setzt das
Intervall auf einen Tag und den Wiederholungszähler auf null. Ein Retry zählt nicht
erneut. Unabhängige gleichzeitige Reviews werden unter einer Zeilensperre verarbeitet.

`flashcard_progress` ist lesbar. Clients dürfen nur `user_id`, `card_id`, `starred`
einfügen und `starred` ändern; bekannte Karten und Termine setzt ausschließlich
der Review-RPC. `flashcard_review_events` ist ein nur lesbares Ereignisprotokoll.

`learning_deck_progress_counts(p_material_ids uuid[])` liefert pro sichtbarem Deck:

- `total`: alle Karten;
- `new`: Karten ohne Review, einschließlich nur markierter Karten;
- `reviewed`: mindestens einmal bearbeitete Karten;
- `known`: zuletzt richtig beantwortete Karten;
- `due`: Karten mit erreichtem Wiederholungstermin.

Neue Karten sind separat von fälligen Wiederholungen. Leere Decks liefern Nullen;
fremde Decks werden nicht zurückgegeben. `known` und `due` können sich überlappen.

## Entwürfe und mehrere Tabs

`learning_drafts` ist nur lesbar; geschrieben wird über
`save_learning_draft(p_source_material, p_kind, p_payload, p_expected_revision)`.

- `kind=summary`: Payload enthält `text` als String, maximal 30000 Zeichen.
- `kind=flashcards`: Payload enthält `cards` als Array mit maximal 300 Objekten;
  jedes hat `question` (maximal 1000 Zeichen) und `answer` (maximal 4000 Zeichen).
- Leere Texte sind für unfertige Eingaben erlaubt. Gesamte Payload: maximal 100000 Bytes.
- Zusätzliche JSON-Felder können UI-Kontext speichern; sie werden nicht als fertige
  Inhalte oder vertrauenswürdige Quellen interpretiert.

Erstes Speichern: erwartete Revision `0`. Der RPC gibt eine neue Revision zurück.
Beim nächsten Speichern muss diese Revision mitgesendet werden. Bei einem Konflikt
liefert er `DRAFT_CONFLICT` (40001); der Client soll den neuen Stand laden und den
Benutzer entscheiden lassen, statt blind zu wiederholen.

SQL-NULL als `p_payload` löscht nur die erwartete Revision und gibt `0` zurück.
**Erst nach erfolgreicher endgültiger Speicherung löschen.** Wenn zwischenzeitlich
ein anderer Tab weitergeschrieben hat, bleibt dessen Entwurf erhalten. Auch nach
Löschen und Neuerstellen wird eine alte Revisionsnummer niemals wiederverwendet.
JSON-`null` ist kein gültiger Entwurf.

KI-Job-Checkpoints und deren Review-Ergebnisse bleiben im vorhandenen Job-System;
die neue Tabelle ersetzt diese nicht.

## Quiz und Versuche

```ts
const { data, error } = await supabase.rpc('save_learning_quiz', {
  p_source_material: materialId,
  p_title: 'Wiederholung',
  p_questions: [
    {
      question: 'Welche Antwort stimmt?',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 0,
      source_chunk_ids: [chunkId], // optional, maximal 20 pro Frage
    },
  ],
  p_request_id: requestId,
  // p_previous_quiz: previousQuizId, // nur für eine neue Revision
});
```

Ein Quiz enthält 1–10 Fragen. Fragetext: 1–1000 Zeichen; genau vier nichtleere
Antworttexte mit maximal je 2000 Zeichen; `correctIndex` muss eine JSON-Zahl und
ganzzahlig zwischen 0 und 3 sein. Die Eingabe ist auf 100000 Bytes begrenzt.

Quellen werden pro Frage serverseitig aus `document_chunks` abgeleitet. Jeder Chunk
muss zum angegebenen Quelldokument gehören. Gespeichert werden Dokument-, Material-
und Chunk-ID, Titel, Seite und Auszug. Vom Client gelieferte `sources` werden nicht
übernommen. Die Snapshots bleiben nach einer Neuindexierung erhalten; IDs sind
historische Referenzen und müssen nicht mehr auf einen vorhandenen Chunk zeigen.
Beim Löschen des Quelldokument-Materials werden Quiz und Versuche mitgelöscht.

Rückgabe: `quiz_id`, `family_id`, `revision`. Mit `p_previous_quiz` entsteht eine
neue unveränderliche Revision derselben Familie. Eine veraltete Vorgängerversion
führt zu `QUIZ_REVISION_CONFLICT` (40001). Alte Versuche verweisen weiter auf ihre
ursprüngliche Quizrevision.

`start_learning_quiz_attempt(p_quiz, p_request_id)` gibt `attempt_id` und
`revision=1` zurück. Eine neue ID beginnt einen weiteren Versuch.

`save_learning_quiz_attempt(p_attempt, p_answers, p_expected_revision, p_submit=false)`
speichert Antworten als positionsbezogenes Array: `[0, null, 2]`. Bei Zwischenständen
sind fehlende Antworten und JSON-null erlaubt. Bei Abgabe müssen alle Fragen mit
Ganzzahlen 0–3 beantwortet sein. Der Server berechnet `score` als Anzahl richtiger
Antworten; die Gesamtzahl ergibt sich aus dem zugehörigen Quiz.

Die Rückgabe enthält den Versuch einschließlich neuer Revision, Score und
`submitted_at`. Veraltete Änderungen ergeben `ATTEMPT_CONFLICT` (40001).
Abgeschlossene Versuche sind unveränderlich (`ATTEMPT_SUBMITTED`, 55000).
Ein identischer unmittelbarer Retry mit der ursprünglichen erwarteten Revision
liefert das bereits gespeicherte Ergebnis, ohne erneut zu schreiben.

Dies ist ein Selbstlernquiz: Besitzer dürfen die richtigen Antworten lesen.
Es ist kein Prüfungsmodus mit geheimen Lösungen. Die ursprüngliche Erweiterung enthält keine KI-Generierung. Diese wird durch
[Quizgenerierung](quiz-generation.md) ergänzt. Dort sind auch die optionalen
Erklärungen und die Quellenanforderungen für KI-Fragen dokumentiert.

## Prüfen

Standardmäßig laufen die SQL-Tests über `npm run test:db`. Die vorhandenen
Summary- und Flashcard-HTTP-Integrationstests bleiben unverändert nutzbar.

Zusätzlicher isolierter Neuaufbau mit Parallelitätstests:

```sh
npm run test:learning
```

Der Runner erstellt bei Bedarf `lernapp-learning-test` ohne Netzwerk mit derselben
PostgreSQL-Imageversion wie der lokale Supabase-Stack. Er übernimmt nur das Infrastruktur-Schema aus `supabase_db_lernapp`, keine
Benutzerdaten oder Vault-Inhalte. Er baut das Anwendungsschema im isolierten
Testcontainer aus allen Migrationen neu auf und verwendet die lokalen Seed-Daten.
Der Testcontainer bleibt zur Inspektion bestehen. Ein erneuter Lauf ersetzt nur
dessen Testdatenbank-Schema. Die Entwicklungsdatenbank wird dabei nicht verändert.
