# Login und Supabase Auth

Supabase Auth verwaltet Registrierung, E-Mail-Bestätigung, Login, Passwort-Reset,
JWTs und Session-Erneuerung. Der Datenbank-Trigger erstellt genau ein Profil je
Auth-Nutzer. Das Frontend verwendet Next.js und `@supabase/ssr` mit Cookie-Sessions.
Es gibt keine eigene Passworttabelle und keine zusätzliche Login-Edge-Function.

## Eine Domain pro Umgebung

In `.env.development` beziehungsweise `.env.production` die tatsächlichen Werte
setzen. Beide Dateien sind gitignored. Die Frontend-Domain wird nur hier als
Basisadresse ohne Pfad angegeben:

```dotenv
AUTH_SITE_URL=https://deine-domain.de
SUPABASE_PROJECT_REF=<Ref des passenden Supabase-Projekts>
SUPABASE_ACCESS_TOKEN=<Management-Token>
```

`AUTH_REDIRECT_URLS` ist optional. Das Werkzeug erzeugt aus `AUTH_SITE_URL` automatisch
`/auth/callback`, `/auth/confirm` und `/auth/reset-password`. Zusätzliche
kommagetrennte URLs werden ergänzt. Produktion erlaubt nur HTTPS, keine
Loopback-Adressen und keine Wildcards. Im Frontend dieselbe `AUTH_SITE_URL` als
Server-Env setzen, dazu `NEXT_PUBLIC_SUPABASE_URL` und den öffentlichen
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (alternativ Anon-Key).
Die Server-Env verhindert, dass Redirects hinter einem Proxy auf interne Hosts zeigen.
Frontend und Backend sind getrennte Deployments und lesen ihre jeweiligen Env-Werte.

Eigene SMTP-Konfiguration ist vorübergehend in beiden Umgebungen standardmäßig
deaktiviert. In der jeweiligen Env-Datei steht `AUTH_SMTP_ENABLED=false`. Die
SMTP-Zugangsdaten dürfen leer bleiben oder für später vorbereitet werden.
Zum Aktivieren das Flag auf `true` setzen und alle SMTP-Werte ausfüllen:

```dotenv
AUTH_SMTP_ENABLED=true
AUTH_SMTP_HOST=smtp.dein-anbieter.de
AUTH_SMTP_PORT=587
AUTH_SMTP_USER=<Benutzer>
AUTH_SMTP_PASS=<Passwort>
AUTH_SMTP_ADMIN_EMAIL=login@deine-domain.de
AUTH_SMTP_SENDER_NAME=Lernapp
```

Nur bei `AUTH_SMTP_ENABLED=true` werden alle sechs SMTP-Werte verlangt und
übertragen. Bei `false` oder fehlendem Flag werden keine SMTP-Felder übertragen;
die vorhandene Remote-Mailkonfiguration bleibt erhalten. Ohne bereits konfigurierten
eigenen SMTP-Anbieter verwendet Supabase weiterhin seinen eingebauten Testversand.
Das Flag schaltet keine E-Mail-Bestätigung aus. Bereits remote eingerichtetes Custom
SMTP wird durch `false` nicht abgeschaltet; es wird lediglich nicht mehr verwaltet.
Absenderdomain beim Anbieter verifizieren und Link-Tracking für Auth-Mails ausschalten.
Die Env-Dateien und Admin-/Service-Keys gehören niemals in Git oder Browser-Builds.

```bash
npm run config:plan:dev
npm run config:push:dev
# Nach Staging-Abnahme mit Produktionswerten:
npm run config:plan:prod
npm run config:push:prod
```

Der Plan liest ausschließlich Remote-Einstellungen. Push zeigt den Diff erneut und
verlangt den Umgebungsnamen als Bestätigung. Normale Code-Deploys ändern Auth nicht.
SMTP-Passwörter bleiben in der Ausgabe maskiert. Details: [environments.md](environments.md).

## E-Mail-Links und Callback

Die Vorlagen unter `supabase/templates/` gelten lokal über `config.toml` und remote
über die beiden Auth-JSON-Dateien. `template(<name>)` lädt die jeweilige versionierte
HTML-Datei beim Plan/Push; der Name bestimmt das Auth-Feld
(`mailer_templates_<name>_content`).

| Vorlage                         | Anlass                                 | Empfänger                  |
| ------------------------------- | -------------------------------------- | -------------------------- |
| `confirmation`                  | Registrierung bestätigen               | neue Adresse               |
| `recovery`                      | Passwort zurücksetzen                  | Kontoadresse               |
| `email_change`                  | E-Mail-Änderung bestätigen             | bisherige und neue Adresse |
| `password_changed_notification` | Hinweis: Passwort wurde geändert       | Kontoadresse               |
| `email_changed_notification`    | Hinweis: E-Mail-Adresse wurde geändert | bisherige Adresse          |

Die beiden Benachrichtigungen sind reine Sicherheitsinformationen ohne Token und werden
über `mailer_notifications_<anlass>_enabled` eingeschaltet. Einladungen, Magic Links und
Reauthentifizierung nutzt die App nicht; dafür gibt es bewusst keine Vorlage.

Alle Vorlagen sind eigenständiges HTML mit Inline-Styles, ohne Bilder, Skripte oder
nachgeladene Ressourcen. Jede Bestätigungsmail enthält den Link als Schaltfläche und
zusätzlich als kopierbaren Text. `scripts/auth-config.test.mjs` prüft Links, erlaubte
Variablen und die Zuordnung zu den Auth-Feldern. Die
Links verwenden `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
beziehungsweise `type=recovery` und `type=email_change`. Die Site-URL stammt aus der
gewählten Env-Datei.

E-Mail ändern: Das Frontend ruft `supabase.auth.updateUser({ email })` auf (Helfer
`changeEmail` in `client/account.ts`). Wegen `double_confirm_changes` (remote
`mailer_secure_email_change_enabled`) bekommen alte und neue Adresse je einen Link mit
`type=email_change`; die Änderung wird erst nach beiden Bestätigungen wirksam. Der
Bestätigungsablauf im Frontend muss `email_change` als erlaubten Typ akzeptieren.

Das Frontend zeigt auf `/auth/confirm` zunächst eine Bestätigungsschaltfläche.
Ein GET verbraucht keinen Token. Erst ein POST auf `/auth/confirm/verify` ruft
Supabase `verifyOtp` mit dem erlaubten Typ auf und setzt Session-Cookies.
Origin-Prüfung, `no-store` und `no-referrer` schützen die Bestätigungsroute.
Token werden aus der Browser-URL entfernt und nicht protokolliert. Dieser Ablauf
funktioniert auch auf einem anderen Gerät ohne den ursprünglichen PKCE-Verifier.

`/auth/callback` bleibt für bereits unterstützte PKCE-Links erhalten. Hier wird der
Code genau einmal serverseitig ausgetauscht; im Browser ist automatische
Code-Verarbeitung ausgeschaltet. Solche älteren Links brauchen weiterhin den
ursprünglichen Browser. Abgelaufene oder bereits verwendete Links führen zu einem
verständlichen Fehler und einer Möglichkeit, eine neue Mail anzufordern.

Bei localhost-Weiterleitungen den gesamten Pfad prüfen:

1. Frontend und Supabase-Projekt gehören zur gleichen Umgebung.
2. Remote-Site-URL und Allowlist mit `config:plan:*` prüfen und korrigieren.
3. Die neuen Frontend-Routen müssen bereits deployt sein, bevor Mailvorlagen wechseln.
4. `AUTH_SITE_URL` auch im Frontend setzen; ein interner Proxy-Host ist kein Redirectziel.
5. Nach jeder URL-/Vorlagenkorrektur eine **neue** Mail anfordern. Bereits versandte
   Mails behalten ihre alten Links.

## Profilvertrag und Autorisierung

`profiles` verwendet `id`, `user_id`, `name`, `avatar_url`, `created_at` und `updated_at`.
Registrierung übergibt weiterhin `data: { display_name: ... }`; der Trigger schreibt
es in `profiles.name`. Im Frontend ausschließlich `name` lesen/ändern und die
aktuellen generierten Datenbanktypen übernehmen. Das erfordert die Core-Migration
`20260910180000_core_erm.sql` auf dem ausgewählten Projekt.

| Zugriff                                             | Verhalten                |
| --------------------------------------------------- | ------------------------ |
| Ohne Login                                          | Kein Profilzugriff       |
| Angemeldet                                          | Nur eigenes Profil lesen |
| Eigenes Profil ändern                               | Nur `name`, 1–60 Zeichen |
| Fremdes Profil lesen/ändern                         | Durch RLS gesperrt       |
| Profil anlegen/löschen, IDs oder Zeitstempel ändern | Für Clients gesperrt     |

Die vorhandene `me`-Function validiert den Nutzer mit `getUser()` und verwendet den
Nutzer-JWT für den RLS-geschützten Zugriff. Sie liefert 401 ohne gültige Anmeldung,
404 bei fehlendem Profil und einen allgemeinen 500-Fehler bei Datenbankfehlern.
Antworten sind nicht cachebar. Nutzer-Metadaten sind keine Rollenquelle.

Serverseitige Seitenprüfungen verwenden validierte Claims beziehungsweise `getUser`,
keine ungeprüften User-Objekte aus `getSession`. Der Frontend-Proxy erneuert Cookies;
RLS schützt auch direkte API-Aufrufe. Logout widerruft den lokalen Refresh-Token
und lädt die Login-Seite neu. Bereits ausgestellte Access-Tokens bleiben bis zu
ihrem Ablauf gültig (hier eine Stunde).

## Abnahme und Rollout

1. Backend-Schema über den vorhandenen PR-/CI-Weg nach Staging bringen.
2. Das abgestimmte Frontend mit `name`-Profilabfragen, Cookie-Sessions,
   Bestätigungs- und Passwort-Reset-Routen bereitstellen. Backend-Browserbeispiel
   `client/auth.ts` nicht parallel zum SSR-Client installieren.
3. Env-Werte prüfen, Auth-Plan ansehen und Auth-Konfiguration nach Staging übertragen.
4. Echte Registrierung → E-Mail → Bestätigung → Profil → Reload → Logout prüfen.
   Bestätigung und Reset auch in einem zweiten Browser testen. Danach Login mit
   falschem/richtigem Passwort, unbestätigtem Konto und verbrauchtem Link prüfen.
5. Passwort-Reset bis zur Anmeldung mit dem neuen Passwort abschließen. Fremde
   Profildaten und direkte geschützte URLs dürfen nicht zugänglich sein.
6. Geprüften Backend- und Frontend-Stand abgestimmt nach Produktion bringen, dort
   Auth-Konfiguration übertragen und echten Mailversand erneut abnehmen.

Bei Rücknahme zuerst kompatible Mailvorlagen/URLs wiederherstellen und dann ggf.
das Frontend zurückrollen. Keine destruktive Schema-Rückmigration für einen
Frontend-Rollback verwenden. Die alte `display_name`-Frontendversion passt nicht
zur Core-Migration; deshalb Schema- und Frontend-Releases zusammen planen.

Für öffentliche Registrierung Rate-Limits und CAPTCHA mit dem Mailanbieter und
Frontend abstimmen. Google/OAuth und Kontolöschung sind getrennte Erweiterungen.

## Automatisierte Prüfungen

```bash
npm run test:tools
npm run db:lint
npm run test:db
npm run test:auth
npm run functions:lint
npm run functions:check
npm run functions:test
```

pgTAP prüft Trigger, Rechte und RLS. `test:auth` prüft Login, `me`, fremde Profile,
Refresh und Logout auf dem lokalen Stack und setzt Annas Namen auf `Anna`.
`test:tools` prüft auch Domain-Ableitung, Produktions-URL-Regeln, SMTP und Vorlagen.

Im Frontend gibt es `npm run test:auth:e2e` mit Playwright und echtem lokalem Supabase
samt Mailpit. `BACKEND_DIR` auf diese Backend-Arbeitskopie setzen. Der Runner übergibt
nur öffentliche Keys an Next.js und Playwright; sein lokaler Admin-Key bleibt im
Runner und dient ausschließlich zum Aufräumen des eigenen Testkontos. Tests lesen
nur ihre Mails; weitere lokale Konten bleiben erhalten. Nach Vorlagenänderungen
`db:stop` / `db:start` ausführen (Daten bleiben erhalten).

Browser-Tests ersetzen nicht die echte SMTP-/Domain-Abnahme auf Staging und Produktion.

Quellen: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client),
[E-Mail-Vorlagen](https://supabase.com/docs/guides/auth/auth-email-templates),
[Redirect-URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
