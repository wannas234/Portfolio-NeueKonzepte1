# OCR und visuelles Dokumentverständnis: Featureplan

Stand: 24.09.2026. Zielbild mit erster Backend-Implementierung. Umgesetzt sind
lokale Seitenauswahl, Gemini-Einseitenextraktion, private Job-Checkpoints und
blockbewusstes Chunking. Implementierter Umfang, Konfiguration und verbleibende
Grenzen: [Visuelle Extraktion](visual-extraction.md). Ein Anbieterbenchmark bzw.
Live-Qualitätspilot wurde noch nicht durchgeführt. Weiter unten beschriebene
Revisionstabellen, Bildausschnitt-UI und multimodaler Chat bleiben Ausbauziele.

## Festgelegter Ansatz: Gemini zuerst, Mistral erweiterbar

Mit dem Nutzer festgelegt: **lokale Text-/Layoutanalyse jeder PDF-Seite und selektive visuelle Extraktion mit Gemini 3.6 Flash (`gemini-3.6-flash`) für markierte oder unsichere Seiten**. TXT bleibt beim lokalen Parser. Der vorhandene Gemini-Zugang wird verwendet; für die erste Version ist keine zusätzliche OCR-Anbieteranbindung vorgesehen. Die tatsächliche Extraktionsqualität wird an repräsentativen Lernunterlagen geprüft.

**Dauerhaft festgehaltene Erweiterungsoption: Mistral OCR mit Bild-/Diagramm-Annotationen.** Mistral soll später als alternativer Extraktionsadapter ergänzt werden können, ohne Router, Blockformat, Chunking oder Suchpipeline neu zu bauen. Es wird im ersten Release weder implementiert noch automatisch als Fallback aufgerufen. Die vorherige Mistral-Startempfehlung ist durch diese Entscheidung ersetzt.

Der Seiten-Router wird gemeinsam mit der strukturierten Extraktion für Issue #53 geplant. Eindeutig einfache Textseiten bleiben lokal, Verdachtsfälle gehen vollständig an den Anbieter. Vollverarbeitung bleibt Vergleichsmodus im Pilot und Rückfalloption, falls die lokale Erkennung nicht ausreichend vollständig ist. OCR nur bei fehlendem Text genügt nicht: Ein digital erzeugtes PDF kann ausgezeichnet extrahierbaren Text und trotzdem wichtige Diagramme oder komplexe Tabellen enthalten.

Annahmen: PDF-Skripte, Folien und Scans auf Deutsch/Englisch; Qualität wichtiger als minimale Seitenkosten; zunächst keine sehr großen Dokumentmengen. Monatliches Volumen, Budget und Anteil handschriftlicher Unterlagen sind noch unbekannt. Für den MVP gelten die vorhandenen Extraktionsgrenzen weiter; größere Dateien sind ein separates Ausbauziel.

## Ausgangslage im Repository

- `supabase/functions/_shared/document-extraction.ts`: unpdf/PDF.js liest Text je Seite, ohne Tabellen- oder Layoutrekonstruktion. Grenzen: 10 MiB und 100 Seiten; Upload erlaubt bereits 50 MiB.
- Leere Scan-Seiten bleiben erhalten; Dokumente können trotzdem als fertig gelten, ohne nutzbaren Inhalt.
- `supabase/functions/_shared/document-chunks.ts`: Abschnitte bis 1.800 UTF-16-Codeeinheiten mit Überlappung; Tabellen können dadurch auseinandergerissen werden.
- `documents-process` und `documents-index` besitzen Warteschlangen, Reservierungen und Wiederholungen. Diese Mechanismen weiterverwenden und um länger laufende externe Verarbeitung erweitern.
- Suche verwendet bereits Gemini-Textembeddings und Hybrid-Ranking. Diagrammbeschreibungen können daran anschließen.
- `supabase/functions/_shared/ai/answers.ts` überträgt aktuell Text. Eine spätere Prüfung am Originalbild erfordert eine Erweiterung des Nachrichtenvertrags und des Antwortadapters.

## Gemini-Extraktion und Anbietergrenze

Gemini 3.6 Flash unterstützt PDF-/Bildeingaben und strukturierte Ausgaben. [Modell](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), [PDF-Verarbeitung](https://ai.google.dev/gemini-api/docs/document-processing).

Die vorhandene Konfiguration `GEMINI_API_KEY` wiederverwenden, aber einen separaten Dokumentextraktionsadapter anlegen. Vorschlag: `DOCUMENT_EXTRACTION_PROVIDER=gemini` und `GEMINI_DOCUMENT_MODEL=gemini-3.6-flash`. Modell, Schema, Promptversion, Timeout, Parallelität und Ausgabelimit sind unabhängig vom Chat konfiguriert. Das derzeitige Chat-Ausgabelimit von standardmäßig 800 Tokens ist für vollständige Seitentranskription ungeeignet. Die konkrete Modellverfügbarkeit im Projekt beim Pilot prüfen.

Nur ausgewählte Seiten physisch als Teil-PDFs erzeugen und übermitteln, zunächst eine Seite pro Auftrag, zusammenhängende Tabellenfortsetzungen bei Bedarf als kleine Seitengruppe. Die Originalseitenzuordnung wird vom Worker vorgegeben und geprüft, nicht vom Modell erraten. Bei nötigem Bildinput die ausgewählte Seite ausreichend lesbar rendern. Ein vollständiges PDF plus Prompt „nur Seite 7“ erfüllt die selektive Übertragung nicht.

Der Extraktionsprompt verlangt vollständige Transkription statt Zusammenfassung, alle Tabellenzeilen/-spalten samt Headern, verbundene Zellen, Formelblöcke und getrennte Diagrammbeschreibungen. Unleserliches wird als unbekannt markiert. Direkt gelesene, geschätzte und interpretierte Inhalte bleiben unterscheidbar. Strukturierte Ausgabe mit JSON-Schema anfordern und serverseitig validieren; Schemaeinhaltung ist kein Beleg für sachliche Richtigkeit.

Ein gemeinsamer Adaptervertrag erhält autorisierte Seitendaten und Originalseiten-Mapping und liefert normalisierte Seiten/Blöcke, Warnungen, Modell-/Anbieterherkunft, Vollständigkeitsstatus und Verbrauch. Tabellen enthalten Zellkoordinaten und Zeilen-/Spaltenspannen, Formeln ihre Transkription, Abbildungen Beschriftungen und Interpretation getrennt. Positionen dürfen fehlen oder ungeprüft sein: Von Gemini erzeugte Bounding Boxes erst validieren, bevor sie für präzise Ausschnitte/Zitate verwendet werden; sonst die ganze Originalseite verlinken. Keine erfundenen OCR-Konfidenzwerte verlangen.

Abgeschnittene Antworten, verweigerte Ausgaben, ungültige JSON-Daten oder unvollständige Tabellen nicht als Erfolg veröffentlichen. Begrenzte Wiederholung mit kleinerer Seitengruppe bzw. gezielter Bereichsprüfung; danach sichtbarer Teilfehler. Gute native Texte bleiben als Vergleich erhalten. Eine kanonische Ausgabe verhindert doppelte Indexierung.

Der spätere Mistral-Adapter übersetzt dessen OCR-/Annotationsergebnis in denselben Vertrag. Verbrauch ist anbieterabhängig: Gemini-Tokens bzw. Mistral-Seiten, jeweils mit separat gespeicherter Kostenschätzung. Ein Anbieterwechsel erzeugt eine neue Extraktionsrevision und gezielte Neuindexierung. Schlüssel und Mistral-spezifische Optionen werden erst bei Einführung dieses Adapters benötigt.

## Was „korrekt erkannt“ bedeutet

### Tabellen

Zeilen, Spalten, verbundene Zellen, mehrstufige Überschriften, Einheiten und Fußnoten müssen zusammen erhalten bleiben. Zahlen werden nicht stillschweigend korrigiert. Originalschreibweise und normalisierter Zahlenwert werden getrennt gespeichert. Bei einer Tabelle über mehrere Seiten werden die Teile verknüpft; ein automatisches Zusammenführen benötigt passende Überschriften, Spaltenstruktur und Fortsetzungsmerkmale.

Speicherung als strukturiertes JSON plus HTML für die Darstellung und eine daraus abgeleitete Suchrepräsentation. Markdown allein ist bei verbundenen Zellen ungeeignet. Die Beschreibung einer Tabelle ersetzt ihre Zellwerte nicht.

### Diagramme und Abbildungen

Drei getrennte Aufgaben: Abbildung lokalisieren, Beschriftungen lesen, Bedeutung auswerten. Für Diagramme werden Typ, Achsen, Einheiten, Legende, Datenreihen und relevante Beziehungen gespeichert. Bei Ablaufdiagrammen sind Knoten und gerichtete Verbindungen relevant. Andere Abbildungen erhalten einen passenden Typ und eine Beschreibung.

Jede Aussage unterscheidet zwischen direkt gelesen, visuell geschätzt und interpretiert. Fehlende oder unleserliche Werte bleiben unbekannt. Eine Linie ohne Zahlenbeschriftungen liefert keine exakten Messwerte. Originalausschnitt, Bildunterschrift, benachbarter Text und Seitenverweis bleiben verfügbar. Auch Vektordiagramme müssen erfasst werden; das Extrahieren eingebetteter Rasterbilder allein reicht nicht.

## Anbietervergleich

Preise in USD, abgerufene öffentliche Standard-/US-Listenpreise; ohne Steuern, Hosting, Speicherung, Embeddings, Zusatzaufrufe und Wiederholungen. Funktionen und Tarife sind nicht vollständig gleichwertig.

| Anbieter                                | Eignung für diesen Fall                                                                                 | Preisorientierung je 1.000 Seiten                                                             | Bewertung                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Gemini 3.6 Flash über Gemini API        | Vorhandener Anbieter; PDF-/Bildverständnis und strukturierte Ausgabe                                    | Tokenbasiert, kein fester Seitenpreis; siehe Kostenmodell                                     | Festgelegter erster Adapter                               |
| Mistral OCR 4.1 + Bildannotation        | Strukturblöcke, Tabellen, Bildbereiche und strukturierte Annotationen                                   | 4 USD OCR; 5 USD annotierte Seiten                                                            | Explizit vorgemerkte spätere Erweiterung                  |
| LlamaParse Agentic / Agentic Plus       | Alternative für komplexe Layouts und multimodale Dokumente                                              | Rechnerisch 12,50 / 56,25 USD anhand veröffentlichter Credits; Tarifbindung beachten          | Recherchealternative; keine MVP-Abhängigkeit              |
| Google Document AI Gemini Layout Parser | Tabellenstruktur und Beschreibungen visueller Inhalte; RAG-orientiert; separates Produkt zur Gemini API | 10 USD für Layout Parser                                                                      | Recherchealternative; keine MVP-Abhängigkeit              |
| Azure Document Intelligence Layout      | Tabellen, Positionen und Abbildungsausschnitte; Diagramminterpretation zusätzlich planen                | Regionalen Layout-Preis ermitteln; dynamische Preistabelle lieferte keinen belastbaren Betrag | Vor allem bei bestehender Azure-Infrastruktur interessant |
| AWS Textract Tables                     | Zeilen-/Spaltenextraktion; allein kein vollständiges Diagrammverständnis                                | 15 USD, Beispiel US West/Oregon, erste Million Seiten                                         | Für diese Lernapp keine erste Wahl                        |

Mistral dokumentiert für OCR 4.1 Blockpositionen und Konfidenzwerte. Modellversion für reproduzierbare Ergebnisse fest pinnen. [Modell und Preise](https://docs.mistral.ai/models/ocr-4-1).

Bei einer späteren Mistral-Anbindung für Tabellen HTML-Ausgabe und für Layout Strukturblöcke anfordern; Bild-/Tabellenplatzhalter aus dem Seitentext mit den zugehörigen Objekten auflösen. [OCR-Ausgabe](https://docs.mistral.ai/studio/document-processing/basic_ocr).

Mistrals `bbox_annotation` verarbeitet erkannte Bildbereiche einzeln. Die globale `document_annotation` berücksichtigt laut Dokumentation nur die ersten acht extrahierten Bildbereiche und eignet sich deshalb nicht als alleinige Diagrammverarbeitung. Übersehene Bildbereiche brauchen einen gesonderten Erkennungstest. [Annotationen](https://docs.mistral.ai/studio/document-processing/annotations).

LlamaParse: 10 bzw. 45 Credits pro Seite laut [Tier-Beschreibung](https://www.llamaindex.ai/blog/introducing-llamaparse-v2-simpler-better-cheaper), 1,25 USD pro 1.000 Credits und Starter-Tarif 50 USD/Monat mit 40.000 Credits laut [Preisseite](https://www.llamaindex.ai/pricing). Seitenpreise sind eine Umrechnung, keine Zusage einer separaten Abrechnung ohne Grundtarif; Tarif vor Pilot bestätigen.

Google: [Layout-Funktionen](https://docs.cloud.google.com/document-ai/docs/layout-parse-chunk) und [Preise](https://cloud.google.com/products/document-ai/pricing). Die Dokumentation kennzeichnet die generative Annotation als Preview. Synchron maximal 15 PDF-Seiten, Batch maximal 500; mehrseitige Tabellen können geteilt werden. Ein vorhandener Gemini-API-Key ersetzt die Einrichtung von Document AI nicht.

Azure: [Layout-Modell](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/layout?view=doc-intel-4.0.0) und [regionale Preise](https://azure.microsoft.com/en-gb/pricing/details/document-intelligence/). AWS: [Funktionsumfang und Preisbeispiele](https://aws.amazon.com/textract/pricing/).

## Alle Seiten oder selektiv?

| Strategie                                                               | Vorteil                                                                   | Hauptnachteil                                                          | Entscheidung                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| OCR nur bei leerem/kaputtem Text                                        | Geringe API-Menge                                                         | Übersieht Diagramme und Tabellen auf textreichen Seiten                | Nicht als Standard verwenden             |
| Textprüfung + Layout-Erkennung auf jeder Seite, OCR selektiv            | Nutzt gemeinsame Strukturinformationen mit Issue #53; reduziert API-Menge | Erkennung verursacht Aufwand; Fehlklassifikation verliert Inhalt       | Geplanter Standard nach Qualitätsprüfung |
| Vollständige Layout-/OCR-Verarbeitung, gezielte visuelle Interpretation | Einfacher Qualitätsvergleich und bessere Abdeckung                        | Jede PDF-Seite wird berechnet; auch hier sind Erkennungsfehler möglich | Pilotvergleich und Rückfalloption        |

„Alle Seiten“ bedeutet nicht, das ganze Dokument in einen einzigen unkontrollierten Modellaufruf zu stecken. Seiten bzw. kleine Gruppen werden mit Originalseiten-Mapping verarbeitet. Dokumentkontext, Überschriften und Nachbarseiten bleiben für Fortsetzungen verfügbar. Paketgröße wird anhand gemessener Latenz und aktueller Anbieterlimits gewählt.

Lokale Textextraktion bleibt als Vergleichssignal bestehen. Native Texte können genauer sein; Unterschiede dienen als Warnsignal. Eine geprüfte kanonische Blockdarstellung verhindert, dass OCR- und Originaltext doppelt im Index landen. Nicht blind zwei unterschiedliche Textfassungen zusammenkleben.

Router: Textqualität, Textpositionen, Spalten, Bilder und Vektorzeichnungen auf jeder Seite prüfen. Textmenge allein genügt nicht. Unsichere Seiten immer vollständig analysieren, Tabellenfortsetzungen mit Nachbarseiten betrachten. Übersprungene Seiten regelmäßig stichprobenartig gegen Vollverarbeitung prüfen. Eine Auswahl von Seiten im Anbieterrequest bedeutet nicht automatisch, dass nur diese Seiten übertragen werden; bei entsprechender Anforderung physisch Teil-PDFs erzeugen.

### Gemeinsame Grundlage mit Issue #53

[Issue #53: Tabellen- und formelbewusstes Chunking](https://github.com/Azockgg/lernapp/issues/53) fordert den Erhalt von Tabellen und erkennbaren Formelblöcken, konsistente `start/end/page`-Metadaten und unverändertes Verhalten für reine Fließtexte. Chunking allein kann zuvor verworfene Struktur nicht wiederherstellen.

Beim PDF-Lesen zunächst Textobjekte mit Positionen und Schriftmerkmalen erhalten, statt sie sofort auf `str` zu reduzieren. Zusätzlich Zeichenoperationen und vorhandenen Strukturbaum auswerten. PDF.js bietet dafür `getOperatorList()` und `getStructTree()`; ein Strukturbaum ist nicht immer vorhanden. Diese APIs liefern Grundlagen, keinen fertigen Diagrammklassifikator. Kompatibilität und Ressourcenverbrauch mit der gepinnten unpdf-Version im Pilot prüfen. [PDF.js-API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html).

Pro Seite `route: local | visual`, nachvollziehbare `reasons` und Qualitätsmerkmale speichern. Mögliche Gründe: `image_present`, `vector_graphics`, `table_candidate`, `formula_uncertain`, `poor_text`, `layout_uncertain`. Bilder sind Hinweise, nicht automatisch relevante Diagramme. Vektorgrafiken, randlose Tabellen und Formeln benötigen weitere Heuristiken. Logos und Dekorationen zunächst eher mitverarbeiten, als wichtige Inhalte durch aggressive Filter zu verlieren.

In Version 1 ganze markierte Seiten verarbeiten, nicht nur mutmaßliche Bildausschnitte. So bleiben Achsen, Legenden und Captions zusammen; Ausschnitte sind eine spätere Optimierung. Sichtbar leere Seiten von Scans unterscheiden. Bei vollständig gescannten oder durchgehend komplexen PDFs kann der Router alle Seiten auswählen.

Lokale und Anbieterergebnisse in ein gemeinsames Blockformat überführen: `text`, `heading`, `list`, `table`, `formula`, `figure`, jeweils mit Seite, Position und Herkunft. Der Chunker arbeitet erst auf diesem normalisierten Ergebnis. Formelblöcke bleiben zusammen; übergroße Blöcke erhalten eine gesonderte Behandlung statt stiller Trennung. Tabellen nur an validierten Zeilengrenzen teilen und Header wiederholen.

Für `start/end` eine eindeutige Bezugsfassung definieren: Offsets in der kanonischen Textdarstellung der jeweiligen Extraktionsrevision; native Offsets separat speichern. Bestehenden reinen Textpfad unverändert lassen. Strukturblöcke und Chunker gemeinsam versionieren und gezielt neu indexieren, damit OCR-Offsets nicht fälschlich auf alten Text zeigen.

Vor Release vor allem die übersehenen Inhalte auf lokal belassenen Seiten messen. Bei unzureichender Erkennung betreffende Dokumentklassen vollständig verarbeiten. Der Router ist ein eigenständig zu prüfender Verarbeitungsschritt, keine kostenlose Nebenwirkung des Textparsens.

### Kostenmodell

Gemini 3.6 Flash: laut am 24.09.2026 geprüfter Standardpreisliste bis 31.12.2026 0,75 USD pro Million Eingabetokens und 3,75 USD pro Million Ausgabetokens inklusive Thinking. Ab 01.01.2027 sind 1,50 bzw. 7,50 USD angekündigt. Kein fester Seitenpreis. [Gemini-Preise](https://ai.google.dev/gemini-api/docs/pricing).

Kosten = abgerechnete Eingabetokens × Eingabepreis + abgerechnete Ausgabe-/Thinking-Tokens × Ausgabepreis. Verbrauch aus Provider-Metadaten erfassen; Thinking nicht doppelt zählen. Bildauflösung, Ausgabeumfang und Wiederholungen beeinflussen den Seitenpreis. Beispiel mit angenommenen 1.000 Eingabetokens und insgesamt 1.000 Ausgabe-/Thinking-Tokens: 0,0045 USD pro analysierter Seite zum aktuellen Tarif. Bei 3.000 ausgewählten von 10.000 Eingangsseiten wären das 13,50 USD. Dies ist eine Rechenannahme, keine gemessene Prognose.

Zum Vergleich kostet Mistral nach veröffentlichter Preisliste 0,004 USD pro OCR-Seite bzw. 0,005 USD pro annotierter Seite. Gemini ist nicht automatisch günstiger; der erste Vorteil ist die Wiederverwendung des vorhandenen Anbieters. [Mistral-Preisgrundlage](https://docs.mistral.ai/models/ocr-4-1).

Budgetierung: Gemini-Eingabe/Ausgabe/Thinking + zusätzliche Bildprüfung + Embeddings + Speicher/Worker + Wiederholungen. Kosten pro Dokument und Nutzer erfassen und begrenzen. Monatliche Mengen, reale Tokennutzung und Qualität entscheiden später über die Mistral-Erweiterung.

## Geplante Pipeline

1. Upload autorisieren und validieren; unverändertes Original privat speichern.
2. Dauerhaften Verarbeitungsauftrag und eine neue Extraktionsrevision anlegen.
3. PDF lokal prüfen: Seitenzahl, native Textobjekte, Layoutsignale und Qualitätsmerkmale; Seitenroute samt Gründen bestimmen.
4. Markierte/unsichere Seiten als Teil-PDFs an den Gemini-Extraktionsadapter übergeben; strukturierte Ergebnisse sofort dauerhaft speichern; sichere Textseiten lokal normalisieren.
5. Tabellen und Formeln normalisieren; Gemini-Diagrammbeschreibungen mit Original und Kontext verbinden. Unsichere Bereiche gezielt erneut mit Gemini prüfen; ein zweiter Anbieter gehört erst zur späteren Erweiterung.
6. Ergebnisse auf Vollständigkeit, Tabellenstruktur, Seitenmapping und verdächtige Zahlendifferenzen prüfen. Anbieter-Konfidenz ist ein Signal, keine Garantie für semantische Richtigkeit.
7. Inhaltstypgerechte Suchabschnitte erstellen und mit der bestehenden Embedding-Pipeline indexieren.
8. Neue Revision erst nach definiertem Abschluss veröffentlichen; Teilfehler und unzuverlässige Inhalte sichtbar kennzeichnen.

Asynchrone Verarbeitung mit Checkpoints statt eines langen Uploadrequests. Supabase Edge Functions übernehmen Autorisierung und Orchestrierung. Rendering, umfangreiche Bildbearbeitung und große Dokumente gehören bei Bedarf in einen separaten Worker; sie sollen nicht zusätzlich in die jetzige PDF-Parserfunktion gepackt werden.

## Datenmodell und RAG

Neue logische Einheiten, konkrete Migrationen erst in der Implementierung festlegen:

- `document_extractions`: Dokument, Revision, Datei-Hash, Anbieter, Modell, Konfigurationsversion, Status, Verbrauch und Warnungen.
- `document_pages`: Originalseitenzahl, nativer Text, kanonischer Inhalt, Methode, Qualitätsmerkmale und Seitenstatus.
- `document_elements`: stabile ID, Seite(n), Typ, Lesereihenfolge, Position, Inhalt/Struktur, Caption, Beziehungen, Herkunft und Prüfstatus.
- `document_assets`: private Bildausschnitte/Seitenbilder, verknüpft mit Elementen und Revision.
- Bestehende `document_chunks`: Element-IDs, Revision und präzise Quellenverweise ergänzen; bisherigen Seitenverweis beibehalten.

Text wird nach Überschriften und Absätzen segmentiert. Kleine Tabellen bleiben zusammen; große Tabellen werden entlang von Zeilen geteilt, jeweils mit vollständigen Spaltenüberschriften und Einheiten. Diagrammbeschreibung und Metadaten bilden einen eigenen Suchabschnitt. Ganze Tabelle bzw. verknüpftes Diagramm können nach einem Treffer nachgeladen werden.

Für Fragen zu exakten Diagrammwerten oder räumlichen Beziehungen soll der Antwortpfad den relevanten Originalausschnitt zusätzlich an ein bildfähiges Modell übergeben können. Beschreibungen allein sind verlustbehaftet. Dazu den bisher textbasierten Nachrichtenvertrag erweitern. Bildverständnis benötigt im MVP keine neuen Bildembeddings: Beschreibung für die Suche, Originalbild zur Prüfung bei passenden Fragen.

Unleserliche Werte und Schätzungen dürfen nicht als gesicherte Fakten in Antworten oder späteren Lernkarten erscheinen. Zitate zeigen Dokument, Originalseite und möglichst den betreffenden Bereich. Bestehende Chat-Quellensnapshots bleiben bei Neuindexierung nachvollziehbar.

## Betrieb und Oberfläche

- Jobs erhalten Checkpoints, begrenzte Wiederholungen, Backoff, geeignete Reservierungsdauer und Schutz gegen veraltete Worker. Ein Timeout darf nicht sofort einen zweiten kostenpflichtigen Auftrag auslösen; Provider-Job-ID speichern, soweit verfügbar.
- Cache-Schlüssel umfasst Besitzer-/Zugriffskontext, Datei-Hash, Modell, Parameter und Schemaversion. Keine mandantenübergreifende Offenlegung durch globale Deduplizierung.
- Rohantworten und Assets privat ablegen; HTML vor Darstellung bereinigen. Inhalte sind Daten, keine Anweisungen an Worker oder Antwortmodell.
- Löschsemantik ausdrücklich festlegen: Material-/Accountlöschung entfernt auch abgeleitete Assets; beim bloßen Löschen der Quelldatei muss die bisherige Aufbewahrung extrahierter Inhalte bewusst berücksichtigt werden.
- Region, Aufbewahrung und Nutzung der Daten beim Anbieter prüfen und dokumentieren. Der Sitz eines Anbieters allein belegt keine passende Verarbeitungskonfiguration.
- UI: „Dokument wird analysiert“, Fortschritt pro Seite, Abschluss mit Zahl erkannter Tabellen/Abbildungen; „teilweise erkannt“ bei Fehlern. OCR-fertig und suchbereit bleiben getrennte Zustände.
- Quelle und Extraktion nebeneinander ansehen; betroffene Seite erneut analysieren. Ohne nutzbaren Inhalt kein uneingeschränkter Erfolgsstatus.
- Erfolgreiche Seiten bei Teilfehlern behalten, aber einen unvollständigen Index niemals stillschweigend als vollständig ausgeben.

## Qualitätsprüfung vor Freigabe

Pilot mit etwa 30–50 repräsentativen Dokumenten bzw. 300–500 Seiten. Ein separates, nicht zur Promptoptimierung verwendetes Testset vorsehen. Enthalten sein müssen: einfache Texte, schlechte Scans, mehrspaltige Skripte, Folien, Tabellen mit verbundenen Zellen, Tabellenfortsetzungen, raster- und vektorbasierte Diagramme, Ablaufdiagramme, Formeln und bei tatsächlichem Bedarf Handschrift.

Zunächst Gemini auf 30–50 schwierigen Seiten gegen manuell geprüfte Referenzen evaluieren; danach das breitere Testset nutzen. Selektive Verarbeitung gegen vollständige Gemini-Verarbeitung vergleichen, um Routerfehler von Extraktionsfehlern zu trennen. Anbieterwerbung und Selbstauskunft eines Modells ersetzen keine Bewertung. Ein bezahlter Mehranbieterbenchmark ist keine Voraussetzung für den ersten Prototyp. Falls Gemini relevante Qualitäts- oder Kostenziele verfehlt, Mistral als ausdrücklich vorgemerkten Erweiterungskandidaten auf denselben Referenzen vergleichen.

Vorgeschlagene Abnahmekriterien, keine behaupteten Anbieterleistungen:

- Mindestens 98 % der markierten relevanten Tabellen/Diagramme im Testset erkannt; Ergebnisse je Dokumentklasse separat ausweisen.
- Mindestens 99 % exakte Übereinstimmung für lesbare kritische Tabellenwerte inklusive Einheit und richtiger Zeilen-/Spaltenzuordnung; Struktur zusätzlich separat bewerten.
- Mindestens 95 % richtige, überprüfbare Antworten auf vorbereitete Diagrammfragen. Abstention/„nicht lesbar“ getrennt von falschen Antworten messen; keine erfundenen exakten Werte im Abnahmeset.
- Jede veröffentlichte Extraktion hat korrekten Seiten- und Elementbezug; keine verlorenen/verschobenen Seiten.
- Kosten pro 100 Seiten sowie Median und p95 der Verarbeitungszeit messen. Latenzziel erst anhand realer Dokumente festlegen.
- End-to-End prüfen: Wird die richtige Tabelle gefunden, bleibt die Einheit erhalten, stimmt die Antwort und öffnet das Zitat die richtige Quelle?

Die Stichprobengröße begrenzt die Aussagekraft. Erfüllt Gemini die Kriterien nicht, Fehlerklassen prüfen und danach über eine Mistral-Erweiterung entscheiden. Bis dahin betroffene Inhalte als unzuverlässig kennzeichnen statt einen nicht implementierten Fallback vorauszusetzen. Fallen getestete Kandidaten bei einer Dokumentklasse durch, diese Klasse als eingeschränkt unterstützt ausweisen.

## Umsetzung in Paketen

1. **Pilot und Referenzdaten:** gemeinsames Blockformat und lokaler Router für Issue #53, Gemini-Adapter, Qualitäts- und Kostenbericht; selektive Verarbeitung gegen vollständige Analyse vergleichen.
2. **Persistente Extraktion:** Revisionen, Seiten/Elemente/Assets, Gemini-PDF-/Bildanbindung mit eigenem Schema und Ausgabelimit, Job-Checkpoints, Limits und Löschung.
3. **Tabellen und Diagramme:** Normalisierung, Annotationen, Originalausschnitte, Strukturprüfung und gezielte Wiederholung.
4. **Suche und Antworten:** inhaltstypgerechtes Chunking, Quellenbezüge, Nachladen vollständiger Elemente, optionale Bildprüfung im Chat.
5. **Nutzeroberfläche und Rollout:** Fortschritt, Vorschau, Warnungen, Retry; erst neue PDFs, danach kontrollierte Neuverarbeitung vorhandener Quellen. Alte Revision bei fehlgeschlagener Neuverarbeitung beibehalten.
6. **Optimierung nach Messung:** Router verfeinern, gegebenenfalls Ausschnitte statt ganzer Seiten verarbeiten, Caching und höhere Dokumentlimits. Vor Aktivierung nachweisen, dass keine relevante Qualitätsverschlechterung entsteht.
7. **Vorgemerkte spätere Erweiterung:** Mistral-OCR-/Annotationsadapter hinter derselben Schnittstelle; Einführung nur nach Qualitäts-/Kostenvergleich, keine Voraussetzung für Schritte 1–6.

Eine Umsetzungsschätzung sollte nach dem Pilot erfolgen: Das Risiko liegt besonders bei Diagrammqualität, Fortsetzungstabellen und Worker-Laufzeiten, nicht allein beim OCR-API-Aufruf.
