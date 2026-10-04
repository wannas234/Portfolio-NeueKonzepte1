# PDF-Pipeline: Prüfergebnisse

Stand: 02.10.2026, Branch `feat/gemini-ocr`, Ausgangscommit `e6efcea2806dea293f37f2f8a94dc75c19a837d5`, Änderungen nicht committed. Alle Prüfungen lokal. Einzige Ausnahme: zwei freigegebene Diagnoseanfragen an Gemini für eine einzelne Seite (siehe „Diagnose Seite 51“).

## Tatsächlich ausgeführt (finaler Stand)

| Prüfung                                                                         | Ergebnis                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run functions:test`                                                        | 54 Tests, 10 Steps bestanden, 0 Fehler                                  |
| `npm run functions:check`                                                       | erfolgreich, keine Typfehler                                            |
| `npm run functions:lint`                                                        | erfolgreich, 44 Dateien                                                 |
| `npm run test:tools`                                                            | 30 Tests: 29 bestanden, 1 übersprungen (DB-Parallelitätstest, s. unten) |
| `node scripts/test-document-pipeline-db.mjs` (isolierter Container)             | 176 SQL-Prüfungen bestanden, eingebetteter Parallelitätstest bestanden  |
| `PIPELINE_DB_TEST=1 node --test scripts/document-pipeline-concurrency.test.mjs` | zweimal direkt hintereinander bestanden                                 |
| `npx prettier --check` auf allen geänderten/neuen Dateien                       | ohne Befund                                                             |
| Offline-Seitenauswahl `scripts/benchmark-document-routing.ts`                   | erneut ausgeführt, Ergebnis identisch mit `offline-results.json`        |

SQL-Prüfungen nach Datei: `visual_document_processing` 16, `document_pipeline_throughput` 29, `document_pipeline_events` 12, `document_processing_schedule` 7, `document_rag` 50, `hybrid_search` 12, `source_documents` 50.

Datenbanktests liefen im Container `lernapp-pipeline-test` (`public.ecr.aws/supabase/postgres:17.6.1.165`, `--network none`). Aus `supabase_db_lernapp` wurde nur das Schema per `pg_dump --schema-only` gelesen; Nutzerdaten und Vault wurden nicht gelesen oder verändert. Das Anwendungsschema wird im Testcontainer aus den Repository-Migrationen aufgebaut, Seeds sind synthetisch.

Nach der Änderung für unvollständige Seiten (nur TypeScript, kein SQL) wurden `functions:test`, `functions:check`, `functions:lint` und Prettier erneut ausgeführt; Tooltests und DB-Suite sind davon nicht betroffen und stammen aus dem vorherigen Lauf.

Nicht ausgeführt: `npm run db:lint` und die übrige CI.

Rohprotokolle, Schema-Dump und Router-Diagnosen liegen nur lokal und flüchtig unter `/private/tmp/lernapp-pipeline-archive-20261002/` (`final-logs/` = Läufe dieses Stands; `db-concurrency.log` dort ist der fehlgeschlagene Lauf vor der Testkorrektur). Sie enthalten Textfragmente der Benchmark-PDFs und gehören nicht ins Repository.

### Während der Abschlussprüfung korrigiert

- Der separat aufgerufene Parallelitätstest war innerhalb von 90 s nach einem vorherigen Lauf nicht wiederholbar: Der zuletzt belegte Embedding-Slot bleibt nach Löschen der Testdokumente bis zum Ablauf bestehen (gewolltes Verhalten, siehe Doku) und belegte das globale Limit. Der Test setzt Slots und Minutenfenster im isolierten Container jetzt vor und nach dem Lauf zurück. Kein Produktcode geändert.
- `docs/document-pipeline-performance.md` nannte für die Vorlesung 63 statt der gespeicherten und reproduzierten 61 ausgewählten Seiten; Live-Umfang daher 376 statt 380 Seitenaufrufe. Korrigiert.
- `offline-results.json` mit Prettier formatiert (inhaltlich unverändert).

## Diagnose Seite 51 (Live, mit Freigabe)

Ein lokaler Upload von `Neue Konzepte 2026 - VL1.pdf` schlug mit `PROCESSING_TIMEOUT` fehl: 60 von 61 visuellen Seiten erfolgreich, Seite 51 sechsmal `incomplete_visual_result` (HTTP 200, ca. 2.200 Ausgabetokens). Seite 51 wurde daraufhin je einmal direkt an Gemini geschickt:

| Einstellungen                        | Ergebnis                         | `finishReason` | `complete` | Dauer  | Tokens Bild/Ausgabe/Thinking |
| ------------------------------------ | -------------------------------- | -------------- | ---------- | ------ | ---------------------------- |
| A: legacy, Thinking/Medien `DEFAULT` | verworfen (`INCOMPLETE_VISUAL…`) | `STOP`         | `false`    | 27,5 s | 527 / 2.171 / 4.350          |
| neu: pipeline-v2, `LOW`, `MEDIUM`    | verworfen (`INCOMPLETE_VISUAL…`) | `STOP`         | `false`    | 9,6 s  | 527 / 2.245 / –              |

Gemini-Warnung in beiden Fällen sinngemäß: ein roter Kasten „Auch mit Features!“ verdeckt Teile der Tabelle. Ursache ist also nicht die neue Konfiguration, sondern dass `complete=false` bisher als harter Fehler galt. Seitdem werden lesbare Blöcke übernommen und die Seite mit `extraction.incomplete` markiert. Einzelstichprobe, keine Benchmark-Aussage.

## Offline-Seitenauswahl (keine Qualitäts- oder Latenzmessung)

| Dokument                                  | Seiten | visuell bisher (A–C) | visuell neu (D/M) |
| ----------------------------------------- | -----: | -------------------: | ----------------: |
| `Benchmark_Lernskript_Energiesysteme.pdf` |     12 |                   11 |                10 |
| `Neue Konzepte 2026 - VL1.pdf`            |     67 |                   67 |                61 |

Dateihashes, Gründe pro Seite und native Chunkzahlen: `offline-results.json`. Ob die nun lokal verarbeiteten Seiten inhaltlich korrekt bleiben, ist noch manuell gegen `quality-checklist.json` zu prüfen.

## Vorbereitet, nicht ausgeführt: Live-Benchmark

Außer den zwei Diagnoseanfragen oben wurde kein kostenpflichtiger Aufruf gemacht. Es gibt daher **keine** gemessenen Laufzeitgewinne und **keinen** Nachweis gleichbleibender Gemini-Qualität bei Thinking LOW, Medienauflösung MEDIUM oder neuer Seitenauswahl.

Geplanter Umfang (Profile A, B, C, D, M aus `profiles.json`, je beide PDFs einmal):

- 10 Uploads, 5 × 79 = 395 Originalseiten
- 3 × 78 + 2 × 71 = 376 erfolgreiche visuelle Seitenaufrufe ohne Retries
- zusätzlich Retries (je Seite höchstens 3 HTTP-Versuche) und Embedding-Requests je nach Chunkanzahl

Profil A ist eine instrumentierte Nachbildung des bisherigen Verhaltens auf dem neuen Code, kein unveränderter historischer Build. Ablauf, Freigabeflag `--approve-paid-model-calls` und Abnahmekriterien: `docs/document-pipeline-performance.md`, Abschnitt „Reproduzierbarer Live-Benchmark“.
