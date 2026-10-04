# Fragen zu Lernmaterialien

[Issue #32](https://github.com/Azockgg/lernapp/issues/32): `Frage → Embedding →
Vektorsuche → Sprachmodell → Antwort mit Quellen`. Der Endpunkt `chat` liefert
vollständiges JSON, kein Streaming. OpenAI und Gemini verwenden dasselbe
Frontend-Protokoll. Alle Frontend-Aufrufe benötigen ein Nutzer-JWT.

## Frontend: Konversation und Material

Konversationen gehören über ihren Kurs zum Nutzer; es gibt kein zusätzliches
`owner_id`. Clients dürfen Konversationen anlegen, umbenennen und löschen.
Nachrichten und Quellen sind ausschließlich servergeschrieben.

```ts
const { data: conversation, error: createError } = await supabase
  .from('chat_conversations')
  .insert({ course_id: courseId })
  .select()
  .single();
if (createError) throw createError;

const { data: conversations, error: listError } = await supabase
  .from('chat_conversations')
  .select('id, course_id, title, updated_at, courses(title)')
  .order('updated_at', { ascending: false });
if (listError) throw listError;
```

Der Titel beginnt mit `Neuer Chat` und wird beim ersten erfolgreichen Austausch
zur ersten Frage. `updated_at` wird serverseitig gepflegt. Umbenennen über
`update({ title })`, löschen über `delete()`, jeweils mit `.eq('id', conversationId)`.

Vor der ersten Frage den Indexstatus prüfen. Die benannte Materialbeziehung ist
wegen zweier Fremdschlüssel erforderlich; sonst liefert PostgREST `PGRST201`.

```ts
const { data: indexed, error: indexError } = await supabase
  .from('source_documents')
  .select('id, materials!source_documents_material_id_fkey!inner(course_id)')
  .eq('materials.course_id', courseId)
  .eq('indexing_status', 'ready')
  .limit(1);
if (indexError) throw indexError;
// Bei indexed.length === 0 auf Upload/Indexierung verweisen.
```

Ein fertiger Index garantiert keine zur Frage passende Passage. Daher bleibt
auch nach dieser Vorprüfung `NO_RELEVANT_MATERIAL` möglich.

## Suche auf Materialien einschränken

Der optionale Request-Parameter `material_ids` beschränkt die Suche auf ein oder
mehrere Materialien des Kurses der Konversation. Ohne diesen Parameter werden
weiterhin alle indexierten Materialien des Kurses durchsucht:

```ts
// Alle indexierten Materialien im Kurs:
await sendChat(supabase, {
  conversation_id: conversationId,
  request_id: crypto.randomUUID(),
  question,
});
// Nur die ausgewählten Materialien:
await sendChat(supabase, {
  conversation_id: conversationId,
  request_id: crypto.randomUUID(),
  question,
  material_ids: [firstMaterialId, secondMaterialId],
});
```

`material_ids` muss, wenn angegeben, ein Array mit 1–100 UUIDs sein. `[]`, `null`
und ungültige IDs liefern `INVALID_REQUEST` (400). Reihenfolge, UUID-Großschreibung
und Duplikate ändern die Auswahl nicht. Fehlende, fremde oder zu einem anderen
Kurs gehörende Materialien liefern einheitlich `MATERIAL_NOT_FOUND` (404), ohne
KI-Aufrufe auszulösen. Es gibt keinen automatischen Rückfall auf den ganzen Kurs.
`NO_INDEXED_MATERIAL` und `NO_RELEVANT_MATERIAL` beziehen sich bei einer Auswahl
nur auf diese Materialien. Ein noch nicht indexiertes Material verhindert nicht
die Suche in anderen bereits indexierten Materialien der Auswahl.

Die Auswahl gilt pro Anfrage für Indexprüfung, Vektor- und Volltextsuche, jeweils
vor Ranking und Trefferlimit. Die Suche verwendet weiterhin das Nutzer-JWT und
RLS. Zitate behalten ihre Material- und Seitenreferenzen. Gesprächsverlauf und
Zusammenfassung bleiben Gesprächskontext; eine Auswahl startet keinen neuen Chat
und entfernt keine älteren Nachrichten.

Bei Wiederholungen dieselbe Frage **und dieselbe Materialauswahl** senden.
Eine geänderte Auswahl (auch der Wechsel zwischen Auswahl und ganzem Kurs) mit
bestehender Request-ID liefert `REQUEST_ID_CONFLICT`. Die Auswahl wird als
Snapshot in `chat_requests.material_ids` und an der Nutzernachricht gespeichert;
`NULL` steht dort für den ganzen Kurs, auch bei historischen Requests.
Beim direkten Wiederherstellen über `chat_exchange` für eingeschränkte Requests
`p_material_ids` mitsenden; für bisherige kursweite Requests bleibt es optional.

Rollout: zuerst Migration `20260923120000_chat_material_scope.sql`, danach die
aktualisierte Chat-Function bereitstellen. Bisherige kursweite Requests und
Such-RPCs bleiben kompatibel. Die neue Auswahl ist im Backend-Client verfügbar;
eine Materialauswahl in der Frontend-Oberfläche ist eine separate Integration.

## Frontend: Frage senden und wiederholen

Datenbanktypen kommen aus `types/database.types.ts`, der Request-/Response-Vertrag
und der kleine Aufrufhelfer aus `client/chat.ts`.

```ts
import { sendChat, type ChatRequest } from './client/chat';

// Einmal pro neuem Absendevorgang erzeugen und bis zur Klärung aufbewahren.
const pendingRequest: ChatRequest = {
  conversation_id: conversationId,
  request_id: crypto.randomUUID(),
  question: question.trim(),
};
const { data, error } = await sendChat(supabase, pendingRequest);
// Ohne Helper identisch:
// supabase.functions.invoke<ChatExchange>('chat', { body: pendingRequest })
```

`question` muss nach Trimmen nicht leer sein und darf vor Trimmen höchstens
1800 UTF-16-Codeeinheiten enthalten (`question.length` in JavaScript). Der
Request-Body ist auf 10 000 Bytes begrenzt. `course_id`, Anbieter und Modell
werden nicht vom Frontend ausgewählt; der Kurs ergibt sich aus der Konversation.

Während der Verarbeitung Eingabe und Absenden für diese Konversation sperren
und einen Ladezustand anzeigen. Die serverseitige Verarbeitungsfrist beträgt
120 Sekunden; ein Frontend-Timeout sollte nicht kürzer sein. Bei Netzwerkfehlern
oder verlorener Antwort bleibt der Ausgang zunächst unbekannt.

**Bei einem Retry exakt dieselbe `request_id` und dieselbe Frage senden.** Bereits
abgeschlossene Requests liefern den gespeicherten Austausch ohne weitere
KI-Aufrufe. Eine geänderte Frage mit derselben ID liefert `REQUEST_ID_CONFLICT`.
Wird eine Frage bewusst geändert, ist das ein neuer Absendevorgang mit neuer ID.
Während ein älterer Request noch läuft, zuerst dessen Ausgang klären.

Die erfolgreiche Antwort enthält:

```ts
const exchange: ChatExchange = {
  conversation_id: '…',
  request_id: '…',
  messages: [
    { id: '…', seq: 1, role: 'user', content: '…', created_at: '…' },
    {
      id: '…',
      seq: 2,
      role: 'assistant',
      content: 'Antwort [2].',
      created_at: '…',
      provider: 'gemini',
      model: '…',
      input_tokens: 120,
      output_tokens: 40,
    },
  ],
  sources: [
    {
      citation_no: 2,
      chunk_id: '…',
      source_document_id: '…',
      material_id: '…',
      material_title: 'Vorlesung 03',
      page_number: 17,
      excerpt: '…',
      similarity: 0.83,
    },
  ],
};
```

`input_tokens` und `output_tokens` können `null` sein, wenn der Provider keine
Zahlen liefert oder eine ältere Nachricht keine Messung hat. `null` bedeutet
unbekannt, nicht null Verbrauch. Gemini-Ausgabetokens enthalten gemeldete
Thinking-Tokens; der interne Thinking-Text wird nicht als Antwort ausgegeben.

Nach Erfolg beide Nachrichten anhand ihrer **`id` zusammenführen**, dann nach
`seq` sortieren. Nicht blind anhängen: Ein Replay oder paralleles Neuladen könnte
sonst denselben Austausch doppelt anzeigen. Danach den offenen Absendevorgang
verwerfen. Quellen gehören zur Assistant-Nachricht `messages[1]`.

## Frontend: Fehler und Wartezeiten

Bei Nicht-2xx liefert `supabase-js` einen `FunctionsHttpError`. Den Fehlercode
immer aus dem Response-Body lesen; `error.message` reicht nicht.

```ts
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { ChatFailure } from './client/chat';

if (error instanceof FunctionsHttpError) {
  const failure = (await error.context.json()) as ChatFailure;
  const { code, retry_after_seconds } = failure.error;
  // retry_after_seconds ist auch bei Cross-Origin-Aufrufen im Body verfügbar.
  // Bei automatischen Wiederholungen mindestens diese Wartezeit einhalten.
} else if (error) {
  // Transportfehler: Ausgang unbekannt, pendingRequest für den Retry behalten.
}
```

| HTTP      | Code                                                                                 | Frontend-Verhalten                                                                                     |
| --------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 400 / 413 | `INVALID_REQUEST`                                                                    | Eingabe/Request korrigieren; 413 bedeutet zu großer Body.                                              |
| 401       | `UNAUTHENTICATED`                                                                    | Session erneuern bzw. anmelden; offenen Request behalten.                                              |
| 404       | `MATERIAL_NOT_FOUND`                                                                 | Material fehlt, ist nicht zugänglich oder gehört zu einem anderen Kurs; Auswahl aktualisieren.         |
| 404       | `CONVERSATION_NOT_FOUND`                                                             | Konversation fehlt oder Zugriff verloren; Chatliste aktualisieren.                                     |
| 409       | `NO_INDEXED_MATERIAL`                                                                | Erst Upload/Indexierung abwarten.                                                                      |
| 409       | `NO_RELEVANT_MATERIAL`                                                               | Keine verfügbare Passage zur Frage; Material prüfen oder Frage ändern.                                 |
| 409       | `REQUEST_ID_CONFLICT`                                                                | Dieselbe ID wurde mit anderer Frage oder Materialauswahl verwendet; offenen Absendevorgang abgleichen. |
| 409       | `REQUEST_IN_PROGRESS`                                                                | Genau dieser Request läuft; nach frühestens 2 Sekunden dieselbe Anfrage wiederholen.                   |
| 409       | `CONVERSATION_BUSY`                                                                  | Eine andere Frage im Chat läuft; deren Abschluss abwarten.                                             |
| 409       | `REQUEST_LEASE_EXPIRED`                                                              | Versuch wurde überholt; nach Wartezeit mit derselben ID wiederholen.                                   |
| 429       | `CONCURRENCY_LIMIT`                                                                  | Andere Konversation verarbeitet bereits eine Frage; Wartezeit einhalten.                               |
| 429       | `RATE_LIMITED`                                                                       | `retry_after_seconds` abwarten; dieselbe Anfrage beibehalten.                                          |
| 503       | `ANSWERS_NOT_CONFIGURED`, `EMBEDDINGS_NOT_CONFIGURED`, `EMBEDDING_CONTRACT_MISMATCH` | Konfigurationsproblem; keine automatische Wiederholungsschleife.                                       |
| 503       | `INVALID_CITATION`, `INCOMPLETE_ANSWER`, `INVALID_ANSWER_RESPONSE`                   | Keine gültige vollständige Antwort; manuellen Retry mit derselben ID anbieten.                         |
| 503       | `CHAT_UNAVAILABLE`, `REQUEST_CANCELLED`                                              | Retry mit derselben ID anbieten. Nach Transportfehler kann bereits gespeichert worden sein.            |

`retry_after_seconds` wird für laufende/belegte Requests, Limits und überholte
Versuche mitgeliefert, zusätzlich als `Retry-After`-Header. Bei automatischer
Wiederholung nach wiederholten Fehlern abbrechen und einen manuellen Retry anbieten.
Ein erneuter Aufruf mit neuer UUID ist **keine** Fehlerbehandlung.

Ein 503 garantiert nicht, dass nichts gespeichert wurde: Die Datenbank kann
bereits committed haben, während ihre Antwort verloren geht. Ein Retry klärt das
über den gespeicherten Austausch. Fehlgeschlagene Versuche erzeugen keine halben
Nachrichtenpaare; ihr letzter Zustand steht separat in `chat_requests`.

## Frontend: Antwort bewerten

[Issue #55](https://github.com/Azockgg/lernapp/issues/55): Jede Assistant-Antwort
trägt ihr eigenes Feedback-Signal. `helpful` ist `true` (hilfreich), `false`
(nicht hilfreich) oder `null` (nicht bewertet). Der Zeitpunkt steht in
`helpful_at` und wird serverseitig gesetzt.

```ts
import { rateAnswer } from './client/chat';

const { data, error } = await rateAnswer(supabase, messageId, true);
// Ohne Helper identisch:
// supabase.from('chat_messages').update({ helpful: true }).eq('id', messageId)
```

Erneutes Bewerten überschreibt den Wert; `null` nimmt die Bewertung zurück und
löscht `helpful_at` wieder. Ein Toggle im UI ist damit ein einziger Aufruf ohne
Fallunterscheidung. Der aktuelle Stand kommt aus dem Verlauf (siehe unten) und
sollte nach einem Fehlschlag erneut geladen werden. Bei optimistischen Updates
kann das UI zunächst den vorherigen Zustand wiederherstellen; eine fehlgeschlagene
Update-Antwort enthält keinen verlässlichen aktuellen Bewertungszustand. Auch
wiederhergestellte Exchanges liefern `helpful` und `helpful_at` an der Assistant-Antwort.

`helpful` ist die einzige Spalte von `chat_messages`, die ein Client schreiben
darf. Antworttext, Modell, Anbieter und Tokenzahlen haben kein Schreibrecht;
ein Update darauf scheitert mit `42501`. Nutzerfragen lassen sich nicht bewerten:
Die Policy blendet sie für das Update aus, der Aufruf ändert dann nichts und
liefert `data: null`. Dasselbe gilt für eine fremde oder gelöschte Nachricht —
**für einen fehlenden Treffer gibt es keinen Fehler**, deshalb `maybeSingle()`
und eine Prüfung auf `data`. `single()` würde hier mit `PGRST116` scheitern.

Die Auswertung über alle Nutzer (`chat_feedback_stats`) ist eine Betriebssicht
und für Clients bewusst nicht ausführbar; siehe [Datenmodell](database.md).

## Frontend: Verlauf und laufenden Request wiederherstellen

```ts
const { data: messages, error: historyError } = await supabase
  .from('chat_messages')
  .select(
    'id, seq, role, content, request_id, model, provider, input_tokens, output_tokens,' +
      ' helpful, helpful_at, created_at,' +
      ' chat_message_sources(citation_no, material_title, page_number,' +
      ' material_id, source_document_id, chunk_id, excerpt, similarity)',
  )
  .eq('conversation_id', conversationId)
  .order('seq');
if (historyError) throw historyError;
```

`seq` bestimmt die Reihenfolge; Frage und Antwort haben denselben Zeitstempel.
Nutzernachrichten haben keine Quellen und kein Feedback. Bei langen Verläufen mit `.range()`
paginieren; das API-Zeilenlimit beträgt standardmäßig 1000.

Den offenen Request im Frontendzustand behalten; für Wiederherstellung nach
Neuladen kann ein nutzergebundener Session-Speicher verwendet werden. Beim
Logout leeren. Der Server liefert den letzten Versuch über eine eingeschränkte
Spaltenauswahl; `.select('*')` ist hier absichtlich nicht erlaubt:

```ts
const { data: state, error: stateError } = await supabase
  .from('chat_requests')
  .select('request_id, status, attempts, error_code, stage, lease_until, updated_at')
  .eq('conversation_id', conversationId)
  .eq('request_id', pendingRequest.request_id)
  .maybeSingle();
if (stateError) throw stateError;
```

- `running`: Wartezustand. Ist `lease_until` überschritten, kann derselbe Request
  erneut gesendet werden; ein Datenbank-Cronjob muss dafür nicht erst laufen.
- `completed`: Verlauf laden oder denselben Request erneut senden, um die Antwort
  zu erhalten.
- `failed` / `cancelled`: Nach Fehlercode behandeln und dieselbe Anfrage wiederholen.
- Kein Eintrag: Der Request wurde eventuell noch nicht reserviert. Ein Retry mit
  derselben ID ist sicher; ältere erfolgreiche Austausche können ebenfalls ohne
  Eintrag vorhanden sein.

`stage` wird bei Fehlern gespeichert; während der Verarbeitung bleibt sie
`reserved`. Sie ist kein Live-Fortschrittsbalken. Ein abgelaufener Request kann bis
zum nächsten zugelassenen Versuch noch `running` anzeigen; `lease_until` beachten.

## Quellen darstellen

Marker sind `[n]`, und `n` entspricht der `citation_no`. Nummern können Lücken
haben: Werden nur die zweite und fünfte Passage zitiert, kommen `[2]` und `[5]`
zurück. Ungültige numerische Marker werden serverseitig abgewiesen.

```ts
const byNumber = new Map(sources.map((source) => [source.citation_no, source]));
const parts = content.split(/(\[\d{1,2}\])/);
```

Aus Titel und Seite entsteht „Vorlesung 03, S. 17“. Bei `page_number: null`
entfällt die Seite. Titel, Seite und Auszug sind dauerhafte Momentaufnahmen.
`chunk_id`, `source_document_id` und `material_id` können unabhängig voneinander
`null` werden: Eine Neuindexierung löscht beispielsweise nur den Chunk-Verweis.
Einen Materiallink nur bei vorhandener `material_id`, einen Chunklink nur bei
vorhandener `chunk_id` anbieten. Antworttext und Titel als Text bzw. sicher
bereinigtes Markdown rendern. Bei einer Antwort ohne Belege ist `sources` leer.

## Backend und Parallelität

`reserve_chat_request` reserviert vor dem Provideraufruf atomar einen Versuch.
Eine Sperre je Nutzer schützt Aufruf-/Parallelitätslimits; eine zusätzliche
Konversationssperre schützt den Verlauf. Standard: sechs zugelassene Versuche
pro rollender Minute und eine aktive Antwort je Nutzer. Auch fehlgeschlagene
Versuche zählen. Laufende Retries, abgeschlossene Replays und abgewiesene
Requests verbrauchen keine weiteren Slots. Konversationen löschen setzt das
Minutenlimit nicht zurück und gibt auch den laufenden Ausführungsslot nicht frei.
Dieser bleibt in `chat_execution_leases` bis zum Abschluss/Fehler oder Ablauf bestehen.

Die Reservierung gilt drei Minuten und hat ein neues Token pro Versuch. Der
Endpunkt begrenzt die Verarbeitung auf 120 Sekunden und jeden KI-Aufruf auf
60 Sekunden. Ein Client-Abbruch wird nach Möglichkeit an den Provider
weitergegeben; ein erfolgreicher Commit bleibt trotzdem gültig.
`complete_chat_request` prüft Besitz, Token und Ablauf erneut, speichert Frage,
Antwort, Quellen und Metadaten in einer Transaktion und markiert den Request als
abgeschlossen. Ein alter Worker kann einen neueren Versuch weder abschließen
noch als fehlgeschlagen markieren.

Nach Prozessabsturz oder unklarem Providerausgang kann ein erneuter Versuch nach
Ablauf nochmals Providerkosten verursachen. Eine exakt einmalige Abrechnung über
Datenbank und externe Provider hinweg ist damit nicht garantiert. Die erfolgreiche
Speicherung bleibt idempotent.

`chat_requests` speichert den letzten Versuch samt Anzahl der Versuche; die
strukturierten Logs enthalten Abschluss/Fehler, Request-ID, Dauer und bei Erfolg
Anbieter, Modell und Tokenzahlen. Fragen, Antworten, Dokumenttexte und Schlüssel
werden nicht geloggt. Nicht erfolgreiche Generierungen können trotzdem Kosten
verursachen; gespeicherte Tokenzahlen sind keine vollständige Abrechnung.

## Anbieterwechsel ohne Vektormischung

In `supabase/functions/.env` für lokale Functions konfigurieren; siehe
[.env.example](../supabase/functions/.env.example). Nach Änderungen die lokalen
Functions neu starten. `.env.development` ist die Umgebung der Remote-CLI und
ersetzt diese Function-Konfiguration nicht.

```dotenv
# OpenAI-Antworten
ANSWER_PROVIDER=openai
OPENAI_ANSWER_MODEL=gpt-4o-mini
OPENAI_API_KEY=...

# Für den Wechsel zusätzlich konfigurieren, dann nur ANSWER_PROVIDER ändern:
GEMINI_API_KEY=...
GEMINI_ANSWER_MODEL=DEIN_VERFUEGBARES_GEMINI_MODELL
# ANSWER_PROVIDER=gemini

AI_MAX_OUTPUT_TOKENS=800
AI_QUESTIONS_PER_MINUTE=6
AI_CONCURRENT_RESPONSES_PER_USER=1
```

OpenAI- und Gemini-Antwortmodelle sind unabhängig benannt. Der Anbieterwechsel
benötigt weder eine Datenmigration noch eine Neuindexierung. Es gibt keinen
automatischen Fallback. Modellverfügbarkeit im eigenen Providerprojekt prüfen;
der Gemini-Modellname muss ausdrücklich gesetzt werden.

**Embeddings verwenden nach Migration `20260916120000` Gemini:**

```dotenv
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=gemini-embedding-2
EMBEDDING_DIMENSIONS=1536
```

`GEMINI_API_KEY` ist für die Dokumentensuche erforderlich, unabhängig vom
Antwortanbieter. `OPENAI_API_KEY` wird nur für OpenAI-Antworten benötigt.
Indexierung, Dokumentsuche und Chat verwenden denselben geprüften Vertrag.
Alte OpenAI-Vektoren werden getrennt archiviert und Dokumente neu indexiert;
es gibt keine Umbenennung vorhandener Vektoren. Die alten SQL-Einstiegspunkte
ohne Vertrag sind entfernt. Nur Umgebungsvariablen zu ändern reicht nicht.
Siehe [Rollout nach Staging](gemini-embeddings-staging.md).

Die bestehenden Quellenregeln bleiben erhalten. Der
Gemini-Adapter bildet lediglich `system` auf `systemInstruction` und
`assistant` auf `model` ab. Retrieval berücksichtigt die letzte Nutzerfrage,
lädt höchstens acht Passagen und nutzt den Nutzer-JWT unter RLS. Der Modellverlauf
enthält höchstens zehn jüngste Nachrichten und 6000 Zeichen plus bis zu 2000 Zeichen
persistierte Gesprächszusammenfassung. Kurze Verläufe benötigen keinen zusätzlichen
Modellaufruf. Die Zusammenfassung ist unvertrauenswürdiger Gesprächskontext und
keine zitierbare Quelle; alte Quellenmarker werden entfernt. Retrieval verwendet
weiterhin die letzte Nutzerfrage aus der jüngsten Historie.

Vor der Antwort wird höchstens ein zusammenhängendes Paket älterer Nachrichten
(maximal 20 Nachrichten / 16.000 Inhaltszeichen) mit der bisherigen Zusammenfassung
verdichtet. Verwendet werden der konfigurierte Antwortanbieter und dessen Modell,
mit 600 Ausgabetokens und 15 Sekunden Zeitlimit innerhalb des bestehenden
120-Sekunden-Requestlimits. Der vorhandene Transport erlaubt einen Retry bei
502/503/504 innerhalb dieses Zeitlimits. Die Eingabe enthält zusätzlich höchstens
2000 Zeichen bisherige Zusammenfassung sowie Prompt und JSON-Struktur.
Große Bestandsverläufe werden schrittweise aufgearbeitet; bis dahin kann zwischen
Zusammenfassung und jüngster Historie eine Kontextlücke bestehen.

`chat_history_summaries` speichert Text und `through_seq`. Originalnachrichten
bleiben erhalten. Nur `save_chat_history_summary` mit gültiger Request-Lease,
passendem Besitzer und erwartetem vorherigem Fortschritt aktualisiert den Stand.
Die Speicherung erfolgt vor der Antwort, sodass ein späterer Antwortfehler keine
erneute Verdichtung desselben Pakets erfordert. Bei Modell-, Validierungs- oder
Speicherfehlern bleibt die letzte gültige Zusammenfassung erhalten; der nächste
Request versucht dasselbe Paket erneut. Abgebrochene Requests werden nicht fortgesetzt.
`chat_summary_generated` protokolliert Anbieter, Modell, zusätzliche Token-Nutzung
und Laufzeit separat von Antwortkosten; `chat_summary_unavailable` meldet den
Fallback ohne Gesprächsinhalte zu loggen.

Rollout: Migration `20260921120000_chat_history_summaries` vor der aktualisierten
Chat-Function anwenden und die Datenbanktypen neu erzeugen. Kein Frontendwechsel
oder neuer API-Parameter ist erforderlich.

API-Verträge: [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat)
und [Gemini GenerateContent](https://ai.google.dev/api/generate-content).

## Lokale Prüfung und späterer Rollout

```bash
npm run db:apply
npm run test:db
npm run test:chat
npm run db:lint
npm run gen:types
npm run functions:test
npm run functions:check
npm run functions:lint
npm run format:check
```

`test:chat` prüft echte parallele Datenbanktransaktionen gegen den lokalen Stack,
legt eigene Testnutzer an und löscht sie danach. Kein Provider wird dabei aufgerufen.
Function-Tests simulieren OpenAI und Gemini, Fehler, Quellenvalidierung und den
festen Embedding-Vertrag. SQL-Tests prüfen außerdem RLS und Quellensnapshots.

Später zuerst Migrationen, dann Functions bereitstellen. Alte Chat-Functions
müssen durch diese Version ersetzt werden, da der bisherige Schreibhelfer jetzt
privat ist. Function-Secrets je Zielprojekt setzen. Anschließend je Anbieter einen
Smoke-Test mit echten Schlüsseln durchführen. Die lokale Umsetzung deployt nichts
und führt keine kostenpflichtigen Provideraufrufe aus.

## Verbrauch bei Wiederholungen

Bereits gespeicherte Antworten werden weiterhin anhand von Unterhaltung und Request-ID
ohne Provider-Aufruf wiedergegeben. Muss der Server neu generieren (auch nach einem
fehlgeschlagenen Versuch), zählt diese Ausführung als neue Einheit. Der Verbrauchsschlüssel
wird serverseitig erzeugt; Client-Request-IDs sind keine Quoten-Schlüssel. Das verhindert
Umgehungen über andere Unterhaltungen oder gelöschte Chats. Tokenzahlen werden derselben
Ausführung zugeordnet.
