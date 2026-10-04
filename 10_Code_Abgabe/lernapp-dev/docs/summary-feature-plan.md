# Automatische Dokument- und Kurszusammenfassungen

Stand: 2. Oktober 2026. Vom Nutzer freigegebener Implementierungsplan.
Der umgesetzte Vertrag und die Betriebsanleitung stehen in [summaries.md](summaries.md).
Lokaler Backend-Branch: `feat/document-course-summaries`, ausgehend von `dev`.

## Ziel und Umfang

Das Frontend kann eine Zusammenfassung für ein hochgeladenes Dokument oder alle
Quelldokumente eines Kurses anfordern, den Fortschritt abfragen und das gespeicherte
Ergebnis laden. Die Generierung erfolgt nach Anforderung automatisch im Hintergrund.
Ein automatischer Start bei jedem Upload ist zunächst nicht vorgesehen.

Die erste Umsetzung umfasst Backend, Migrationen, Tests, einen typisierten
TypeScript-Client und die Integrationsdokumentation. Die eigentliche UI-Anbindung
erfolgt anschließend im separaten Frontend-Repository.

Vorgeschlagene V1: deutsche Lernzusammenfassung mit Überblick, Kernaussagen,
wichtigen Begriffen und dokumentgestützten Zusammenhängen. Keine erfundenen
Prüfungsschwerpunkte. Quellenangaben verweisen auf Dokumente und, soweit vorhanden,
Seiten. Persönliche Notizen, Chats, Kalender und bereits erzeugte Lernmaterialien
werden nicht als Kursquellen aufgenommen.

## Vorhandene Grundlage

- `source_documents` enthält extrahierten Text, Seiten und Verarbeitungsstatus.
  Die Tabelle `documents` ist dagegen für selbst erstellte Inhalte vorgesehen.
- `materials` und `summaries` speichern bereits Zusammenfassungen als Kursmaterial;
  `summaries.content` ist JSON, `source_file_id` optional.
- Die Dokumentpipeline bietet Vorbilder für dauerhafte Jobs, Worker, Leases,
  Checkpoints und zeitgesteuerte Wiederaufnahme.
- `_shared/ai/` kapselt die vorhandenen KI-Anbieter. Die Zusammenfassung benötigt
  eigene Ausgabe- und Laufzeitbudgets; Chatgrenzen nicht unbesehen übernehmen.
- Das Frontend liest und schreibt manuelle Zusammenfassungen als `{ text }`.
  `getCourseSummary` wählt aktuell das älteste Summary-Material unabhängig von der
  Quelle. Vor Anzeige automatisch generierter Dokumentzusammenfassungen muss diese
  Abfrage explizit zwischen Dokument-, Kurs- und manuellen Zusammenfassungen trennen.
- Gesprächszusammenfassungen in `chat_history_summaries` sind ein anderes Feature.

## Vorgeschlagener Frontend-Vertrag

Neue authentifizierte Edge Function `summaries`, mit folgenden Aktionen:

```ts
// Vorschlag, noch keine vorhandene Schnittstelle:
type GenerateSummary = {
  action: 'generate';
  request_id: string; // UUID; bei Netzwerk-Retry wiederverwenden
  target: { type: 'document'; source_document_id: string } | { type: 'course'; course_id: string };
};
// Annahme: HTTP 202, { job_id, status: 'queued' | 'processing' }
// Vorhandenes identisches Ergebnis: HTTP 200 mit job_id und summary_id.
// Weitere Aktionen: status(job_id), result(summary_id), retry(job_id).
```

Statusantworten enthalten `queued | processing | completed | failed`, Phase,
Anzahl abgeschlossener/gesamter Arbeitsschritte, bei Erfolg `summary_id` und bei
Fehler einen öffentlichen `error_code`. Ergebnisantworten enthalten Text,
strukturierte Abschnitte, Quellen, Erstellungszeitpunkt, Ziel und Quellstand sowie
`is_stale`. Polling genügt für V1; keine neue Realtime-Abhängigkeit.

Client-Helfer in `client/summaries.ts`: `generateSummary`, `getSummaryJob`,
`getSummaryResult`, `retrySummaryJob`. Dokument-ID bezeichnet ausdrücklich
`source_documents.id`, nicht Datei- oder Material-ID.

## Datenmodell und Schutz bestehender Inhalte

1. Bestehende `summaries` für das fertige Ergebnis weiterverwenden; `content.text`
   bleibt als kompatible Textdarstellung erhalten. Versioniertes Inhaltsformat
   ergänzt Abschnitte und überprüfte Quellenmarker.
2. Separate serververwaltete Generierungsmetadaten ordnen Ergebnis, Ziel,
   Quellfingerabdruck, Promptversion, Anbieter und Modell zu. Dokumentzuordnung
   nicht allein aus dem nullable `source_file_id` ableiten.
3. Dauerhafte Aufträge und Arbeitsschritte speichern Status, Versuche, Lease,
   Checkpoints und den unveränderlichen Quellstand eines Durchlaufs. Internes
   Arbeitsmaterial bleibt für Browser unzugänglich.
4. Ergebnis-Material, Zusammenfassung, Metadaten und erfolgreicher Jobabschluss
   werden atomar gespeichert. Manuelle Zusammenfassungen werden nicht überschrieben.
   Bei verändertem Quellstand entsteht eine neue generierte Version.
5. Gleiche Request-ID mit anderem Inhalt wird abgewiesen; parallele Anfragen für
   denselben Quellstand teilen einen aktiven Job bzw. ein vorhandenes Ergebnis.
   Dies wird durch Datenbank-Constraints und transaktionale RPCs abgesichert.
6. Eigentumsprüfung und RLS schützen Status und Ergebnisse. Nur Worker dürfen
   Generierungsmetadaten, Quellenbelege und Jobstatus verändern. Bestehende
   Bearbeitungsrechte für manuelle Zusammenfassungen bleiben erhalten; generierte
   Originale sind schreibgeschützt. Löschung und Quellenentzug müssen laufende
   Arbeiten invalidieren und dürfen keine verwaisten Zugriffsrechte hinterlassen.

## Verarbeitung

1. Ziel und Eigentümer prüfen. Für Kurse alle aktuell zugehörigen Quelldokumente
   vollständig und paginiert erfassen. Leere Kurse sowie fehlgeschlagene, noch
   nicht fertige oder inhaltsleere Quellen liefern einen verständlichen Fehler
   mit betroffenen Dokument-IDs. V1 erzeugt keine stillschweigend unvollständige
   „Gesamtkurszusammenfassung“.
2. Den Quellstand über Inhaltsfingerabdrücke fixieren. Änderungen während eines
   Durchlaufs vor Speicherung erkennen und als `SOURCE_CHANGED` behandeln;
   spätere Änderungen kennzeichnen vorhandene Ergebnisse als veraltet.
3. Vollständige extrahierte Texte in begrenzte Abschnitte zerlegen und abschnittsweise
   verdichten. Keine Top-k-Vektorsuche verwenden: Sie würde relevante Teile auslassen.
4. Abschnittsergebnisse zu Dokumentzusammenfassungen zusammenführen. Für Kurse
   Dokumentergebnisse anschließend thematisch zusammenführen, Dopplungen reduzieren
   und Widersprüche mit ihren Quellen beibehalten. Bei großen Eingaben mehrere
   begrenzte Verdichtungsstufen verwenden, ohne Texte still abzuschneiden.
5. Quellen-IDs und Seitenbereiche durch alle Stufen mitführen und vor Speicherung
   gegen den Quellstand validieren. Nur vorhandene Belege akzeptieren. Dokumenttext
   als nicht vertrauenswürdige Daten behandeln, nicht als Systemanweisungen.
6. `summaries-process` als separaten Worker mit begrenzten Verarbeitungsschritten,
   Leases, Checkpoints und Cron-Wiederaufnahme ergänzen. Keine lange HTTP-Anfrage
   aus dem Frontend voraussetzen. Abgelaufene Worker dürfen nichts überschreiben.
7. Temporäre Anbieterfehler begrenzt erneut versuchen; endgültige Fehler sichtbar
   machen. Nutzerbezogene Rate-/Parallelitätslimits sowie konfigurierbare Grenzen
   für Quellumfang und Tokenbudget vorsehen. Überschreitung ausdrücklich melden.
   Laufzeit und Tokenverbrauch protokollieren, keine Dokumenttexte oder Secrets.

## Umsetzungsschritte nach Bestätigung

1. API- und Ergebnisformat konkretisieren, Migrationen und RLS/RPCs implementieren.
2. Authentifizierte Request-/Status-/Ergebnis-Schnittstelle und Idempotenz ergänzen.
3. Zusammenfassungslogik, Quellenprüfung und wiederaufnehmbaren Worker implementieren.
4. Worker-Konfiguration, lokale Einrichtung, Client-Helfer, generierte DB-Typen und
   Dokumentation aktualisieren.
5. Tests und lokalen End-to-End-Durchlauf ausführen; Frontend-Vertrag mit Beispielen
   für Start, Polling, Ergebnisse, Fehler und veraltete Quellen übergeben.

## Abnahme und Tests

- Ein Dokument und ein Kurs mit mehreren Dokumenten liefern dauerhaft gespeicherte,
  quellenbezogene Zusammenfassungen; alle Eingabeabschnitte werden berücksichtigt.
- Große Dokumente/Kurse werden über mehrere Worker-Läufe fertiggestellt.
- Neustart, Lease-Ablauf, Netzwerk-Retry und parallele Requests erzeugen keine
  doppelten Ergebnisse oder überschriebenen Abschlüsse.
- Fremde Nutzer erhalten weder Inhalte noch Status; Worker-Schreibrechte sind
  nicht über die Data API zugänglich. RLS mit pgTAP prüfen.
- Leere/unfertige Quellen, Quellenänderung/-löschung, Anbieterfehler, fehlerhafte
  KI-Ausgaben und Budgetüberschreitung liefern definierte Zustände.
- Manuelle Zusammenfassungen bleiben erhalten; generierte Dokument- und
  Kursergebnisse sind eindeutig unterscheidbar.
- Deno-Tests für Zerlegung, Verdichtung, Belege und Fehlerbehandlung; Integrationstest
  mit deterministischem Anbieter-Testdouble. Anschließend DB-Tests, Function-Lint,
  Typecheck und Formatprüfung nach Repository-Konvention. Ein echter KI-Probelauf
  erfordert vorhandene lokale Anbieter-Konfiguration.

## Zur Freigabe vorgeschlagene Produktentscheidungen

- Start durch Frontend-Aufruf, kein automatischer kostenpflichtiger Upload-Trigger.
- „Kompletter Kurs“ umfasst sämtliche hochgeladenen Quelldokumente zum Startzeitpunkt.
- Alle Kursquellen müssen verarbeitet und nutzbar sein; keine Teilzusammenfassung in V1.
- Deutsche Ausgabe mit Quellen, ohne zusätzliche Längen-/Stiloptionen in V1.
- Backend-Funktion samt Client-Vertrag zuerst; UI-Integration als separater Schritt.
