# Frontend über fertige Backend-Features informieren

Das [PR-Template](../.github/PULL_REQUEST_TEMPLATE.md) enthält die Checkbox
`Notify Frontend` und zwei Markdown-Textbereiche. Bei Bedarf die Checkbox
aktivieren und unter `Feature` einen kurzen Titel sowie unter
`Details / Zusätzliche Informationen` mehrzeilige Hinweise eintragen:

```markdown
- [x] Notify Frontend

### Feature

Kartensuche mit Filtern

### Details / Zusätzliche Informationen

- `GET /cards` akzeptiert jetzt den Parameter `subject`.
- Bitte den Filter in die Suchmaske integrieren.
```

Der [Workflow](../.github/workflows/notify-frontend.yml) reagiert ausschließlich
auf geschlossene PRs mit Zielbranch `dev`. Nur nach einem Merge und bei aktivierter
Checkbox erstellt er im Frontend ein Issue mit dem Titel
`Neues Backend-Feature: <Feature>`, PR-Link, GitHub-Autor und Details.
Das Label `backend-notification` legt er bei Bedarf automatisch an.
Die Benachrichtigung bestätigt den Merge; sie wartet nicht auf das Staging-Deployment.

Ohne Haken endet der Lauf erfolgreich ohne API-Aufrufe. Fehlende Felder erhalten
Platzhalter und erzeugen Warnungen in den Actions-Logs. Kommentare des Templates
zählen nicht als Inhalt. Zusätzliche Leerzeichen, `[X]`, CRLF, fett geschriebene
Überschriften und abschließende Doppelpunkte werden toleriert. Überschriftennamen
beibehalten; Feldinhalte stehen darunter. Unterüberschriften in den Details mit
`####` beginnen. Checkboxen und Überschriften in Codeblöcken werden nicht ausgewertet.
Überlange Inhalte werden mit Warnung gekürzt; der vollständige Text bleibt im PR.

## Einrichten

1. Oben im Workflow `FRONTEND_OWNER` und `FRONTEND_REPO` ersetzen. Beispiel:
   Owner `mein-team`, Repository `lernapp-frontend` (ohne URL oder `.git`).
2. Im Frontend-Repository unter **Settings → General → Features** Issues aktivieren.
3. In den persönlichen GitHub-Einstellungen unter **Developer settings → Personal
   access tokens → Fine-grained tokens** ein Token erstellen:
   - **Resource owner:** Eigentümer des Frontend-Repositories.
   - **Repository access:** nur das Frontend-Repository auswählen.
   - **Repository permissions → Issues:** **Read and write**.
   - Der Token-Inhaber braucht ausreichenden Zugriff auf das Frontend. Falls die
     Organisation Token-Freigaben verlangt, diese ebenfalls abschließen.
4. Im **Backend-Repository** unter **Settings → Secrets and variables → Actions →
   New repository secret** das Token als `FRONTEND_REPO_PAT` speichern.
   Ablaufdatum beachten und das Secret bei einer Token-Erneuerung aktualisieren.
5. Die Dateien nach `dev` übernehmen. Damit GitHub das Template bei neuen PRs
   automatisch anbietet, muss es außerdem auf dem Default-Branch vorhanden sein.

Der automatische `GITHUB_TOKEN` bekommt mit `permissions: {}` keine zusätzlichen
Backend-Rechte; für das andere Repository wird das PAT benötigt. Der Workflow
führt keinen Checkout aus und liest PR-Inhalte über `context.payload`, ohne sie
in JavaScript-Quelltext einzusetzen. Verwendet wird `actions/github-script@v8`.
Siehe [github-script](https://github.com/actions/github-script),
[Issue-API](https://docs.github.com/en/rest/issues/issues#create-an-issue) und
[Label-API](https://docs.github.com/en/rest/issues/labels#create-a-label).

Bei `pull_request`-Events aus Forks und bei Dependabot stehen Repository-Secrets
üblicherweise nicht zur Verfügung. Mit aktivierter Checkbox meldet der Workflow
dann einen verständlichen Fehler; ohne Checkbox bleibt er erfolgreich. Dieser
Workflow ist daher für Feature-Branches im Backend-Repository vorgesehen.
Siehe [GitHub-Ereignisse und Fork-Einschränkungen](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).

## Testen

Lokal ohne Token, Netzwerk und echte Issues:

```bash
node --test scripts/notify-frontend.test.mjs
```

Die Tests führen den tatsächlichen Inline-Code mit simulierten GitHub-API-Antworten
aus: aktivierte/deaktivierte Checkbox, Formatabweichungen, fehlende Felder,
mehrzeilige Details, Label-Erstellung, API-Fehler und wiederholte Läufe.
Sie laufen auch mit `npm run test:tools` in der bestehenden CI.

Für einen vollständigen Test auf GitHub:

1. Workflow zunächst auf ein Frontend-Testrepository konfigurieren und das Secret
   mit Zugriff darauf hinterlegen.
2. Einen PR aus einem Branch desselben Backend-Repositories nach `dev` erstellen,
   Checkbox aktivieren, Felder ausfüllen und mergen.
3. Unter **Actions → Notify Frontend** den Lauf prüfen. Im Zielrepository müssen
   Issue, PR-Link, Autor, Details und Label erscheinen.
4. Einen weiteren PR ohne Haken mergen: kein Issue. Einen PR mit Haken und leeren
   Feldern mergen: Issue mit Platzhaltern und Warnungen. Einen PR ohne Merge
   schließen: Job wird übersprungen.
5. Den erfolgreichen Lauf erneut ausführen: kein zweites Issue.

`act` ist optional; für dessen Event-Simulation braucht man ein `pull_request`
Payload mit `action: closed`, `merged: true` und `base.ref: dev` sowie das PAT.
Ein solcher Lauf spricht die echte GitHub-API an und erstellt echte Issues;
deshalb ein Testrepository verwenden. Die lokalen Tests oben brauchen das nicht.
Siehe [act-Nutzung](https://nektosact.com/usage/index.html).

## Fehler und erneute Ausführung

Fehlende Zielkonfiguration, fehlendes/abgelaufenes PAT und API-Fehler lassen den
Lauf bewusst fehlschlagen, damit eine ausgebliebene Benachrichtigung sichtbar ist.
Nach Beheben eines Secret- oder temporären API-Problems den Job erneut starten.
Bei Änderungen am Workflow oder PR-Body einen neuen Test-PR verwenden: Wiederholungen
arbeiten mit dem ursprünglichen Ereignis und Workflow-Stand.

Ein unsichtbarer Kommentar im Issue identifiziert den Backend-PR. Vor dem Erstellen
werden bestehende Issues einschließlich geschlossener Issues geprüft. Den Kommentar
beibehalten, damit erneute Läufe keine Duplikate erzeugen. Läufe desselben PRs werden
serialisiert. Nachträgliche PR-Änderungen aktualisieren ein bestehendes Issue nicht.
