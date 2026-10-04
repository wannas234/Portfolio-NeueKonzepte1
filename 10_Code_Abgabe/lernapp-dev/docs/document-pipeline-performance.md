# PDF-Pipeline: Durchsatz, Wiederaufnahme und Benchmark

Arbeitsstand: `feat/gemini-ocr`, Ausgangscommit `e6efcea2806dea293f37f2f8a94dc75c19a837d5`. Kein Branchwechsel, kein Deployment, keine Produktionsänderung und keine neuen kostenpflichtigen Modellaufrufe. Die zu Beginn vorhandenen unversionierten Diagnose-/Timing-Dateien wurden nicht verändert; die neue Instrumentierung benötigt diese Dateien nicht.

## Verifizierter Ausgangszustand

`documents-process` bearbeitete eine visuelle Seite, `documents-index` einen Batch mit höchstens 32 Chunks. Beide Cronjobs liefen minütlich, pg_net wartete höchstens 90 s. Gemini hatte einen 60-s-HTTP-Timeout, keinen expliziten Thinking-/Medienparameter und ein unverändert beibehaltenes Ausgabelimit von 16.384 Tokens. Die Tabellenserialisierung wiederholte `content` in jeder Tabellenzeile. `document_pipeline_timings.ocr_duration` ist eine verstrichene Phase einschließlich Wartezeiten, keine API-Dauer.

Die aktuelle Standardkonfiguration verwendet weiterhin `gemini-3.6-flash` am Developer-API-Endpunkt `v1beta/models/...:generateContent`. Der Embedding-Vertrag bleibt unabhängig davon `gemini-embedding-2`, 1536 Dimensionen, normalisierte Vektoren und höchstens 32 Inhalte je Request.

## Verarbeitung und Datenmodell

- Ein Aufruf arbeitet synchron innerhalb eines konfigurierbaren Arbeitsbudgets (standardmäßig 75 s). Neue Seiten/Batches beginnen nur bei mindestens 15 s Restbudget. Provider-Anfragen erhalten ein mit dem Restbudget verbundenes AbortSignal; zehn Sekunden sind für Persistierung reserviert. DB-/Storage-Anfragen haben zusätzlich ihre bisherigen 10-/20-s-Grenzen und eine absolute Grenze bei Budget + 10 s. Keine losgelösten Promises und keine rekursiven HTTP-Aufrufe.
- Bis zu drei Seiten arbeiten parallel. Die bereits aktiven Tasks werden auch nach einem Teilfehler abgewartet und speichern ihre eigenen Ergebnisse. PDF-lib lädt die Quelldatei einmal pro Extraktor und erzeugt weiterhin physisch einzelne Originalseiten.
- `save_document_processing_page` sperrt zuerst die Datei und führt genau eine Seite in den aktuellen Checkpoint ein. Die vorhandene vollständige Eigentums-, Status- und Lease-Prüfung bleibt über `save_document_processing_checkpoint` wirksam. Erfolgreiche Seiten sind unveränderlich. Die Seitenposition muss zum ursprünglichen Index passen; die gespeicherte Konfiguration muss zum Checkpoint passen. Ein kompletter Checkpoint wird nur zur initialen Analyse geschrieben, bevor parallele Seiten starten.
- Das JSON-Persistenzmodell kann deshalb bleiben: kein weiterer Hostingdienst und keine zusätzliche Seitentabelle nötig. Das Merge-RPC serialisiert nur kurze Datenbanktransaktionen, nicht die Gemini-Anfragen. Die bestehenden Grenzen (100 Seiten, 10 MiB PDF, 20 MiB Checkpoint, 5 MiB publizierter Text) bleiben bestehen.
- `document_provider_slots` begrenzt projektweit aktive Anfragen, auch bei mehreren Uploads und Function-Replikaten. Standard: höchstens drei Anfragen insgesamt (Zeile `all`), davon höchstens drei visuelle und zwei Embedding-Anfragen. Slots laufen nach 90 s aus; Provider-Requests sind auf höchstens 60 s begrenzt. Bei Dokumentlöschung bleibt ein laufender Slot ohne Dokumentreferenz bis zur Freigabe/Ablauf bestehen, damit Löschen keine zusätzlichen Providerkapazitäten freigibt. Neue Slots erfordern einen gültigen Dokumentlease und einen weiterhin gültigen Eigentümer-/Dateibezug.
- `document_provider_limits` begrenzt zusätzlich Requeststarts pro festem Minutenfenster. Default je Modellklasse: 30 reservierte Starts/Minute, zusätzlich 60 über beide Klassen zusammen (`all`). Jede Belegung reserviert vorsorglich drei Starts für maximal drei HTTP-Versuche; ungenutzte Reservierungen verfallen am Fensterende. Das ist bewusst konservativ, keine Messung der tatsächlichen Auslastung. Das Limit muss zu den Quoten des verwendeten Google-Projekts passen; andere Anwendungen mit demselben Projekt sind nicht in dieser Datenbanksperre erfasst. TPM-/Tagesquoten sind nicht durch die Parallelitätsgrenze abgedeckt.
- 429/5xx: höchstens drei HTTP-Versuche, exponentieller Backoff mit Jitter, numerisches oder HTTP-Datum-`Retry-After`. Lange Wartezeiten werden dauerhaft über `available_at` und eine modellweite Sperre weitergereicht (maximal 24 h pro Sperre). Nicht erfolgreiche andere HTTP-Codes und ungültige/abgeschnittene Ausgaben werden nicht innerhalb desselben Requests wiederholt. Netzwerkausfälle werden beim nächsten Jobversuch behandelt.
- Reine Kapazitäts-/Budgetpausen verbrauchen keinen Fehlerversuch und löschen keine früheren Fehlerversuche. Fortschritt ohne Fehler setzt den Versuchszähler zurück. Nach drei fehlgeschlagenen Worker-Versuchen wird Extraktion als fehlgeschlagen markiert und der Job bei `available_at = infinity` geparkt. Der Checkpoint bleibt für den bestehenden authentifizierten Retry erhalten; bezahlte Seiten gehen dabei nicht verloren.
- Erfolgreiche Embedding-Batches committen den bestehenden Cursor. Derselbe Aufruf beansprucht anschließend den Lease erneut und verarbeitet weitere Batches bis zur Grenze. Ein konkurrierender Worker darf den nächsten Lease gewinnen. Der Embedding-Vertrag und die atomare Sichtbarkeit vollständig indizierter Dokumente bleiben unverändert.

Die neue Migration `20261002120000_document_pipeline_throughput.sql` ergänzt einen Dispatcher alle fünf Sekunden. Er sendet nur bei fälligen Jobs einen pg_net-Wakeup. Die bestehenden Minutenscheduler bleiben als Wiederaufnahme aktiv. Dauerhaft sind die Jobtabellen und `available_at`; pg_net selbst verwendet unlogged Tabellen und ist ausdrücklich nicht der dauerhafte Speicher. Ein verlorener Wakeup wird beim nächsten Tick oder Minutenscheduler ersetzt. Es gibt keine Aufrufkette zwischen Functions. Unter hoher Last können mehrere Wakeups entstehen; Dokumentleases, Semaphore und Quoten begrenzen die tatsächliche Arbeit.

## Konfiguration und Kompatibilität

| Einstellung                   | Standard      | Zweck                                                       |
| ----------------------------- | ------------- | ----------------------------------------------------------- |
| `DOCUMENT_WORKER_BUDGET_MS`   | `75000`       | 15000–75000 ms Arbeitsbudget                                |
| `DOCUMENT_VISUAL_CONCURRENCY` | `3`           | 1–3 lokale Gemini-Anfragen                                  |
| `DOCUMENT_VISUAL_MAX_PAGES`   | `100`         | Zusätzliche obere Grenze pro Aufruf; `1` für A              |
| `DOCUMENT_INDEX_MAX_BATCHES`  | `313`         | Zusätzliche obere Grenze; `1` für A                         |
| `DOCUMENT_PIPELINE_REVISION`  | `pipeline-v2` | Neue Router-/Aufbereitungsversion; `legacy` für Vergleich   |
| `DOCUMENT_THINKING_LEVEL`     | `LOW`         | `DEFAULT`, `MINIMAL`, `LOW`, `MEDIUM`, `HIGH`               |
| `DOCUMENT_MEDIA_RESOLUTION`   | `MEDIUM`      | `DEFAULT`, `MEDIUM`, `HIGH`                                 |
| `DOCUMENT_MAX_OUTPUT_TOKENS`  | `16384`       | Unverändert; kein kleineres Limit als Beschleunigungsersatz |

`DEFAULT` lässt das jeweilige API-Feld weg. Explizite Thinking-/Medienoptionen werden für andere Modellnamen zunächst abgewiesen, bis deren Unterstützung geprüft wurde. Kein automatischer Modellwechsel. JSON-Schema, vollständige Zellabdeckung und Prüfung auf `finishReason=STOP` bleiben erhalten. `MAX_TOKENS` wird nie als vollständiger Text veröffentlicht.

Meldet Gemini bei normalem Abschluss `complete=false` (z. B. weil ein Overlay auf der Folie Tabellenzellen verdeckt), werden die lesbaren Blöcke übernommen und die Seite mit `extraction.incomplete = true` sowie den Gemini-Warnungen markiert; das Request-Ereignis enthält `incomplete`. Vorher scheiterte eine solche Seite bei jedem Versuch und nach drei Versuchen das ganze Dokument (`PROCESSING_TIMEOUT`). Seiten ohne lesbaren Inhalt oder ohne gültiges `complete`-Flag scheitern weiterhin. Das gilt für alle Revisionen, auch für fortgesetzte Checkpoints. Das Frontend zeigt die Markierung derzeit nicht an.

Neue Checkpoints enthalten die schlüsselfreie Konfiguration (Modell, Ausgabelimit, Thinking, Medienauflösung, Revision). Wiederaufnahme nutzt diese gespeicherte Konfiguration, auch nach einer Secret-/Env-Änderung. Alte Checkpoints ohne Konfiguration laufen mit ihrem gespeicherten Modell, bisherigem Standardlimit 16.384 und ausgelassenen Thinking-/Medienfeldern sowie alter Serialisierung weiter. Eine historisch abweichende Ausgabegrenze ist bei solchen alten Checkpoints nicht rekonstruierbar. Alte bereits veröffentlichte Seiten behalten ihr bisheriges Chunking; die Zusammenfassung kurzer Blöcke greift nur bei Seiten mit `pipeline-v2`-Provenienz.

Globale Limits werden ausschließlich im Operator-Kontext geändert, beispielsweise in einer isolierten Testinstanz:

```sql
update public.document_provider_limits
set concurrency = 3, starts_per_minute = 30 where provider = 'visual';
-- Zusätzliches Gesamtlimit, einschließlich Embeddings:
update public.document_provider_limits
set concurrency = 3, starts_per_minute = 60 where provider = 'all';
```

Die drei reservierten Requeststarts erfordern ein Limit von mindestens 3. Für besonders kleine Kontingente Parallelität auf 1 reduzieren. Vor einem Live-Test die modellbezogenen RPM-/TPM-/Tageslimits in Google AI Studio prüfen und den Umfang entsprechend reduzieren; keine hart codierte Behauptung über das Kontingent des Nutzers.

## Router, Tabellen und Quellen

Der Router kombiniert native Textqualität, räumlich getrennte Textzeilen, mathematische Zeichen/Schriftgeometrie, Bildflächen und relevante Vektorflächen. Er berücksichtigt PDF-Transformationen und Save/Restore. Clipping-Pfade, vollflächige Hintergründe, dünne horizontale/vertikale Linien und kleine Bilder im Seitenrand lösen allein keine visuelle Verarbeitung aus. Ein `Figure`-Tag ohne passende Fläche reicht ebenfalls nicht. Große Bilder bleiben auch bei vorhandenen Überschriften Scan-Kandidaten; Bilder im Textkörper werden vorsichtig ausgewählt. Unbekannte Bildoperatoren und fehlgeschlagene Layoutanalyse bleiben konservativ visuell. Keine Bildausschnitt-Infrastruktur.

Das ist keine semantische Klassifikation von Logos: insbesondere große Logos oder ungewöhnliche, nicht eindeutig dekorative Elemente können weiter Gemini auslösen. Unter-/Hochstellungen, wiederholte Spaltentrennung und Diagrammgeometrie werden separat erfasst. Jede Auswahl speichert ihre Gründe. Die generischen synthetischen Tests ergänzen die beiden PDF-Regressionsdateien.

Tabellenkontext wird einmal serialisiert. Die neue Promptvariante fordert Originalüberschrift und Einheiten im Tabellenkontext sowie Fußnoten als eigene nachfolgende Textblöcke. Zellinhalt, vollständiges Raster, Headerhierarchie und Spans bleiben strukturiert erhalten. Interne Block-IDs werden nicht als vermeintliche Tabellenbeschriftungen in den Quelltext geschrieben. Zeilen tragen weiterhin ihre zugehörigen Spaltenüberschriften. Ganze Tabellenzeilen und Formeln werden nicht willkürlich getrennt; passt eine atomare Zeile/Formel nicht in den bestehenden 1800-Zeichen-Embeddingvertrag, entsteht weiterhin ein expliziter Indexierungsfehler.

Benachbarte kurze Text-/Überschrift-/Listenblöcke derselben Seite werden bis 1800 Zeichen zusammengeführt. Originaltext und UTF-16-Offsets bleiben exakt, alle ursprünglichen Block-IDs stehen in `block_ids`. Formeln und Tabellen bleiben eigene Einheiten. Der synthetische Regressionstest reduziert acht kleine Chunks auf vier, ohne Seitenwechsel oder Inhaltsverlust. Das ist keine gemessene Reduktion für neue Gemini-Extrakte der Benchmark-PDFs.

## Messwerte

`document_worker_events` enthält nur Metadaten: Run-ID, Start/Ende, aktive Workerzeit, ausgewählte Seiten/Gründe, Konfiguration, pro Seite Requestzeit einschließlich Antwortbody, getrennte Backoffzeit, Versuche/HTTP-Status, Input-/Output-/Thinking-Tokens und klassifizierte Fehler. Embedding-Requests enthalten Zeiten, Versuche und Batchgrößen. Keine API-Schlüssel, Dokumenttexte, Providerfehlerbodies oder Thought-Inhalte werden dort gespeichert. Reguläre Extrakte und Chunks enthalten natürlich weiterhin die Dokumentinhalte.

`document_worker_metrics` verbindet dies mit vorhandenen Queue-/Uploadereignissen: erste Queuewartezeiten, Zwischenpausen zwischen Workerläufen, summierte aktive Workerzeit, separate Gemini-/Embedding-Requestzeiten, Batchanzahl und Gesamtdauer bis zur vollständigen Indexierung. Parallel laufende Gemini-Requestzeiten sind summierte Ressourcenzeiten und dürfen nicht mit der verstrichenen Dokumentdauer gleichgesetzt werden. Fehlende Messwerte bleiben NULL; abgebrochene Worker ohne Endereignis werden ausgewiesen. Fehlermessungen sind verstrichene Requestoperationen; ihre `attempts` enthalten die verfügbaren HTTP-Einzelzeiten. Telemetrieausfall darf keine erfolgreiche Verarbeitung rückgängig machen. Eine Aufbewahrungs-/Bereinigungsregel für langfristig wachsende Ereignisdaten muss der Betreiber festlegen.

Abfragen: `supabase/snippets/document_throughput.sql`. Die frühere `ocr_duration` bleibt zur Kompatibilität bestehen und bedeutet weiterhin eine Phase einschließlich Zwischenpausen.

## Lokale Prüfung

```sh
npm run functions:test
npm run functions:check
npm run functions:lint
npm run test:tools

deno run --allow-read=/Users/adrian/Desktop/Benchmark \
  --config supabase/functions/deno.json scripts/benchmark-document-routing.ts
```

Zuletzt ausgeführte Prüfungen und Ergebnisse: [`benchmarks/document-pipeline/test-results.md`](../benchmarks/document-pipeline/test-results.md).

Der letzte Befehl braucht keine Netzwerk-/Env-Berechtigung. `benchmarks/document-pipeline/offline-results.json` hält Dateihashes, ursprüngliche und neue Auswahlzahlen sowie Gründe fest. Die bisherigen fünf Markdown-Extrakte und das Gemini-Timing sind gehasht als Referenz eingebunden, nicht als neue Messergebnisse ausgegeben.

Datenbanktests werden gegen einen separaten, netzwerklosen Container gefahren. `scripts/test-document-pipeline-db.mjs` liest ausschließlich das Schema der vorhandenen lokalen Datenbank, keine Nutzer-/Vaultdaten. Im Zielcontainer rekonstruiert es das Anwendungsschema aus allen Repository-Migrationen und verwendet synthetische Seeds. Es verändert niemals `supabase_db_lernapp`:

```sh
docker run -d --name lernapp-pipeline-test --network none \
  -e POSTGRES_PASSWORD=pipeline-test-only \
  public.ecr.aws/supabase/postgres:17.6.1.165 \
  -c cron.database_name=postgres \
  -c shared_preload_libraries=pg_stat_statements,pg_cron,pg_net,pgsodium,supabase_vault \
  -c pgsodium.getkey_script=/usr/share/postgresql/extension/pgsodium_getkey
node scripts/test-document-pipeline-db.mjs
```

Der Zielname ist fest, der Netzwerkmodus wird geprüft. Achtung: ausschließlich sein Testschema wird bei Wiederholung neu aufgebaut. Das zusätzliche Node-Integrationstestskript führt echte gleichzeitige SQL-Sitzungen aus. Im normalen Tooltest wird es übersprungen; mit `PIPELINE_DB_TEST=1` richtet es sich ausschließlich an diesen Testcontainer.

## Reproduzierbarer Live-Benchmark – vorbereitet, nicht ausgeführt

Die bisherigen Exportdateien liefern keine reine Gemini-Requestzeit und keine strukturierten Checkpoints. Daher keine erfundenen Vorher-/Nachher-Laufzeiten. Ein A-Lauf reproduziert die bisherigen Router-/Prompt-/Serialisierungs-/Schedulingparameter auf dem instrumentierten Code; die gemeinsame neue Sicherheits-/Messinfrastruktur bleibt aktiv. Für einen bytegenauen historischen Vergleich wäre zusätzlich der oben genannte Ausgangscommit in einer separaten Testinstanz nötig.

`benchmarks/document-pipeline/profiles.json` isoliert:

| Profil | Änderung gegenüber Vorgänger                                                           |
| ------ | -------------------------------------------------------------------------------------- |
| A      | Bisherige Konfiguration; 1 Seite und 1 Batch/Aufruf, Minutenscheduler                  |
| B      | Zeitbudget, Parallelität 3, fortlaufende Batches, 5-s-Dispatcher                       |
| C      | Zusätzlich Thinking LOW                                                                |
| D      | Zusätzlich neuer Router und neue Textaufbereitung                                      |
| M      | Separater Kontrolllauf mit explizit MEDIUM; entspricht der neuen Standardkonfiguration |

Die Medienauflösung bleibt in A–D ausgelassen, damit C tatsächlich nur Thinking und D nur Auswahl/Aufbereitung verändert. M prüft den expliziten neuen Medienstandard separat. Laut Dokumentation entsprechen der Gemini-3-Standard und MEDIUM bei PDFs jeweils 560 Bildtokens plus nativem Text; die Gleichwertigkeit der Ergebnisse wird dennoch nicht vorausgesetzt.

Geplanter erster Umfang zur Freigabe: pro Profil beide PDFs einmal, insgesamt zehn Uploads, 395 Originalseiten. Offline werden A/B/C jeweils 78 (11 + 67) und D/M jeweils 71 (10 + 61) visuelle Seiten ausgewählt (`offline-results.json`): insgesamt 376 erfolgreiche visuelle Seitenaufrufe ohne Retries, zuzüglich Embedding-Requests nach tatsächlicher Chunkanzahl. Retries sind zusätzliche potenziell kostenpflichtige Requests; ein bewilligter Kostendeckel sollte vor Ausführung anhand des eigenen Kontingents festgelegt werden. Keine belastbare p95-Aussage aus einer Wiederholung. Weitere Wiederholungen oder zusätzliche Dokumente benötigen einen erweiterten Umfang.

1. Eine eigene lokale Benchmark-Supabase-Instanz ohne andere Jobs vorbereiten. Migrationen anwenden, Worker-Vault mit deren lokaler URL/Worker-Key konfigurieren; keine Produktionsinstanz verwenden. Die netzwerklose reine SQL-Testinstanz oben eignet sich nicht für Modellaufrufe.
2. Für jedes Profil zuerst offline `node scripts/benchmark-document-live.mjs A` (entsprechend B/C/D/M) ausführen. Das gibt Parameter und die lokale Cron-Umschaltung aus, keine Secrets. Die Parameter in eine private Function-Env-Datei mit den benötigten Schlüsseln übernehmen, beide Functions damit starten. Nach Profilwechsel neu starten. Für A nur den 5-s-Dispatcher deaktivieren; beide Minutenscheduler bleiben aktiv. B–M aktivieren ihn.
3. Einen isolierten Testkurs/Testnutzer anlegen. `BENCHMARK_ISOLATED=1`, `BENCHMARK_SUPABASE_URL`, `BENCHMARK_ANON_KEY`, `BENCHMARK_SERVICE_KEY`, `BENCHMARK_USER_TOKEN`, `BENCHMARK_COURSE_ID` und einen stabilen lokalen `BENCHMARK_OUTPUT` setzen. Die Secrets nicht in Shell-History oder Berichte schreiben. Die Modellschlüssel gehören ausschließlich in die private Worker-Env-Datei.
4. **Erst nach Freigabe kostenpflichtiger Aufrufe:** `node scripts/benchmark-document-live.mjs A --run --approve-paid-model-calls`. Der Runner erlaubt nur localhost, prüft leere Jobqueues und wartet begrenzt bis maximal 90 Minuten. Er lädt beide Dokumente in derselben Variante hoch, damit Konkurrenz zwischen Dokumenten Teil jedes Vergleichs ist. Er exportiert Dokumente, Chunks, Events, Messwerte, IDs und Hashes lokal. Die gemessene Endzeit aus der DB ist genauer als die zusätzlich gespeicherte Pollingzeit.
5. Bei einer Unterbrechung denselben `BENCHMARK_OUTPUT` mit `--resume` weiterverwenden. Nicht erneut hochladen, um eine Wiederverwendung erfolgreicher Checkpoints zu ermöglichen. Fehlgeschlagene Dokumente vor einem expliziten Retry prüfen. Exporte dürfen Dokumenttexte enthalten und sind entsprechend lokal zu behandeln.
6. Tatsächliche Routing-Konfiguration wird gegen das Profil geprüft. Anzahl Chunks unter 200 Zeichen, Tabellenwiederholungen, Requestzeiten, Queue-/Zwischenpausen, Tokenverbrauch, Retries und Gesamtdauer tabellarisch vergleichen. A–D/M nacheinander mit frischen Uploads und unveränderten Quoten ausführen; Kalt-/Warmstarts kennzeichnen. Der Runner löscht keine Artefakte automatisch.
7. `benchmarks/document-pipeline/quality-checklist.json` gegen die Originalseiten und vollständigen neuen Extrakte manuell abnehmen. Alle sechs Energieformeln, GHD **9 %**, als abgelesen/geschätzt markierte PV-Werte, Scandaten, Prozentzuordnung, vollständige CAGR und Dollarzeichen sind Freigabekriterien. Zusätzliche Stichproben aller nun lokal gerouteten Seiten sind Pflicht. Strings alleine beweisen weder mathematische Vollständigkeit noch korrekte Tabellenzuordnung. Kein Produktivrollout bei Regression.

## Rücknahme und Grenzen

Sofort reversible Drosselung: Dispatcher deaktivieren (`update cron.job set active=false where jobname='learning-documents-dispatch'`), lokale Parallelität und Seiten-/Batchgrenze auf 1, für neue Jobs `DOCUMENT_PIPELINE_REVISION=legacy`, Thinking/Medien auf `DEFAULT`. Bestehende Checkpoints bleiben gepinnt und laufen mit ihrer bisherigen Konfiguration weiter. Bestehende vollständig veröffentlichte Dokumente werden nicht neu indexiert.

Für einen vollständigen Code-Rollback zuerst Jobs mit v2-Konfiguration fertigstellen oder kontrolliert parken. **Nicht** den alten Worker auf teilweise verarbeitete v2-Checkpoints loslassen: der historische Worker kennt deren Konfigurationsvertrag nicht. Erst nach Drain und ohne aktive Provider-Slots die frühere Worker-Version wiederherstellen. Neue Tabellen/RPCs können zur Diagnose stehen bleiben; keine automatischen destruktiven Down-Migrationen. Keine alten Vektoren umrechnen oder mit einem anderen Embedding-Modell mischen.

Verbleibende Grenzen: native PDF-Analyse kann trotz Wandzeitbudget das separate Supabase-CPU-/RAM-Limit erreichen; die persistierten Jobs sichern dann Wiederaufnahme. Nach Provider-Erfolg und vor bestätigter DB-Persistierung bleibt bei Absturz ein unvermeidbares Wiederholungsfenster ohne Provider-Idempotenzschlüssel. Persistierte Seiten werden dagegen nicht erneut angefragt. Geometrie bleibt eine Heuristik. Niedrigeres Thinking und neue Aufbereitung sind noch nicht live auf Qualität/Latenz validiert. Dokumentstatus/Frontend und das Prinzip der vollständigen Veröffentlichung wurden nicht geändert.

## Offizielle Quellen (geprüft am 02.10.2026)

- [Gemini 3.6 Flash: PDF, Thinking und Structured Outputs](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)
- [Thinking beim verwendeten generateContent-Endpunkt](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [Medienauflösung: PDF MEDIUM](https://ai.google.dev/gemini-api/docs/media-resolution)
- [GenerateContent-Konfigurationsreferenz](https://ai.google.dev/api/generate-content)
- [Projekt-/modellabhängige Gemini-Quoten](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Supabase Edge-Limits: 150/400 s Wandzeit, 150 s Idle, 2 s CPU, 256 MB](https://supabase.com/docs/guides/functions/limits)
- [Supabase Cron](https://supabase.com/docs/guides/cron) und [pg_net, insbesondere unlogged Queue](https://supabase.com/docs/guides/database/extensions/pg_net)
