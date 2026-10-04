# Quellenmaterial und Dokumentverarbeitung

Issue #29 erweitert den bestehenden Dateiablauf um Quellenmaterialien und einen
dauerhaften Verarbeitungsauftrag. Projekte heißen im Backend weiterhin `courses`.
Issue #30 ergänzt die PDF-/TXT-Textextraktion und den Worker `documents-process`.
Angemeldete Nutzer können die Verarbeitung einer eigenen Quelle sofort starten.
Zusätzlich bearbeitet der Worker nach Deployment und Vault-Konfiguration minütlich
einen fälligen Auftrag als Absicherung. Neue Quellen bleiben bis zur Reservierung `uploaded`.

## Datenmodell

Ein bestätigter Upload erzeugt genau ein `materials`-Objekt vom Typ
`source_document` pro Datei und einen zugehörigen Datensatz in `source_documents`.
`materials` enthält Titel, `course_id`, `created_by` und `file_id`.
`source_documents.material_id` ist eindeutig; ein zusammengesetzter Fremdschlüssel
sichert den Materialtyp ab. Die bestehende Tabelle `documents` bleibt für Notizen,
Lernhilfen und andere erstellte Inhalte reserviert.

| Feld                       | Bedeutung                                                     |
| -------------------------- | ------------------------------------------------------------- |
| `processing_status`        | `uploaded`, `processing`, `ready` oder `failed`               |
| `extracted_text`           | Ergebnistext; bis zum erfolgreichen Abschluss `NULL`          |
| `pages`                    | Optionales Array `{ "page": 1, "text": "…" }` je Seite        |
| `page_count`               | Aus `pages` abgeleitet; ohne echte Seiteneinteilung `NULL`    |
| `error_code`               | Öffentlicher Fehlercode; nur bei `failed` gesetzt             |
| `started_at`               | Start des letzten Verarbeitungsversuchs                       |
| `completed_at`             | Zeitpunkt des erfolgreichen oder fehlgeschlagenen Abschlusses |
| `created_at`, `updated_at` | Automatisch verwaltete Zeitstempel                            |

`files.status = ready` bedeutet weiterhin, dass die Datei geprüft und zum Download
freigegeben ist. Erst `source_documents.processing_status = ready` bedeutet, dass
ein Prozessor ein Ergebnis gespeichert hat. Ein Verarbeitungsfehler sperrt den
Download der gültigen Quelldatei nicht.

## Upload und Frontend

Der Ablauf `prepare → Storage-Upload → complete` bleibt bestehen. Die Function
prüft zuerst die gespeicherten Bytes. Anschließend setzt die ausschließlich
serverseitig aufrufbare RPC `complete_file_upload` die Dateifreigabe, das Material
und den Auftrag innerhalb einer Datenbanktransaktion. Bei einem Fehler wird diese
Transaktion vollständig zurückgenommen. Bereits bestätigte Dateien verwenden
dieselbe RPC, ohne erneut Bytes zu laden. Wiederholte und parallele Aufrufe liefern
dieselben IDs und setzen laufende oder abgeschlossene Verarbeitung nicht zurück.

Die Antwort von `complete` ist um diese Felder ergänzt:

```json
{
  "file": { "id": "Datei-UUID", "status": "ready" },
  "material_id": "Material-UUID",
  "source_document": {
    "id": "Quellen-UUID",
    "processing_status": "uploaded",
    "error_code": null
  }
}
```

`file` enthält weiterhin den vollständigen bisherigen Dateidatensatz. Die anderen
Dateiaktionen behalten ihre Antworten. Statuslisten lassen sich mit dem Nutzer-JWT
über die Data API laden:

```ts
const { data, error } = await supabase
  .from('materials')
  .select(
    'id, title, file_id, source_documents!source_documents_material_id_fkey(id, processing_status, error_code, updated_at)',
  )
  .eq('course_id', courseId)
  .eq('type', 'source_document')
  .order('created_at', { ascending: false })
  .range(0, 49);
```

Solange Quellen `uploaded` oder `processing` sind, kann das Frontend den Status
regelmäßig neu laden und bei Navigation abbrechen. `uploaded` ist als
„Hochgeladen – Verarbeitung ausstehend“ anzuzeigen. Diese Änderung richtet keine
Realtime-Publikation ein. Den eventuell großen Ergebnistext separat bei Bedarf
laden; nicht mit jeder Statusabfrage.

Nur eigene Quellen sind sichtbar. Clients können weder Verarbeitungsdaten schreiben
noch Quellenmaterialien direkt anlegen oder ihre Datei-Zuordnung ändern. Titel und
Beschreibung bleiben bearbeitbar; andere Materialtypen behalten ihre bisherigen
Rechte. Löschen erfolgt über das Material bzw. den vorhandenen Dateiablauf.

Ein fehlgeschlagenes Dokument kann sein Besitzer erneut einreihen:

```ts
const { data, error } = await supabase.rpc('retry_document_processing', {
  p_document_id: sourceDocumentId,
});
```

Die RPC liefert den Quellen-Datensatz. Wiederholungen starten `uploaded`,
`processing` oder `ready` nicht erneut. Fremde, fehlende oder von ihrer gelöschten
Datei getrennte Quellen liefern `DOCUMENT_NOT_FOUND` (SQLSTATE `P0002`);
nicht freigegebene Dateien `FILE_NOT_READY` (`55000`). Das ist das PostgREST-
Fehlerformat, nicht das Fehlerformat der `files`-Function.

## Sofort starten, ohne auf Cron zu warten

Nach erfolgreichem `complete` kann das Frontend direkt oder über einen Button
„Jetzt verarbeiten“ diese Function aufrufen. `document_id` ist die ID aus
`complete.source_document.id`, nicht die Datei- oder Material-ID:

```ts
const { data, error } = await supabase.functions.invoke('documents-process', {
  body: { document_id: sourceDocumentId },
});
```

Die angemeldete Supabase-Sitzung liefert den Nutzer-JWT. Niemals einen
Service-Role-Key ins Frontend übernehmen. Die Function prüft die Anmeldung und
liest die Quelle mit Nutzer-RLS, bevor sie einen privilegierten Claim versucht.
Ein Aufruf verarbeitet ausschließlich diese eigene Quelle; andere Aufträge in der
Warteschlange verzögern ihn nicht. Der Body ist auf 1 KiB begrenzt.

Der Aufruf wartet auf das Verarbeitungsergebnis. HTTP 200 enthält die bisherigen
Zähler sowie `source_document: { id, processing_status, error_code, page_count }`.
Ein Parserfehler kann HTTP 200 mit Status `failed` liefern: stets den Status prüfen.
Bereits fertige oder fehlgeschlagene Quellen werden nicht erneut verarbeitet.
Für fehlgeschlagene Quellen bleibt der explizite `retry_document_processing`-Aufruf
zuständig. Dessen fünfsekündige Wartefrist bleibt bestehen.

Ist der Auftrag bereits reserviert oder noch nicht fällig, liefert die Function
HTTP 202 und den aktuellen Status; das Frontend kann diesen regelmäßig nachladen
bzw. nach der Wartefrist nochmals starten. Parallele Klicks und Cron-Aufrufe sind
über denselben Claim abgesichert. Fehlende und fremde Quellen liefern einheitlich
`DOCUMENT_NOT_FOUND` / 404, ungültige Eingaben `INVALID_REQUEST` / 400 (zu großer
Body: 413), fehlende Anmeldung 401. Temporäre Infrastrukturfehler liefern 503;
bei unklarem Ausgang erst den Status nachladen. Der automatische Cron-Lauf bleibt
für nicht manuell gestartete oder abgebrochene Aufträge bestehen.

## Prozessor und Reservierungen

`document_processing_jobs` ist eine ausschließlich serverseitig zugängliche
Warteschlange. Ihre Fremdschlüssel entfernen Aufträge bei Datei- oder
Materiallöschung. Ein Worker liest fällige Aufträge begrenzt nach `available_at`
und versucht pro ID `claim_document_processing(p_document_id)`.

Die RPC liefert `NULL`, wenn der Auftrag gerade gesperrt, noch nicht fällig,
bereits reserviert oder nicht mehr gültig ist. Andernfalls liefert sie
`document_id`, `lease_token`, `lease_until`, `attempt` und den Dateidatensatz.
Parallele Worker erhalten höchstens eine aktive Reservierung. Nur eigene,
konsistent zugeordnete und freigegebene Quellen werden angenommen.

Eine Reservierung gilt fünf Minuten. Nach Ablauf kann der nächste Claim den
Auftrag mit einem neuen Token übernehmen. Nach drei erfolglosen Reservierungen
setzt der nächste Claim `failed / PROCESSING_TIMEOUT` und entfernt den Auftrag.
Ein Benutzer-Retry setzt die Versuchszahl zurück und reiht mit fünf Sekunden
Verzögerung neu ein. Ein abgestürzter Worker wird durch den nächsten
Worker-Durchlauf nach Ablauf seiner Reservierung aufgefangen.

Erfolg wird über folgende ausschließlich serverseitige RPC gespeichert:

```ts
await admin.rpc('finish_document_processing', {
  p_document_id: documentId,
  p_lease_token: leaseToken,
  p_text: 'Extrahierter Text',
  p_pages: [{ page: 1, text: 'Extrahierter Text' }],
});
```

Für TXT oder Formate ohne stabile Seitenzahlen `p_pages` weglassen. Seiten müssen
ab 1 lückenlos aufsteigen, je Seite einen String enthalten und auf höchstens 10.000
Einträge begrenzt sein. Ergebnistext ist auf 10 MiB, das JSON der Seiten auf 20 MiB
begrenzt. Leerer Text ist ein zulässiges Ergebnis, etwa bei einer leeren Seite;
die fachliche Behandlung von Scans ohne Text gehört zum Prozessor.

Bei Fehlern stattdessen `p_error_code` mit `PROCESSING_FAILED`,
`UNSUPPORTED_FORMAT` oder `INVALID_DOCUMENT` übergeben. Interne Fehlermeldungen
gehören in Worker-Logs. Die RPC speichert Ergebnis/Fehler und Endstatus atomar und
entfernt den Auftrag. `true` bestätigt die Speicherung; `false` bedeutet, dass
Quelle oder aktive Reservierung nicht mehr existieren. Abgelaufene und alte Tokens
können keine Ergebnisse überschreiben. Eine Wiederholung nach verloren gegangener
Erfolgsantwort liefert ebenfalls `false`; den Quellenstatus anschließend lesen.
Ungültige Ergebnisse liefern `INVALID_PROCESSING_RESULT` (`22023`) und lassen die
Reservierung bestehen, damit der Worker einen kontrollierten Fehler melden kann.

## Textextraktion und Grenzen

`documents-process` akzeptiert `POST` mit Nutzer-JWT und einer konkreten
`document_id` oder mit Service-Role-Key für die automatische Warteschlange.
CORS-Preflight ist ohne Anmeldung möglich. Der Worker prüft die kanonische
Storage-Zuordnung und liest Bytes streamend mit Größen- und Zeitlimit. Pro Aufruf
verarbeitet er höchstens einen Auftrag; bis zu zehn Kandidaten werden auf freie
Reservierungen geprüft. Aktive Reservierungen werden bereits beim Auflisten
übersprungen. Der Request enthält keine Datei-URL und keine vom Nutzer gewählte
Quelle. Downloadlinks oder PDF-Verweise werden nicht verfolgt.

| Format    | Verarbeitung                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------- |
| PDF       | Text je Originalseite, einschließlich leerer Seiten; vollständiger Text mit Seitenumbrüchen als Leerzeile |
| TXT       | UTF-8-Text unverändert; `pages` und `page_count` bleiben `NULL`                                           |
| DOCX/PPTX | Upload bleibt möglich; Extraktion endet derzeit mit `UNSUPPORTED_FORMAT`                                  |

Der fest versionierte Parser [unpdf](https://github.com/unjs/unpdf) verwendet eine
für Serverless-Laufzeiten gebündelte PDF.js-Version. Der Worker prüft zusätzlich
Textpositionen, Zeichenoperationen und vorhandene Struktur-Tags. Bilder,
Vektorzeichnungen, Tabellen-/Spaltenmuster, Formelzeichen und unklare Textqualität
markieren Seiten für die visuelle Extraktion mit Gemini. Sichere Textseiten und
leere Seiten bleiben lokal. Das ist eine konservative Heuristik, keine garantierte
Diagrammerkennung. PDF-JavaScript-Aktionen werden nicht ausgeführt.

Markierte Seiten werden mit `pdf-lib` einzeln in ein Teil-PDF kopiert und an den
separaten Gemini-Extraktionsadapter geschickt. Tabellenzellen samt Spannen,
Formeln und Abbildungsbeschreibungen werden als strukturierte Blöcke gespeichert.
Der Worker verarbeitet höchstens eine visuelle Seite pro Aufruf. Details, Grenzen
und Inbetriebnahme: [Visuelle Extraktion](visual-extraction.md).

Für die Extraktion gelten **10 MiB Eingabe, höchstens 100 PDF-Seiten und 5 MiB
Seitentext**. Die bestehenden Uploadgrenzen bleiben bei 50 MiB. Überschreitungen,
beschädigte oder passwortgeschützte PDFs liefern `INVALID_DOCUMENT`. Die Grenze
ist konservativ, da [Supabase Edge Functions](https://supabase.com/docs/guides/functions/limits)
nur begrenzte CPU-Zeit und Speicher bieten. Auch Dateien unterhalb dieser Grenzen
können die Plattformlimits erreichen; solche Abbrüche werden über die Reservierung
wiederholt und schließlich als `PROCESSING_TIMEOUT` sichtbar. Für größere Unterlagen
ist ein separater Worker mit mehr Ressourcen erforderlich.

Scans mit Bildinhalt werden auch ohne Textschicht an Gemini übergeben. Tatsächlich
leere Seiten bleiben leer und behalten ihre Originalposition. Fehlgeschlagene
visuelle Verarbeitung wird nicht als vollständige Textextraktion veröffentlicht.
Office-Parser sind weiterhin nicht enthalten. Chunking und Embeddings folgen nach
der Extraktion über die [RAG-Pipeline aus Issue #31](rag.md).

Storage-/Datenbankfehler liefern HTTP 503 und lassen die Reservierung zur späteren
Wiederaufnahme bestehen. Ein endgültiger Parserfehler wird über die Abschluss-RPC
atomar gespeichert. Ein HTTP-200-Ergebnis enthält Zähler `completed`, `failed` und
`discarded`; HTTP 200 allein bedeutet daher nicht, dass Text extrahiert wurde.

## Automatischer Betrieb

Die Migration `20260914150000_document_processing_schedule.sql` richtet
`learning-documents-process` minütlich ein. Der bestehende CI-Schritt
`scripts/configure-file-cleanup.mjs` konfiguriert nach dem Function-Deployment nun
beide Scheduler. `configure_document_processing` speichert Worker-URL und Key in
Vault unter `document_processing_url` und `document_processing_service_key`.
Ohne diese Einträge wird kein HTTP-Aufruf gesendet. Bei Key-Rotation den
Konfigurationsschritt erneut ausführen.

Mit einem Auftragsschritt pro Minute liegt der reguläre Durchsatz bei höchstens 60
Schritten pro Stunde. Textdokumente benötigen einen Schritt; visuelle PDFs einen
Schritt je markierter Seite. Die vorhandenen Claims erlauben später zusätzliche Worker,
ohne denselben Auftrag gleichzeitig zu bearbeiten. Lokal wird der Worker im Test
explizit mit dem lokalen Service-Key aufgerufen; die Migration allein konfiguriert
keine lokalen oder entfernten Zugangsdaten.

Auf Staging nach dem Deployment eine PDF hochladen und `uploaded → processing → ready`
prüfen. Zusätzlich `cron.job_run_details`, `net._http_response`, Function-Logs und
alte Einträge in `document_processing_jobs` prüfen. Ein erfolgreicher Cron-SQL-Lauf
belegt noch keinen erfolgreichen HTTP-Aufruf oder Parserlauf.

## Löschung und Bestandsdaten

Die Dateilöschung erhält bereits extrahierte Inhalte und setzt `materials.file_id`
wie bisher auf `NULL`. Unfertige Quellen erhalten `failed / SOURCE_DELETED`.
Sobald eine Datei `deleting` ist, kann kein Worker mehr erfolgreich abschließen.
Materiallöschung entfernt Quelle und Auftrag; Kurs- und Accountlöschung greifen
über die vorhandenen Kaskaden. Veraltete Worker können diese Daten nicht neu anlegen.

Die neue Migration ergänzt bereits als `ready` bestätigte Dateien und verwendet
vorhandene Quellenmaterialien einschließlich ihrer Titel wieder. `pending`,
`failed` und `unverified` werden nicht hochgestuft. Doppelte Quellenmaterialien pro
Datei oder inkonsistente Eigentümer-/Kurszuordnungen brechen die Migration atomar
ab und müssen vor dem Rollout geprüft werden. Es werden keine Bestandsmaterialien
automatisch zusammengeführt oder gelöscht.

Rollout: zuerst Migration, dann die aktualisierten Edge Functions und Scheduler-Konfiguration über den
bestehenden CI-Deploy. Falls die alte Function währenddessen noch Dateien bestätigt,
legt ein erneutes `complete` deren Quellen nach; alternativ kann der Server diese
`ready`-Dateien erneut durch `complete_file_upload` führen. Gelöschte Materialien
können durch eine erneute Dateibestätigung neu angelegt werden, solange die Datei
noch vorhanden ist.

## Prüfung

`source_documents.test.sql` prüft Rollenrechte, Materialwiederverwendung, Status,
Ergebnisse, Reservierungen, Wiederholungen und Löschungen. `test:files` prüft mit
echtem Storage und parallelen HTTP-Aufrufen die identische Quellen-ID bei doppelter
Bestätigung sowie genau eine erfolgreiche Worker-Reservierung.

```bash
npm run db:apply
npm run db:lint
npm run test:db
npm run functions:serve
# In einem zweiten Terminal:
npm run test:files
npm run functions:test
npm run functions:check
npm run functions:lint
npm run gen:types
npm run format:check
```

### Scheduler-Authentifizierung

`scripts/configure-file-cleanup.mjs` synchronisiert den externen Service-Role-Key
mit dem Edge-Function-Secret `WORKER_SERVICE_ROLE_KEY` und den Scheduler-Einträgen
in Vault. Der Plattformwert `SUPABASE_SERVICE_ROLE_KEY` kann davon abweichen und
bleibt für interne Datenbank-/Storage-Zugriffe zuständig. Lokal fällt die
Worker-Authentifizierung ohne eigenes Secret auf diesen Plattformwert zurück.
Nach Deployment der drei Worker den Konfigurationsschritt ausführen; bei
Schlüsselrotation erneut ausführen. Ohne CI-Token nutzt das Skript den CLI-Login.

Bei dauerhaftem `uploaded` auch die HTTP-Antworten in `net._http_response` prüfen:
Ein erfolgreicher Cron-SQL-Lauf beweist keinen erfolgreichen Worker-Aufruf.
`401 UNAUTHENTICATED` bei `attempts = 0` deutet auf Worker-Authentifizierung hin.
