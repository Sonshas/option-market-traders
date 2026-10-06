-- MegaPay (M-Pesa STK push) REAL deposits. Additive only.
-- deposits.provider_reference = MegaPay transaction_request_id; deposits.details->>'reference' = our OMT-XXXXXXXX.

create unique index if not exists deposits_provider_reference_uniq
  on public.deposits (provider, provider_reference)
  where provider_reference is not null;

create unique index if not exists deposits_megapay_reference_uniq
  on public.deposits ((details->>'reference'))
  where provider = 'megapay';

create unique index if not exists deposits_megapay_receipt_uniq
  on public.deposits ((details->>'mpesa_receipt'))
  where provider = 'megapay' and details ? 'mpesa_receipt';

create unique index if not exists wallet_ledger_deposit_reference_uniq
  on public.wallet_ledger (reference_id)
  where entry_type = 'deposit' and reference_id is not null;

-- MegaPay deposit rows may only be created by the megapay-deposit Edge Function (service role).
create policy deposits_block_client_megapay on public.deposits
  as restrictive
  for insert
  to authenticated
  with check (provider is distinct from 'megapay');

create table if not exists public.megapay_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  payload jsonb,
  raw_body text not null default '',
  content_type text,
  reference text,
  transaction_id text,
  routed_to text not null default 'unknown' check (routed_to in ('omt', 'vast', 'unknown')),
  forward_status integer,
  forward_error text,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  processed boolean not null default false,
  process_result text
);

alter table public.megapay_webhook_events enable row level security;
revoke all on table public.megapay_webhook_events from anon, authenticated;

create index if not exists megapay_webhook_events_retry_idx
  on public.megapay_webhook_events (received_at)
  where routed_to = 'vast' and (forward_status is null or forward_status < 200 or forward_status >= 300);

create index if not exists megapay_webhook_events_reference_idx
  on public.megapay_webhook_events (reference);

create or replace function public.credit_megapay_deposit(
  p_deposit_id uuid,
  p_receipt text,
  p_amount_kes numeric,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deposits%rowtype;
  w public.wallets%rowtype;
  v_amount_kes numeric;
  v_rate numeric;
begin
  select * into d from public.deposits where id = p_deposit_id for update;
  if not found then
    raise exception 'deposit_not_found';
  end if;

  if d.status = 'COMPLETED' then
    return jsonb_build_object('status', 'COMPLETED', 'already', true, 'amount', d.amount);
  end if;

  -- An expired (timed-out) deposit can still be credited if MegaPay later confirms payment.
  if not (d.status in ('PENDING', 'PROCESSING')
          or (d.status = 'FAILED' and d.details->>'failure_kind' = 'expired')) then
    raise exception 'deposit_not_creditable: %', d.status;
  end if;

  if d.provider is distinct from 'megapay' or d.account_mode <> 'real' or d.is_simulated
     or d.provider_reference is null then
    raise exception 'deposit_not_megapay';
  end if;

  v_amount_kes := (d.details->>'amount_kes')::numeric;
  v_rate := (d.details->>'rate')::numeric;
  if v_amount_kes is null or p_amount_kes is null or v_amount_kes <> p_amount_kes then
    raise exception 'amount_mismatch';
  end if;
  if v_rate is null or v_rate <= 0 or round(v_amount_kes / v_rate, 2) <> d.amount or d.amount <= 0 then
    raise exception 'usd_amount_mismatch';
  end if;

  select * into w from public.wallets where id = d.wallet_id for update;
  if not found or w.user_id <> d.user_id or w.account_mode <> 'real' or w.is_simulated
     or w.currency <> d.currency then
    raise exception 'wallet_mismatch';
  end if;

  update public.wallets
     set balance = balance + d.amount,
         available_balance = available_balance + d.amount
   where id = w.id
  returning * into w;

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    d.user_id, d.account_id, 'real', w.id, 'deposit', d.amount,
    w.balance, w.available_balance, w.locked_balance, d.id::text,
    'M-Pesa deposit KES ' || v_amount_kes || coalesce(' receipt ' || nullif(p_receipt, ''), ''), false
  );

  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    d.user_id, d.account_id, 'real', w.id, 'deposit', d.amount, d.currency, 'COMPLETED',
    d.details->>'reference',
    'M-Pesa deposit KES ' || v_amount_kes || coalesce(' · ' || nullif(p_receipt, ''), ''), false
  );

  update public.deposits
     set status = 'COMPLETED',
         details = (details - 'failure_kind' - 'failure_reason')
                   || jsonb_build_object(
                        'mpesa_receipt', nullif(p_receipt, ''),
                        'completed_at', now(),
                        'confirmation', coalesce(p_raw, '{}'::jsonb))
   where id = d.id;

  return jsonb_build_object('status', 'COMPLETED', 'already', false, 'amount', d.amount, 'balance', w.balance);
end;
$$;

create or replace function public.fail_megapay_deposit(
  p_deposit_id uuid,
  p_status text,
  p_kind text,
  p_reason text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deposits%rowtype;
begin
  if p_status not in ('FAILED', 'CANCELLED') then
    raise exception 'invalid_status';
  end if;

  select * into d from public.deposits where id = p_deposit_id for update;
  if not found then
    raise exception 'deposit_not_found';
  end if;
  if d.provider is distinct from 'megapay' then
    raise exception 'deposit_not_megapay';
  end if;
  if d.status not in ('PENDING', 'PROCESSING') then
    return jsonb_build_object('status', d.status, 'changed', false);
  end if;

  update public.deposits
     set status = p_status,
         details = details || jsonb_build_object(
                     'failure_kind', p_kind,
                     'failure_reason', p_reason,
                     'failed_at', now(),
                     'failure_raw', coalesce(p_raw, '{}'::jsonb))
   where id = d.id;

  return jsonb_build_object('status', p_status, 'changed', true);
end;
$$;

revoke all on function public.credit_megapay_deposit(uuid, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.fail_megapay_deposit(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.credit_megapay_deposit(uuid, text, numeric, jsonb) to service_role;
grant execute on function public.fail_megapay_deposit(uuid, text, text, text, jsonb) to service_role;
