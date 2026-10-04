-- Kontolöschung (Edge Function `delete-account`): Tombstones in file_cleanup_jobs.
--
-- file_cleanup_jobs hat bewusst keine Fremdschlüssel und überlebt die Kontolöschung mit
-- owner_id und storage_path. Die Tombstones verhindern, dass ein Upload-Schlüssel oder eine
-- Datei-ID wiederverwendet wird (prevent_file_reuse). Nach einer Kontolöschung kann es keine
-- neuen Dateien dieses Besitzers mehr geben; abgeschlossene Jobs werden deshalb 30 Tage nach
-- Abschluss gelöscht. Offene Jobs bleiben, bis files-cleanup das Objekt entfernt hat.
-- Tombstones bestehender Konten bleiben unverändert.
begin;

create function public.purge_deleted_account_tombstones() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  delete from public.file_cleanup_jobs j
    where j.completed_at < now() - interval '30 days'
      and not exists (select 1 from public.profiles p where p.id = j.owner_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.purge_deleted_account_tombstones() from public, anon, authenticated;
grant execute on function public.purge_deleted_account_tombstones() to service_role;

select cron.schedule('purge-deleted-account-tombstones', '17 3 * * *',
  'select public.purge_deleted_account_tombstones()');

commit;
