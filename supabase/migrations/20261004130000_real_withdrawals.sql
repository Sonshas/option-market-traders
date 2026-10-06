-- REAL withdrawals to M-Pesa (manual payout by an admin, or Daraja B2C). Additive only.
--
-- Money rules enforced here:
--  * request_real_withdrawal debits the REAL wallet immediately (hold) and creates a PENDING row;
--  * complete_withdrawal only records that money HAS been sent (M-Pesa receipt required) — no balance change;
--  * fail_withdrawal refunds the hold exactly once;
--  * clients can only SELECT their own rows. All writes go through SECURITY DEFINER functions (service_role).

alter table public.withdrawals
  add column if not exists amount_kes numeric,
  add column if not exists fee_kes numeric not null default 0,
  add column if not exists net_kes numeric,
  add column if not exists msisdn text,
  add column if not exists reference text,
  add column if not exists mpesa_receipt text,
  add column if not exists conversation_id text,
  add column if not exists originator_conversation_id text,
  add column if not exists result_code text,
  add column if not exists result_desc text,
  add column if not exists failure_reason text,
  add column if not exists processing_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists admin_user_id uuid,
  add column if not exists admin_note text,
  add column if not exists details jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'withdrawals_provider_check' and conrelid = 'public.withdrawals'::regclass) then
    alter table public.withdrawals
      add constraint withdrawals_provider_check check (provider is null or provider in ('manual', 'daraja_b2c'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'withdrawals_msisdn_check' and conrelid = 'public.withdrawals'::regclass) then
    alter table public.withdrawals
      add constraint withdrawals_msisdn_check check (msisdn is null or msisdn ~ '^254[17][0-9]{8}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'withdrawals_kes_check' and conrelid = 'public.withdrawals'::regclass) then
    alter table public.withdrawals
      add constraint withdrawals_kes_check check (
        fee_kes >= 0
        and (amount_kes is null or amount_kes > 0)
        and (net_kes is null or (net_kes > 0 and net_kes = amount_kes - fee_kes))
      );
  end if;
end $$;

create unique index if not exists withdrawals_reference_uniq
  on public.withdrawals (reference) where reference is not null;
create unique index if not exists withdrawals_mpesa_receipt_uniq
  on public.withdrawals (mpesa_receipt) where mpesa_receipt is not null;
create unique index if not exists withdrawals_conversation_id_uniq
  on public.withdrawals (conversation_id) where conversation_id is not null;
create unique index if not exists withdrawals_originator_conversation_id_uniq
  on public.withdrawals (originator_conversation_id) where originator_conversation_id is not null;
-- At most one open REAL withdrawal per user (also protects against concurrent requests).
create unique index if not exists withdrawals_one_open_per_user_uniq
  on public.withdrawals (user_id)
  where account_mode = 'real' and is_simulated = false and status in ('PENDING', 'PROCESSING');
create index if not exists withdrawals_open_idx
  on public.withdrawals (created_at)
  where account_mode = 'real' and status in ('PENDING', 'PROCESSING');

-- Ledger entry types for the hold / payout / refund lifecycle.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'wallet_ledger_entry_type_check' and conrelid = 'public.wallet_ledger'::regclass) then
    alter table public.wallet_ledger drop constraint wallet_ledger_entry_type_check;
  end if;
  alter table public.wallet_ledger
    add constraint wallet_ledger_entry_type_check check (
      entry_type in (
        'deposit', 'withdrawal', 'trade_stake', 'trade_payout', 'trade_refund', 'adjustment', 'bot_stake', 'copy_stake',
        'withdrawal_hold', 'withdrawal_paid', 'withdrawal_refund'
      )
    );
end $$;

-- One hold, at most one payout entry and at most one refund per withdrawal.
create unique index if not exists wallet_ledger_withdrawal_entry_uniq
  on public.wallet_ledger (reference_id, entry_type)
  where account_mode = 'real' and entry_type in ('withdrawal_hold', 'withdrawal_paid', 'withdrawal_refund') and reference_id is not null;

-- Clients never write withdrawals directly (the old self-insert policy allowed PENDING inserts).
revoke insert, update, delete, truncate, references, trigger on public.withdrawals from anon, authenticated;
drop policy if exists withdrawals_self_insert on public.withdrawals;
do $$
declare
  op text;
begin
  foreach op in array array['insert', 'update', 'delete'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'withdrawals' and policyname = 'withdrawals_block_client_' || op) then
      if op = 'insert' then
        execute format('create policy %I on public.withdrawals as restrictive for insert to anon, authenticated with check (false)', 'withdrawals_block_client_' || op);
      else
        execute format('create policy %I on public.withdrawals as restrictive for %s to anon, authenticated using (false)', 'withdrawals_block_client_' || op, op);
      end if;
    end if;
  end loop;
end $$;

-- Live status updates in the app (postgres_changes honours the owner-only SELECT policy).
alter table public.withdrawals replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'withdrawals') then
    alter publication supabase_realtime add table public.withdrawals;
  end if;
end $$;

-- Optional pause switch (defaults to enabled when the row is missing).
insert into public.feature_flags (key, value, label, note)
values ('REAL_WITHDRAWALS_ENABLED', true, 'REAL withdrawals', 'Set false to pause new M-Pesa withdrawal requests. Open requests can still be completed/refunded.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- request_real_withdrawal: hold the money and create the PENDING request. Called by the mpesa-withdraw Edge Function
-- (service role) after it authenticated the user; every rule is re-checked here under a wallet row lock.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.request_real_withdrawal(
  p_user_id uuid,
  p_amount_usd numeric,
  p_msisdn text,
  p_kes_per_usd numeric,
  p_fee_kes numeric,
  p_min_kes numeric,
  p_max_kes numeric,
  p_provider text,
  p_reference text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  wd public.withdrawals%rowtype;
  v_amount_kes numeric;
  v_fee_kes numeric;
  v_net_kes numeric;
  v_account_status text;
  v_local_phone text;
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if not coalesce((select value from public.feature_flags where key = 'REAL_WITHDRAWALS_ENABLED'), true) then
    raise exception 'withdrawals_paused';
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 or p_amount_usd <> round(p_amount_usd, 2) then
    raise exception 'invalid_amount';
  end if;
  if p_kes_per_usd is null or p_kes_per_usd <= 0 or p_fee_kes is null or p_fee_kes < 0 or p_min_kes is null or p_max_kes is null then
    raise exception 'invalid_config';
  end if;
  if p_msisdn is null or p_msisdn !~ '^254[17][0-9]{8}$' then
    raise exception 'invalid_phone';
  end if;
  if p_provider is null or p_provider not in ('manual', 'daraja_b2c') then
    raise exception 'invalid_provider';
  end if;
  if p_reference is null or p_reference !~ '^OMT-W-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception 'invalid_reference';
  end if;

  v_amount_kes := round(p_amount_usd * p_kes_per_usd);
  v_fee_kes := round(p_fee_kes);
  v_net_kes := v_amount_kes - v_fee_kes;
  if v_amount_kes < p_min_kes then
    raise exception 'below_minimum';
  end if;
  -- Owner rule: never more than KES 400,000 per request, whatever the caller passes.
  if v_amount_kes > least(p_max_kes, 400000) then
    raise exception 'above_maximum';
  end if;
  if v_net_kes <= 0 then
    raise exception 'amount_too_small';
  end if;

  select account_status into v_account_status from public.users where id = p_user_id;
  if v_account_status = 'suspended' then
    raise exception 'account_suspended';
  end if;

  -- Owner rule: at least one settled REAL trade (won or lost; ties/cancellations are refunds) before any payout.
  if not exists (
    select 1 from public.trades
     where user_id = p_user_id and account_mode = 'real' and is_simulated = false and status in ('won', 'lost')
  ) then
    raise exception 'no_real_trade';
  end if;

  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;

  if exists (
    select 1 from public.withdrawals
     where user_id = p_user_id and account_mode = 'real' and is_simulated = false and status in ('PENDING', 'PROCESSING')
  ) then
    raise exception 'withdrawal_already_open';
  end if;

  if w.available_balance < p_amount_usd then
    raise exception 'insufficient_funds';
  end if;

  update public.wallets
     set balance = balance - p_amount_usd,
         available_balance = available_balance - p_amount_usd
   where id = w.id
  returning * into w;

  v_local_phone := '0' || substr(p_msisdn, 4);

  begin
    insert into public.withdrawals (
      user_id, account_id, account_mode, wallet_id, amount, currency, destination, destination_details, status,
      provider, is_simulated, amount_kes, fee_kes, net_kes, msisdn, reference, originator_conversation_id, details
    ) values (
      p_user_id, w.account_id, 'real', w.id, p_amount_usd, w.currency, 'M-Pesa ' || v_local_phone,
      jsonb_build_object('method', 'mpesa', 'msisdn', p_msisdn), 'PENDING',
      p_provider, false, v_amount_kes, v_fee_kes, v_net_kes, p_msisdn, p_reference, p_reference,
      jsonb_build_object('rate', p_kes_per_usd, 'requested_at', now())
    )
    returning * into wd;
  exception
    when unique_violation then
      raise exception 'withdrawal_already_open';
  end;

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'withdrawal_hold', -p_amount_usd,
    w.balance, w.available_balance, w.locked_balance, wd.id::text,
    'M-Pesa withdrawal requested · KES ' || v_net_kes || ' to ' || v_local_phone || ' · ' || p_reference, false
  );

  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'withdrawal', -p_amount_usd, w.currency, 'PENDING', p_reference,
    'M-Pesa withdrawal · KES ' || v_net_kes || ' to ' || v_local_phone, false
  );

  return jsonb_build_object(
    'withdrawal_id', wd.id,
    'reference', wd.reference,
    'status', wd.status,
    'amount_usd', wd.amount,
    'amount_kes', wd.amount_kes,
    'fee_kes', wd.fee_kes,
    'net_kes', wd.net_kes,
    'msisdn', wd.msisdn,
    'provider', wd.provider,
    'created_at', wd.created_at,
    'balance', w.balance,
    'available_balance', w.available_balance
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- mark_withdrawal_processing: PENDING → PROCESSING (admin started the payout, or the B2C dispatcher is sending it).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.mark_withdrawal_processing(
  p_withdrawal_id uuid,
  p_admin_user_id uuid,
  p_note text,
  p_provider text,
  p_conversation_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  wd public.withdrawals%rowtype;
begin
  select * into wd from public.withdrawals where id = p_withdrawal_id for update;
  if not found then
    raise exception 'withdrawal_not_found';
  end if;
  if wd.account_mode <> 'real' or wd.is_simulated then
    raise exception 'withdrawal_not_real';
  end if;
  if wd.status = 'PROCESSING' then
    return jsonb_build_object('status', wd.status, 'already', true);
  end if;
  if wd.status <> 'PENDING' then
    raise exception 'withdrawal_not_open: %', wd.status;
  end if;
  if p_provider is not null and p_provider not in ('manual', 'daraja_b2c') then
    raise exception 'invalid_provider';
  end if;

  update public.withdrawals
     set status = 'PROCESSING',
         processing_at = now(),
         admin_user_id = coalesce(p_admin_user_id, admin_user_id),
         admin_note = coalesce(nullif(p_note, ''), admin_note),
         provider = coalesce(p_provider, provider),
         conversation_id = coalesce(nullif(p_conversation_id, ''), conversation_id)
   where id = wd.id;

  update public.transactions
     set status = 'PROCESSING'
   where account_mode = 'real' and type = 'withdrawal' and reference = wd.reference and status = 'PENDING';

  return jsonb_build_object('status', 'PROCESSING', 'already', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- complete_withdrawal: money HAS been sent (B2C result code 0 or admin-recorded manual payout). Receipt required.
-- Finalises the hold with a zero-amount 'withdrawal_paid' ledger entry; the balance does not change.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.complete_withdrawal(
  p_withdrawal_id uuid,
  p_receipt text,
  p_admin_user_id uuid,
  p_note text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  wd public.withdrawals%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_receipt text;
begin
  v_receipt := upper(trim(coalesce(p_receipt, '')));
  if v_receipt !~ '^[A-Z0-9-]{6,40}$' then
    raise exception 'receipt_required';
  end if;

  select wallet_id into v_wallet_id from public.withdrawals where id = p_withdrawal_id;
  if not found then
    raise exception 'withdrawal_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into wd from public.withdrawals where id = p_withdrawal_id for update;

  if wd.account_mode <> 'real' or wd.is_simulated or w.user_id <> wd.user_id then
    raise exception 'withdrawal_not_real';
  end if;
  if wd.status not in ('PENDING', 'PROCESSING') then
    raise exception 'withdrawal_not_open: %', wd.status;
  end if;
  if exists (select 1 from public.withdrawals where mpesa_receipt = v_receipt and id <> wd.id) then
    raise exception 'receipt_already_used';
  end if;

  update public.withdrawals
     set status = 'COMPLETED',
         mpesa_receipt = v_receipt,
         completed_at = now(),
         processing_at = coalesce(processing_at, now()),
         admin_user_id = coalesce(p_admin_user_id, admin_user_id),
         admin_note = coalesce(nullif(p_note, ''), admin_note),
         result_code = coalesce(nullif(p_raw->>'result_code', ''), result_code),
         result_desc = coalesce(nullif(p_raw->>'result_desc', ''), result_desc),
         failure_reason = null,
         details = details || jsonb_build_object('completed_raw', coalesce(p_raw, '{}'::jsonb))
   where id = wd.id;

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    wd.user_id, wd.account_id, 'real', w.id, 'withdrawal_paid', 0,
    w.balance, w.available_balance, w.locked_balance, wd.id::text,
    'M-Pesa withdrawal paid · KES ' || wd.net_kes || ' · receipt ' || v_receipt, false
  );

  update public.transactions
     set status = 'COMPLETED',
         note = coalesce(note, '') || ' · receipt ' || v_receipt
   where account_mode = 'real' and type = 'withdrawal' and reference = wd.reference and status in ('PENDING', 'PROCESSING');

  return jsonb_build_object('status', 'COMPLETED', 'already', false, 'receipt', v_receipt, 'net_kes', wd.net_kes);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- fail_withdrawal: payout did not happen (B2C non-zero result / timeout, or admin decision). Refunds the hold once.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.fail_withdrawal(
  p_withdrawal_id uuid,
  p_reason text,
  p_admin_user_id uuid,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  wd public.withdrawals%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_reason text;
begin
  v_reason := left(trim(coalesce(p_reason, '')), 300);
  if v_reason = '' then
    raise exception 'reason_required';
  end if;

  select wallet_id into v_wallet_id from public.withdrawals where id = p_withdrawal_id;
  if not found then
    raise exception 'withdrawal_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into wd from public.withdrawals where id = p_withdrawal_id for update;

  if wd.account_mode <> 'real' or wd.is_simulated or w.user_id <> wd.user_id then
    raise exception 'withdrawal_not_real';
  end if;
  if wd.status not in ('PENDING', 'PROCESSING') then
    raise exception 'withdrawal_not_open: %', wd.status;
  end if;

  update public.wallets
     set balance = balance + wd.amount,
         available_balance = available_balance + wd.amount
   where id = w.id
  returning * into w;

  update public.withdrawals
     set status = 'FAILED',
         failure_reason = v_reason,
         failed_at = now(),
         admin_user_id = coalesce(p_admin_user_id, admin_user_id),
         result_code = coalesce(nullif(p_raw->>'result_code', ''), result_code),
         result_desc = coalesce(nullif(p_raw->>'result_desc', ''), result_desc),
         details = details || jsonb_build_object('failure_raw', coalesce(p_raw, '{}'::jsonb), 'refunded_at', now())
   where id = wd.id;

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    wd.user_id, wd.account_id, 'real', w.id, 'withdrawal_refund', wd.amount,
    w.balance, w.available_balance, w.locked_balance, wd.id::text,
    'M-Pesa withdrawal refunded · ' || v_reason, false
  );

  update public.transactions
     set status = 'FAILED',
         note = coalesce(note, '') || ' · refunded: ' || v_reason
   where account_mode = 'real' and type = 'withdrawal' and reference = wd.reference and status in ('PENDING', 'PROCESSING');

  return jsonb_build_object('status', 'FAILED', 'already', false, 'refunded', wd.amount, 'balance', w.balance);
end;
$$;

revoke all on function public.request_real_withdrawal(uuid, numeric, text, numeric, numeric, numeric, numeric, text, text) from public, anon, authenticated;
revoke all on function public.mark_withdrawal_processing(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_withdrawal(uuid, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_withdrawal(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.request_real_withdrawal(uuid, numeric, text, numeric, numeric, numeric, numeric, text, text) to service_role;
grant execute on function public.mark_withdrawal_processing(uuid, uuid, text, text, text) to service_role;
grant execute on function public.complete_withdrawal(uuid, text, uuid, text, jsonb) to service_role;
grant execute on function public.fail_withdrawal(uuid, text, uuid, jsonb) to service_role;

-- Daraja B2C dispatcher (no-op unless WITHDRAWAL_MODE=daraja_b2c and the B2C secrets are set). Same Vault secret
-- as the other sweeps. Rows stay PENDING for manual payout when B2C is not configured.
select cron.schedule(
  'mpesa-withdraw-dispatch',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://wkfyavcjjuyzvyeprklz.supabase.co/functions/v1/mpesa-withdraw-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sweep-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'real_trade_sweep_secret')
    ),
    body := '{"mode":"dispatch"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
