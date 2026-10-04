# Document Chunks und Embeddings

[Issue #31](https://github.com/Azockgg/lernapp/issues/31) ergänzt die vorhandene
[Textextraktion](documents.md) um die Backend-Pipeline
`source_documents → Chunks → Embeddings → pgvector → Ähnlichkeitssuche`.
Die Antwortgenerierung durch ein Sprachmodell setzt darauf auf und ist in
[Fragen zu Lernmaterialien](chat.md) beschrieben; eine Suchoberfläche ist ein separater Schritt.

## Daten und Segmentierung

`document_chunks.document_id` referenziert `source_documents.id`, nicht `files.id`.
Die Tabelle enthält `id`, `chunk_index` (ab 0, dokumentweit lückenlos), `content`,
`page_number`, `metadata`, `embedding`, `embedding_provider`, `embedding_model` und `created_at`.
Die Kombination aus Dokument und Index ist eindeutig.

PDF-Seiten werden einzeln und in Originalreihenfolge segmentiert. Leere Seiten
erzeugen keine Chunks, bleiben aber in den Seitenzahlen berücksichtigt. Für TXT
ist `page_number = null`. Es werden höchstens 1800 UTF-16-Codeeinheiten pro Chunk
verwendet, bevorzugt mit Grenzen an Absätzen, Satzenden oder Leerzeichen.
Untrennbare lange Wörter werden Unicode-sicher geteilt. Die Überlappung beträgt
bis zu 200 Codeeinheiten und wird möglichst an einer Wortgrenze begonnen.
`metadata.start` und `metadata.end` sind Offsets im unveränderten Seitentext
(bzw. vollständigen TXT-Text), Ende exklusiv. `metadata.chunker = characters-v1`
kennzeichnet das Verfahren. Rand-Leerraum wird ausgelassen.

Visuell extrahierte Seiten können zusätzlich strukturierte `blocks` enthalten.
Diese verwenden `metadata.chunker = blocks-v1` sowie `block_id` und `block_kind`.
`start/end` beziehen sich weiterhin exakt auf den kanonischen Seitentext.
Tabellenzeilen enthalten wiederholte Header, Caption und Einheiten; der Chunker
fasst ausschließlich vollständige Zeilen zusammen. Erkannte Formelblöcke bleiben
ungeteilt. Eine einzelne Tabellenzeile oder Formel über 1.800 Codeeinheiten führt
zu `INVALID_INDEXING_INPUT`, statt unbemerkt zerschnitten zu werden. Die vollständigen
Tabellenzellen samt Spannen bleiben in den Seitenblöcken gespeichert. Bestehende
Fließtextseiten behalten das bisherige Verfahren. Siehe [visuelle Extraktion](visual-extraction.md).

Der aktive Vertrag ist `gemini / gemini-embedding-2 / 1536`. Alle drei Functions
verwenden `GEMINI_API_KEY`. Der Adapter erzeugt pro Text einen separaten
`batchEmbedContents`-Request mit `outputDimensionality: 1536`. Suchfragen erhalten
`task: search result | query: …`, Dokumentchunks `title: none | text: …`.
Gemini Embedding 2 unterstützt kein `taskType`-Feld. Antworten werden auf Anzahl,
Dimension und endliche, von null verschiedene Vektoren geprüft und normalisiert.
Siehe [Gemini-Dokumentation](https://ai.google.dev/gemini-api/docs/embeddings).

`finish_document_indexing_batch` und `search_document_chunks` prüfen Anbieter,
Modell und Dimension. Die alten RPCs ohne expliziten Vertrag sind entfernt.
Die Migration `20260916120000` archiviert bestehende OpenAI-Vektoren im nicht
exponierten Schema `embedding_archive`, leert den aktiven Index und stellt alle
fertig extrahierten Dokumente zur vollständigen Neuindexierung bereit. Alte
Leases und Cursor werden verworfen. Quelldateien, extrahierte Texte und bisherige
Chat-Quellensnapshots bleiben erhalten; die alten Chunk-Verweise werden null.
Die Archivdaten werden bei Löschung des zugehörigen Dokuments mitgelöscht.
Der Antwortanbieter bleibt unabhängig zwischen OpenAI und Gemini wählbar.

Nur Secrets zu ändern reicht nicht. Vorgehen und Staging-Befehle:
[Gemini-Rollout](gemini-embeddings-staging.md).

## Verarbeitung und Status

Ein Trigger reiht erfolgreich extrahierte Quellen atomar in
`document_indexing_jobs` ein. Die Migration erfasst auch vorhandene `ready`-Quellen.
Die Textextraktion behält ihren eigenen `processing_status`; zusätzlich gibt es:

| `indexing_status` | Bedeutung                                                        |
| ----------------- | ---------------------------------------------------------------- |
| `pending`         | Wartet auf erfolgreiche Extraktion oder einen Indexierungsworker |
| `processing`      | Chunks werden in Batches eingebettet                             |
| `ready`           | Vollständig indexiert, für Suche freigegeben                     |
| `failed`          | Indexierung fehlgeschlagen; `indexing_error` prüfen              |

`documents-index` akzeptiert ausschließlich POST mit Service-Role-Key. Ein Aufruf
reserviert höchstens ein Dokument und verarbeitet höchstens 32 Chunks mit einem
Embedding-Request. Chunks und Fortschrittscursor werden transaktional gespeichert.
Der nächste Aufruf setzt am Cursor fort. Erst der letzte Batch veröffentlicht das
Dokument für Nutzer und Suche. Bei leerem Text wird `ready` ohne Chunks gespeichert;
es werden keine leeren Texte an den Provider geschickt.

Claims gelten zwei Minuten und verhindern doppelte parallele Verarbeitung.
Netzwerkfehler, HTTP 429/5xx und Datenbankfehler liefern 503 und lassen die
Reservierung auslaufen. Bereits gespeicherte Batches bleiben erhalten. Nach drei
erfolglosen Versuchen desselben Batches setzt der nächste Claim
`failed / INDEXING_TIMEOUT`. Ein erfolgreicher Batch setzt den Versuchszähler zurück.
Mehr als 10.000 Chunks führen zu `INVALID_INDEXING_INPUT`. Veraltete Reservierungen
können nichts speichern. Bei verlorener Erfolgsantwort kann ein externer
Embedding-Request erneut Kosten verursachen; Datenbank-Chunks werden nicht dupliziert.

Der Besitzer kann fehlgeschlagene Indexierung neu einreihen:

```ts
await supabase.rpc('retry_document_indexing', {
  p_document_id: sourceDocumentId,
});
```

Dabei werden alte Teil-Chunks entfernt und nach fünf Sekunden neu begonnen.
Wiederholungen für `pending`, `processing` und `ready` sind wirkungslos. Fremde oder
fehlende Dokumente liefern `DOCUMENT_NOT_FOUND`. Den Status per Nutzer-Data-API aus
`source_documents` lesen; Clients dürfen Status und Chunks nicht selbst schreiben.

## Suche vom Frontend

```ts
const { data, error } = await supabase.functions.invoke('documents-search', {
  body: {
    course_id: courseId,
    query: 'Wie funktioniert die Photosynthese?',
    limit: 10,
    min_similarity: 0,
  },
});
// data.matches: { id, document_id, material_id, chunk_index,
//                 content, page_number, metadata, similarity }[]
```

Ein Nutzer-JWT ist erforderlich. `query` muss nichtleer und höchstens 1800
UTF-16-Codeeinheiten lang sein. `limit` liegt zwischen 1 und 50 (Standard 10),
`min_similarity` zwischen -1 und 1 (Standard 0). HTTP 200 enthält nach kombiniertem
Hybrid-Ranking absteigende Treffer, gegebenenfalls ein leeres Array. Die Kursprüfung erfolgt vor
dem kostenpflichtigen Embedding-Aufruf. Fehlende/fremde Kurse liefern einheitlich
404, ungültige Eingaben 400, Bodies über 10.000 Bytes 413, fehlende Anmeldung 401.
Provider-/Datenbankfehler liefern 503. Es werden keine Provider-Fehlertexte oder
Schlüssel an Clients ausgegeben.

`search_document_chunks` ist außerdem eine authentifizierte SQL-RPC für bereits
serverseitig erzeugte Query-Vektoren. Neben `p_course_id`, `p_embedding`, `p_limit`
und `p_min_similarity` benötigt sie `p_embedding_provider: 'gemini'`,
`p_embedding_model: 'gemini-embedding-2'` und `p_embedding_dimensions: 1536`.
Die neue Überladung benötigt zusätzlich `p_query` sowie explizite Werte für
`p_limit` und `p_min_similarity`. Ohne `p_query` bleibt die bestehende
Sieben-Parameter-RPC mit reiner Vektorsuche verfügbar. Beide Varianten prüfen
den Embedding-Vertrag und laufen mit Aufruferrechten und RLS.
Das Frontend sollte `documents-search` verwenden und keine Embeddings
erzeugen oder API-Schlüssel erhalten.
Die Suche verwendet exakte Cosinus-Distanz aus
[pgvector](https://github.com/pgvector/pgvector), beschränkt auf den gewünschten Kurs.
Ein ANN-Index wird noch nicht angelegt: Bei den zunächst kleinen Kursbeständen
liefert exakte Suche alle passenden Treffer ohne nachträgliche ANN-Filterverluste.
Mit wachsenden Beständen Laufzeiten messen und eine geeignete Indexstrategie ergänzen.
Embedding-Vektoren werden im Suchergebnis nicht übertragen.

### Hybrid-Ranking (Issue #49)

`documents-search` übergibt den getrimmten Suchtext als `p_query`. Der Chat
übergibt die aktuelle Frage; sein Query-Embedding berücksichtigt weiterhin die
vorherige Frage bei Folgefragen. Dadurch müssen ältere Begriffe nicht zusätzlich
in jedem Volltexttreffer vorkommen.

Ein GIN-Ausdrucksindex kombiniert deutsche Wortstämme mit der `simple`-Konfiguration
für unveränderte Fachbegriffe, Abkürzungen und Zahlen. Die Anfrage wird mit
`plainto_tsquery` in beiden Konfigurationen ausgewertet (ODER zwischen den beiden
Varianten, UND zwischen den Wörtern einer Variante). Suchtext wird nicht als SQL
oder als vom Nutzer vorgegebene tsquery-Syntax ausgeführt. Die PostgreSQL-Verfahren
sind in der [Volltextdokumentation](https://www.postgresql.org/docs/current/textsearch-controls.html)
beschrieben.

Pro Signal werden `max(20, min(50, 4 * limit))` Kandidaten berücksichtigt:
Vektor nach Cosinus-Ähnlichkeit, Volltext nach `ts_rank_cd`. Reciprocal Rank Fusion
addiert `1 / (60 + Rang)` je vorhandenem Signal. Doppelte Chunk-IDs werden vereinigt.
Bei gleichem Ergebnis entscheiden Volltextrang und anschließend Chunk-ID stabil.
Kurs, RLS, Indexierungsstatus und Embedding-Provenienz gelten für beide Kandidatenlisten.

`min_similarity` filtert ausschließlich die Vektorkandidaten. Ein Volltexttreffer
kann auch mit geringerer Cosinus-Ähnlichkeit erscheinen. Das Rückgabefeld
`similarity` bleibt die unveränderte Cosinus-Ähnlichkeit, **nicht** der RRF-Wert;
Clients dürfen die Treffer nicht danach neu sortieren. Ohne Volltexttreffer bleibt
die semantische Reihenfolge erhalten. Ein leerer RPC-Suchtext verwendet die bisherige
Vektorsuche; HTTP-Suchanfragen müssen weiterhin nichtleer sein.

Die lokale pgTAP-Regression `hybrid_search.test.sql` vergleicht drei gezielte
Abfragen (`TCP`, `Preiselastizität`, `4711`) bei absichtlich schwachen Vektoren:
Recall@1 steigt von 0/3 auf 3/3. Das ist ein reproduzierbarer synthetischer
Ranking-Test, keine gemessene Qualitätssteigerung auf einem repräsentativen
Vorlesungskorpus. Zusätzlich werden Kurs-/Nutzerisolation, anonyme Zugriffe,
unfertige Dokumente, Provenienz und Vektorrückfall geprüft.

Rollout: zuerst `20260922120000_hybrid_document_search.sql`, danach die Funktionen
`chat` und `documents-search` deployen. Der Index erfasst vorhandene Chunks ohne
erneute Embedding-Aufrufe. Alte Aufrufer bleiben kompatibel. Die GIN-Erstellung
kann Schreibzugriffe während der Migration blockieren; für große Bestände ein
Wartungsfenster einplanen. Die Hybrid-Suche benötigt weiterhin Query-Embeddings
und hebt keine Gemini-Kontingente für die Antwortgenerierung auf.

Material-, Kurs- und Accountlöschung entfernen Quellen, Chunks und Aufträge über
Fremdschlüssel. Die Löschung allein der Originaldatei erhält bereits extrahierten
Text und damit auch seine Indexierung, entsprechend dem bestehenden Dateiablauf.

## Konfiguration und Rollout

1. Migration anwenden, dann Functions über den bestehenden CI-Deploy bereitstellen.
2. `GEMINI_API_KEY` als Supabase Edge-Function-Secret je Zielprojekt setzen.
   Nur serverseitig konfigurieren; kein Frontend-Env-Präfix verwenden.
3. Der vorhandene Schritt `configure_document_processing` konfiguriert die
   benötigten Vault-Einträge bereits. Der neue minütliche Cronjob
   `learning-documents-index` verwendet dieselbe Basisadresse und denselben
   Service-Key wie die Extraktion, mit Pfad `/functions/v1/documents-index`.
4. Eine PDF und eine TXT hochladen, Extraktion starten und anschließend
   `indexing_status = ready` sowie Treffer mit korrekter Seitenreferenz prüfen.

Ohne API-Key liefert der Worker `EMBEDDINGS_NOT_CONFIGURED` / 503, ohne Aufträge
zu reservieren oder Versuche zu verbrauchen. Der Schlüssel wird nicht durch die
Migration oder den Scheduler eingerichtet. Indexierung sendet Dokumenttext,
Suche den Anfragetext an Gemini und verursacht API-Kosten. Auch die vorhandenen
fertigen Quellen werden nach Aktivierung automatisch verarbeitet.

Lokal nur den Provider-Key in `supabase/functions/.env` eintragen (gitignored;
Vorlage daneben). `npm run functions:serve` lädt diese Datei über die Supabase-CLI.
Den Indexierungsworker für lokale Tests explizit mit dem lokalen Service-Key
aufrufen; Cron benötigt auch lokal eingerichtete Vault-Werte. Bei 32 Chunks pro
Minute dauert die Indexierung großer Dokumente mehrere Minuten. Queue-Alter,
`indexing_error`, Function-Logs und Cron-HTTP-Antworten überwachen.

## Validierung

`document_rag.test.sql` prüft automatische Einreihung, Batchfortschritt,
Atomarität, Lease-Ablauf, Wiederholung, RLS, Seitenprüfung, Cosinus-Rangfolge und
Löschkaskaden. Deno-Tests prüfen Segmentierung und beide HTTP-Functions mit
simuliertem Provider (einschließlich ungültiger Vektoren und Ausfällen).

```bash
npm run db:apply
npm run test:db
npm run db:lint
npm run gen:types
npm run functions:test
npm run functions:check
npm run functions:lint
npm run format:check
```

Die automatischen Tests rufen keinen KI-Provider auf. Ein echter Provider-Smoke-Test
mit Projekt-Key bleibt Teil der Prüfung nach Konfiguration und Deployment.

## Verbrauch direkter Suchanfragen

Jeder Aufruf von `documents-search`, der ein Embedding anfordert, verbraucht eine
Sucheinheit und unterliegt dem Minutenlimit. Eine optionale `request_id` ist kein
Ergebnis-Cache und macht Wiederholungen nicht kostenlos. Der Verbrauchsschlüssel
wird ausschließlich serverseitig erzeugt. Abgewiesene Quoten-Anfragen erreichen
den Embedding-Anbieter nicht.
