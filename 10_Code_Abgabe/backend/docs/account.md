# Konto: Datenexport, Löschung und Datenflüsse

Backend-Funktionen für die Betroffenenrechte nach DSGVO und die Grundlage für die
Datenschutzerklärung. Client-Helfer: `client/account.ts`.

## Datenexport (`account-export`, Art. 15/20)

`GET /functions/v1/account-export` mit Nutzer-JWT. Antwort ist eine JSON-Datei
(`content-disposition: attachment; filename="universe-export-YYYY-MM-DD.json"`).

- Die Daten liefert `public.export_my_data()`. Der Nutzer kommt allein aus `auth.uid()`;
  jede Teilmenge ist explizit auf ihn gefiltert.
- Höchstens 3 Exporte pro 24 Stunden (`public.account_exports`). Danach `429 RATE_LIMITED`
  mit `Retry-After` in Sekunden.
- Dateien: Metadaten plus `download_url` (Signed URL, 24 h gültig, `download_expires_at`)
  für Dateien im Status `ready`. Signiert wird mit dem Nutzer-JWT, es gelten also die
  Storage-Policies. Lokal `PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` in
  `supabase/functions/.env` setzen, sonst zeigen die Links auf das interne Gateway.

Enthaltene Schlüssel neben `export_version`, `exported_at`, `account` und `files`:
`profile`, `subscription`, `courses`, `lectures`, `materials`, `documents`,
`document_notes`, `presentations` (mit `slides`), `summaries`, `flashcard_decks`
(mit `cards`), `flashcard_progress`, `flashcard_reviews`, `quizzes`, `quiz_attempts`,
`learning_drafts`, `grades`, `calendar_events`, `material_analyses`,
`chat_conversations` (mit `messages` und deren `sources`), `usage_events`.

Nicht enthalten sind abgeleitete technische Daten: Embeddings, Chunks, extrahierter
Text, Job-, Lease- und Pipeline-Zustände. Bei einer inkompatiblen Strukturänderung
`EXPORT_VERSION` erhöhen.

## Konto löschen (`delete-account`, Art. 17)

`POST /functions/v1/delete-account` mit Nutzer-JWT und
`{ "password": "…", "confirm": "LÖSCHEN" }`.

1. Passwort wird über `signInWithPassword` geprüft (eigener Client ohne Nutzer-JWT).
2. Stripe: offene Checkout-Sessions verfallen, alle nicht beendeten Abos werden sofort
   gekündigt (`DELETE /v1/subscriptions/{id}`, ohne anteilige Erstattung). Bei einem
   Fehler wird abgebrochen und nichts gelöscht. Der Stripe-Customer bleibt bestehen,
   Rechnungen unterliegen der Aufbewahrungspflicht.
3. Storage: alle Objekte unter `learning-files/<uid>/` werden entfernt, auch verwaiste.
4. `auth.admin.deleteUser`. Alle Nutzertabellen hängen per Cascade an `auth.users`.

Ein erneuter Aufruf nach einem Fehler setzt beim fehlgeschlagenen Schritt wieder auf.
`stripe-webhook` bestätigt Events zu gelöschten Konten (Fremdschlüsselfehler 23503),
statt sie endlos erneut zustellen zu lassen.

| Status | Code                    | Bedeutung                                         |
| ------ | ----------------------- | ------------------------------------------------- |
| 400    | `INVALID_REQUEST`       | Body fehlt oder Passwort fehlt                    |
| 400    | `CONFIRMATION_REQUIRED` | Bestätigungstext stimmt nicht exakt               |
| 403    | `INVALID_PASSWORD`      | Passwort falsch                                   |
| 409    | `PASSWORD_REQUIRED`     | Konto ohne E-Mail/Passwort                        |
| 429    | `RATE_LIMITED`          | Auth-Rate-Limit bei der Passwortprüfung           |
| 500    | `CONFIGURATION_ERROR`   | Stripe-Customer vorhanden, aber kein Stripe-Key   |
| 502    | `STRIPE_ERROR`          | Kündigung fehlgeschlagen, nichts gelöscht         |
| 503    | `STORAGE_ERROR`         | Dateien nicht entfernt, Konto besteht noch        |
| 503    | `DELETE_FAILED`         | Dateien entfernt, Auth-Nutzer noch nicht gelöscht |

Nach Erfolg im Frontend lokal abmelden (`signOut({ scope: 'local' })`); das alte JWT
bleibt bis zu seinem Ablauf (`jwt_exp`) formal gültig, findet aber keine Daten mehr.

### Tombstones

`file_cleanup_jobs` hat bewusst keine Fremdschlüssel und überlebt die Löschung mit
`owner_id` und `storage_path`. Der tägliche Cronjob `purge-deleted-account-tombstones`
löscht abgeschlossene Jobs gelöschter Konten 30 Tage nach Abschluss. Tombstones
bestehender Konten bleiben, sie schützen vor der Wiederverwendung von Upload-Schlüsseln.

## Widerrufsrecht beim Checkout

`create-checkout-session` liest `waiver_accepted` aus dem Body. Bei `true` werden
`waiver_accepted_at` (Serverzeit) und `waiver_version` in den Metadaten von
Checkout-Session und Subscription gespeichert. Mit `CHECKOUT_REQUIRE_WAIVER=true` ist die
Zustimmung Pflicht (`400 WAIVER_REQUIRED`). Erst einschalten, wenn das Frontend die
Checkbox mitschickt. Bei einer inhaltlichen Änderung des Texts `WAIVER_VERSION` anpassen.

## Datenflüsse (Vorlage für die Datenschutzerklärung)

Fachlich und rechtlich prüfen lassen; Regionen und Verträge (AVV/DPA) für jedes Projekt
eintragen.

| Empfänger                                | Zweck                                                                      | Daten                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Supabase                                 | Datenbank, Auth, Storage, Edge Functions                                   | alle Konto- und Lerndaten, Dateien, Auth-Logs                         |
| Google (Gemini API)                      | Textextraktion, Embeddings, Chat, Zusammenfassungen, Karteikarten, Analyse | Inhalte hochgeladener Dokumente und Seitenbilder, Fragen, Chatverlauf |
| OpenAI (optional)                        | Antworten, falls `ANSWER_PROVIDER=openai`                                  | Fragen, Dokumentauszüge, Chatverlauf                                  |
| Docling-Dienst (optional, `DOCLING_URL`) | PDF-Extraktion                                                             | hochgeladene PDFs                                                     |
| Stripe                                   | Zahlungen und Abo-Verwaltung                                               | E-Mail, Supabase-Nutzer-ID, Zahlungsdaten (nur bei Stripe)            |
| SMTP-Anbieter (falls aktiviert)          | Auth-Mails                                                                 | E-Mail-Adresse, Mailinhalt                                            |

Speicherdauer:

- Konto- und Lerndaten bis zur Löschung durch den Nutzer oder des Kontos.
- Gelöschte Dateien: Objekt wird asynchron entfernt (`files-cleanup`, alle 15 min).
- Nicht abgeschlossene Uploads: nach 24 Stunden.
- Tombstones gelöschter Konten: 30 Tage nach Abschluss der Bereinigung.
- `usage_events` (Verbrauchskonto) und `account_exports`: bis zur Kontolöschung.
- Stripe-Customer und Rechnungen: bei Stripe, gemäß Aufbewahrungspflichten.
- `embedding_archive.openai_document_chunks` (Altbestand aus der Embedding-Migration)
  wird per Cascade mit den Dokumenten gelöscht; nach erfolgreicher Migration entfernen.

## Checkout gegen doppelte Abos absichern

Migration `20261005110000_checkout_attempts.sql` vor der neuen Function ausrollen.
`checkout_attempts` ist nur für `service_role` zugänglich. Der Server reserviert
pro Nutzer atomar einen Versuch mit unveränderlichen Stripe-Parametern. Parallele
Aufrufe und Wiederholungen nach verlorener Antwort verwenden denselben Stripe-
Idempotenzschlüssel. Offene Sitzungen werden wiederverwendet; nach bestätigtem
Ablauf rotiert der Versuch per Compare-and-swap. Abgeschlossene Sitzungen sperren neue
Checkouts, bis Stripe das Ende ihres Abos bestätigt. Aktive Abos sperren neue Checkouts.
Die Stripe-Listen werden vollständig paginiert.

Bei mehreren offenen Alt-Sitzungen wird kein weiterer Checkout erzeugt. Solche
Altbestände müssen bei Stripe geprüft und überzählige Sitzungen geschlossen werden.
Ein über 23 Stunden alter Versuch ohne gespeicherte Sitzungs-ID
wird ebenfalls gesperrt: Stripe kann Idempotenzschlüssel nach 24 Stunden verwerfen.
In diesem seltenen Fehlerfall erst den Stripe-Bestand abgleichen, bevor der Versuch
administrativ zurückgesetzt wird. Ein automatischer frischer Schlüssel wäre unsicher.
