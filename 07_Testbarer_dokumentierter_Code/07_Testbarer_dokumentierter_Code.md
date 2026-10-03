# Testbarer, dokumentierter Code

Diese Doku haben wir bewusst selbst geschrieben, in eigenen Worten und nicht von der KI generiert. Sie soll zeigen, dass wir verstehen, was wir gebaut haben, und sie soll es einfach machen, das Projekt zu starten und zu testen. Der Code selbst liegt in zwei getrennten Repositories, einem für das Frontend und einem für das Backend.

## Überblick über den Aufbau

Die App besteht aus zwei Teilen, die klar getrennt sind.

- **Frontend.** Gebaut mit Next.js, React und TypeScript. Es ist das, was die Nutzerin oder der Nutzer im Browser sieht, also Kurse, Dokumente, Zusammenfassungen, Karteikarten, Kalender, Noten und der KI-Assistent.
- **Backend.** Umgesetzt mit Supabase, also einer Postgres-Datenbank mit Migrationen, Sicherheitsregeln und serverseitigen Funktionen. Hier liegen die Daten und die Logik für die KI-Antworten.

Beide Teile sind über eine klar definierte Schnittstelle verbunden. Das Frontend greift nie direkt auf die Datenbank zu, ohne dass die Sicherheitsregeln greifen.

## Wie das Herzstück funktioniert

Das wichtigste Feature ist der kursbezogene KI-Chat. Damit er nur aus dem echten Kursmaterial antwortet, läuft im Hintergrund folgender Ablauf.

1. Ein Dokument wird hochgeladen und im Backend verarbeitet.
2. Der Text wird in kleine Abschnitte zerlegt, die sogenannten Chunks.
3. Zu jedem Abschnitt wird ein Vektor berechnet, der seine Bedeutung abbildet.
4. Stellt jemand eine Frage, suchen wir die inhaltlich passendsten Abschnitte über eine Vektorsuche.
5. Diese Abschnitte gibt die KI als Grundlage für ihre Antwort zurück, zusammen mit der Quelle zu Folie und Seite.

Dadurch bekommt man eine Antwort, die sich wirklich auf das eigene Kursmaterial bezieht, und nicht eine allgemeine Antwort wie bei einem freien Chatbot.

## So startet man das Projekt

Die Reihenfolge ist wichtig. Zuerst das Backend starten, dann das Frontend verbinden.

### 1. Backend starten

Voraussetzung sind Node in der Version aus der Datei `.nvmrc`, npm und ein laufendes Docker.

```
nvm use
npm ci
npm run db:start
npm run db:status
```

`npm run db:status` zeigt die lokalen Adressen und die öffentlichen Schlüssel an. Diese Werte brauchen wir gleich für das Frontend. Zum Ausprobieren gibt es zwei vorbereitete Nutzer, `anna@example.com` und `ben@example.com`, jeweils mit dem Passwort `password123`.

### 2. Frontend verbinden und starten

Voraussetzung ist Node 22 oder neuer.

```
npm ci
```

Danach die Datei `.env.example` nach `.env.local` kopieren und die öffentlichen Werte aus `db:status` eintragen.

```
NEXT_PUBLIC_SUPABASE_URL=<project-url>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
AUTH_SITE_URL=http://127.0.0.1:3000
```

Dann den Entwicklungsserver starten.

```
npm run dev
```

Die App ist anschließend unter `http://127.0.0.1:3000` erreichbar. Wichtig ist, dass keine geheimen Schlüssel in das Repository gelangen. Im Frontend werden ausschließlich die öffentlichen Werte verwendet.

## So testet man das Projekt

Der Code ist testbar, und die Prüfungen laufen auch automatisch in der CI bei jeder Änderung. Von Hand lassen sie sich so starten.

Im Backend prüfen wir die Datenbank und die serverseitigen Funktionen.

```
npm run test:db
npm run db:lint
```

Im Frontend prüfen wir Tests, Stil und einen vollständigen Build.

```
npm test
npm run lint
npm run build
```

Wenn alle diese Befehle ohne Fehler durchlaufen, ist der Stand in sich stimmig.

## So läuft die Demo

Für die Vorführung starten wir das Backend und das Frontend wie oben beschrieben und melden uns mit einem der vorbereiteten Nutzer an. Dann zeigen wir den durchgehenden Ablauf aus Kurs, Material, Zusammenfassung und Karteikarten sowie den KI-Assistenten, der mit Quellenangabe aus dem Kursmaterial antwortet.

## Hinweis zur Dokumentation

Neben dieser Übersicht haben wir die wichtigsten Teile im Code in eigenen Dokumenten festgehalten, zum Beispiel zur Vektorsuche, zum Datei-Speicher, zur Anmeldung und zum Datenmodell. Diese Dokumente liegen in den Repositories im Ordner `docs`. Sie sind von uns geschrieben und helfen uns, den Code auch später noch zu verstehen und sauber zu erweitern.
