begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Provisioned once after function deployment; credentials stay in encrypted Vault.
create function public.configure_document_processing(p_api_url text, p_service_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare secret_id uuid;
begin
  if p_api_url is null or p_api_url !~ '^https://[a-z0-9]+\.supabase\.co$' or p_service_key is null or length(p_service_key) < 40 then
    raise exception 'INVALID_PROCESSING_CONFIG' using errcode = '22023';
  end if;
  select id into secret_id from vault.secrets where name = 'document_processing_url';
  if secret_id is null then
    perform vault.create_secret(p_api_url || '/functions/v1/documents-process', 'document_processing_url');
  else
    perform vault.update_secret(secret_id, p_api_url || '/functions/v1/documents-process');
  end if;
  select id into secret_id from vault.secrets where name = 'document_processing_service_key';
  if secret_id is null then
    perform vault.create_secret(p_service_key, 'document_processing_service_key');
  else
    perform vault.update_secret(secret_id, p_service_key);
  end if;
end;
$$;
revoke all on function public.configure_document_processing(text,text) from public, anon, authenticated;
grant execute on function public.configure_document_processing(text,text) to service_role;

select cron.schedule('learning-documents-process', '* * * * *', $job$
  select net.http_post(
    url := u.decrypted_secret,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || k.decrypted_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  )
  from vault.decrypted_secrets u cross join vault.decrypted_secrets k
  where u.name = 'document_processing_url' and k.name = 'document_processing_service_key';
$job$);
commit;
