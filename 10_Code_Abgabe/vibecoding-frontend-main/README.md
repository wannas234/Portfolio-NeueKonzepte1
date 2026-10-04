# Lernapp Frontend

Next.js-Frontend für einen verbundenen Studienraum aus Kursen, Lernmaterial,
Zusammenfassungen, Karteikarten und Prüfungsvorbereitung.

## Lokale Einrichtung

Voraussetzung ist Node.js 22 oder neuer.

```bash
npm ci
```

`.env.example` nach `.env.local` kopieren und die öffentlichen Werte des
ausgewählten Supabase-Projekts eintragen:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=<project-url>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
AUTH_SITE_URL=http://127.0.0.1:3000
```

`AUTH_SITE_URL` ist eine serverseitige Basisadresse für Auth-Redirects und
Origin-Prüfungen. Keine Service-Role-Keys, Secret-Keys, Datenbankpasswörter oder
Management-Tokens in dieses Repository eintragen.

```bash
npm run dev
```

Die Anwendung ist anschließend unter `http://127.0.0.1:3000` erreichbar.

## Backend-Vertrag

Das Frontend ist gegen den Backend-Stand `dev` synchronisiert, bis der
Release-Merge `dev` → `main` erfolgt ist (Regeln in `AGENTS.md`). Der genaue
Commit steht im Kopf der Typkopie unter
`lib/supabase/database.types.ts`; zur Laufzeit und in CI besteht keine
Abhängigkeit auf einen benachbarten Backend-Checkout.

Aktiv angebunden sind:

- Registrierung, E-Mail-Bestätigung, Login, Cookie-Session und Logout
- Passwort-Reset
- eigenes Profil
- Kurse
- Dateimetadaten
- eigene Zusammenfassungen
- eigene Karteikarten
- eigene Kalendertermine (inklusive optionalem Ende, Ganztägig-Option und Detailkarte per Klick)
- eigene Prüfungsleistungen und Noten in ECTS (inklusive ECTS-gewichtetem Zwischenstand und Zielnotenrechner)

Dashboard, die globale Unterlagenansicht und der KI-Assistent enthalten
weiterhin deutlich gekennzeichnete Vorschau- beziehungsweise Beispieldaten.

Das Backend besitzt noch keinen freigegebenen Storage-Bucket samt Policies für
Dateiinhalte. Deshalb ist der Upload im Frontend deaktiviert; es wird keine
lokale Browserablage als Ersatz für Produktionspersistenz verwendet.

## Qualitätsprüfungen

```bash
npm test
npm run lint
npm run build
```

Die GitHub-Actions-Pipeline führt diese Prüfungen für Pull Requests und Pushes
nach `main` aus.

Weitere Auth- und Umgebungsdetails stehen in
[`docs/authentication.md`](docs/authentication.md). Dauerhafte Repository-Regeln
stehen in [`AGENTS.md`](AGENTS.md); der aktuelle technische Snapshot in
[`CURRENT_STATE.md`](CURRENT_STATE.md).
