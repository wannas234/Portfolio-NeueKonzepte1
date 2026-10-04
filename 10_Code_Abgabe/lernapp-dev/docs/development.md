# Entwickeln in diesem Repo

Der Ablauf lokal → Staging → Produktion steht in der [README](../README.md#der-workflow).
Diese Seite erklärt die Entwicklungsaufgaben.
Die Login-Anbindung und deren Rollout stehen in [auth.md](auth.md).

## Editor und Arbeitsplätze

Empfohlene VS-Code-Extensions: Deno, Prettier und Postgres Tools. Deno ist auf
`supabase/functions` begrenzt. Prettier formatiert beim Speichern; SQL ist
bewusst ausgenommen. `db:lint` prüft Postgres-Funktionen mit `plpgsql_check`,
nicht die SQL-Formatierung oder automatisch die Vollständigkeit von RLS-Policies.

| Werkzeug           | Verwendung                                                  |
| ------------------ | ----------------------------------------------------------- |
| VS Code / Terminal | Migrationen, Functions, Tests und Typengenerierung          |
| Lokales Studio     | Schema und Testdaten ansehen, Schemaänderungen ausprobieren |
| GitHub             | PRs, CI-Ergebnisse und Produktionsfreigabe                  |
| Remote-Dashboard   | Remote-Zustand prüfen und Staging-Testdaten pflegen         |

Browseränderungen müssen dieselben CI-Prüfungen bestehen. Der GitHub-Webeditor
führt die lokalen Hooks nicht aus. Für Schemaänderungen brauchst du eine
Umgebung mit Docker, um Migrationen und Typen zu prüfen.

## Schema ändern

```bash
git switch dev
git pull
git switch -c feat/lernkarten-tabelle
npm run db:start
npm run db:new -- lernkarten_tabelle
```

Migration ausfüllen. Neue API-Tabellen brauchen RLS und passende Policies.
Ob eine Tabelle über die API erreichbar ist, hängt zusätzlich von Schemas und
GRANTs ab. Die initiale Migration zeigt das Grundmuster.

Alternativ im **lokalen** Studio das Schema ändern und danach:

```bash
npm run db:diff -- lernkarten_tabelle
```

Die Migration gegenlesen: Ein Diff kann vergessene Experimente enthalten. Er
erfasst Schema, keine Testdaten. Seed-Daten gehören in `seed.sql`, Auth-Einstellungen
sind Konfiguration. Auch die Einrichtung von Storage-Buckets muss ausdrücklich
erfasst werden; sie folgt nicht automatisch aus einem Schema-Diff.

Neue handgeschriebene Migrationen ohne Datenverlust anwenden:

```bash
npm run db:apply
npm run db:lint
npm run test:db
npm run gen:types
```

Vor einem Schema-PR zusätzlich einen Neuaufbau prüfen:

```bash
npm run db:reset
npm run test:db
npm run gen:types
```

**Reset löscht lokale Daten.** Reproduzierbare Testdaten deshalb in `seed.sql`
pflegen. Ein erfolgreicher Neuaufbau beweist, dass Migrationen mit den Seeds
funktionieren. Produktion bekommt nur neue Migrationen auf vorhandene Daten:
Constraints können an alten Daten scheitern, Änderungen Sperren erzeugen oder
bestehende Clients brechen. Auf Staging mit repräsentativen Testdaten prüfen;
inkompatible Änderungen auf mehrere Releases verteilen.

Bereits gemergte Migrationen nicht ändern. Korrekturen bekommen eine neue Datei.
Liegt eine noch ungemergte Migration zeitlich vor einer bereits auf Staging
angewendeten, vor dem Merge einen neuen Zeitstempel vergeben und lokal neu
aufbauen. Ein grüner Neuaufbau allein prüft diese Remote-Migrationsreihenfolge nicht.

## Datenbanktests

`supabase/tests/database/` enthält pgTAP-Tests. Jede Datei kapselt Änderungen in
`begin` / `rollback`; neue Tests müssen dieses Muster beibehalten.

Struktur, RLS-Aktivierung und echte Zugriffe als `anon` und `authenticated`
testen: erlaubte eigene Zugriffe und verbotene fremde Schreibzugriffe. Eine
Liste vorhandener Policies allein beweist ihr Verhalten nicht.

Die Profiltests prüfen auch, dass ungültige optionale Registrierungsdaten einen
gültigen Standardnamen ergeben. Direkte spätere Profiländerungen bleiben an den
Tabellen-Constraint gebunden. `plan(n)` bei neuen Assertions anpassen.

`npm run test:auth` prüft zusätzlich die Registrierung über die lokale Auth-API:
Ein gültiger, fehlender oder ungültiger Anzeigename führt jeweils zu genau einem
Profil mit passender Auth-ID und Zeitstempeln. Das Profil entsteht bereits beim
Anlegen des Auth-Nutzers, vor der E-Mail-Bestätigung. Registriert wird mit dem
öffentlichen Key; der lokale Service-Key dient ausschließlich zur Profilprüfung
und zum anschließenden Löschen der erzeugten Testkonten. Dabei wird auch die
automatische Profillöschung geprüft. Der Test liest keine Remote-Zugangsdaten.
Für den ebenfalls enthaltenen Login-Test muss die lokale `me`-Function laufen
(`npm run functions:serve`).

Die Storage-Einrichtung und ihre Tests stehen in [storage.md](storage.md).
`npm run test:storage` prüft die lokale Storage-API mit temporären Testkonten,
eigenen und fremden Zugriffen sowie MIME-Type- und Größenlimits.
`npm run test:files` prüft zusätzlich den vollständigen Datei-Ablauf über die
Functions `files` und `files-cleanup`, einschließlich Wiederholungen und Bereinigung.
Der Frontend-Vertrag und der automatische Bereinigungsjob stehen in [storage.md](storage.md).

## Edge Functions

```bash
npm run functions:serve
```

Für einen lokalen Login `.env.local` mit URL und öffentlichem Key aus `db:status`
füllen. In einem zweiten Terminal einen Seed-Nutzer anmelden:

```bash
TOKEN=$(node --env-file=.env.local --input-type=module -e '
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: "anna@example.com", password: "password123" })
  });
  if (!response.ok) throw new Error(`Login fehlgeschlagen: ${response.status}`);
  console.log((await response.json()).access_token);
')
curl -i http://127.0.0.1:54321/functions/v1/me -H "Authorization: Bearer $TOKEN"
```

Browseraufrufe brauchen CORS. `me` beantwortet `OPTIONS` ohne JWT und liefert
CORS-Header bei ihren JSON-Antworten. GET und POST brauchen einen gültigen
Nutzer-JWT; der weitergereichte Authorization-Header lässt RLS greifen.
Alle Origins sind für Bearer-Zugriffe erlaubt, Cookie-Credentials nicht.

```bash
npm run functions:lint
npm run functions:check
npm run functions:test
```

Diese Tests ersetzen keinen vollständigen Login-und-Function-Test gegen den
laufenden Stack. Auf Staging auch den tatsächlichen Frontendaufruf prüfen.
Eigene lokale Function-Secrets stehen in `supabase/functions/.env` (gitignored).
Die Plattform stellt URL und eingebaute API-Keys selbst bereit.

Service-/Secret-Keys sind für ausdrücklich privilegierte Serveraufgaben
zulässig, gehören aber nie ins Frontend. Eine fehlende RLS-Policy ist kein Grund,
einen normalen Nutzerzugriff auf einen Admin-Key umzustellen.

## Commit und Review

Der Pre-Commit-Hook formatiert gestagete Dateien und führt Deno-Lint aus.
Commit-Namen folgen `feat(db): lernkarten ergänzen`; ein Commit-Message-Hook
erzwingt das aktuell nicht. Branch-Präfixe: `feat`, `fix`, `refactor`, `docs`,
`test`, `chore`. Das optionale GitHub-Ruleset kann Branch-Namen beim Push erzwingen.

Im Review prüfen: RLS, Migration auf bestehenden Daten, kompatible Clients,
Tests und aktuelle Typen. Für Einzelentwicklung erlauben die Rulesets PRs ohne
fremdes Approval; CI bleibt verpflichtend.

## Wenn etwas klemmt

- **Docker/Port belegt:** Docker und laufende Container prüfen. Mehrere Checkouts
  teilen mit derselben `project_id` denselben lokalen Stack.
- **Typenprüfung rot:** Migrationen lokal anwenden, `gen:types` ausführen und
  die geänderte Datei committen.
- **SQL-Lint rot:** Den gemeldeten Funktionsfehler beheben; Warnungen führen
  jetzt ebenfalls zu einem fehlgeschlagenen Befehl.
- **Deploy rot:** Projekt-Ref, Credentials, pausiertes Projekt und offene
  Migrationen prüfen. Bei vorübergehenden Fehlern den Job erneut starten,
  bei Codefehlern eine neue Änderung über den PR-Weg liefern.
- **Remote-Schema im Dashboard geändert:** Drift kann unbemerkt bleiben oder
  spätere Migrationen scheitern lassen. Schema und Migrationshistorie prüfen.
  Zum Einfangen bietet die CLI `db pull --project-ref <ref>`; dabei kann sie
  eine Aktualisierung der Remote-Migrationshistorie anbieten. Diesen administrativen
  Schritt bewusst prüfen, die erzeugte Migration lokal testen und per PR übernehmen.

Bei teilweise angewendeten Änderungen zuerst den tatsächlichen Zustand prüfen.
Ein erneuter Deploy setzt Migrationen nicht zurück. Auth-Konfiguration separat
nach [environments.md](environments.md#auth-konfiguration-gezielt-übertragen) verwalten.
