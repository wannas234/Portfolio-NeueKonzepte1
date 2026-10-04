# Lernapp Backend

Supabase-Backend mit Postgres-Migrationen, Row Level Security und Deno Edge Functions.

## Starten

Voraussetzungen: Node aus `.nvmrc`, npm und laufendes Docker.

```bash
nvm use
npm ci
npm run db:start
npm run db:status
```

CLI und Deno kommen aus den npm-Abhängigkeiten. `npm ci` verwendet das Lockfile
und richtet die Git-Hooks ein. Für den lokalen Stack ist keine Env-Datei nötig.
Für App und Login-Beispiele `.env.example` nach `.env.local` kopieren und die
URL sowie den öffentlichen Key aus `db:status` eintragen.

| Dienst               | Adresse                                                   |
| -------------------- | --------------------------------------------------------- |
| API / Auth / Storage | http://127.0.0.1:54321                                    |
| Studio               | http://127.0.0.1:54323                                    |
| Postgres             | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Test-Mails           | http://127.0.0.1:54324                                    |

Lokale Seed-Nutzer: `anna@example.com` und `ben@example.com`, Passwort jeweils
`password123`. Seeds laufen beim frischen Aufbau und beim lokalen Reset.

## Der Workflow

```text
Feature-Branch → PR nach dev → CI → Staging-Deploy → dort prüfen
                            dev → PR nach main → CI → Freigabe → Produktions-Deploy
```

1. Feature-Branch von `dev` erstellen und lokal entwickeln.
2. Schemaänderungen als neue Migration schreiben, lokal anwenden, testen und Typen generieren.
3. PR nach `dev` öffnen. CI prüft Code und eine frisch aufgebaute Datenbank.
4. Nach dem Merge prüft CI den tatsächlichen Commit auf `dev` und deployt nach Staging.
5. Auf Staging insbesondere Login, Datenzugriffe und betroffene Functions prüfen.
6. Release-PR `dev` → `main` mit **Merge-Commit** zusammenführen. Nach erfolgreicher
   CI das Produktions-Deployment im GitHub-Environment freigeben.
7. `main` per PR mit **Merge-Commit** zurück nach `dev` synchronisieren, damit
   `dev` für den nächsten Release den aktuellen Stand von `main` enthält.

Feature-PRs nach `dev` normalerweise squashen. Für Branch-Synchronisation
Merge-Commits verwenden. Das `dev`-Ruleset erlaubt beides.

Prüfung und Deploy stehen zusammen in [ci.yml](.github/workflows/ci.yml).
PRs deployen nichts. Die Deploy-Jobs brauchen beide erfolgreichen Prüfjobs
(`needs`) und den passenden Push-Branch. Laufende Deploys werden nicht durch
neuere Pushes abgebrochen. Überholte Commits werden vor dem Deploy abgewiesen.

Bei vorübergehenden Deploy-Fehlern in GitHub Actions den fehlgeschlagenen Job
nochmals ausführen. Ist inzwischen ein neuer Commit auf dem Branch, dessen
CI-Lauf verwenden. Es gibt keinen manuellen Einstieg, der die CI umgeht.

## Befehle im Alltag

| Befehl                                                          | Wirkung                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run db:start` / `db:stop`                                  | Lokalen Stack starten / stoppen                                                    |
| `npm run db:status`                                             | Lokale URLs und Keys anzeigen                                                      |
| `npm run db:new -- lernkarten_tabelle`                          | Leere Migration erzeugen                                                           |
| `npm run db:diff -- lernkarten_tabelle`                         | Studio-Schemaänderungen als Migration erfassen                                     |
| `npm run db:apply`                                              | Neue Migrationen lokal anwenden, Daten behalten                                    |
| `npm run db:reset`                                              | Lokale Daten verwerfen, Migrationen und Seeds neu einspielen                       |
| `npm run db:workers`                                            | Lokale Worker-Cronjobs in Vault konfigurieren (läuft nach start/reset automatisch) |
| `npm run db:lint`                                               | Postgres-Funktionen prüfen; Warnungen und Fehler führen zum Abbruch                |
| `npm run test:db`                                               | pgTAP-Tests ausführen                                                              |
| `npm run gen:types`                                             | Typen aus der lokalen Datenbank generieren                                         |
| `npm run functions:serve`                                       | Edge Functions lokal ausführen                                                     |
| `npm run functions:lint` / `functions:check` / `functions:test` | Deno-Code prüfen                                                                   |
| `npm run test:tools`                                            | Zielauswahl und Auth-Konfigurationswerkzeug prüfen                                 |
| `npm run format` / `format:check`                               | Formatieren / Formatierung prüfen                                                  |

Lokale Befehle akzeptieren keine frei durchgereichten CLI-Optionen. Dadurch
können `--linked`, `--db-url` oder `--project-ref` ihr Ziel nicht ändern.

## Nutzungslimits (Gratis / Pro)

Alle Kontingente stehen in [supabase/usage-limits.mjs](supabase/usage-limits.mjs):
KI-Chatnachrichten, direkte Suchen, Zusammenfassungen, Karteikarten-Generierungen,
Materialanalysen und Uploads pro Kalendermonat sowie der Gesamtspeicher, jeweils für
`free` und `pro` (Abo-Status `active`/`trialing`, bei `past_due` noch 7 Tage Schonfrist).

- Deploys spielen die Datei automatisch in `public.plan_limits` ein. Lokal passiert das bei
  `db:start`/`db:reset` oder sofort mit `npm run db:workers`.
- Durchgesetzt wird in der Datenbank (`consume_usage` und Trigger auf neuen Jobs bzw.
  Dateien), nicht im Frontend. Überschreitungen liefern `QUOTA_EXCEEDED` (429) bzw.
  `STORAGE_QUOTA_EXCEEDED` (413).
- Jede kostenpflichtige Aktion landet dauerhaft in `public.usage_events`, auch wenn der
  zugehörige Chat, Job oder die Datei später gelöscht wird.
- Das Frontend liest den eigenen Stand über die RPC `get_my_usage()` (Tarif, Verbrauch,
  Grenzen, Reset-Datum, Ende der Schonfrist). Sie bestimmt den Nutzer allein aus dem JWT.

### Zahlungsfehler und Kündigung

- `past_due`: Pro bleibt ab dem ersten Zahlungsfehler 7 Tage aktiv
  (`subscriptions.past_due_since`, gesetzt per Trigger; Frist in `public.grace_until`).
  Danach gilt das Gratis-Kontingent.
- `unpaid`, `paused`, `incomplete`, `canceled`: Gratis-Kontingent. Kündigung zum
  Periodenende bleibt bis dahin `active`.
- Daten bleiben bei jeder Rückstufung erhalten. Wer über dem Gratis-Speicher liegt, kann
  vorhandene Dateien weiter nutzen, aber nichts Neues hochladen.
- Stripe-Dashboard (Billing → Revenue recovery): Smart Retries über etwa 7 Tage, danach
  „Abo kündigen“; E-Mails zu fehlgeschlagenen Zahlungen aktivieren. Das ist Konfiguration
  in Stripe, nicht in diesem Repository.

## Gezielte Remote-Aufgaben

| Befehl                                         | Wirkung                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `npm run db:status:dev` / `db:status:prod`     | Remote-Migrationsstand anzeigen                                   |
| `npm run config:plan:dev` / `config:plan:prod` | Auth-Änderungen gegenüber Remote anzeigen                         |
| `npm run config:push:dev` / `config:push:prod` | Vorschau und Bestätigung, dann ausgewählte Auth-Felder übertragen |

**Auth-Konfiguration wird separat und ausdrücklich übertragen.** Normale
Deploys enthalten ausschließlich Migrationen und Functions. Die lokale
`supabase/config.toml` wird nicht nach Remote gepusht. Für Auth gibt es kleine
JSON-Dateien je Umgebung; nicht aufgeführte Felder bleiben unverändert.
Einrichtung und Beispiele: [environments.md](docs/environments.md#auth-konfiguration-gezielt-übertragen).

## Weiterarbeiten

- [SQL-Abfragen: Phasendauer, Zeitstempel und vollständiger Dokumenttext mit Seitenzahlen](supabase/snippets/document_inspection.sql)
- [Entwicklungsaufgaben, Tests und Fehlerbehebung](docs/development.md)
- [Umgebungen, GitHub-Einrichtung und Auth-Konfiguration](docs/environments.md)
- [Login, Frontend-Anbindung, RLS und Rollout](docs/auth.md)
- [Datenmodell, Beziehungen und ERM-Entscheidungen](docs/database.md)
- [Private Dateien, Storage-Policies und Tests](docs/storage.md)
- [Dokument-Chunks, Embeddings und Vektorsuche](docs/rag.md)
- [Fragen zu Lernmaterialien mit Quellenangaben](docs/chat.md)
- [Automatische Dokument- und Kurszusammenfassungen](docs/summaries.md)
- [Kursmetadaten, Vorlesungen und private Seitennotizen](docs/course-structure-and-notes.md)
- [Materialanalyse mit Terminbeschreibungen und Kalenderübernahme](docs/material-analysis.md)
- [Frontend-Benachrichtigungen nach Backend-Merges](docs/notify-frontend.md)

Die Rulesets sind für Einzelentwicklung mit PR-Pflicht und CI-Prüfung, aber
ohne verpflichtende fremde PR-Approvals eingerichtet. Im Team zusätzliche
Reviews einstellen. Die Produktionsfreigabe wird separat am Environment eingerichtet.

PDF-Pipeline: [Durchsatz, Konfiguration, Tests, Live-Benchmark und Rücknahme](docs/document-pipeline-performance.md).

### Lernfortschritt und manuelle Lerninhalte

RPC-Verträge für manuelle Zusammenfassungen und Decks, Kartenreviews, Entwürfe sowie
Quizrevisionen und Versuche: [Lernworkflow](docs/learning-workflow.md).

Dokumentbasierte KI-Quizgenerierung: [Vertrag, Limits und Betrieb](docs/quiz-generation.md).
