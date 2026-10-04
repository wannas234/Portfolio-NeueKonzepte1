# Lastenheft UniVerse

## 1. Einleitung

Dieses Lastenheft beschreibt die Anforderungen an die Lernplattform UniVerse. Es legt fest, was das System aus Sicht der Nutzenden und des Teams leisten muss, und dient als gemeinsame Grundlage für Umsetzung, Tests und Abnahme. Bewusst beschreibt es das Was und nicht das Wie. Die technische Umsetzung ist in den Repositories und der Code-Dokumentation beschrieben.

UniVerse entsteht im Rahmen der Lehrveranstaltung Neue Konzepte an der DHBW Mannheim als reales App-Entwicklungsprojekt mit KI-gestützter Entwicklung. Das Dokument richtet sich an das Projektteam, an die betreuende Lehrperson und an alle, die den Funktionsumfang nachvollziehen oder prüfen möchten.

## 2. Ausgangssituation und Problemstellung

Studierende arbeiten heute mit vielen getrennten Werkzeugen. Die Folien liegen an einer Stelle, die eigenen Notizen an einer anderen, die Termine im Kalender und die Prüfungsvorbereitung noch einmal woanders. Allgemeine KI-Werkzeuge wie ein freier Chatbot helfen dabei nur begrenzt, weil sie nicht wissen, was in einem konkreten Kurs behandelt wurde. Sie geben oft Antworten, die plausibel klingen, aber nicht zum Stoff der eigenen Vorlesung passen.

Daraus ergeben sich drei Kernprobleme:

- Das Lernmaterial ist verstreut und schlecht durchsuchbar.
- Antworten einer KI haben keinen verlässlichen Bezug zum eigenen Kursmaterial und sind nicht belegbar.
- Die Prüfungsvorbereitung ist aufwendig, weil Zusammenfassungen und Karteikarten mühsam von Hand entstehen.

Besonders betroffen sind Lernende, die viel Stoff in kurzer Zeit bewältigen müssen oder die klare Struktur brauchen. Genau an dieser Stelle setzt UniVerse an.

## 3. Zielsetzung

UniVerse verbindet Studienorganisation und kursbezogenes Lernen in einem durchgehenden Ablauf. Der rote Faden führt vom Kurs über das Dokument bis zu Zusammenfassung, Karteikarten, Quiz und Prüfungsvorbereitung.

Daraus leiten sich die folgenden übergeordneten Ziele ab:

- Ein KI-Assistent, der ausschließlich aus dem hochgeladenen Kursmaterial antwortet und seine Quellen bis auf Folie und Seite angibt.
- Automatische Erzeugung von Zusammenfassungen, Karteikarten und Quizfragen aus eigenem Material.
- Eine zentrale und ruhige Oberfläche für Kurse, Dokumente, Termine und Noten.
- Ein tragfähiges Geschäftsmodell über ein Abo mit klaren und fairen Nutzungsgrenzen.

Das Produkt soll ausdrücklich kein beliebiger PDF-Chatbot und keine lose Sammlung einzelner KI-Funktionen werden. Der eigentliche Mehrwert liegt im verbundenen Ablauf, bei dem die einzelnen Bausteine aufeinander aufbauen.

## 4. Zielgruppe

Die primäre Zielgruppe sind Studierende an Hochschulen und Universitäten. Ergänzend adressiert UniVerse Lernende in der Abiturvorbereitung. Die Anforderungen orientieren sich an drei ausgearbeiteten Personas, die unterschiedliche Bedürfnisse abbilden:

- **Amelie**, Masterstudentin, braucht kursbezogene und zitierfähige Antworten für ihre Seminararbeiten.
- **Tim**, Schüler in der Abiturvorbereitung, braucht schnellen und sichtbaren Mehrwert mit möglichst wenig Aufwand.
- **Nora**, Studentin mit ADHS und Legasthenie, braucht Struktur, kleine Lerneinheiten und eine reizarme Oberfläche.

Die Personas sind nicht nur Beschreibung, sondern Prüfstein. Jede größere Funktion wird daran gemessen, ob sie mindestens einer dieser Personas spürbar hilft.

## 5. Systemüberblick

UniVerse besteht aus einem Web-Frontend und einem Backend mit Datenbank und serverseitiger Logik. Das Frontend ist die Oberfläche im Browser. Das Backend speichert die Daten, setzt die Zugriffsregeln durch und stellt die KI-Funktionen bereit. Die Antworten des Assistenten entstehen über eine Suche im hochgeladenen Material und nicht aus allgemeinem Wissen. Die Verbindung zwischen beiden Teilen ist klar definiert, und das Frontend erhält niemals Zugriff an den Sicherheitsregeln vorbei.

## 6. Funktionale Anforderungen

Die Anforderungen sind nummeriert und mit einer Priorität versehen. Muss bedeutet zwingend, Soll bedeutet wichtig, Kann bedeutet optional.

### 6.1 Benutzerkonten und Anmeldung

| ID | Priorität | Anforderung |
| --- | --- | --- |
| /LF-01/ | Muss | Nutzende können sich mit E-Mail und Passwort registrieren. |
| /LF-02/ | Muss | Die Registrierung erfordert eine Bestätigung der E-Mail-Adresse. |
| /LF-03/ | Muss | Nutzende können sich anmelden und abmelden, die Sitzung bleibt sicher bestehen. |
| /LF-04/ | Muss | Nutzende können ihr Passwort zurücksetzen. |
| /LF-05/ | Muss | Nutzende können ihr eigenes Profil einsehen und den Namen ändern. |
| /LF-06/ | Soll | Nutzende können ihre Daten exportieren und ihr Konto vollständig löschen. |

### 6.2 Kurse und Material

| ID | Priorität | Anforderung |
| --- | --- | --- |
| /LF-10/ | Muss | Nutzende können Kurse anlegen und verwalten. |
| /LF-11/ | Muss | Nutzende können Dokumente zu einem Kurs hochladen. |
| /LF-12/ | Muss | Hochgeladene Dokumente werden im Hintergrund verarbeitet und für die Suche aufbereitet. |
| /LF-13/ | Soll | Nutzende sehen den Verarbeitungsstatus und können eine fehlgeschlagene Verarbeitung erneut anstoßen. |
| /LF-14/ | Kann | Das System erkennt auch Inhalte aus Bildern, Tabellen und gescannten Seiten. |

### 6.3 KI-Assistent

| ID | Priorität | Anforderung |
| --- | --- | --- |
| /LF-20/ | Muss | Der Assistent beantwortet Fragen ausschließlich auf Basis des Materials des gewählten Kurses. |
| /LF-21/ | Muss | Jede Antwort enthält eine Quellenangabe bis auf die Ebene von Folie und Seite. |
| /LF-22/ | Muss | Der Assistent ist immer auf genau einen Kurs begrenzt. |
| /LF-23/ | Soll | Nutzende können eine Antwort bewerten, damit die Qualität nachvollziehbar bleibt. |
| /LF-24/ | Soll | Frühere Unterhaltungen bleiben erhalten und sind wieder aufrufbar. |
| /LF-25/ | Soll | Bei Folgefragen bezieht der Assistent den bisherigen Verlauf sinnvoll mit ein. |

### 6.4 Lernhilfen

| ID | Priorität | Anforderung |
| --- | --- | --- |
| /LF-30/ | Muss | Das System erzeugt auf Wunsch Zusammenfassungen aus dem Material. |
| /LF-31/ | Muss | Das System erzeugt auf Wunsch Karteikarten aus dem Material. |
| /LF-32/ | Soll | Das System erzeugt Quizfragen zum Selbsttest aus dem Material. |
| /LF-33/ | Soll | Karteikarten unterstützen wiederholtes Lernen mit wachsenden Abständen. |
| /LF-34/ | Soll | Lange Inhalte werden in kleine, gut verarbeitbare Abschnitte zerlegt. |
| /LF-35/ | Kann | Nutzende können Entwürfe zwischenspeichern, auch über mehrere Tabs hinweg. |

### 6.5 Organisation

| ID | Priorität | Anforderung |
| --- | --- | --- |
| /LF-40/ | Muss | Nutzende können Termine in einem Kalender anlegen und einem Kurs zuordnen. |
| /LF-41/ | Muss | Nutzende können Prüfungsleistungen und Noten erfassen. |
| /LF-42/ | Soll | Das System berechnet einen ECTS-gewichteten Notenstand und bietet einen Zielnotenrechner. |
| /LF-43/ | Soll | Ein Dashboard gibt einen Überblick über Kurse, Termine und offene Aufgaben. |

### 6.6 Abo und Bezahlung

| ID | Priorität | Anforderung |
| --- | --- | --- |
| /LF-50/ | Muss | Nutzende können ein kostenpflichtiges Abo abschließen und verwalten. |
| /LF-51/ | Muss | Die Bezahlung läuft über einen etablierten Zahlungsdienstleister. |
| /LF-52/ | Muss | Das System begrenzt die Nutzung der KI-Funktionen über Nutzungskontingente. |
| /LF-53/ | Soll | Nutzende sehen ihren aktuellen Verbrauch im Verhältnis zum Kontingent. |

## 7. Nicht-funktionale Anforderungen

### 7.1 Sicherheit und Datenschutz

| ID | Priorität | Anforderung |
| --- | --- | --- |
| /NF-01/ | Muss | Die Zugriffskontrolle erfolgt in der Datenbank. Nutzende sehen und ändern nur eigene Daten. |
| /NF-02/ | Muss | Es gelangen keine geheimen Schlüssel in das Repository. |
| /NF-03/ | Muss | Das System setzt gängige Sicherheits-Header und schützt Sitzungen serverseitig. |
| /NF-04/ | Muss | Nutzende können ihre Daten exportieren und vollständig löschen lassen. |

### 7.2 Benutzbarkeit und Barrierefreiheit

| ID | Priorität | Anforderung |
| --- | --- | --- |
| /NF-10/ | Muss | Die Oberfläche ist klar strukturiert und auf das Wesentliche reduziert. |
| /NF-11/ | Soll | Inhalte werden in kleinen Einheiten dargestellt, damit sie leichter zu verarbeiten sind. |
| /NF-12/ | Kann | Die Oberfläche bietet Einstellungen für Kontrast und Schriftgröße. |

### 7.3 Leistung und Betrieb

| ID | Priorität | Anforderung |
| --- | --- | --- |
| /NF-20/ | Soll | Die Verarbeitung von Dokumenten läuft im Hintergrund und blockiert die Oberfläche nicht. |
| /NF-21/ | Soll | Das System ist in getrennten Umgebungen für Test und Produktion betreibbar. |
| /NF-22/ | Soll | Teure externe Aufrufe erfolgen erst, wenn Kurszugehörigkeit und Eingaben geprüft wurden. |

### 7.4 Wartbarkeit und Testbarkeit

| ID | Priorität | Anforderung |
| --- | --- | --- |
| /NF-30/ | Muss | Der Code ist testbar, zentrale Abläufe sind durch automatische Tests abgedeckt. |
| /NF-31/ | Muss | Jede Änderung wird vor der Übernahme automatisch auf Stil, Tests und Build geprüft. |
| /NF-32/ | Soll | Wichtige Teile des Systems sind in eigenen Dokumenten beschrieben. |
| /NF-33/ | Soll | Wiederholte Schreibvorgänge erzeugen bei einem erneuten Versuch keine doppelten Daten. |

## 8. Technische Rahmenbedingungen

- Das Frontend wird mit Next.js, React und TypeScript umgesetzt.
- Das Backend basiert auf Supabase mit einer Postgres-Datenbank, Migrationen und serverseitigen Funktionen.
- Die Antworten des Assistenten entstehen über eine kombinierte Suche aus Vektorsuche und Volltextsuche im hochgeladenen Material.
- Dokumente werden in Abschnitte zerlegt, mit Embeddings versehen und über pgvector durchsuchbar gemacht.
- Die Zusammenarbeit läuft über getrennte Zweige mit Pull Requests und automatischer Prüfung.
- Die Entwicklung erfolgt KI-gestützt mit Claude Code und ergänzend mit ChatGPT.

## 9. Abgrenzung

Nicht Bestandteil dieses Projekts sind:

- Eine native mobile App. UniVerse ist zunächst web-first.
- Ein vollständiger Ersatz für ein Lernmanagementsystem der Hochschule.
- Ein allgemeiner Chatbot ohne Bezug zum eigenen Kursmaterial.
- Eine automatische Übernahme von Daten aus fremden Systemen.
- Ein Prüfungsmodus mit geheimen Lösungen. Die Quizfunktion ist ein Selbsttest zum Lernen.

## 10. Lieferumfang und Abnahmekriterien

Das Projekt gilt als erfolgreich abgenommen, wenn die folgenden Punkte erfüllt sind:

- Eine lauffähige Anwendung mit den als Muss gekennzeichneten Funktionen.
- Eine einfache und dokumentierte Möglichkeit, das Projekt lokal zu starten.
- Grüne automatische Prüfungen für Tests, Stil und Build.
- Eine Demo, die den durchgehenden Ablauf aus Kurs, Material, Zusammenfassung, Karteikarten und kursbezogenem Assistenten zeigt.
- Die dazugehörige Dokumentation im Portfolio.

## 11. Meilensteine

Die Umsetzung folgt dem Fahrplan der Lehrveranstaltung:

- Problematisierung und App-Idee
- Market Sizing, Geschäftsmodell und dieses Lastenheft
- Persona und erster lauffähiger Stand
- Stakeholder, Risiken und Anbindung des Backends
- Nahezu fertige App und Reflexion
- Abschlusspräsentation mit Demo und Pitch
