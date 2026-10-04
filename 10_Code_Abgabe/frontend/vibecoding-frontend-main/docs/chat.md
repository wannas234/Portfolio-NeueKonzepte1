# Chat im Frontend

`/assistant` verwendet den bestehenden Supabase-Browserclient und dessen
angemeldete Sitzung. Auth, Tabellenabfragen und die Edge Function `chat` verwenden
alle `NEXT_PUBLIC_SUPABASE_URL` und den öffentlichen Key aus der Frontend-Umgebung.
Für diese Integration ist dort das Staging-Projekt einzutragen. Es gibt keinen
Fallback auf den lokalen Supabase-Stack und keinen separaten KI-Key im Frontend.

Der Staging-Endpunkt `chat` wurde per OPTIONS geprüft (204); `assistant-chat`
lieferte 404. Vertrag: Backend `docs/chat.md` / `client/chat.ts` auf
`feat/chatbot`, Commit `f97d844`. Die Antwort ist vollständiges JSON, kein Stream.

Die Oberfläche lädt echte `courses`, `chat_conversations` und `chat_messages`.
Der Indexstatus wird über die ausdrücklich benannte Materialbeziehung von
`source_documents` geprüft. Die vorhandenen lokalen Kurse in localStorage und
Dateien in IndexedDB werden nicht als Backend-Kurse oder indexierte Unterlagen
ausgegeben und nicht automatisch migriert. Ein nutzereigener Backend-Kurs mit
fertig indexiertem Material ist für Antworten erforderlich. Die Index-Vorprüfung
ist nur ein Hinweis und sperrt Senden nicht: Der Endpunkt prüft den aktuellen
Materialstand beim Aufruf. Andere Sperrgründe stehen direkt unter der Eingabe.

Eine Konversation wird beim ersten Senden angelegt. Nachrichten und Quellen
schreibt ausschließlich das Backend. Die UI zeigt Texte ohne HTML-Ausführung
und Quellen mit Originalnummer, Titel, Seite und ausklappbarem Auszug.

Offene Requests bleiben mit derselben UUID und Frage im Arbeitsspeicher und,
soweit verfügbar, nutzer- und kursgebunden in sessionStorage. Dieser Speicher
enthält nur die Wiederholungsinformation, keinen Ersatz für den Backend-Verlauf.
Ein manueller Retry verwendet denselben Request; Wartezeiten aus dem Fehlerbody
werden berücksichtigt. Unklare Ergebnisse sperren weitere Fragen bis zur Klärung.
Nach Neuladen kann eine bereits gespeicherte Antwort den offenen Request auflösen.
Nachrichten werden nach ID zusammengeführt und nach `seq` sortiert. Verlauf wird
in Seiten zu 100 Nachrichten geladen. Ein Logout während der Chat geöffnet ist
leert die offenen Requests; andere Nutzer greifen durch den Nutzerbezug nicht auf
sie zu. SessionStorage wird außerdem mit dem Tab geschlossen.

Prüfung: `npm test`, `npm run lint`, `npm run build`.
Die Chat-Tests simulieren den Supabase-Client, inklusive Fehlerantworten,
Wiederholungen, Pagination, JWT-Weitergabe und Quellenzuordnung. Sie erzeugen keine
kostenpflichtigen KI-Anfragen und ersetzen keinen angemeldeten Staging-Smoke-Test.

Manuell auf Staging prüfen:

1. Anmelden, `/assistant` öffnen, Kurs mit indexierten Unterlagen auswählen.
2. Frage eingeben und senden (Enter; Umschalt+Enter für Zeilenumbruch).
3. Antwort und Quellen prüfen, Folgefrage senden, Seite neu laden, Chat auswählen.
4. Zwischen Kursen/Unterhaltungen wechseln; Nachrichten dürfen nicht vermischt werden.
5. Bei unterbrochener Verbindung dieselbe Anfrage wiederholen; kein doppelter Austausch.
6. Kurs ohne Index und abgelaufene Sitzung auf verständliche Hinweise prüfen.
