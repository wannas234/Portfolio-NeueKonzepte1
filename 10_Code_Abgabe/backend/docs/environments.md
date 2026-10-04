# Umgebungen und Einrichtung

|                 | Lokal                             | Staging                                       | Produktion                                   |
| --------------- | --------------------------------- | --------------------------------------------- | -------------------------------------------- |
| Supabase        | Docker, `lernapp`                 | `learnapp-dev`                                | `learnapp-production`                        |
| Stand           | Arbeitsverzeichnis                | Branch `dev`                                  | Branch `main`                                |
| Anwendung       | `db:apply` / `db:reset`           | Nach grüner CI automatisch                    | Nach grüner CI und Freigabe                  |
| Daten           | Lokale Seeds                      | Repräsentative Testdaten                      | Echte Daten                                  |
| Env-Datei       | `.env.local` für App/Beispiele    | `.env.development` für Remote-Werkzeuge       | `.env.production` für Remote-Werkzeuge       |
| Auth-Push-Datei | `supabase/config.toml` gilt lokal | `supabase/environments/development.auth.json` | `supabase/environments/production.auth.json` |

## Supabase-Projekte

Zwei getrennte Projekte anlegen. Ihre Datenbankversion muss zur `major_version`
in `supabase/config.toml` passen (aktuell 17). Mit `SHOW server_version;` im
jeweiligen SQL-Editor prüfen.

Deploys laufen über GitHub Actions; keine zusätzliche Supabase-GitHub-Integration
einrichten, die dieselben Projekte ebenfalls deployt. Remote-Schemaänderungen
gehen über Migrationen. Staging-Testdaten dürfen im Studio gepflegt werden.
Die Pipeline führt `seed.sql` weder auf Staging noch in Produktion aus.

## GitHub einmalig einrichten

1. Branches `main` und `dev` anlegen, `main` als Default-Branch verwenden.
2. Settings → Environments: `development` und `production` anlegen. Jeweils
   die Projekt-Ref als Variable `SUPABASE_PROJECT_REF` und DB-Passwort sowie
   Access Token als Secrets `SUPABASE_DB_PASSWORD` und `SUPABASE_ACCESS_TOKEN`
   hinterlegen. Einen für das Projekt berechtigten Token verwenden.
3. Deployment-Branches: `development` erlaubt **nur `dev`**, `production` **nur `main`**.
4. Für `production` Required reviewers einstellen. Bei Einzelentwicklung darf
   „Prevent self-review“ deine eigene Deploy-Freigabe nicht verhindern.
   Verfügbarkeit dieser Schutzfunktionen hängt vom GitHub-Tarif und der
   Repository-Sichtbarkeit ab; eine YAML-Environment-Angabe allein erzwingt kein Approval.
5. Rulesets aus `.github/rulesets/dev.json` und `main.json` importieren beziehungsweise
   bestehende Regeln aktualisieren. Erforderliche Checks heißen unverändert
   `Format & Edge Functions` und `Migrations & pgTAP-Tests`.
6. Im Repository Squash- und Merge-Commits erlauben. Feature-PRs squashen,
   Release- und Synchronisations-PRs mergen. Das Namens-Ruleset für Feature-Branches ist optional.

Die Rulesets verlangen derzeit keine fremden PR-Approvals und funktionieren
für Einzelentwicklung. Im Team die gewünschte Review-Anzahl einstellen.
Bestehende Rulesets aktualisieren, nicht mehrfach mit widersprüchlichen Regeln importieren.

**Umstellung vom bisherigen Workflow:** Es bleibt nur `ci.yml`. `workflow_run`
und manuelle Deploy-Trigger entfallen. `main` aus den erlaubten Deployment-Branches
von `development` entfernen. Credentials pro Environment hinterlegen; alte
gleichnamige Repository-Fallbacks nach der Umstellung entfernen. Alte wartende
Deploy-Läufe einmalig abbrechen, damit der frühere Workflow später nicht mehr deployt.
GitHub-Einstellungen ändern sich durch lokale Dateiänderungen nicht automatisch.

### Deploy bricht bei „Ziel und Commit prüfen“ ab

Steht im Log `SUPABASE_PROJECT_REF:` ohne Wert, fehlt die Projekt-Ref im
`vars`-Kontext. Unter Settings → Environments → ausgewählte Umgebung →
**Environment variables** eine Variable `SUPABASE_PROJECT_REF` mit der Ref
des passenden Supabase-Projekts anlegen. Ein gleichnamiges **Secret** wird
von `${{ vars.SUPABASE_PROJECT_REF }}` nicht gelesen. Lokale `.env`-Dateien
stellen ebenfalls keine Werte für GitHub Actions bereit.

`development` erhält die Ref von `learnapp-dev`, `production` die Ref von
`learnapp-production`. Die Ref ist der Projektteil aus
`https://<project-ref>.supabase.co`, nicht der Anzeigename oder die ganze URL.
Access Token und DB-Passwort bleiben dagegen **Environment secrets**.

Der Job `Deploy development` gehört zum Push auf `dev`; `Deploy production`
zum Push auf `main`. Ein geöffneter Release-PR allein deployt nichts. Deshalb
bei der Fehlersuche Job, Branch und Commit des tatsächlichen Laufs prüfen.
Nach Korrektur der Variable den fehlgeschlagenen Job erneut ausführen, sofern
sein Commit noch aktuell ist. Dieser Fehler tritt vor `db push` auf.

## Lokale Credentials für Remote-Aufgaben

```bash
cp .env.example .env.development
cp .env.example .env.production
```

Nur Dateien anlegen, deren Remote-Werkzeuge du verwendest. Ein normaler
Code-Deploy braucht keine Remote-Credentials auf deinem Rechner.

| Variable                            | Verwendung                                                        |
| ----------------------------------- | ----------------------------------------------------------------- |
| `SUPABASE_PROJECT_REF`              | Eindeutiges Remote-Ziel, 20 Kleinbuchstaben                       |
| `SUPABASE_DB_PASSWORD`              | Remote-Migrationsstand abfragen                                   |
| `SUPABASE_ACCESS_TOKEN`             | Management API für Auth-Konfiguration; außerdem CLI-Zugriff       |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | App-Verbindung; bestimmen nicht das Ziel der Verwaltungswerkzeuge |

Project-Ref: Dashboard → Project Settings. Access Token:
[Supabase Account Tokens](https://supabase.com/dashboard/account/tokens).
Für reine Migrationsabfragen kann die CLI auch einen gespeicherten Login verwenden;
das Auth-Werkzeug benötigt den Token ausdrücklich in der Env-Datei.

URL und Anon-/Publishable-Key sind öffentliche Client-Konfiguration. DB-Passwort,
Access Token und Service-/Secret-Keys sind Geheimnisse. Lokale Keys aus dem
eigenen Stack übernehmen; nicht auf identische Keys über Installationen vertrauen.

## Auth-Konfiguration gezielt übertragen

Der Code-Deploy ändert keine Remote-Auth-Einstellungen. Für bewusste Änderungen
gibt es `config:plan:*` und `config:push:*`.

Die versionierten JSON-Dateien enthalten die Login-Basiskonfiguration mit
E-Mail-Bestätigung, versionierten Mailvorlagen und umgebungsspezifischen URL-Referenzen. Eigene SMTP-Einstellungen werden in beiden Umgebungen nur bei
`AUTH_SMTP_ENABLED=true` aus der Env-Datei übernommen. Details stehen in [auth.md](auth.md).
Nur Felder eintragen, die dieses Repository verwalten soll. Nicht aufgeführte
Felder bleiben unverändert. Ein entferntes Feld wird nicht zurückgesetzt;
zum Zurücksetzen den gewünschten Wert ausdrücklich eintragen.

Beispiel für `supabase/environments/development.auth.json`:

```json
{
  "site_url": "env(AUTH_SITE_URL)",
  "uri_allow_list": "env(AUTH_REDIRECT_URLS)",
  "mailer_autoconfirm": false,
  "password_min_length": 8
}
```

In `.env.development` die tatsächlichen URLs setzen:

```dotenv
AUTH_SITE_URL=https://staging.deine-domain.de

# Optional: weitere Redirects, zusätzlich zu den automatisch erzeugten Routen.
# AUTH_REDIRECT_URLS=http://localhost:3000/**
```

Die Beispieldomain vor dem Push ersetzen. `AUTH_SITE_URL` ist eine Basisadresse
ohne Pfad, Query oder Fragment. Das Werkzeug erzeugt daraus `/auth/callback`,
`/auth/confirm` und `/auth/reset-password`. Ein leeres `AUTH_REDIRECT_URLS` verwendet
ausschließlich diese Standardrouten; zusätzliche Einträge werden ergänzt und dedupliziert.
Ein ausdrücklich literales `uri_allow_list: ""` in einer eigenen JSON-Konfiguration
kann die Allowlist weiterhin leeren. Produktion erhält eigene Env-Werte, verlangt
HTTPS und weist Loopback-URLs sowie Wildcards ab. Der URL-Validator ist für Web-Frontends ausgelegt, nicht für
native App-Deep-Links.

```bash
npm run config:plan:dev
npm run config:push:dev
# Auth-Flows auf Staging testen, geprüfte JSON-Änderung nach main übernehmen.
npm run config:plan:prod
npm run config:push:prod
```

`plan` liest Remote und zeigt nur Änderungen der eingetragenen Felder. `push`
zeigt die Vorschau erneut und verlangt im Terminal den Umgebungsnamen
(`development` oder `production`). Erst danach werden geänderte Felder übertragen.
Bei zwischenzeitlichen Änderungen der verwalteten Remote-Felder bricht der Push
ab; erneut planen und prüfen.

Dieser Push ist eine manuelle Verwaltungsaktion mit deinem Access Token. Er
läuft nicht durch das GitHub-Environment-Approval. Vor einem Produktions-Push
auf `main` wechseln, die geprüften Dateien verwenden und die angezeigte Ref
kontrollieren. Ein normaler Merge löst diesen Push nie aus.

Das Werkzeug verwendet ausschließlich
[`PATCH /v1/projects/{ref}/config/auth`](https://supabase.com/docs/reference/api/v1-update-auth-service-config).
Es pusht keine gesamte TOML-Datei und keine Datenbank-/Storage-Konfiguration.
Unveränderte Felder werden nicht übertragen. API-Fehler führen zum Abbruch;
Secret-Werte werden nicht protokolliert. Maskierte Remote-Secrets können in der
Vorschau immer als geändert erscheinen.

### Unterstützte Einstellungen

- Site-URL / Redirects: `site_url`, `uri_allow_list`.
- Registrierung: `disable_signup`, `external_email_enabled`, `external_anonymous_users_enabled`.
- E-Mail: `mailer_autoconfirm` (**false verlangt Bestätigung**), `mailer_secure_email_change_enabled`.
- Passwörter / Sessions: `password_min_length`, `password_required_characters`,
  `security_update_password_require_reauthentication`, `jwt_exp`.
- Google und GitHub: jeweils `external_<provider>_enabled`,
  `external_<provider>_client_id`, `external_<provider>_secret`.
- SMTP: `smtp_host`, `smtp_port` (String), `smtp_user`, `smtp_pass`,
  `smtp_admin_email`, `smtp_sender_name`.

Feldnamen entsprechen der Management API, nicht TOML. Mailvorlagen: je Vorlage
`mailer_subjects_<name>` und `mailer_templates_<name>_content` für `confirmation`,
`recovery`, `email_change`, `password_changed_notification` und
`email_changed_notification`; die beiden Benachrichtigungen zusätzlich
`mailer_notifications_password_changed_enabled` und
`mailer_notifications_email_changed_enabled`.
Die Referenz `template(<name>)` liest ausschließlich die passende HTML-Datei unter
`supabase/templates/`; unbekannte Namen werden abgewiesen. Übersicht: [auth.md](auth.md).
Weitere Auth-Felder nach Prüfung der API im Werkzeug ergänzen oder im Dashboard einstellen. Nicht
unterstützte Felder werden abgewiesen.

Secrets ausschließlich über Referenzen eintragen, zum Beispiel:

```json
{
  "external_google_enabled": true,
  "external_google_client_id": "env(AUTH_GOOGLE_CLIENT_ID)",
  "external_google_secret": "env(AUTH_GOOGLE_SECRET)"
}
```

Die echten Werte gehören in die passende gitignored Env-Datei. `env(...)` wird
aus dieser Datei aufgelöst; kein Shell-Code wird ausgeführt. Vorhandene
Provider-Secrets nicht durch leere Platzhalter ersetzen.

## Sonstige Remote-Einstellungen

Eigene Edge-Function-Secrets pro Projekt im Dashboard verwalten; lokal in
`supabase/functions/.env`. Eingebaute URL und API-Keys stellt die Plattform bereit.
Storage, Auth-Felder außerhalb des unterstützten Umfangs und sonstige
Projektoptionen ausdrücklich pro Umgebung pflegen.

Administrative CLI-Eingriffe außerhalb der angebotenen Befehle brauchen ein
explizites Ziel per `--project-ref` beziehungsweise `--db-url`. Es gibt keinen
allgemeinen `supabase:prod`-Wrapper mehr, der beliebige Befehle als abgesichert ausgibt.

### Eigenes SMTP per Flag aktivieren

`AUTH_SMTP_ENABLED=false` ist der Standard für Development und Produktion. Damit
werden keine SMTP-Zugangsdaten benötigt oder übertragen; gesetzte Werte alleine
aktivieren SMTP nicht. Zum Aktivieren `AUTH_SMTP_ENABLED=true` setzen: Dann verlangt
das Werkzeug alle sechs SMTP-Variablen und überträgt sie beim nächsten Auth-Push.
Das Flag selbst ist nur eine Werkzeug-Einstellung und kein Management-API-Feld.
`AUTH_SMTP_PORT` ist ein String, beispielsweise `587`.

Bei deaktiviertem Flag bleibt die Remote-Mailkonfiguration unverändert. Bestehendes
Custom SMTP wird dadurch nicht zurückgesetzt. Ohne eigenen SMTP-Anbieter nutzt das
Projekt weiterhin Supabases eingebauten Testversand; E-Mail-Bestätigung bleibt aktiv.
Verifizierte Absenderdomain verwenden und Link-Tracking beim Anbieter abschalten.

### Abgestimmter Auth-Rollout

Zuerst das aktuelle Backend-Schema und die Frontend-Routen bereitstellen, danach
Mailvorlagen und URLs per Auth-Push übertragen. Alte E-Mails behalten ihre alten
Links; nach einer Korrektur neue Mails anfordern. Die vollständige Reihenfolge und
Abnahme stehen in [auth.md](auth.md).
