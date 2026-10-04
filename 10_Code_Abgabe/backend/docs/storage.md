# Private Lernunterlagen und Datei-Ablauf

Issues #23–#25 verwenden den privaten Bucket `learning-files` und `public.files`.
Ein Projekt entspricht `courses.id`. Dateiauswahl, Drag & Drop und Fortschritt
implementiert das Frontend. Dieses Backend stellt Vorbereitung, Prüfung,
Download und wiederholbares Löschen bereit.

## Formate und Grenzen

Maximal **50 MiB (52.428.800 Bytes)**, mindestens ein Byte pro Datei.

| Endung | MIME-Type                                                                   |
| ------ | --------------------------------------------------------------------------- |
| `pdf`  | `application/pdf`                                                           |
| `pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| `docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document`   |
| `txt`  | `text/plain`                                                                |

Storage prüft MIME-Type und Größenlimit. `prepare` prüft zusätzlich Dateiname
(maximal 255 Zeichen), Endung und Metadaten. Der Client muss den passenden
Content-Type senden, auch wenn der Browser `file.type` leer lässt.
`application/octet-stream` ist nicht freigegeben.

`complete` liest die gespeicherten Bytes begrenzt und streamend ein. Tatsächliche
Größe und Content-Type müssen den Metadaten entsprechen. Die Formatprüfung umfasst:

- PDF: Versionskopf und EOF-Markierung.
- TXT: gültiges UTF-8 ohne Nullbytes.
- DOCX/PPTX: ZIP-Verzeichnis, lokale Header, zum Format passende Dateieinträge,
  begrenzte Offsets und maximal 100 MiB deklarierte entpackte Gesamtgröße.
  Verschlüsselte Archive, ZIP64 und mehr als 10.000 Einträge werden abgewiesen.

Das ist eine begrenzte Strukturprüfung. Sie dekomprimiert kein Office-XML, prüft
keine ZIP-Prüfsummen und ersetzt keinen vollständigen Dokumentparser oder Virenscan.
Eine spätere Dokumentverarbeitung muss ihren Input weiterhin prüfen und begrenzen.

## Pfad, Status und Zugriffe

```text
{user_id}/{course_id}/{file_id}.{extension}
```

`prepare` erzeugt die Datei-ID serverseitig und gibt Bucket und Pfad zurück.
Der Originalname steht separat in `original_filename`. Eine Datenbankregel bindet
Pfad, Bucket, Nutzer, Kurs und MIME-Type zusammen. Bestehende RLS-Regeln sichern
die Kurs- und Nutzerzuordnung. Clients können keinen Dateistatus setzen.

| Status       | Bedeutung                                                           |
| ------------ | ------------------------------------------------------------------- |
| `pending`    | Metadaten vorbereitet; Upload oder Bestätigung steht aus            |
| `ready`      | Gespeicherte Datei geprüft; Öffnen und Download erlaubt             |
| `failed`     | Inhaltsprüfung fehlgeschlagen; `error_code` beschreibt den Grund    |
| `deleting`   | Löschung begonnen; wiederholbar bei Teilfehlern                     |
| `unverified` | Metadaten aus der Zeit vor dieser Migration; Bestand noch ungeprüft |

Storage erlaubt einen Upload nur zu einem eigenen `pending`-Datensatz, der jünger
als 24 Stunden ist. Die Policy sperrt den Datensatz innerhalb der Upload-Transaktion
gegen gleichzeitige Löschung. Überschreiben und Verschieben bleiben gesperrt.
Direkte Storage-Downloads und signierte URLs sind nur für eigene `ready`-Dateien
möglich. Direkte Storage-Löschungen durch Clients sind nicht mehr erlaubt.
Metadaten dürfen weiterhin über die Data API gelesen und gelöscht werden;
beim Löschen entsteht zwingend ein Bereinigungsauftrag.

## Frontend-Vertrag

`POST /functions/v1/files`, Nutzer-JWT im Authorization-Header, öffentlicher
Supabase-Key im `apikey`-Header. CORS-Preflight wird unterstützt. Der Body enthält
nur Metadaten und darf höchstens 8 KiB groß sein.

### 1. Vorbereiten

Einmal pro beabsichtigtem Upload eine `upload_key`-UUID erzeugen und für
Wiederholungen desselben Vorgangs aufbewahren.

```json
{
  "action": "prepare",
  "course_id": "UUID des eigenen Kurses",
  "upload_key": "UUID dieses Upload-Vorgangs",
  "filename": "Vorlesung.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 12345
}
```

Antwort: `{ "file": { ... } }` mit `id`, `storage_bucket`, `storage_path`,
Originalname, Zuordnungen, Status und Zeitstempeln. Gleichzeitige Wiederholungen
mit demselben Schlüssel und denselben Metadaten liefern denselben Datensatz.
Abweichende Metadaten ergeben `UPLOAD_KEY_CONFLICT`. Nach einer Löschung ergibt
derselbe Schlüssel `UPLOAD_DELETED`; für einen neuen Upload einen neuen Schlüssel
verwenden. Gleiche Namen mit verschiedenen Schlüsseln sind erlaubt; es findet
keine Deduplizierung nach Dateiinhalt statt.

### 2. Direkt zu Storage hochladen

```ts
const { error } = await supabase.storage
  .from(file.storage_bucket)
  .upload(file.storage_path, selectedFile, {
    contentType: file.mime_type,
    upsert: false,
  });
```

Die Datei wird nicht durch eine Edge Function hochgeladen. Bei Abbruch oder
Netzwerkfehler ist das Ergebnis zunächst unbekannt. Zuerst `complete` mit derselben
Datei-ID versuchen. Nur bei `UPLOAD_MISSING` erneut denselben Pfad hochladen.
Bei einem Storage-Konflikt erneut `complete` versuchen; niemals `upsert: true`
verwenden oder automatisch einen zweiten Datensatz erzeugen. Benutzerseitigen
Abbruch auf Wunsch durch `delete` abschließen.

### 3. Bestätigen

```json
{ "action": "complete", "file_id": "UUID der Datei" }
```

Antwort: `{ "file": { ... , "status": "ready" }, "material_id": "…", "source_document": { "id": "…", "processing_status": "uploaded", "error_code": null } }`.
Die Bestätigung legt atomar ein Quellenmaterial und einen Verarbeitungsauftrag an.
Bei Wiederholungen enthält `source_document` den aktuellen Verarbeitungsstatus.
Details und Statusabfragen: [Dokumentverarbeitung](documents.md).
Wiederholtes Bestätigen ist
zulässig. Fehlende Bytes lassen den Vorgang `pending`; ungültiger Inhalt setzt
`failed`. Ein fehlgeschlagener Vorgang kann gelöscht und mit neuem Schlüssel
neu begonnen werden. Netzwerk- oder Datenbankfehler lassen sich erneut versuchen.

### 4. Auflisten, öffnen und herunterladen

```ts
const { data, error } = await supabase
  .from('files')
  .select('id, original_filename, mime_type, size_bytes, status, error_code, created_at')
  .eq('course_id', courseId)
  .order('created_at', { ascending: false })
  .range(0, 49);
```

```json
{ "action": "download", "file_id": "UUID der Datei", "download": true }
```

Antwort: `{ "path": "/storage/v1/object/sign/...?...", "expires_in": 60 }`.
Mit `new URL(data.path, publicSupabaseUrl).href` die Browser-URL bilden.
`download: true` setzt den ursprünglichen Dateinamen für den Download;
weglassen oder `false` ermöglicht das Öffnen, soweit der Browser das Format kann.
Der relative Pfad funktioniert auch lokal, wo die Function einen internen
Docker-Hostnamen verwendet. Signierte Links sind bis zum Ablauf übertragbare
Zugriffsnachweise und dürfen nicht als dauerhaft gespeicherte Dateiadresse dienen.

### 5. Löschen

```json
{ "action": "delete", "file_id": "UUID der Datei" }
```

Antwort: `{ "deleted": true }`. Die Function prüft die Eigentümerschaft mit RLS,
markiert `deleting`, entfernt das Objekt über die Storage-API und anschließend
den Datensatz. Bei einem Fehler bleibt der Vorgang wiederholbar. Fehlende oder
fremde IDs liefern dieselbe erfolgreiche Antwort, ohne fremde Dateien anzufassen.
Das Frontend sollte erst nach Erfolg ausblenden oder einen ausstehenden Löschstatus
anzeigen. Datenbank und Storage bilden keine gemeinsame atomare Transaktion;
die Warteschlange stellt die nachträgliche Bereinigung sicher.

### Fehlercodes

Antwortform: `{ "error": { "code": "..." } }`.

| Code / HTTP                                                    | Frontend-Verhalten                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `UNAUTHENTICATED` / 401                                        | Sitzung prüfen bzw. erneuern                               |
| `INVALID_REQUEST`, `INVALID_FILE` / 400                        | Eingaben korrigieren                                       |
| `FILE_TOO_LARGE` / 413                                         | Kleinere Datei wählen                                      |
| `COURSE_NOT_FOUND`, `FILE_NOT_FOUND` / 404                     | Übersicht aktualisieren                                    |
| `UPLOAD_KEY_CONFLICT`, `UPLOAD_DELETED` / 409                  | Vorgang prüfen; für neuen Upload neuen Schlüssel verwenden |
| `FILE_NOT_READY`, `UPLOAD_NOT_PENDING` / 409                   | Status neu laden                                           |
| `LEGACY_FILE_REQUIRES_REVIEW` / 409                            | Bestandsdaten administrativ prüfen                         |
| `INVALID_CONTENT` / 422                                        | Andere bzw. korrigierte Datei verwenden                    |
| `UPLOAD_MISSING` / 503                                         | Upload noch nicht vorhanden; denselben Vorgang fortsetzen  |
| `STORAGE_ERROR`, `DATABASE_ERROR`, `SERVICE_UNAVAILABLE` / 503 | Mit begrenztem Backoff erneut versuchen                    |

Gateway- und direkte Storage-Antworten können ein anderes Fehlerformat haben;
diese ebenfalls behandeln. Die Function liefert keine internen Fehlerdetails.

## Dauerhafte Bereinigung und Betrieb

Ein Trigger schreibt bei Datei-, Kurs- und Account-Löschung in `file_cleanup_jobs`.
Die Tabelle hat absichtlich keine kaskadierenden Fremdschlüssel. Nur kanonische,
aus Nutzer/Kurs/Datei-ID ableitbare Pfade werden aufgenommen; alte frei eingetragene
Pfade erteilen keine privilegierte Löschberechtigung. Objektzeilen werden niemals
direkt per SQL gelöscht.

`files-cleanup` akzeptiert ausschließlich den eingebauten Service-Role-Key. Der
Worker entfernt zunächst bis zu 100 veraltete Vorgänge: `pending`/`failed` nach
24 Stunden ohne Änderung, `deleting` nach 15 Minuten. Anschließend bearbeitet er
bis zu 50 fällige Aufträge mit einem Zeitbudget. Storage-Fehler bleiben mit
Versuchszähler und Backoff von höchstens einer Stunde in der Warteschlange.
Erfolgreiche Aufträge bleiben als Tombstones erhalten, damit gelöschte Pfade und
Upload-Schlüssel nicht erneut verwendet werden. Eine spätere Archivierung muss
diesen Wiederverwendungsschutz erhalten.

Die zweite Migration installiert `pg_cron` und `pg_net`. Ein Job ruft den Worker
alle 15 Minuten auf. **Nach dem Function-Deployment** konfiguriert CI über
`scripts/configure-file-cleanup.mjs` die Projekt-URL und den Service-Key in Vault.
Das Skript verwendet die bestehenden `SUPABASE_PROJECT_REF`- und
`SUPABASE_ACCESS_TOKEN`-Werte des jeweiligen GitHub-Environments; Keys werden
nicht geloggt. Ohne Vault-Konfiguration sendet der Job keine Anfrage. Lokale
Tests rufen den Worker gezielt mit den lokalen, temporär gelesenen Keys auf.
Bei Rotation des Service-Role-Keys den Konfigurationsschritt erneut ausführen.

Auf Staging prüfen: `cron.job`, `cron.job_run_details`, `net._http_response`,
Function-Logs und nicht abgeschlossene `file_cleanup_jobs` mit `last_error` und
`next_attempt_at`. Ein erfolgreicher Cron-SQL-Lauf alleine beweist keinen
HTTP-Erfolg. Die Cleanup-Tabelle ist für normale Nutzer nicht zugänglich.

## Bestandsdaten und Rollout

Bestehende Dateien erhalten `unverified`; sie werden nicht automatisch gelöscht
oder als `ready` ausgegeben. Kanonische Bestandsdateien können über `complete`
geprüft werden. Nicht kanonische Pfade müssen administrativ mit Eigentümerprüfung
migriert werden. Bereits vor dieser Migration entstandene Objekte ohne Metadaten
werden nicht pauschal eingesammelt. Seeds enthalten nur Metadaten und keine Blobs.

Die geänderten Storage-Rechte sind eine API-Änderung: Frontend auf den beschriebenen
Ablauf umstellen und auf Staging gemeinsam prüfen. Zusätzliche manuelle permissive
Storage-Policies können die neuen Einschränkungen aufheben und müssen beim Rollout
geprüft werden. Die bestehenden Migrationen werden nicht geändert.

## Tests

```bash
npm run db:apply
npm run db:lint
npm run test:db
npm run test:storage
npm run test:files
npm run functions:lint
npm run functions:check
npm run functions:test
npm run gen:types
```

SQL-Tests prüfen Constraints, RLS, Upload-Schlüssel, Warteschlange und Ablaufzeiten.
Storage-Tests prüfen die tatsächlichen Bucket-Limits und Nutzertrennung;
ihre freigegebenen Metadaten sind ausdrücklich Test-Fixtures.
`test:files` prüft den vollständigen Ablauf einschließlich Wiederholungen,
Downloads, ungültigem Inhalt, 50-MiB-Datei und kaskadierender Bereinigung.
Function-Tests simulieren zusätzlich Netzwerk-, Storage- und Datenbankfehler.
Alle Integrationstests verwenden ausschließlich den lokalen Stack und räumen
ihre temporären Nutzer und Objekte auf. CI führt diese Prüfungen aus.

Referenzen: [Storage-Zugriffsregeln](https://supabase.com/docs/guides/storage/security/access-control),
[CLI-Projektkeys](https://supabase.com/docs/reference/cli/supabase-projects-api-keys).
