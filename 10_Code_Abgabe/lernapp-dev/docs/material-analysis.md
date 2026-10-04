# Materialanalyse und Terminvorschläge

`material-analysis` analysiert ein verarbeitetes Quellmaterial und speichert ein
versioniertes JSON-Ergebnis. Version 1 erkennt einmalige Termine (`event`) und
Fristen (`deadline`). Die Terminbeschreibung umfasst erkennbare Inhalte, Themen,
Vorbereitung und benötigte Unterlagen aus zugehörigen Sätzen. Ohne zusätzliche
Information bleibt `description: null`.

## Voraussetzungen und Grenzen

- Bestehenden Datei-Upload und Dokumentprozessor verwenden: `material_id` bezeichnet
  ein eigenes `source_document`-Material mit fertiger Textextraktion. Die vorhandene
  Dokumentpipeline verarbeitet PDF (einschließlich Scan-/Bildseiten per OCR) und TXT.
  Einzelne Bilddateien müssen derzeit als PDF bereitgestellt werden.
- Eingefügten Text zunächst als Textdatei hochladen; der Analyse-Endpunkt selbst
  nimmt keine Rohdateien oder freien Text entgegen.
- Bestehende `ANSWER_PROVIDER`-/Modell-/API-Key-Konfiguration wird wiederverwendet.
- Ein synchroner Modellaufruf mit 55 Sekunden Zeitlimit, maximal 8192 Ausgabetokens,
  maximal 60.000 Quelltextzeichen und 50 Vorschlägen. Größere Quellen werden
  abgelehnt, niemals still gekürzt. Abgebrochene Ausgaben werden nicht veröffentlicht.
- Pro Nutzer maximal ein laufender Aufruf und sechs neue Analysen pro Minute.
  Wiederholte Requests mit derselben `request_id` kosten keinen weiteren Modellaufruf.
- Keine automatische Erstellung von Kalendereinträgen. Auch Vorschläge ohne
  Prüfhinweise müssen ausdrücklich bestätigt werden.

## API

Alle Aktionen: `POST /functions/v1/material-analysis` mit Nutzer-Bearer-Token.
Typisierte Aufrufe stehen in `client/material-analysis.ts`.

### Analysieren

```json
{
  "action": "analyze",
  "request_id": "UUID-pro-logischer-Anfrage",
  "material_id": "UUID-des-Materials",
  "context": {
    "reference_date": null,
    "timezone": "Europe/Berlin"
  }
}
```

`context` ist optional. `reference_date` ist ein **verlässliches Bezugsdatum**
im Format `YYYY-MM-DD`, beispielsweise das Datum eines Anschreibens. Niemals
automatisch das Upload-Datum einsetzen. Die Zeitzone muss ausdrücklich aus dem
App-Kontext stammen. Fehlende Angaben bleiben `null`.

Das Ergebnis besitzt folgende Struktur:

```json
{
  "schema_version": "1.0",
  "analysis_id": "UUID",
  "material_id": "UUID",
  "status": "completed",
  "items": [
    {
      "id": "stabiler-64-stelliger-hex-Hash",
      "type": "calendar_entry",
      "title": "Mathematikprüfung",
      "description": "Lineare Funktionen und Gleichungssysteme. Geodreieck mitbringen.",
      "source": {
        "page": 2,
        "quote": "Am 12. November 2026 um 9 Uhr schreiben wir die Mathematikprüfung zu linearen Funktionen und Gleichungssystemen. Geodreieck mitbringen."
      },
      "review": { "required": false, "issues": [] },
      "data": {
        "kind": "event",
        "date": "2026-11-12",
        "time": "09:00:00",
        "end_date": null,
        "end_time": null,
        "timezone": "Europe/Berlin",
        "location": null,
        "submission_channel": null
      }
    }
  ],
  "warnings": [],
  "error_code": null,
  "decisions": []
}
```

Ein leeres `items` bei `completed` ist ein erfolgreiches Ergebnis ohne Termine.
Datum ohne Uhrzeit bleibt `time: null`; daraus kann die Prüfoberfläche einen
ganztägigen Eintrag machen. `review.required` kennzeichnet Unklarheiten, keine
Erlaubnis zur automatischen Übernahme.

Prüfcodes: `missing_year`, `missing_date`, `relative_date_unresolved`,
`conflicting_information`, `ambiguous_information`, `missing_timezone`,
`invalid_time_range`. Hinweise enthalten jeweils auch eine deutsche `message`.

Das Modell erhält feste Feld-/Typvorgaben; das Backend validiert die JSON-Struktur,
Datumswerte, Zeitbereiche und Originalzitate strikt. Ein vorhandenes Originalzitat
beweist nicht automatisch die sachliche Richtigkeit aller Modellinterpretationen:
Nutzer sollen vor der Übernahme den Vorschlag prüfen. Historische Daten,
Literaturangaben, bloße Beispiele und Terminserien sind vom MVP ausgeschlossen.

### Ergebnis erneut lesen

```json
{ "action": "result", "analysis_id": "UUID" }
```

HTTP 202 bedeutet `processing`, HTTP 200 liefert `completed` oder `failed`.
Auch die ursprüngliche Analyse kann mit HTTP 200 und `status: failed` antworten;
Clients müssen den Status auswerten. Nach einem Verbindungsabbruch dieselbe
`request_id` erneut senden. Nach spätestens 100 Sekunden wird ein verlassener
Aufruf beim Lesen als `failed` mit `ANALYSIS_TIMEOUT` markiert.
Für einen bewussten neuen Versuch nach Fehlschlag eine neue `request_id` erzeugen.
Änderungen an Kontext oder Material bei gleicher Request-ID ergeben einen Konflikt.

### Bestätigen / korrigieren und übernehmen

```json
{
  "action": "accept",
  "analysis_id": "UUID",
  "item_id": "64-stelliger-hex-Hash",
  "event": {
    "title": "Mathematikprüfung",
    "description": "Lineare Funktionen und Gleichungssysteme. Geodreieck mitbringen.",
    "kind": "exam",
    "starts_at": "2026-11-12T09:00:00+01:00",
    "ends_at": null,
    "all_day": false
  }
}
```

`event` enthält die vom Nutzer bestätigten, bei Bedarf korrigierten Daten.
Die Oberfläche übernimmt insbesondere die vorgeschlagene `description` in dieses
Objekt. Zeitpunkte müssen Sekunden und einen expliziten Offset oder `Z` enthalten;
die Oberfläche muss damit auch mehrdeutige Sommerzeitwechsel klären. Für ganztägige
Einträge `all_day: true` und die im Kalender verwendeten Tagesgrenzen übergeben.
`ends_at` muss nach `starts_at` liegen. Der Kurs wird serverseitig vom Material
übernommen. `kind` verwendet die vorhandenen Kalenderwerte:
`lecture`, `exercise`, `study`, `presentation`, `exam`, `deadline`, `other`.

Antwort:

```json
{
  "item_id": "64-stelliger-hex-Hash",
  "status": "accepted",
  "calendar_event_id": "UUID"
}
```

Kalenderanlage und Übernahmebeleg erfolgen atomar. Wiederholtes Bestätigen liefert
denselben Beleg, auch wenn der Termin später gelöscht wurde. Für Änderungen nach
der Übernahme die vorhandene Kalenderbearbeitung nutzen.

### Verwerfen

```json
{ "action": "dismiss", "analysis_id": "UUID", "item_id": "64-stelliger-hex-Hash" }
```

Antwort: `status: dismissed`, `calendar_event_id: null`. Entscheidungen erscheinen
bei weiteren Ergebnisabrufen in `decisions`. Bereits getroffene Entscheidungen
werden nicht still umgekehrt (`DECISION_CONFLICT`). Identische Vorschläge desselben
Materials nutzen bei erneuter Analyse denselben Beleg. Die deterministische
Identität berücksichtigt Titel und Termindaten; abweichend formulierte Vorschläge
oder dieselben Termine in verschiedenen Materialien können weiterhin eine manuelle
Dublettenprüfung erfordern.

## Fehler und Datenschutz

- 400: `INVALID_REQUEST`.
- 401: `UNAUTHENTICATED`.
- 404: `TARGET_NOT_FOUND`, `ANALYSIS_NOT_FOUND`, `ITEM_NOT_FOUND` (auch fremde Daten).
- 409: `SOURCES_NOT_READY`, `REQUEST_CONFLICT`, `SOURCE_CHANGED`,
  `ANALYSIS_NOT_READY`, `ANALYSIS_EXPIRED`, `DECISION_CONFLICT`.
- 413: `REQUEST_TOO_LARGE`, `SOURCE_LIMIT_EXCEEDED`.
- 429: `ANALYSIS_RATE_LIMITED`.
- 503: `ANSWERS_NOT_CONFIGURED`, `ANALYSIS_UNAVAILABLE`.

Gespeicherte Fehlschläge enthalten nur öffentliche Codes, z. B.
`INVALID_ANALYSIS_SOURCE`, `INVALID_ANALYSIS_OUTPUT`, `INCOMPLETE_ANSWER`,
`RESULT_LIMIT_EXCEEDED`, `ANALYSIS_PROVIDER_UNAVAILABLE` oder `SOURCE_CHANGED`.
Keine Providerantworten, Schlüssel oder Materialtexte in Fehlermeldungen.

Tabellen haben RLS und sind ausschließlich für `service_role` zugänglich. Die Edge
Function authentifiziert zuerst den Nutzer; RPCs prüfen zusätzlich Kursbesitz.
Quelländerungen während der Analyse verhindern die Veröffentlichung veralteter
Resultate. Materiallöschung entfernt Analysen und Belege per Cascade.

## Erweiterung

`schema_version` versioniert den Vertrag; `items[].type` ist der Diskriminator für
spätere Ergebnistypen. Aktuell wird nur `calendar_entry` akzeptiert. Neue Typen
bekommen eigene Datenvalidierung, Extraktionsregeln und Bestätigungsaktionen.
Die generische JSON-Speicherung muss dafür nicht umgebaut werden.

## Validierung

Die Deno-Tests prüfen Beschreibungen, Quellen, Unsicherheiten, Termine und den
Endpunkt mit simuliertem KI-Anbieter. pgTAP prüft Zugriffsrechte, Request- und
Import-Idempotenz, atomare Kalenderanlage, Quellenänderungen und Zeitlimits.
Die fachliche Erkennungsqualität des gewählten Modells muss zusätzlich mit echten,
repräsentativen Materialien bewertet werden; Mock-Tests messen diese nicht.
