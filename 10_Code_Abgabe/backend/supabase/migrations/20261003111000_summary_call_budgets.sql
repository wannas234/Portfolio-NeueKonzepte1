begin;
alter table public.summary_jobs add column reserved_tokens bigint not null default 0;
alter table public.summary_jobs add column paid_calls integer not null default 0;
-- Reserve before contacting the provider, including interrupted/failed attempts.
-- Retries cannot reset costs and an expired worker cannot reserve another call.
create function public.reserve_summary_call(p_job_id uuid,p_lease_token uuid,p_tokens integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.summary_jobs;
begin
 select * into j from public.summary_jobs where id=p_job_id for update;
 if not found or j.status<>'processing' or j.lease_token is distinct from p_lease_token
  or j.lease_until<=clock_timestamp() then return false; end if;
 if p_tokens is null or p_tokens<1 or j.reserved_tokens+p_tokens>(j.configuration->>'tokenBudget')::bigint
  or j.paid_calls>=(j.configuration->>'maxCalls')::integer then
  update public.summary_jobs set status='failed',error_code='BUDGET_EXCEEDED',lease_token=null,
    lease_until=null,updated_at=now() where id=j.id;
  return false;
 end if;
 update public.summary_jobs set reserved_tokens=reserved_tokens+p_tokens,paid_calls=paid_calls+1 where id=j.id;
 return true;
end $$;
revoke all on function public.reserve_summary_call(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_summary_call(uuid,uuid,integer) to service_role;
commit;
