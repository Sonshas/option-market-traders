-- Safaricom Daraja (M-Pesa Express / STK Push) REAL deposits on our own Paybill. Additive only.
-- deposits.provider = 'daraja'; provider_reference = checkout_request_id = Daraja CheckoutRequestID;
-- details->>'reference' = our OMT-XXXXXXXX (sent as AccountReference).
-- Crediting reuses credit_megapay_deposit / fail_megapay_deposit, now accepting provider 'daraja' as well.

alter table public.deposits
  add column if not exists merchant_request_id text,
  add column if not exists checkout_request_id text,
  add column if not exists mpesa_receipt text,
  add column if not exists result_code text,
  add column if not exists result_desc text,
  add column if not exists callback_amount_kes numeric,
  add column if not exists callback_at timestamptz,
  add column if not exists last_query_at timestamptz;

create unique index if not exists deposits_checkout_request_id_uniq
  on public.deposits (checkout_request_id)
  where checkout_request_id is not null;

create unique index if not exists deposits_mpesa_receipt_uniq
  on public.deposits (mpesa_receipt)
  where mpesa_receipt is not null;

create unique index if not exists deposits_daraja_reference_uniq
  on public.deposits ((details->>'reference'))
  where provider = 'daraja';

create index if not exists deposits_daraja_open_idx
  on public.deposits (created_at)
  where provider = 'daraja' and status in ('PENDING', 'PROCESSING');

-- Daraja rows and the M-Pesa result columns may only be written by the Edge Functions (service role).
create policy deposits_block_client_daraja on public.deposits
  as restrictive
  for insert
  to authenticated
  with check (
    provider is distinct from 'daraja'
    and merchant_request_id is null
    and checkout_request_id is null
    and mpesa_receipt is null
    and result_code is null
    and result_desc is null
    and callback_amount_kes is null
    and callback_at is null
    and last_query_at is null
  );

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

  -- An expired (timed-out) deposit can still be credited if the provider later confirms payment.
  if not (d.status in ('PENDING', 'PROCESSING')
          or (d.status = 'FAILED' and d.details->>'failure_kind' = 'expired')) then
    raise exception 'deposit_not_creditable: %', d.status;
  end if;

  if d.provider is null or d.provider not in ('megapay', 'daraja') or d.account_mode <> 'real' or d.is_simulated
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
         mpesa_receipt = coalesce(nullif(p_receipt, ''), mpesa_receipt),
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
  if d.provider is null or d.provider not in ('megapay', 'daraja') then
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

-- Settle Daraja deposits whose callback never arrived: mpesa-status (sweep mode) STK-queries open deposits
-- older than 2 minutes and expires them after 10. Authenticated with the existing sweep secret from Vault.
select cron.schedule(
  'mpesa-deposit-sweep',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://wkfyavcjjuyzvyeprklz.supabase.co/functions/v1/mpesa-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sweep-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'real_trade_sweep_secret')
    ),
    body := '{"mode":"sweep"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
