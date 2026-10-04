# Selektive PDF-Extraktion mit Gemini

## Implementierter Ablauf

`documents-process` prüft jede PDF-Seite lokal mit PDF.js. Eingebettete Bilder,
Vektor-Zeichenoperationen, getrennte Textspalten, Tabellen-/Abbildungs-Tags,
Formelzeichen oder unsicherer Text markieren eine Seite für visuelle Verarbeitung.
Das Ergebnis enthält `route: local | visual` und nachvollziehbare `reasons`.
Auch eine Seite mit gut auslesbarem Text kann dadurch ausgewählt werden.
Leere Seiten ohne entsprechende Signale bleiben lokal.

Für die erste ausgewählte Seite wird ein eigenständiges Einseiten-PDF erzeugt.
Der Gemini-Aufruf enthält nur dieses PDF und den Extraktionsauftrag, keinen
Chatverlauf und keine fremden Kursinhalte. Die Originalseitenzahl wird serverseitig
zugeordnet. Ein erfolgreicher Aufruf liefert Text-/Überschriften-/Listenblöcke,
Tabellen, Formeln und Abbildungsbeschreibungen in Lesereihenfolge.

Der Anbieteradapter ist vom Chat unabhängig. JSON-Schema, Tabellenraster,
Zellspannen, Textgrößen und Abschlussgrund werden geprüft. Überlappende/fehlende
Zellen, abgeschnittene Antworten, verweigerte Ausgaben und `complete=false` werden
nicht veröffentlicht. Schemaeinhaltung garantiert trotzdem keine fachliche
Richtigkeit; Modell-Auslassungen und Erkennungsfehler bleiben möglich.

`native_text` bewahrt die lokale Vergleichsfassung. `text` ist die kanonische
Suchfassung. `blocks` enthalten stabile Seiten-/Block-IDs, Typ und UTF-16-Offsets.
Tabellen enthalten zusätzlich `cells` und Zeilenenden. Jede Suchzeile wiederholt
ihre Spaltenüberschriften sowie Caption/Einheiten. `extraction` speichert Version,
Anbieter, Modell, Warnungen und getrennte Input-/Output-/Thinking-Tokenzahlen.
Diese Metadaten und das ursprüngliche PDF bilden die Quellenreferenz. Es werden
keine unzuverlässigen Modell-Bounding-Boxes als exakte Koordinaten ausgegeben.

## Warteschlange und Fehler

Die Migration `20260924120000_visual_document_processing.sql` ergänzt die private
Jobtabelle um `checkpoint` und die service-only RPC
`save_document_processing_checkpoint`. Vor dem ersten Modellaufruf wird die lokale
Analyse mit beibehaltener Reservierung gespeichert. Nach einer erfolgreichen Seite
wird der Fortschritt gespeichert und die Reservierung für den nächsten Schritt
freigegeben. Pro Function-Aufruf wird höchstens eine visuelle Seite verarbeitet.
Auch das letzte Modellergebnis wird vor `finish_document_processing` gesichert.

Die RPC prüft Dateistatus, Eigentumsverknüpfung, Dokumentstatus, Token und Ablauf
der Reservierung. Veraltete Worker und gelöschte Quellen können nichts speichern.
Erst nach allen Seiten wird das Dokument atomar `ready` und für die vorhandene
Indexierungswarteschlange freigegeben. Teilinhalte gelangen nicht in die Suche.

HTTP 429/5xx, Netzwerkfehler und ungültige Modellergebnisse lassen die bestehende
Reservierung auslaufen. Der nächste Versuch verwendet gespeicherte Ergebnisse.
Ein erfolgreicher Seitenschritt setzt das Versuchslimit zurück. Nach drei
fehlgeschlagenen Versuchen desselben Schritts gilt die bestehende Behandlung:
`PROCESSING_TIMEOUT`, Job samt Checkpoint wird entfernt. Ein anschließender
Nutzer-Retry startet das Dokument neu. Fehler zwischen erfolgreichem Modellaufruf
und Checkpoint-Speicherung können zusätzliche Modellkosten verursachen.

Der minütliche Scheduler verarbeitet einen Schritt pro Aufruf: Ein PDF mit 20
markierten Seiten benötigt daher bei alleiniger Scheduler-Verarbeitung ungefähr
20 Takte, zuzüglich Warte-/Fehlerzeiten. Parallelisierung/Durchsatzsteigerung ist
ein eigener Betriebsentscheid; dieselbe Quelle bleibt durch die Lease geschützt.

## Konfiguration und Rollout

Serverseitige Umgebungsvariablen:

```dotenv
GEMINI_API_KEY=<vorhandener serverseitiger Schlüssel>
DOCUMENT_EXTRACTION_PROVIDER=gemini
GEMINI_DOCUMENT_MODEL=gemini-3.6-flash
DOCUMENT_MAX_OUTPUT_TOKENS=16384
```

Provider und Modell besitzen die gezeigten Defaults. Das Ausgabelimit erlaubt
1.024–32.768 Tokens und ist unabhängig von `AI_MAX_OUTPUT_TOKENS` für Chatantworten.
Fehlender Schlüssel oder ungültige Konfiguration liefert vor einem Claim
`503 / DOCUMENT_EXTRACTION_NOT_CONFIGURED`; es wird kein Versuch verbraucht.
Diese Voraussetzung gilt für den gemeinsamen Worker auch bei TXT-Aufträgen.

Zuerst Migration anwenden, Schlüssel/Modellzugriff im Zielprojekt sicherstellen,
dann `documents-process` und `documents-index` zusammen deployen. Modell und
Vertragsversion bei laufenden Jobs nicht wechseln: abweichende Checkpoints werden
abgewiesen. Ein fehlgeschlagener Auftrag kann über den bestehenden Retry neu
gestartet werden. Vorher erfolgreich verarbeitete Dokumente werden nicht
automatisch neu analysiert oder kostenpflichtig erneut verarbeitet.

Lokal: `npm run db:apply`, `npm run gen:types`, `npm run functions:check`,
`npm run functions:lint`, `npm run functions:test`, `npm run test:db`.
Tests verwenden generierte PDFs und simulierte Gemini-Antworten. Für eine
Produktionsfreigabe zusätzlich einen Live-Pilot mit repräsentativen Unterlagen
durchführen; Modellzugang, Laufzeit, echte Extraktionsqualität und Kosten lassen
sich durch diese Tests nicht bestätigen.

## Grenzen dieser ersten Backend-Version

- 10 MiB, maximal 100 PDF-Seiten und 5 MiB kanonischer Text bleiben die Grenzen.
- Der Router ist heuristisch. Besonders ungewöhnliche Formeln, gedrehte Layouts
  oder Darstellungen ohne eindeutige Signale müssen im Pilot bewertet werden.
- Tabellen über Seitengrenzen werden noch nicht automatisch zusammengeführt.
- Einzelne übergroße Tabellenzeilen oder Formeln brechen die Indexierung explizit
  mit `INVALID_INDEXING_INPUT` ab, statt Struktur zu verlieren.
- Bildausschnitte, visuelle Nachprüfung während einer Chatantwort, Korrektureditor
  und eine neue Fortschrittsoberfläche gehören zum weiteren Featureplan.
- Fachlich unleserliche Stellen werden im Ergebnis markiert; extrahierte
  Diagrammbeschreibungen sind keine Garantie für korrekte Zahleninterpretation.

## Vorgemerkte Mistral-Erweiterung

Die Nutzerentscheidung ist **Gemini zuerst, Mistral später möglich**.
`VisualExtractor` in `visual-extraction.ts` definiert die Austauschgrenze;
`DocumentPage`/`DocumentBlock` in `document-structure.ts` sind anbieterunabhängig.
Ein zukünftiger Mistral-Adapter muss dessen OCR- und BBox-Annotationen in dieses
Format übersetzen und separat Seitenverbrauch erfassen. Router, Offsetvertrag
und Chunker bleiben gleich. Aktuell wird `DOCUMENT_EXTRACTION_PROVIDER=mistral`
explizit abgewiesen; es gibt keinen versteckten zweiten Anbieteraufruf.

Planung und Qualitätskriterien: [Featureplan](ocr-feature-plan.md).
