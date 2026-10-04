# Automatische Dokument- und Kurszusammenfassungen

Das Backend erzeugt auf Anforderung eine deutsche Lernzusammenfassung für ein
hochgeladenes Quelldokument oder sämtliche Quelldokumente eines Kurses. Die
Generierung läuft dauerhaft im Hintergrund und speichert ein eigenes Kursmaterial.
Manuelle Zusammenfassungen werden nicht überschrieben. Ein Upload allein löst
keine Zusammenfassung aus.

## Frontend-Vertrag

Alle Aktionen laufen über `supabase.functions.invoke('summaries', { body })` mit
dem JWT des angemeldeten Nutzers. `client/summaries.ts` enthält typisierte Helfer.
Keine Service-Keys oder Anbieter-Keys im Frontend verwenden.

```ts
import {
  generateSummary,
  getSummaryJob,
  getSummaryResult,
  retrySummaryJob,
} from './client/summaries.ts';

// Diese Request-ID für Netzwerk-Wiederholungen beibehalten.
const request = {
  request_id: crypto.randomUUID(),
  target: { type: 'course' as const, course_id: courseId },
};
const { data: job, error } = await generateSummary(supabase, request);
if (error) throw error;

// Alternative: target: { type: 'document', source_document_id: documentId }
// documentId ist source_documents.id, NICHT files.id oder materials.id.

const { data: state } = await getSummaryJob(supabase, job!.job_id);
if (state?.status === 'completed' && state.summary_id) {
  const { data: result } = await getSummaryResult(supabase, state.summary_id);
  // result.content.text, result.content.sections, result.content.sources
  // result.is_stale weist auf veränderte/entfernte/neue Quellen hin.
}
// Bei einem erneut versuchbaren Fehler und nach der Wartefrist:
// await retrySummaryJob(supabase, job!.job_id);
```

| Aktion     | Request-Felder         | Antwort                                                                              |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `generate` | `request_id`, `target` | HTTP 202 mit Jobstatus; 200 bei vorhandenem abgeschlossenem/fehlgeschlagenem Auftrag |
| `status`   | `job_id`               | HTTP 200 mit Jobstatus                                                               |
| `result`   | `summary_id`           | HTTP 200 mit Ergebnis und Quellen                                                    |
| `retry`    | `job_id`               | Jobstatus; HTTP 202 bei eingereihtem/laufendem Auftrag                               |

`target` ist entweder `{ type: 'document', source_document_id: UUID }` oder
`{ type: 'course', course_id: UUID }`. Eine wiederverwendete `request_id` mit anderem
Ziel liefert 409. Unterschiedliche IDs für dasselbe Ziel und denselben
Quell-/Konfigurationsstand verwenden denselben laufenden Auftrag bzw. dasselbe
fertige Ergebnis. Neue Quellenstände benötigen eine neue Request-ID.

Jobstatus:

```json
{
  "job_id": "UUID",
  "status": "queued",
  "phase": "document",
  "completed_steps": 3,
  "total_steps": 5,
  "summary_id": null,
  "error_code": null,
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

Statuswerte sind `queued`, `processing`, `completed`, `failed`. `queued` gilt auch
zwischen Verarbeitungsschritten. Phasen sind `queued`, `sections`, `document`,
`course`, `completed` (Client berücksichtigt außerdem `failed`). Vor dem ersten
abgeschlossenen Schritt ist `total_steps` noch 0: dann einen unbestimmten Fortschritt
anzeigen. Später ist `completed_steps / total_steps` der Anteil fertiger
Arbeitsschritte, keine Zeitschätzung. Alle 3–5 Sekunden pollen, bei Navigation oder
Endzustand stoppen und Netzwerkfehler mit Wartezeit behandeln.

Ergebnisse enthalten `summary_id`, `material_id`, `target`, `created_at`,
`is_stale` sowie `content`:

```json
{
  "version": 1,
  "language": "de",
  "text": "Überblick\nZusammenfassung … [S1]",
  "sections": [{ "heading": "Überblick", "text": "Zusammenfassung …", "source_ids": ["S1"] }],
  "sources": [
    {
      "id": "S1",
      "source_document_id": "UUID",
      "material_id": "UUID",
      "title": "Vorlesung",
      "page": 1
    }
  ]
}
```

`content.sources` löst die Quellenmarker der Abschnitte auf. `page: null` bedeutet,
dass kein verlässlicher Seitenbezug vorhanden ist. Das separate Ergebnisfeld
`sources` listet alle in diesem Durchlauf berücksichtigten Dokumente. Quellenmarker
werden strukturell auf vorhandene Dokument-/Seitenbelege geprüft; eine semantische
Richtigkeitsgarantie für generierten Text ist das nicht. KI-Texte als generiert
anzeigen und als Text bzw. mit sicherem Markdown-Renderer darstellen.

### Bestehenden Summary-Editor anbinden

Die bestehende Frontend-Abfrage wählt das älteste Material vom Typ `summary`.
Vor der UI-Anbindung muss sie explizit nach `summaries.generation_kind` unterscheiden:

- `manual`: bisherige editierbare Zusammenfassungen;
- `document`: generierte Dokumentzusammenfassungen;
- `course`: generierte Kurszusammenfassungen.

`summary_generations` enthält Eigentümer-geschützte, nur lesbare Metadaten zu den
generierten Ergebnissen. Die neue Ergebnisaktion ist der bevorzugte Leseweg,
weil sie zusätzlich den aktuellen `is_stale`-Wert ermittelt. Generierte Originale
sind für Clients nicht bearbeitbar; zum Weiterbearbeiten kann das Frontend bewusst
eine neue manuelle Zusammenfassung anlegen. Das Löschen über das zugehörige Material
bleibt möglich. Datenbanktypen erst nach Aufnahme dieses Backend-Vertrags gemäß
Frontend-Repository-Konvention synchronisieren. Diese Änderung implementiert keine UI.

## Quellen und Fehler

Ein Kurs umfasst ausschließlich die zum Anforderungszeitpunkt vorhandenen
`source_documents`. Alle müssen `ready` sein, eine freigegebene Quelldatei und
nichtleeren extrahierten Text besitzen. Notizen, Chats, Kalender, manuelle und
bereits generierte Zusammenfassungen fließen nicht ein. Vektorsuche wird nicht
verwendet; alle Textabschnitte werden verarbeitet. Bei unvollständiger
Textextraktion kann die Zusammenfassung nur den tatsächlich extrahierten Inhalt
abdecken.

Fehlerantworten: `{ error: { code, details? } }`. Bei nicht erfolgreichen HTTP-Codes
liefert Supabase einen `FunctionsHttpError`; den JSON-Body aus dessen `context`
auslesen. `status: failed` ist dagegen ein erfolgreicher Statusabruf mit `error_code`.

| Fehlercode                               | Bedeutung / Reaktion                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`                        | 401; Sitzung erneuern                                                                                                             |
| `INVALID_REQUEST` / `REQUEST_TOO_LARGE`  | 400 / 413; Request korrigieren                                                                                                    |
| `TARGET_NOT_FOUND` / `SUMMARY_NOT_FOUND` | 404; nicht vorhanden oder kein Zugriff                                                                                            |
| `REQUEST_CONFLICT`                       | 409; gleiche Request-ID für anderes Ziel                                                                                          |
| `NO_SOURCES`                             | 422; Kurs ohne Quellen                                                                                                            |
| `SOURCES_NOT_READY`                      | 409; betroffene IDs in `error.details.source_document_ids`; Extraktion abschließen/reparieren                                     |
| `SOURCE_LIMIT_EXCEEDED`                  | 413; Umfang über der konfigurierten Grenze oder mehr als 200 Dokumente                                                            |
| `SUMMARY_RATE_LIMITED`                   | 429; maximal 2 aktive Jobs und 10 neue Jobs je Stunde/Nutzer; Retry frühestens nach 5 Sekunden, maximal 3 manuelle Wiederholungen |
| `SOURCE_CHANGED`                         | Quellstand hat sich während der Verarbeitung verändert; neue Anfrage starten                                                      |
| `NEW_REQUEST_REQUIRED`                   | 409; dieser Auftrag kann nicht erneut verwendet werden                                                                            |
| `BUDGET_EXCEEDED`                        | Job gescheitert; budgetgerechte neue Anfrage nötig, kein Budgetreset per Retry                                                    |
| `SUMMARY_PROCESSING_FAILED`              | Drei erfolglose Versuche eines Schritts; nach Beheben der Ursache Retry möglich                                                   |
| `SUMMARIES_NOT_CONFIGURED`               | 503; Anbieter/Modell/Schlüssel prüfen                                                                                             |
| `SUMMARIES_UNAVAILABLE`                  | 503; temporärer Backendfehler; Status prüfen, dann dieselbe Request-ID wiederverwenden                                            |
| `RESULT_DELETED`                         | Ergebnis wurde entfernt; neue Request-ID verwenden                                                                                |

Ändert oder entfernt sich eine Quelle während der Generierung, wird kein Ergebnis
für den veralteten Stand veröffentlicht. Spätere Änderungen (auch neue Kursquellen)
kennzeichnen vorhandene Ergebnisse als veraltet. Die bisherigen Ergebnisse bleiben
als Versionen abrufbar. Kurslöschung entfernt Jobs und Ergebnisse.

## Betrieb

Migrationen `20261003110000_generated_summaries` und
`20261003111000_summary_call_budgets` sowie Functions `summaries` und
`summaries-process` gehören gemeinsam zum Rollout. Der vorhandene Function-Deploy
nimmt beide mit. Kein Upload-Trigger wird verändert.

Der Scheduler `learning-summaries-dispatch` weckt alle 10 Sekunden einen Worker,
wenn fällige Jobs existieren. Er verwendet die schon vorhandenen Vault-Werte
`document_processing_url` und `document_processing_service_key`, ersetzt dabei nur
den Function-Pfad. Die bestehenden lokalen und Deployment-Konfigurationsskripte
richten diese bereits ein; keine weiteren Secrets oder Konfigurations-RPCs nötig.

Lokal nach `npm run db:apply` gegebenenfalls `npm run db:workers` ausführen und
`npm run functions:serve` starten. `npm run db:start` konfiguriert Vault ebenfalls.

`ANSWER_PROVIDER` wählt den vorhandenen Anbieter; `SUMMARY_MODEL` überschreibt
optional dessen Antwortmodell ausschließlich für neue Zusammenfassungsjobs.
Anbieter, Modell, Promptversion und Limits werden je Auftrag festgehalten. Keys
bleiben ausschließlich in der Umgebung. Ein späterer Anbieterwechsel verändert
keine laufenden Jobs; deren ursprünglicher Anbieter-Key muss verfügbar bleiben.

| Variable                        | Standard |  Maximum |
| ------------------------------- | -------: | -------: |
| `SUMMARY_MAX_OUTPUT_TOKENS`     |     3000 |     8192 |
| `SUMMARY_MAX_SOURCE_CHARACTERS` |   500000 |  2000000 |
| `SUMMARY_MAX_CALLS`             |      200 |     2000 |
| `SUMMARY_TOKEN_BUDGET`          |  2000000 | 10000000 |

Ein Worker verarbeitet genau einen KI-Schritt pro Aufruf. Eingabeblöcke haben
höchstens 10000 Zeichen; Verdichtungsstufen verbinden höchstens vier Ergebnisse.
Dokumente werden zuerst einzeln verdichtet, danach folgt die Kurszusammenführung.
Ergebnisse werden auf 4500 Zeichen für Überschriften und Text begrenzt. Die
Quellenmarker zählen zusätzlich. Nicht valide oder abgeschnittene KI-Antworten
werden nicht gespeichert.

Vor jedem Anbieteraufruf reserviert die Datenbank ein konservatives Budget aus
UTF-8-Eingabegröße, maximaler Ausgabe und Transportreserve. Die Reservation deckt
auch den einzelnen internen Transport-Retry des bestehenden Adapters ab.
`SUMMARY_MAX_CALLS` zählt diese logischen Aufrufe; jeder kann höchstens zwei
HTTP-Versuche enthalten. Fehlgeschlagene/abgebrochene Aufrufe und manuelle Retries
geben kein Budget zurück. Daher ist das Budget keine Abrechnung tatsächlicher
Tokens, sondern eine konservative Grenze. Bei komplexen Kursen kann diese Grenze
vor der Zeichengrenze greifen; Inhalte werden dann nicht stillschweigend gekürzt.

Eine Lease gilt zwei Minuten. Erfolgreiche Schritte speichern einen Checkpoint und
geben den Job frei; fehlgeschlagene Schritte werden nach Lease-Ablauf erneut
versucht. Nach drei erfolglosen Reservierungen wird der Job als fehlgeschlagen
markiert. Nur die aktuelle Lease darf Ergebnisse schreiben. KI-Laufzeit, Anbieter,
Modell und gemeldete Tokenzahlen erscheinen als `summary_step`-Logs ohne Quelltext.

Interne Tabellen `summary_jobs` und `summary_requests` sind ausschließlich für den
Service zugänglich. Der Server leitet die Nutzer-ID aus `auth.getUser()` ab;
Worker-RPCs sind für Browser gesperrt. Manuelle Inhalte behalten ihre bisherigen
RLS-Rechte. Die Tabelle `summary_generations` ist für Eigentümer nur lesbar.

## Prüfung

- `npm run functions:check`, `npm run functions:lint`, `npm run functions:test`
- `npm run db:lint`, `npm run test:db`, `npm run gen:types`
- `npm run test:summaries`: echte lokale Auth-/Datenbanktransaktionen, parallele
  Anfragen und Handler-Durchlauf mit simuliertem KI-Anbieter. Benötigt einen lokalen
  Stack ohne aktive Summary-Jobs, verwendet temporäre Nutzer und räumt diese auf.
  Externer Netzwerkzugriff ist im Testprozess gesperrt.

Der Integrationstest läuft auch in CI. Er prüft die technische Verarbeitung;
eine qualitative Bewertung echter Modellantworten ist davon getrennt.
