# Gemini Embedding 2 auf Staging

Der Backend-Vertrag ist `gemini / gemini-embedding-2 / 1536`. Der Adapter nutzt
einen separaten Request pro Chunk in `batchEmbedContents` und die dokumentierten
Textpräfixe für Dokumente und Suchfragen. Kein `taskType`-Parameter und kein
OpenAI-Key sind für Embeddings erforderlich.
[Gemini-Protokoll](https://ai.google.dev/gemini-api/docs/embeddings).

Die vorhandene lokale Datei `supabase/functions/.env` enthält bereits diesen
Embedding-Vertrag, `ANSWER_PROVIDER=gemini`, `GEMINI_ANSWER_MODEL=gemini-3.6-flash`
und einen Gemini-Key. Die Schlüssel wurden nicht geändert und gehören nicht in
Git oder Frontend-Variablen. Die Beispiel-Datei enthält keine Schlüssel.

## Rollout

Aus dem Backend-Verzeichnis ausführen. `STAGING_PROJECT_REF` unten bezeichnet
das bisher vom Frontend verwendete Projekt; vor Ausführung mit deinem Staging
abgleichen. In einem Terminal mit Supabase-Login ausführen. Die CLI fragt bei
Bedarf das Datenbankpasswort ab; alternativ `SUPABASE_DB_PASSWORD` über die
lokale Secret-Verwaltung bereitstellen. Keine `.env` mit Shell-`source` ausführen.

```bash
cd /Users/adrian/Desktop/Lernapp/lernapp_backend
npx supabase login
export STAGING_PROJECT_REF=viivnvdafgogawfebwwi

# Liste kontrollieren: Es wird jede noch ausstehende Migration angewandt.
npx supabase migration list --project-ref "$STAGING_PROJECT_REF"
npx supabase db push --project-ref "$STAGING_PROJECT_REF" --dry-run --skip-vault

# Datenbank zuerst: alter Code scheitert danach sicher am alten Vertrag.
npx supabase db push --project-ref "$STAGING_PROJECT_REF" --skip-vault

# Lokale Function-Konfiguration als Secrets auf genau dieses Projekt übertragen.
npx supabase secrets set --env-file supabase/functions/.env --project-ref "$STAGING_PROJECT_REF"

# Alle Nutzer des gemeinsamen Embedding-Adapters aktualisieren.
npx supabase functions deploy documents-index --project-ref "$STAGING_PROJECT_REF"
npx supabase functions deploy documents-search --project-ref "$STAGING_PROJECT_REF"
npx supabase functions deploy chat --project-ref "$STAGING_PROJECT_REF"

npx supabase migration list --project-ref "$STAGING_PROJECT_REF"
npx supabase secrets list --project-ref "$STAGING_PROJECT_REF"
```

Die Secrets-Liste zeigt Namen und Digests, keine Klartextschlüssel. `--skip-vault`
verhindert, dass der Datenbank-Push nebenbei vorhandene Scheduler-Vault-Secrets
überschreibt. Der bestehende Scheduler `learning-documents-index` benötigt weiter
die Vault-Einträge `document_processing_url` und `document_processing_service_key`.
Die bereits vorhandene Konfiguration bleibt erhalten. Bei fehlenden Einträgen den
bestehenden CI-Schritt `scripts/configure-file-cleanup.mjs` mit den Staging-CLI-
Zugangsdaten ausführen (siehe `docs/environments.md`).

Nicht gleichzeitig einen automatischen CI-Deploy eines älteren Backend-Stands
laufen lassen. Die Änderung einschließlich Migration gehört vor einem weiteren
CI-Deploy in den deployten Branch; ein alter Function-Deploy würde die neue
Konfiguration wieder inkompatibel machen.

## Was die Migration macht

- Kopiert vorhandene OpenAI-Chunks einschließlich Herkunft in
  `embedding_archive.openai_document_chunks`, ohne Zugriff für Browsernutzer.
- Entfernt sie aus dem aktiven Index; sie werden nicht als Gemini umetikettiert.
- Setzt Indexstatus auf `pending` und Cursor/Leases zurück; alle bereits fertig
  extrahierten Dokumente werden neu eingereiht. Neue Extraktionen werden wie
  bisher automatisch eingereiht.
- Behält Originaldateien, Texte, Chatnachrichten und Quellenauszüge. Alte
  `chunk_id`-Verweise in Quellen werden null. Archivdaten folgen Dokumentlöschungen.
- Sperrt Anbieter, Modell und Dimension auf den neuen Vertrag und entfernt
  `match_document_chunks` / `finish_document_indexing` ohne Herkunftsparameter.

Während der Umstellung sind Antworten vorübergehend nicht verfügbar. Erst wenn
mindestens ein Dokument des Kurses `indexing_status = 'ready'` erreicht, kann der
Chat wieder Quellen finden. Die Neuindexierung verursacht Gemini-API-Kosten.
Ein Rückwechsel ist ebenfalls eine Datenmigration, kein bloßes Secrets-Update.

Im Staging-SQL-Editor lässt sich der Fortschritt lesen:

```sql
select processing_status, indexing_status, indexing_error, count(*)
from public.source_documents
 group by processing_status, indexing_status, indexing_error;

select count(*) as queued_documents from public.document_indexing_jobs;

select jobname, active from cron.job
where jobname = 'learning-documents-index';
```

Bei `INDEXING_TIMEOUT` Function-Logs und Gemini-Quota prüfen. Nach Behebung kann
der angemeldete Besitzer `retry_document_indexing` mit `p_document_id` für ein
fehlgeschlagenes Dokument aufrufen. Das ist kein Grund für erneuten Upload.

## Prüfung

```bash
npm run functions:test
npm run functions:check
npm run functions:lint
npm run test:db
npm run test:embedding-migration
npm run db:lint
```

Der Migrationstest rekonstruiert einen OpenAI-Index innerhalb einer einzigen
lokalen Rollback-Transaktion und prüft Archiv, Quellen, Warteschlange und alte
Leases. Er greift ausschließlich auf den lokalen Supabase-Docker-Container zu.

Ein echter Test mit zwei synthetischen Texten lieferte über den vorhandenen Key
HTTP 200 und zweimal 1536 Dimensionen. Beide konfigurierten Gemini-Modelle waren
über die Modell-API verfügbar. Ein vollständiger Chat-Test auf Staging steht nach
dem Rollout noch aus; es wurden hier keine Staging-Secrets oder Deployments geändert.
