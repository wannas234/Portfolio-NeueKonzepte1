# Dateitext und Verarbeitungsdauer

Es gibt genau zwei [SQL-Abfragen](../supabase/queries/document-diagnostics.sql).
Im lokalen Supabase SQL Editor die gewünschte Abfrage markieren und ausführen.
Es müssen keine Datei-IDs oder andere Platzhalter ersetzt werden. Beide zeigen
alle vorhandenen Dateien, die neueste zuerst, mit verständlichen Spaltennamen.

1. **Vollständiger Text:** Eine Zeile pro Datei. Die Spalte „Vollständiger Text“
   enthält den gesamten extrahierten Text mit PDF-Seitenüberschriften.
2. **Zeitübersicht:** Eine Zeile pro Datei mit Status, Zeitstempeln und Laufzeiten
   für Extraktion, Indexierung, Download, Textauslesen, Textaufteilung, Embeddings
   und Speicherung. Alle Dauern sind in Sekunden.

Extraktion und Indexierung sind Gesamtwerte; die Detailphasen sind bereits darin
enthalten und dürfen nicht nochmals dazuaddiert werden. Die Messwerte summieren
alle Versuche und Batches der Datei, einschließlich fehlgeschlagener oder verworfener
Arbeit. Queue-Wartezeiten und Pausen zwischen Batches sind nicht enthalten.
Ohne gemessenen Extraktionslauf wird die vorhandene Dauer des letzten
Extraktionsversuchs verwendet. `NULL` bedeutet, dass keine Messung vorliegt.
Start/Ende beschreiben den ersten gemessenen Start und das letzte gemessene Ende;
bei laufender Verarbeitung ist das letzte Ende noch kein endgültiger Abschluss.

Die Zeitübersicht benötigt die Migration `20260930120000_document_processing_timings`
und die aktualisierten Worker. Frühere Detailmessungen können nicht nachträglich
rekonstruiert werden. Harte Worker-Abbrüche können unvollständige Messungen hinterlassen.

PDF-Seitenzahlen bleiben erhalten, auch bei leeren Seiten. TXT hat keine Seitenzahlen.
Vor abgeschlossener Extraktion ist der Text `NULL`. Der SQL Editor kann lange Zellen
optisch kürzen; die Abfrage selbst begrenzt den Text nicht. Die Daten stammen aus dem
extrahierten Dokument, nicht aus den überlappenden Such-Chunks.

Angemeldete Nutzer sehen über RLS nur ihre zugänglichen Dokumente. Der SQL Editor
mit Adminrolle zeigt alle Dateien der lokalen Datenbank.

## Lokal dauerhaft „Ausstehend“

Bleibt die Verarbeitung bei `attempts = 0`, fehlen möglicherweise die lokalen
Vault-Einträge für den Scheduler. Bei laufendem lokalem Supabase und gestarteten
Functions ausführen:

```bash
npm run documents:configure:local
```

Nach einem Datenbank-Reset oder einer Änderung des Worker-Keys wiederholen.
Die Indexierung benötigt zusätzlich `GEMINI_API_KEY` in der lokalen Edge Runtime.
