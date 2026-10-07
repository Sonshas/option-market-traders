-- =============================================================================
-- Smart Base Binary — consolidated host Supabase schema (incremental migrations)
-- =============================================================================
-- FOR FRESH SUPABASE INSTALLS ONLY. Replaces the 16 incremental migrations below.
-- Do not run on a database that already applied those files individually.
--
-- Source files merged (chronological):
--   - 20260920111952_align_markets_catalog_with_app.sql
--   - 20261003000000_megapay_deposits.sql
--   - 20261003120000_real_trading_engine.sql
--   - 20261003120100_real_trading_settlement_cron.sql
--   - 20261003170000_real_trading_payout_model.sql
--   - 20261003200000_real_trading_tick_duration.sql
--   - 20261004090000_daraja_deposits.sql
--   - 20261004130000_real_withdrawals.sql
--   - 20261005160000_payout_fee_stk_requests.sql
--   - 20261005170000_account_win_rate_90.sql
--   - 20261005180000_payment_settings.sql
--   - 20261005190000_place_real_trade_stake_bounds.sql
--   - 20261005200000_natural_contract_settlement.sql
--   - 20261005210000_system_issues.sql
--   - 20261007120000_flat_digit_payout_rate.sql
--   - 20261007150000_superadmin_panel.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- from: 20260920111952_align_markets_catalog_with_app.sql
-- ---------------------------------------------------------------------------

-- Smart Base Binary (wkfyavcjjuyzvyeprklz)
-- Migration: align_markets_catalog_with_app
-- Additive only. Does not enable REAL trading execution.

ALTER TABLE public.markets DROP CONSTRAINT IF EXISTS markets_category_check;
ALTER TABLE public.markets
  ADD CONSTRAINT markets_category_check
  CHECK (category = ANY (ARRAY['synthetic'::text, 'forex'::text, 'crypto'::text]));

ALTER TABLE public.markets DROP CONSTRAINT IF EXISTS markets_price_status_check;
ALTER TABLE public.markets
  ADD CONSTRAINT markets_price_status_check
  CHECK (price_status = ANY (ARRAY[
    'disconnected'::text,
    'connecting'::text,
    'live'::text,
    'simulated'::text,
    'reconnecting'::text,
    'error'::text
  ]));

INSERT INTO public.markets AS m (
  symbol, display_name, category, contract_kinds, durations_ms,
  last_price, price_status, feed_label, is_simulated, is_active
)
VALUES
  ('BTCUSDT', 'Bitcoin / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('ETHUSDT', 'Ethereum / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('BNBUSDT', 'BNB / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('SOLUSDT', 'Solana / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('XRPUSDT', 'XRP / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('ADAUSDT', 'Cardano / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('DOGEUSDT', 'Dogecoin / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('AVAXUSDT', 'Avalanche / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true)
ON CONFLICT (symbol) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  contract_kinds = EXCLUDED.contract_kinds,
  durations_ms = EXCLUDED.durations_ms,
  feed_label = EXCLUDED.feed_label,
  is_simulated = EXCLUDED.is_simulated,
  is_active = EXCLUDED.is_active,
  updated_at = now();

UPDATE public.feature_flags
SET value = false,
    note = 'REAL order execution remains disabled until a verified settlement stack is approved.',
    updated_at = now()
WHERE key = 'REAL_TRADING_ENABLED';

UPDATE public.feature_flags
SET value = false,
    note = 'REAL payments remain disabled until a payment provider is configured.',
    updated_at = now()
WHERE key = 'REAL_PAYMENTS_ENABLED';

INSERT INTO public.feature_flags (key, value, label, note)
VALUES (
  'REAL_MARKET_CATALOG_SYNCED',
  true,
  'Binance catalog mirrored',
  'Catalog symbols only — not live prices and not trade execution.'
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  label = EXCLUDED.label,
  note = EXCLUDED.note,
  updated_at = now();


-- ---------------------------------------------------------------------------
-- from: 20261003000000_megapay_deposits.sql
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- from: 20261003120000_real_trading_engine.sql
-- ---------------------------------------------------------------------------

-- REAL digit-options trading (house model). Additive only.
-- Accounting (same lock model as DEMO): placing a trade moves the stake from available_balance to
-- locked_balance (balance unchanged). Settlement releases the lock and credits the payout to
-- available_balance, so balance changes by payout − stake. wallet_ledger.amount = change in available_balance.

alter table public.trades
  add column if not exists entry_epoch bigint,
  add column if not exists entry_pip_size numeric,
  add column if not exists exit_epoch bigint,
  add column if not exists exit_digit smallint,
  add column if not exists details jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trades_exit_digit_check' and conrelid = 'public.trades'::regclass) then
    alter table public.trades
      add constraint trades_exit_digit_check check (exit_digit is null or (exit_digit >= 0 and exit_digit <= 9));
  end if;
end $$;

alter table public.trade_settlements
  add column if not exists details jsonb not null default '{}'::jsonb;

-- Deriv 1-second indices offered by the REAL ticket (trades.symbol references markets).
insert into public.markets (symbol, display_name, category, contract_kinds, durations_ms, price_status, feed_label, is_simulated, is_active)
values
  ('1HZ10V', 'Volatility 10 (1s) Index', 'synthetic', array['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], array[15000,30000,60000,120000,300000], 'disconnected', 'deriv_public', false, true),
  ('1HZ25V', 'Volatility 25 (1s) Index', 'synthetic', array['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], array[15000,30000,60000,120000,300000], 'disconnected', 'deriv_public', false, true),
  ('1HZ50V', 'Volatility 50 (1s) Index', 'synthetic', array['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], array[15000,30000,60000,120000,300000], 'disconnected', 'deriv_public', false, true),
  ('1HZ75V', 'Volatility 75 (1s) Index', 'synthetic', array['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], array[15000,30000,60000,120000,300000], 'disconnected', 'deriv_public', false, true),
  ('1HZ100V', 'Volatility 100 (1s) Index', 'synthetic', array['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], array[15000,30000,60000,120000,300000], 'disconnected', 'deriv_public', false, true)
on conflict (symbol) do nothing;

-- Money tables are written only by SECURITY DEFINER functions / the service role.
revoke insert, update, delete, truncate, references, trigger
  on public.trades, public.wallets, public.wallet_ledger, public.transactions, public.trade_settlements
  from anon, authenticated;

do $$
declare
  t text;
  op text;
begin
  foreach t in array array['trades', 'wallets', 'wallet_ledger', 'transactions', 'trade_settlements'] loop
    foreach op in array array['insert', 'update', 'delete'] loop
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_block_client_' || op) then
        if op = 'insert' then
          execute format('create policy %I on public.%I as restrictive for insert to anon, authenticated with check (false)', t || '_block_client_' || op, t);
        else
          execute format('create policy %I on public.%I as restrictive for %s to anon, authenticated using (false)', t || '_block_client_' || op, t, op);
        end if;
      end if;
    end loop;
  end loop;
end $$;

-- One stake entry and at most one payout/refund entry per REAL trade.
create unique index if not exists wallet_ledger_real_trade_entry_uniq
  on public.wallet_ledger (reference_id, entry_type)
  where account_mode = 'real' and entry_type in ('trade_stake', 'trade_payout', 'trade_refund') and reference_id is not null;

create unique index if not exists trades_user_idempotency_idx
  on public.trades (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists trades_real_open_idx
  on public.trades (user_id)
  where account_mode = 'real' and status = 'open';

create or replace function public.place_real_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ms integer,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_expires timestamptz;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;

  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;

  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;

  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  if p_stake is null or p_stake < 1 or p_stake > 500 or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ms is null or p_duration_ms not in (15000, 30000, 60000, 120000, 300000) then
    raise exception 'invalid_duration';
  end if;
  if p_payout_rate is null or p_payout_rate <= 0 or p_payout_rate > 1 then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;

  -- The expiry must be safely in the future so nobody can trade on an already-known exit tick.
  v_entry := to_timestamp(p_entry_epoch);
  v_expires := v_entry + make_interval(secs => p_duration_ms / 1000.0);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds'
     or v_expires <= now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;

  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;

  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= 5 then
    raise exception 'too_many_open_trades';
  end if;

  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;

  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, payout_rate, status, entry_price, expires_at,
    idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ms, p_payout_rate, 'open', p_entry_price, v_expires,
    p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object('entry_source', 'deriv_ticks_history', 'placed_at', now())
  )
  returning * into t;

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );

  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'REAL trade stake · ' || p_symbol, false
  );

  return jsonb_build_object('already', false, 'trade_id', t.id);
end;
$$;

create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;

  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;

  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);
  if v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;

  -- Cross-check the Edge Function: digit from price + pip size, and the contract rule.
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;
  v_outcome := case t.contract_type
    when 'EVEN_ODD' then
      case when (v_digit % 2 = 0) = (t.contract_option = 'even') then 'won' else 'lost' end
    when 'MATCH_DIFFER' then
      case when (v_digit = t.selected_digit) = (t.contract_option = 'match') then 'won' else 'lost' end
    else
      case when v_digit = t.barrier then 'tie'
           when (v_digit > t.barrier) = (t.contract_option = 'over') then 'won'
           else 'lost' end
  end;
  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;

  v_payout := case v_outcome
    when 'won' then round(t.stake * (1 + t.payout_rate), 2)
    when 'tie' then t.stake
    else 0
  end;
  v_pl := v_payout - t.stake;

  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;

  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object('exit_pip_size', p_pip_size, 'settled_at', now())
   where id = t.id;

  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' when 'lost' then 'loss' else 'tie' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id,
    case v_outcome when 'tie' then 'trade_refund' else 'trade_payout' end,
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL trade ' || v_outcome || ' on digit ' || v_digit, false
  );

  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id,
      case v_outcome when 'tie' then 'trade_refund' else 'trade_payout' end,
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'REAL trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;

  return jsonb_build_object('already', false, 'status', v_outcome, 'payout', v_payout, 'profit_loss', v_pl, 'digit', v_digit);
end;
$$;

create or replace function public.refund_real_trade(
  p_trade_id uuid,
  p_reason text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;

  if t.account_mode <> 'real' or t.is_simulated or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if now() < t.expires_at + interval '10 minutes' then
    raise exception 'refund_too_early';
  end if;

  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + t.stake
   where id = w.id
  returning * into w;

  update public.trades
     set status = 'cancelled',
         payout = t.stake,
         profit_loss = 0,
         resolved_at = now(),
         details = details || jsonb_build_object('refund_reason', p_reason, 'refunded_at', now())
   where id = t.id;

  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id, 'tie', null, t.stake, 0, null, false,
    jsonb_build_object('refund', true, 'reason', p_reason) || coalesce(p_raw, '{}'::jsonb)
  );

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_refund', t.stake,
    w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL stake refunded · ' || coalesce(p_reason, 'no exit tick'), false
  );

  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_refund', t.stake, w.currency, 'COMPLETED', t.id::text,
    'REAL stake refunded · no exit tick', false
  );

  return jsonb_build_object('already', false, 'status', 'cancelled', 'payout', t.stake);
end;
$$;

-- Shared secret for the pg_cron sweep → real-trade-settle call. Lives only in Vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'real_trade_sweep_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'real_trade_sweep_secret',
      'Header x-sweep-secret for the real-trade-settle sweep (pg_cron).'
    );
  end if;
end $$;

create or replace function public.verify_real_trade_sweep_secret(p_secret text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(p_secret) >= 32, false) and exists (
    select 1 from vault.decrypted_secrets where name = 'real_trade_sweep_secret' and decrypted_secret = p_secret
  );
$$;

revoke all on function public.place_real_trade(uuid, text, text, text, smallint, smallint, numeric, integer, numeric, numeric, bigint, numeric, text) from public, anon, authenticated;
revoke all on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) from public, anon, authenticated;
revoke all on function public.refund_real_trade(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.verify_real_trade_sweep_secret(text) from public, anon, authenticated;
grant execute on function public.place_real_trade(uuid, text, text, text, smallint, smallint, numeric, integer, numeric, numeric, bigint, numeric, text) to service_role;
grant execute on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) to service_role;
grant execute on function public.refund_real_trade(uuid, text, jsonb) to service_role;
grant execute on function public.verify_real_trade_sweep_secret(text) to service_role;


-- ---------------------------------------------------------------------------
-- from: 20261003120100_real_trading_settlement_cron.sql
-- ---------------------------------------------------------------------------

-- Settle expired REAL trades every minute even when nobody has the site open.
-- The x-sweep-secret value is read from Vault at run time; it never appears in cron.job.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'real-trade-settle-sweep',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://wkfyavcjjuyzvyeprklz.supabase.co/functions/v1/real-trade-settle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sweep-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'real_trade_sweep_secret')
    ),
    body := '{"mode":"sweep"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);


-- ---------------------------------------------------------------------------
-- from: 20261003170000_real_trading_payout_model.sql
-- ---------------------------------------------------------------------------

-- Probability-based payouts (5% house margin), barrier digit loses on OVER/UNDER, daily REAL winnings limit.
-- Additive: new settings table + functions; place_real_trade / settle_real_trade are replaced in place
-- (same signatures). No data is modified.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table if not exists public.trading_settings (
  key text primary key,
  value numeric not null,
  description text,
  updated_at timestamptz not null default now()
);

alter table public.trading_settings enable row level security;
revoke insert, update, delete, truncate, references, trigger on public.trading_settings from anon, authenticated;
grant select on public.trading_settings to authenticated;

drop policy if exists trading_settings_read on public.trading_settings;
create policy trading_settings_read on public.trading_settings
  for select to authenticated using (true);

insert into public.trading_settings (key, value, description) values
  ('REAL_DAILY_PROFIT_LIMIT_USD', 1000,
   'REAL trading pauses for a user once their net settled REAL profit_loss since Africa/Nairobi midnight reaches this amount.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Payout rate: mirror of digitPayoutRate() in supabase/functions/_shared/digit-contracts.ts
-- n = winning digits out of 10; rate = floor((95 - 10n) * 1000 / n) / 10000; n = 0 -> 0. NULL = invalid selection.
-- ---------------------------------------------------------------------------
create or replace function public.real_digit_payout_rate(
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint
) returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer;
begin
  if p_contract_type = 'EVEN_ODD' and p_contract_option in ('even', 'odd') then
    n := 5;
  elsif p_contract_type = 'MATCH_DIFFER' and p_contract_option in ('match', 'differ')
        and p_selected_digit between 0 and 9 then
    n := case p_contract_option when 'match' then 1 else 9 end;
  elsif p_contract_type = 'OVER_UNDER' and p_contract_option in ('over', 'under')
        and p_barrier between 0 and 9 then
    n := case p_contract_option when 'over' then 9 - p_barrier else p_barrier end;
  else
    return null;
  end if;
  if n <= 0 then
    return 0;
  end if;
  return floor(((95 - 10 * n) * 1000)::numeric / n) / 10000;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily limit status (Africa/Nairobi day)
-- ---------------------------------------------------------------------------
create or replace function public.real_trade_daily_status(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz;
  v_limit numeric;
  v_net numeric;
begin
  v_day_start := date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
  select value into v_limit from public.trading_settings where key = 'REAL_DAILY_PROFIT_LIMIT_USD';
  select coalesce(sum(profit_loss), 0) into v_net
    from public.trade_settlements
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false and created_at >= v_day_start;
  return jsonb_build_object(
    'net_profit', v_net,
    'limit', v_limit,
    'reached', v_limit is not null and v_net >= v_limit,
    'day_start', v_day_start
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- place_real_trade: payout rate must equal the server formula; daily limit enforced.
-- ---------------------------------------------------------------------------
create or replace function public.place_real_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ms integer,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_expires timestamptz;
  v_rate numeric;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;

  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;

  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;

  if (public.real_trade_daily_status(p_user_id) ->> 'reached')::boolean then
    raise exception 'daily_limit_reached';
  end if;

  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  if p_stake is null or p_stake < 1 or p_stake > 500 or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ms is null or p_duration_ms not in (15000, 30000, 60000, 120000, 300000) then
    raise exception 'invalid_duration';
  end if;
  v_rate := public.real_digit_payout_rate(p_contract_type, p_contract_option, p_selected_digit, p_barrier);
  if v_rate is null then
    raise exception 'invalid_contract';
  end if;
  if p_payout_rate is null or p_payout_rate <> v_rate then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;

  -- The expiry must be safely in the future so nobody can trade on an already-known exit tick.
  v_entry := to_timestamp(p_entry_epoch);
  v_expires := v_entry + make_interval(secs => p_duration_ms / 1000.0);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds'
     or v_expires <= now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;

  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;

  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= 5 then
    raise exception 'too_many_open_trades';
  end if;

  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;

  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, payout_rate, status, entry_price, expires_at,
    idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ms, v_rate, 'open', p_entry_price, v_expires,
    p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object('entry_source', 'deriv_ticks_history', 'placed_at', now(), 'payout_model', 'p_win_margin_5pct')
  )
  returning * into t;

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );

  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'REAL trade stake · ' || p_symbol, false
  );

  return jsonb_build_object('already', false, 'trade_id', t.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- settle_real_trade: barrier digit loses; win payout rounded down to the cent.
-- ---------------------------------------------------------------------------
create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;

  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;

  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);
  if v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;

  -- Cross-check the Edge Function: digit from price + pip size, and the contract rule.
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;
  v_outcome := case t.contract_type
    when 'EVEN_ODD' then
      case when (v_digit % 2 = 0) = (t.contract_option = 'even') then 'won' else 'lost' end
    when 'MATCH_DIFFER' then
      case when (v_digit = t.selected_digit) = (t.contract_option = 'match') then 'won' else 'lost' end
    else
      case when t.contract_option = 'over' and v_digit > t.barrier then 'won'
           when t.contract_option = 'under' and v_digit < t.barrier then 'won'
           else 'lost' end
  end;
  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;

  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;

  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;

  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object('exit_pip_size', p_pip_size, 'settled_at', now())
   where id = t.id;

  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL trade ' || v_outcome || ' on digit ' || v_digit, false
  );

  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'REAL trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;

  return jsonb_build_object('already', false, 'status', v_outcome, 'payout', v_payout, 'profit_loss', v_pl, 'digit', v_digit);
end;
$$;

revoke all on function public.real_digit_payout_rate(text, text, smallint, smallint) from public, anon, authenticated;
revoke all on function public.real_trade_daily_status(uuid) from public, anon, authenticated;
revoke all on function public.place_real_trade(uuid, text, text, text, smallint, smallint, numeric, integer, numeric, numeric, bigint, numeric, text) from public, anon, authenticated;
revoke all on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) from public, anon, authenticated;
grant execute on function public.real_digit_payout_rate(text, text, smallint, smallint) to service_role;
grant execute on function public.real_trade_daily_status(uuid) to service_role;
grant execute on function public.place_real_trade(uuid, text, text, text, smallint, smallint, numeric, integer, numeric, numeric, bigint, numeric, text) to service_role;
grant execute on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- from: 20261003200000_real_trading_tick_duration.sql
-- ---------------------------------------------------------------------------

-- Tick-duration REAL contracts (1–10 ticks). Additive: two nullable columns, a new place_real_tick_trade,
-- and settle_real_trade / refund_real_trade replaced in place (same signatures). The seconds path
-- (place_real_trade + expiry-window settlement) is unchanged for existing trades and old clients.
--
-- Settlement rule: the anchor is max(entry tick epoch, placement second). The exit is the Nth distinct
-- Deriv tick with epoch strictly greater than the anchor. If it is not available within 10 minutes of the
-- anchor, the stake is refunded.

alter table public.trades add column if not exists duration_ticks smallint;
alter table public.trades add column if not exists tick_anchor_epoch bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trades_duration_ticks_chk') then
    alter table public.trades add constraint trades_duration_ticks_chk check (
      duration_ticks is null or (duration_ticks between 1 and 10 and tick_anchor_epoch is not null)
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- place_real_tick_trade: same checks as place_real_trade, with a tick count instead of milliseconds.
-- ---------------------------------------------------------------------------
create or replace function public.place_real_tick_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ticks smallint,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_anchor bigint;
  v_cadence integer;
  v_expires timestamptz;
  v_rate numeric;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;

  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;

  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;

  if (public.real_trade_daily_status(p_user_id) ->> 'reached')::boolean then
    raise exception 'daily_limit_reached';
  end if;

  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  if p_stake is null or p_stake < 1 or p_stake > 500 or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ticks is null or p_duration_ticks < 1 or p_duration_ticks > 10 then
    raise exception 'invalid_duration';
  end if;
  v_rate := public.real_digit_payout_rate(p_contract_type, p_contract_option, p_selected_digit, p_barrier);
  if v_rate is null then
    raise exception 'invalid_contract';
  end if;
  if p_payout_rate is null or p_payout_rate <> v_rate then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;

  v_entry := to_timestamp(p_entry_epoch);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;

  -- Only ticks after the later of the entry tick and the placement second count, so a stale entry
  -- quote can never select a tick that was already published when the trade was placed.
  v_anchor := greatest(p_entry_epoch, floor(extract(epoch from now()))::bigint);
  v_cadence := case when p_symbol like '1HZ%' then 1 else 2 end;
  v_expires := to_timestamp(v_anchor + p_duration_ticks * v_cadence);

  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;

  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= 5 then
    raise exception 'too_many_open_trades';
  end if;

  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;

  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, duration_ticks, tick_anchor_epoch, payout_rate, status,
    entry_price, expires_at, idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ticks * v_cadence * 1000, p_duration_ticks, v_anchor, v_rate, 'open',
    p_entry_price, v_expires, p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object(
      'entry_source', 'deriv_ticks_history', 'placed_at', now(), 'payout_model', 'p_win_margin_5pct',
      'duration_unit', 'ticks', 'expires_at_is_estimate', true
    )
  )
  returning * into t;

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );

  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'REAL trade stake · ' || p_symbol, false
  );

  return jsonb_build_object('already', false, 'trade_id', t.id, 'tick_anchor_epoch', v_anchor);
end;
$$;

-- ---------------------------------------------------------------------------
-- settle_real_trade: adds the tick branch; the seconds branch is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
  v_epochs jsonb;
  v_prev bigint;
  v_cur bigint;
  i integer;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;

  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;

  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);

  if t.duration_ticks is not null then
    -- Exit must be the Nth distinct tick after the anchor: N strictly increasing epochs, all after
    -- the anchor, the last one being the exit tick.
    if p_exit_epoch < t.tick_anchor_epoch + t.duration_ticks
       or p_exit_epoch > t.tick_anchor_epoch + 600
       or v_exit > now() + interval '5 seconds' then
      raise exception 'exit_tick_outside_window';
    end if;
    v_epochs := p_raw -> 'tick_epochs';
    if v_epochs is null or jsonb_typeof(v_epochs) <> 'array' or jsonb_array_length(v_epochs) <> t.duration_ticks then
      raise exception 'invalid_tick_sequence';
    end if;
    v_prev := t.tick_anchor_epoch;
    for i in 0 .. t.duration_ticks - 1 loop
      v_cur := (v_epochs ->> i)::bigint;
      if v_cur is null or v_cur <= v_prev then
        raise exception 'invalid_tick_sequence';
      end if;
      v_prev := v_cur;
    end loop;
    if v_prev <> p_exit_epoch then
      raise exception 'invalid_tick_sequence';
    end if;
  elsif v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;

  -- Cross-check the Edge Function: digit from price + pip size, and the contract rule.
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;
  v_outcome := case t.contract_type
    when 'EVEN_ODD' then
      case when (v_digit % 2 = 0) = (t.contract_option = 'even') then 'won' else 'lost' end
    when 'MATCH_DIFFER' then
      case when (v_digit = t.selected_digit) = (t.contract_option = 'match') then 'won' else 'lost' end
    else
      case when t.contract_option = 'over' and v_digit > t.barrier then 'won'
           when t.contract_option = 'under' and v_digit < t.barrier then 'won'
           else 'lost' end
  end;
  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;

  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;

  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;

  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object('exit_pip_size', p_pip_size, 'settled_at', now())
   where id = t.id;

  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL trade ' || v_outcome || ' on digit ' || v_digit, false
  );

  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'REAL trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;

  return jsonb_build_object('already', false, 'status', v_outcome, 'payout', v_payout, 'profit_loss', v_pl, 'digit', v_digit);
end;
$$;

-- ---------------------------------------------------------------------------
-- refund_real_trade: tick trades may be refunded 10 minutes after their anchor.
-- ---------------------------------------------------------------------------
create or replace function public.refund_real_trade(p_trade_id uuid, p_reason text, p_raw jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;

  if t.account_mode <> 'real' or t.is_simulated or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if now() < (case when t.duration_ticks is not null then to_timestamp(t.tick_anchor_epoch) else t.expires_at end)
             + interval '10 minutes' then
    raise exception 'refund_too_early';
  end if;

  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + t.stake
   where id = w.id
  returning * into w;

  update public.trades
     set status = 'cancelled',
         payout = t.stake,
         profit_loss = 0,
         resolved_at = now(),
         details = details || jsonb_build_object('refund_reason', p_reason, 'refunded_at', now())
   where id = t.id;

  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id, 'tie', null, t.stake, 0, null, false,
    jsonb_build_object('refund', true, 'reason', p_reason) || coalesce(p_raw, '{}'::jsonb)
  );

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_refund', t.stake,
    w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL stake refunded · ' || coalesce(p_reason, 'no exit tick'), false
  );

  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_refund', t.stake, w.currency, 'COMPLETED', t.id::text,
    'REAL stake refunded · no exit tick', false
  );

  return jsonb_build_object('already', false, 'status', 'cancelled', 'payout', t.stake);
end;
$$;

revoke all on function public.place_real_tick_trade(uuid, text, text, text, smallint, smallint, numeric, smallint, numeric, numeric, bigint, numeric, text) from public, anon, authenticated;
revoke all on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) from public, anon, authenticated;
revoke all on function public.refund_real_trade(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.place_real_tick_trade(uuid, text, text, text, smallint, smallint, numeric, smallint, numeric, numeric, bigint, numeric, text) to service_role;
grant execute on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) to service_role;
grant execute on function public.refund_real_trade(uuid, text, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- from: 20261004090000_daraja_deposits.sql
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- from: 20261004130000_real_withdrawals.sql
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- from: 20261005160000_payout_fee_stk_requests.sql
-- ---------------------------------------------------------------------------

-- Host-site tracking for payout-desk fee STK prompts.
-- The fee wallet lives in the SEPARATE payout Supabase project (see supabase/payout-desk/).
-- This table only records Daraja checkout ids so the callback can call settle_service_fee.

create table if not exists public.payout_fee_stk_requests (
  id uuid primary key default gen_random_uuid(),
  fee_ref text not null,
  kind text not null check (kind in ('tax_compliance', 'ai_bot')),
  amount_kes integer not null check (amount_kes > 0),
  phone_masked text not null default '',
  payout_user_id uuid,
  checkout_request_id text unique,
  merchant_request_id text,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'COMPLETED', 'FAILED', 'SETTLE_ERROR')),
  mpesa_receipt text,
  result_code text,
  result_desc text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists payout_fee_stk_requests_ref
  on public.payout_fee_stk_requests (fee_ref, created_at desc);

alter table public.payout_fee_stk_requests enable row level security;

-- No anon/authenticated policies: only service_role (Edge Functions) may touch these rows.
revoke all on public.payout_fee_stk_requests from public, anon, authenticated;
grant all on public.payout_fee_stk_requests to service_role;


-- ---------------------------------------------------------------------------
-- from: 20261005170000_account_win_rate_90.sql
-- ---------------------------------------------------------------------------

-- Account win rate 90% for every trade type (DEMO/REAL share the same JS policy in domain/outcome/).
-- Exit digit 0–8 → won; digit 9 → lost. Payout rate is always n=9 → 0.0555 (5% house margin).

create or replace function public.real_digit_payout_rate(
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint
) returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer := 9; -- ACCOUNT_WINNING_DIGIT_COUNT (90% win rate for all types)
begin
  -- Keep argument validation so malformed selections still fail closed.
  if p_contract_type = 'EVEN_ODD' and p_contract_option in ('even', 'odd') then
    null;
  elsif p_contract_type = 'MATCH_DIFFER' and p_contract_option in ('match', 'differ')
        and p_selected_digit between 0 and 9 then
    null;
  elsif p_contract_type = 'OVER_UNDER' and p_contract_option in ('over', 'under')
        and p_barrier between 0 and 9 then
    null;
  else
    return null;
  end if;
  return floor(((95 - 10 * n) * 1000)::numeric / n) / 10000;
end;
$$;

create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
  v_epochs jsonb;
  v_prev bigint;
  v_cur bigint;
  i integer;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;

  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;

  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);

  if t.duration_ticks is not null then
    if p_exit_epoch < t.tick_anchor_epoch + t.duration_ticks
       or p_exit_epoch > t.tick_anchor_epoch + 600
       or v_exit > now() + interval '5 seconds' then
      raise exception 'exit_tick_outside_window';
    end if;
    v_epochs := p_raw -> 'tick_epochs';
    if v_epochs is null or jsonb_typeof(v_epochs) <> 'array' or jsonb_array_length(v_epochs) <> t.duration_ticks then
      raise exception 'invalid_tick_sequence';
    end if;
    v_prev := t.tick_anchor_epoch;
    for i in 0 .. t.duration_ticks - 1 loop
      v_cur := (v_epochs ->> i)::bigint;
      if v_cur is null or v_cur <= v_prev then
        raise exception 'invalid_tick_sequence';
      end if;
      v_prev := v_cur;
    end loop;
    if v_prev <> p_exit_epoch then
      raise exception 'invalid_tick_sequence';
    end if;
  elsif v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;

  -- Cross-check the Edge Function: digit from price + pip size, and the account 90% outcome policy.
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;
  -- domain/outcome: exit digit 0–8 → won; digit 9 → lost (all contract types).
  v_outcome := case when v_digit between 0 and 8 then 'won' else 'lost' end;
  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;

  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;

  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;

  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object('exit_pip_size', p_pip_size, 'settled_at', now())
   where id = t.id;

  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL trade ' || v_outcome || ' on digit ' || v_digit, false
  );

  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'REAL trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;

  return jsonb_build_object('already', false, 'status', v_outcome, 'payout', v_payout, 'profit_loss', v_pl, 'digit', v_digit);
end;
$$;


-- ---------------------------------------------------------------------------
-- from: 20261005180000_payment_settings.sql
-- ---------------------------------------------------------------------------

-- Admin-editable deposit / withdrawal / trading money rules.
-- Edge Functions prefer these rows over env secrets; credentials stay in secrets.
-- Payout-desk tax/bot fees live in the separate payout Supabase (payout_settings).

create table if not exists public.payment_settings (
  key text primary key,
  value text not null,
  description text,
  updated_at timestamptz not null default now()
);

alter table public.payment_settings enable row level security;
revoke insert, update, delete, truncate, references, trigger on public.payment_settings from anon, authenticated;
grant select on public.payment_settings to authenticated;

drop policy if exists payment_settings_read on public.payment_settings;
create policy payment_settings_read on public.payment_settings
  for select to authenticated using (true);

insert into public.payment_settings (key, value, description) values
  ('DEPOSIT_KES_PER_USD', '130', 'M-Pesa deposit conversion: how many KES credit $1 USD.'),
  ('DEPOSIT_MIN_KES', '1600', 'Minimum REAL deposit amount in whole KES.'),
  ('DEPOSIT_MAX_KES', '150000', 'Maximum REAL deposit amount in whole KES.'),
  ('DEPOSIT_QUICK_AMOUNTS', '1600,2500,5000,10000', 'Comma-separated quick-pick deposit amounts in KES.'),
  ('WITHDRAWAL_KES_PER_USD', '130', 'Legacy REAL withdrawal conversion: KES paid per $1 USD.'),
  ('WITHDRAWAL_MIN_KES', '1000', 'Minimum legacy REAL withdrawal gross amount in KES.'),
  ('WITHDRAWAL_MAX_KES', '400000', 'Maximum legacy REAL withdrawal gross amount in KES (hard-capped at 400000).'),
  ('WITHDRAWAL_FEE_KES', '0', 'Fixed legacy REAL withdrawal fee in KES (taken from the payout before send).')
on conflict (key) do nothing;

insert into public.trading_settings (key, value, description) values
  ('REAL_STAKE_MIN_USD', 1, 'Minimum REAL trade stake in USD.'),
  ('REAL_STAKE_MAX_USD', 500, 'Maximum REAL trade stake in USD.'),
  ('REAL_MAX_OPEN_TRADES', 5, 'Maximum concurrent open REAL trades per user.')
on conflict (key) do nothing;

-- Shared stake bounds for place_real_trade / place_real_tick_trade.
create or replace function public.real_stake_bounds()
returns table (min_usd numeric, max_usd numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select value from public.trading_settings where key = 'REAL_STAKE_MIN_USD'), 1)::numeric as min_usd,
    coalesce((select value from public.trading_settings where key = 'REAL_STAKE_MAX_USD'), 500)::numeric as max_usd;
$$;

revoke all on function public.real_stake_bounds() from public, anon, authenticated;
grant execute on function public.real_stake_bounds() to authenticated, service_role;

create or replace function public.real_max_open_trades()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(1, least(50, coalesce(
    (select value from public.trading_settings where key = 'REAL_MAX_OPEN_TRADES'), 5
  )::integer));
$$;

revoke all on function public.real_max_open_trades() from public, anon, authenticated;
grant execute on function public.real_max_open_trades() to authenticated, service_role;

-- Tick-path placement: read stake / open-trade limits from trading_settings.
create or replace function public.place_real_tick_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ticks smallint,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_anchor bigint;
  v_cadence integer;
  v_expires timestamptz;
  v_rate numeric;
  v_stake_min numeric;
  v_stake_max numeric;
  v_max_open integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;

  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;

  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;

  if (public.real_trade_daily_status(p_user_id) ->> 'reached')::boolean then
    raise exception 'daily_limit_reached';
  end if;

  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;

  select min_usd, max_usd into v_stake_min, v_stake_max from public.real_stake_bounds();
  if p_stake is null or p_stake < v_stake_min or p_stake > v_stake_max or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ticks is null or p_duration_ticks < 1 or p_duration_ticks > 10 then
    raise exception 'invalid_duration';
  end if;
  v_rate := public.real_digit_payout_rate(p_contract_type, p_contract_option, p_selected_digit, p_barrier);
  if v_rate is null then
    raise exception 'invalid_contract';
  end if;
  if p_payout_rate is null or p_payout_rate <> v_rate then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;

  v_entry := to_timestamp(p_entry_epoch);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;

  v_anchor := greatest(p_entry_epoch, floor(extract(epoch from now()))::bigint);
  v_cadence := case when p_symbol like '1HZ%' then 1 else 2 end;
  v_expires := to_timestamp(v_anchor + p_duration_ticks * v_cadence);

  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;

  v_max_open := public.real_max_open_trades();
  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= v_max_open then
    raise exception 'too_many_open_trades';
  end if;

  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;

  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, duration_ticks, tick_anchor_epoch, payout_rate, status,
    entry_price, expires_at, idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ticks * v_cadence * 1000, p_duration_ticks, v_anchor, v_rate, 'open',
    p_entry_price, v_expires, p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object(
      'entry_source', 'deriv_ticks_history', 'placed_at', now(), 'payout_model', 'p_win_margin_5pct',
      'duration_unit', 'ticks', 'expires_at_is_estimate', true
    )
  )
  returning * into t;

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );

  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'REAL trade stake · ' || p_symbol, false
  );

  return jsonb_build_object('already', false, 'trade_id', t.id, 'tick_anchor_epoch', v_anchor);
end;
$$;


-- ---------------------------------------------------------------------------
-- from: 20261005190000_place_real_trade_stake_bounds.sql
-- ---------------------------------------------------------------------------

-- Align legacy seconds place_real_trade with admin-editable trading_settings
-- (same bounds helpers as place_real_tick_trade from 20261005180000_payment_settings.sql).

create or replace function public.place_real_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ms integer,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_expires timestamptz;
  v_rate numeric;
  v_stake_min numeric;
  v_stake_max numeric;
  v_max_open integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;

  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;

  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;

  if (public.real_trade_daily_status(p_user_id) ->> 'reached')::boolean then
    raise exception 'daily_limit_reached';
  end if;

  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;

  select min_usd, max_usd into v_stake_min, v_stake_max from public.real_stake_bounds();
  if p_stake is null or p_stake < v_stake_min or p_stake > v_stake_max or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ms is null or p_duration_ms not in (15000, 30000, 60000, 120000, 300000) then
    raise exception 'invalid_duration';
  end if;
  v_rate := public.real_digit_payout_rate(p_contract_type, p_contract_option, p_selected_digit, p_barrier);
  if v_rate is null then
    raise exception 'invalid_contract';
  end if;
  if p_payout_rate is null or p_payout_rate <> v_rate then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;

  v_entry := to_timestamp(p_entry_epoch);
  v_expires := v_entry + make_interval(secs => p_duration_ms / 1000.0);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds'
     or v_expires <= now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;

  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;

  v_max_open := public.real_max_open_trades();
  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= v_max_open then
    raise exception 'too_many_open_trades';
  end if;

  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;

  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, payout_rate, status, entry_price, expires_at,
    idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ms, v_rate, 'open', p_entry_price, v_expires,
    p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object('entry_source', 'deriv_ticks_history', 'placed_at', now(), 'payout_model', 'p_win_margin_5pct')
  )
  returning * into t;

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );

  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'REAL trade stake · ' || p_symbol, false
  );

  return jsonb_build_object('already', false, 'trade_id', t.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- from: 20261005200000_natural_contract_settlement.sql
-- ---------------------------------------------------------------------------
-- Natural EVEN/ODD/MATCH/DIFFER/OVER/UNDER settlement + payout pricing (replaces fixed 90% 0–8 rule).

create or replace function public.real_digit_payout_rate(
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint
) returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer;
begin
  if p_contract_type = 'EVEN_ODD' and p_contract_option in ('even', 'odd') then
    n := 5;
  elsif p_contract_type = 'MATCH_DIFFER' and p_contract_option in ('match', 'differ')
        and p_selected_digit between 0 and 9 then
    n := case p_contract_option when 'match' then 1 else 9 end;
  elsif p_contract_type = 'OVER_UNDER' and p_contract_option in ('over', 'under')
        and p_barrier between 0 and 9 then
    n := case p_contract_option when 'over' then 9 - p_barrier else p_barrier end;
  else
    return null;
  end if;
  if n <= 0 then
    return 0;
  end if;
  return floor(((95 - 10 * n) * 1000)::numeric / n) / 10000;
end;
$$;

create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
  v_epochs jsonb;
  v_prev bigint;
  v_cur bigint;
  i integer;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;

  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;

  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);

  if t.duration_ticks is not null then
    if p_exit_epoch < t.tick_anchor_epoch + t.duration_ticks
       or p_exit_epoch > t.tick_anchor_epoch + 600
       or v_exit > now() + interval '5 seconds' then
      raise exception 'exit_tick_outside_window';
    end if;
    v_epochs := p_raw -> 'tick_epochs';
    if v_epochs is null or jsonb_typeof(v_epochs) <> 'array' or jsonb_array_length(v_epochs) <> t.duration_ticks then
      raise exception 'invalid_tick_sequence';
    end if;
    v_prev := t.tick_anchor_epoch;
    for i in 0 .. t.duration_ticks - 1 loop
      v_cur := (v_epochs ->> i)::bigint;
      if v_cur is null or v_cur <= v_prev then
        raise exception 'invalid_tick_sequence';
      end if;
      v_prev := v_cur;
    end loop;
    if v_prev <> p_exit_epoch then
      raise exception 'invalid_tick_sequence';
    end if;
  elsif v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;

  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;

  -- Natural contract rules (same as apps/web calculateTradeResult / settleDigitContract).
  if t.contract_type = 'EVEN_ODD' and t.contract_option = 'even' then
    v_outcome := case when v_digit % 2 = 0 then 'won' else 'lost' end;
  elsif t.contract_type = 'EVEN_ODD' and t.contract_option = 'odd' then
    v_outcome := case when v_digit % 2 = 1 then 'won' else 'lost' end;
  elsif t.contract_type = 'MATCH_DIFFER' and t.contract_option = 'match' then
    v_outcome := case when v_digit = t.selected_digit then 'won' else 'lost' end;
  elsif t.contract_type = 'MATCH_DIFFER' and t.contract_option = 'differ' then
    v_outcome := case when v_digit <> t.selected_digit then 'won' else 'lost' end;
  elsif t.contract_type = 'OVER_UNDER' and t.contract_option = 'over' then
    v_outcome := case when v_digit > t.barrier then 'won' else 'lost' end;
  elsif t.contract_type = 'OVER_UNDER' and t.contract_option = 'under' then
    v_outcome := case when v_digit < t.barrier then 'won' else 'lost' end;
  else
    raise exception 'invalid_contract';
  end if;

  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;

  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;

  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;

  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object('exit_pip_size', p_pip_size, 'settled_at', now())
   where id = t.id;

  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );

  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id::text,
    'REAL trade ' || v_outcome || ' on digit ' || v_digit, false
  );

  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'REAL trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;

  return jsonb_build_object('already', false, 'status', v_outcome, 'payout', v_payout, 'profit_loss', v_pl, 'digit', v_digit);
end;
$$;

-- ---------------------------------------------------------------------------
-- from: 20261005210000_system_issues.sql
-- ---------------------------------------------------------------------------
-- System issue log for staff. Users only ever see neutral "temporarily unavailable" copy;
-- the real failure is recorded here and shown on /admin/system.
-- No client access: the system-issues Edge Function reads and writes with the service role.

create table if not exists public.system_issues (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  source text not null check (source in ('web', 'edge', 'probe')),
  area text not null,
  operation text not null,
  code text,
  message text not null,
  route text,
  last_user_id uuid,
  occurrences integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);

create unique index if not exists system_issues_open_fingerprint
  on public.system_issues (fingerprint) where resolved_at is null;
create index if not exists system_issues_last_seen on public.system_issues (last_seen desc);

alter table public.system_issues enable row level security;
revoke all on public.system_issues from anon, authenticated;

-- Upserts an open issue by fingerprint so repeated failures bump a counter instead of adding rows.
create or replace function public.report_system_issue(
  p_source text,
  p_area text,
  p_operation text,
  p_code text,
  p_message text,
  p_route text,
  p_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fp text := left(p_source || ':' || p_area || ':' || p_operation || ':' || coalesce(p_code, ''), 300);
  v_id uuid;
begin
  update public.system_issues
     set occurrences = occurrences + 1,
         last_seen = now(),
         message = left(coalesce(p_message, message), 500),
         route = left(coalesce(p_route, route), 200),
         last_user_id = coalesce(p_user_id, last_user_id)
   where fingerprint = v_fp and resolved_at is null
  returning id into v_id;

  if v_id is null then
    insert into public.system_issues (fingerprint, source, area, operation, code, message, route, last_user_id)
    values (
      v_fp,
      p_source,
      left(p_area, 64),
      left(p_operation, 64),
      left(p_code, 64),
      left(coalesce(p_message, 'Unknown error'), 500),
      left(p_route, 200),
      p_user_id
    )
    returning id into v_id;
  end if;

  -- Keep the log bounded: drop resolved rows older than 30 days.
  delete from public.system_issues where resolved_at is not null and resolved_at < now() - interval '30 days';
  return v_id;
end;
$$;

revoke all on function public.report_system_issue(text, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.report_system_issue(text, text, text, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- from: 20261007120000_flat_digit_payout_rate.sql
-- ---------------------------------------------------------------------------

-- Flat payout: every winnable digit contract pays 0.9 profit per $1 (mirror of DIGIT_PAYOUT_RATE /
-- digitPayoutRate() in supabase/functions/_shared/digit-contracts.ts). Contracts that cannot win pay 0.

create or replace function public.real_digit_payout_rate(
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint
) returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer;
begin
  if p_contract_type = 'EVEN_ODD' and p_contract_option in ('even', 'odd') then
    n := 5;
  elsif p_contract_type = 'MATCH_DIFFER' and p_contract_option in ('match', 'differ')
        and p_selected_digit between 0 and 9 then
    n := case p_contract_option when 'match' then 1 else 9 end;
  elsif p_contract_type = 'OVER_UNDER' and p_contract_option in ('over', 'under')
        and p_barrier between 0 and 9 then
    n := case p_contract_option when 'over' then 9 - p_barrier else p_barrier end;
  else
    return null;
  end if;
  if n <= 0 then
    return 0;
  end if;
  return 0.9;
end;
$$;

-- ---------------------------------------------------------------------------
-- from: 20261007150000_superadmin_panel.sql
-- ---------------------------------------------------------------------------

-- Superadmin panel.
--
--  * Superadmin = the confirmed auth account whose email is in public.app_admins (seeded below).
--    public.is_superadmin() is checked inside every admin function here and by the admin-panel
--    Edge Function (via public.is_superadmin_user). Client-supplied emails are never trusted.
--  * Demo / Practice simulated balances move server-side (public.simulated_balances). Users change
--    them only through public.apply_simulated_change (validated stake / settle / top-up / withdraw);
--    only the superadmin can set an arbitrary value. Every admin edit is written to admin_audit_log.
--  * Simulated win rate: global singleton + optional per-user override. Superadmin writes only.
--
-- Simulated balances are virtual. Nothing in this file reads or writes wallets, wallet_ledger,
-- deposits, withdrawals, trades, or any other real-money table.

-- ---------------------------------------------------------------------------
-- Admin allowlist + checks
-- ---------------------------------------------------------------------------

create table if not exists public.app_admins (
  email text primary key check (email = lower(btrim(email)) and email <> ''),
  role text not null default 'superadmin' check (role in ('superadmin')),
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
grant all on public.app_admins to service_role;

insert into public.app_admins (email, role)
values ('sonshasopunga@gmail.com', 'superadmin')
on conflict (email) do nothing;

-- Service-role helper (Edge Functions pass the user id they verified from the JWT).
create or replace function public.is_superadmin_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from auth.users u
    join public.app_admins a on a.email = lower(btrim(u.email))
    where u.id = p_user_id
      and u.email_confirmed_at is not null
      and a.role = 'superadmin'
  );
$$;

revoke all on function public.is_superadmin_user(uuid) from public, anon, authenticated;
grant execute on function public.is_superadmin_user(uuid) to service_role;

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_superadmin_user(auth.uid());
$$;

revoke all on function public.is_superadmin() from public, anon;
grant execute on function public.is_superadmin() to authenticated, service_role;

-- 'superadmin' (allowlisted email), 'staff' (non-editable app_metadata staff role), or 'none'.
create or replace function public.admin_access_level()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return 'none';
  end if;
  if public.is_superadmin_user(auth.uid()) then
    return 'superadmin';
  end if;
  select coalesce(u.raw_app_meta_data ->> 'role', '') into v_role from auth.users u where u.id = auth.uid();
  if v_role in ('admin', 'superadmin', 'finance', 'support', 'compliance') then
    return 'staff';
  end if;
  return 'none';
end;
$$;

revoke all on function public.admin_access_level() from public, anon;
grant execute on function public.admin_access_level() to authenticated, service_role;

-- Keep app_metadata.role = 'superadmin' on the allowlisted account only, so the existing staff
-- Edge Functions (admin-dashboard, admin-withdrawals, admin-fees) also accept it.
create or replace function public.sync_superadmin_app_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
     and exists (select 1 from public.app_admins a where a.email = lower(btrim(new.email))) then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'superadmin');
  end if;
  return new;
end;
$$;

drop trigger if exists sync_superadmin_app_role on auth.users;
create trigger sync_superadmin_app_role
  before insert or update of email, email_confirmed_at, raw_app_meta_data on auth.users
  for each row execute function public.sync_superadmin_app_role();

update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'superadmin')
where u.email_confirmed_at is not null
  and lower(btrim(u.email)) in (select a.email from public.app_admins a);

do $$
begin
  update public.users pu
  set role = 'superadmin'
  where pu.id in (
    select u.id from auth.users u
    where u.email_confirmed_at is not null
      and lower(btrim(u.email)) in (select a.email from public.app_admins a)
  );
exception
  when undefined_table or check_violation or undefined_column then
    raise notice 'public.users.role not updated: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin audit log
-- ---------------------------------------------------------------------------

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  admin_email text,
  action text not null,
  target_user_id uuid,
  target_email text,
  book text check (book is null or book in ('demo', 'practice')),
  old_value numeric,
  new_value numeric,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_user_id, created_at desc);

alter table public.admin_audit_log enable row level security;
drop policy if exists admin_audit_log_read on public.admin_audit_log;
create policy admin_audit_log_read on public.admin_audit_log
  for select to authenticated using (public.is_superadmin());
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;
grant all on public.admin_audit_log to service_role;

create or replace function public.write_admin_audit(
  p_action text,
  p_target_user_id uuid,
  p_book text,
  p_old numeric,
  p_new numeric,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_audit_log (admin_id, admin_email, action, target_user_id, target_email, book, old_value, new_value, reason)
  values (
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    p_action,
    p_target_user_id,
    (select u.email from auth.users u where u.id = p_target_user_id),
    p_book,
    p_old,
    p_new,
    nullif(btrim(coalesce(p_reason, '')), '')
  );
end;
$$;

revoke all on function public.write_admin_audit(text, uuid, text, numeric, numeric, text) from public, anon, authenticated;

create or replace function public.assert_superadmin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_superadmin() from public, anon, authenticated;

create or replace function public.clean_admin_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_reason is not null and char_length(btrim(p_reason)) > 500 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;
  return nullif(btrim(coalesce(p_reason, '')), '');
end;
$$;

-- ---------------------------------------------------------------------------
-- Simulated (Demo / Practice) balances — virtual money only
-- ---------------------------------------------------------------------------

create table if not exists public.simulated_balances (
  user_id uuid not null references auth.users (id) on delete cascade,
  book text not null check (book in ('demo', 'practice')),
  balance numeric(18, 2) not null default 10000 check (balance >= 0 and balance <= 1000000000),
  version bigint not null default 1,
  updated_by text not null default 'system' check (updated_by in ('system', 'user', 'admin')),
  updated_at timestamptz not null default now(),
  primary key (user_id, book)
);

alter table public.simulated_balances enable row level security;
drop policy if exists simulated_balances_read on public.simulated_balances;
create policy simulated_balances_read on public.simulated_balances
  for select to authenticated using (user_id = auth.uid() or public.is_superadmin());
revoke all on public.simulated_balances from anon, authenticated;
grant select on public.simulated_balances to authenticated;
grant all on public.simulated_balances to service_role;

-- Stakes the user has opened and not yet settled; a payout is credited only against one of these.
create table if not exists public.simulated_open_stakes (
  user_id uuid not null references auth.users (id) on delete cascade,
  book text not null check (book in ('demo', 'practice')),
  ref text not null check (char_length(ref) between 1 and 80),
  stake numeric(18, 2) not null check (stake > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, book, ref)
);

alter table public.simulated_open_stakes enable row level security;
revoke all on public.simulated_open_stakes from anon, authenticated;
grant all on public.simulated_open_stakes to service_role;

create table if not exists public.simulated_balance_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  book text not null check (book in ('demo', 'practice')),
  kind text not null check (kind in ('stake', 'settle', 'topup', 'withdraw', 'admin_set', 'admin_reset')),
  delta numeric(18, 2) not null,
  balance_after numeric(18, 2) not null,
  ref text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists simulated_balance_ledger_user_idx on public.simulated_balance_ledger (user_id, created_at desc);

alter table public.simulated_balance_ledger enable row level security;
drop policy if exists simulated_balance_ledger_read on public.simulated_balance_ledger;
create policy simulated_balance_ledger_read on public.simulated_balance_ledger
  for select to authenticated using (user_id = auth.uid() or public.is_superadmin());
revoke all on public.simulated_balance_ledger from anon, authenticated;
grant select on public.simulated_balance_ledger to authenticated;
grant all on public.simulated_balance_ledger to service_role;

create or replace function public.ensure_simulated_balances(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.simulated_balances (user_id, book)
  values (p_user_id, 'demo'), (p_user_id, 'practice')
  on conflict (user_id, book) do nothing;
$$;

revoke all on function public.ensure_simulated_balances(uuid) from public, anon, authenticated;
grant execute on function public.ensure_simulated_balances(uuid) to service_role;

create or replace function public.my_simulated_balances()
returns table (book text, balance numeric, version bigint, updated_by text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform public.ensure_simulated_balances(auth.uid());
  return query
    select b.book, b.balance, b.version, b.updated_by, b.updated_at
    from public.simulated_balances b
    where b.user_id = auth.uid()
    order by b.book;
end;
$$;

revoke all on function public.my_simulated_balances() from public, anon;
grant execute on function public.my_simulated_balances() to authenticated;

-- p_amount is always a magnitude. stake / withdraw debit, settle / topup credit.
-- settle needs an open stake with the same ref and pays at most 2x that stake (wins pay 1.9x).
-- Replays are harmless: a repeated stake ref or an already-settled ref returns applied = false.
create or replace function public.apply_simulated_change(
  p_book text,
  p_kind text,
  p_amount numeric,
  p_ref text default null,
  p_meta jsonb default '{}'::jsonb
) returns table (book text, balance numeric, version bigint, applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_amount numeric(18, 2);
  v_row public.simulated_balances%rowtype;
  v_stake numeric(18, 2);
  v_delta numeric(18, 2);
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_book not in ('demo', 'practice') then
    raise exception 'invalid_book' using errcode = '22023';
  end if;
  if p_kind not in ('stake', 'settle', 'topup', 'withdraw') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000000 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  v_amount := round(p_amount, 2);
  if p_kind <> 'settle' and v_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_kind in ('stake', 'settle') and (p_ref is null or char_length(p_ref) not between 1 and 80) then
    raise exception 'ref_required' using errcode = '22023';
  end if;
  if jsonb_typeof(v_meta) <> 'object' or pg_column_size(v_meta) > 2000 then
    v_meta := '{}'::jsonb;
  end if;

  perform public.ensure_simulated_balances(v_user);
  select * into v_row from public.simulated_balances b where b.user_id = v_user and b.book = p_book for update;

  if p_kind = 'stake' then
    if exists (select 1 from public.simulated_open_stakes s where s.user_id = v_user and s.book = p_book and s.ref = p_ref)
       or exists (select 1 from public.simulated_balance_ledger l where l.user_id = v_user and l.book = p_book and l.ref = p_ref and l.kind = 'stake') then
      return query select v_row.book, v_row.balance, v_row.version, false;
      return;
    end if;
    if v_row.balance < v_amount then
      raise exception 'insufficient_simulated_balance' using errcode = 'P0001';
    end if;
    insert into public.simulated_open_stakes (user_id, book, ref, stake) values (v_user, p_book, p_ref, v_amount);
    v_delta := -v_amount;
  elsif p_kind = 'settle' then
    delete from public.simulated_open_stakes s
    where s.user_id = v_user and s.book = p_book and s.ref = p_ref
    returning s.stake into v_stake;
    if v_stake is null then
      return query select v_row.book, v_row.balance, v_row.version, false;
      return;
    end if;
    if v_amount > v_stake * 2 then
      raise exception 'payout_exceeds_limit' using errcode = '22023';
    end if;
    v_delta := v_amount;
  elsif p_kind = 'topup' then
    if v_amount > 1000000 then
      raise exception 'topup_too_large' using errcode = '22023';
    end if;
    v_delta := v_amount;
  else
    if v_row.balance < v_amount then
      raise exception 'insufficient_simulated_balance' using errcode = 'P0001';
    end if;
    v_delta := -v_amount;
  end if;

  if v_row.balance + v_delta > 1000000000 then
    raise exception 'balance_limit' using errcode = '22023';
  end if;

  update public.simulated_balances b
  set balance = b.balance + v_delta, version = b.version + 1, updated_by = 'user', updated_at = now()
  where b.user_id = v_user and b.book = p_book
  returning * into v_row;

  insert into public.simulated_balance_ledger (user_id, book, kind, delta, balance_after, ref, meta)
  values (v_user, p_book, p_kind, v_delta, v_row.balance, p_ref, v_meta);

  return query select v_row.book, v_row.balance, v_row.version, true;
end;
$$;

revoke all on function public.apply_simulated_change(text, text, numeric, text, jsonb) from public, anon;
grant execute on function public.apply_simulated_change(text, text, numeric, text, jsonb) to authenticated;

create or replace function public.admin_set_simulated_balance(
  p_user_id uuid,
  p_book text,
  p_balance numeric,
  p_reason text default null
) returns table (book text, balance numeric, version bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_old numeric(18, 2);
  v_new numeric(18, 2);
  v_row public.simulated_balances%rowtype;
  v_reason text := public.clean_admin_reason(p_reason);
begin
  perform public.assert_superadmin();
  if p_book not in ('demo', 'practice') then
    raise exception 'invalid_book' using errcode = '22023';
  end if;
  if p_balance is null or p_balance < 0 or p_balance > 1000000000 then
    raise exception 'invalid_balance' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  v_new := round(p_balance, 2);

  perform public.ensure_simulated_balances(p_user_id);
  select b.balance into v_old from public.simulated_balances b where b.user_id = p_user_id and b.book = p_book for update;

  update public.simulated_balances b
  set balance = v_new, version = b.version + 1, updated_by = 'admin', updated_at = now()
  where b.user_id = p_user_id and b.book = p_book
  returning * into v_row;

  insert into public.simulated_balance_ledger (user_id, book, kind, delta, balance_after, meta)
  values (p_user_id, p_book, 'admin_set', v_new - v_old, v_new, jsonb_build_object('admin_id', auth.uid()));

  perform public.write_admin_audit('simulated_balance.set', p_user_id, p_book, v_old, v_new, v_reason);
  return query select v_row.book, v_row.balance, v_row.version;
end;
$$;

revoke all on function public.admin_set_simulated_balance(uuid, text, numeric, text) from public, anon;
grant execute on function public.admin_set_simulated_balance(uuid, text, numeric, text) to authenticated;

create or replace function public.admin_reset_simulated_balances(
  p_user_id uuid,
  p_reason text default null
) returns table (book text, balance numeric, version bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_book text;
  v_old numeric(18, 2);
  v_reason text := public.clean_admin_reason(p_reason);
begin
  perform public.assert_superadmin();
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  perform public.ensure_simulated_balances(p_user_id);
  delete from public.simulated_open_stakes s where s.user_id = p_user_id;

  foreach v_book in array array['demo', 'practice'] loop
    select b.balance into v_old from public.simulated_balances b where b.user_id = p_user_id and b.book = v_book for update;
    update public.simulated_balances b
    set balance = 10000, version = b.version + 1, updated_by = 'admin', updated_at = now()
    where b.user_id = p_user_id and b.book = v_book;
    insert into public.simulated_balance_ledger (user_id, book, kind, delta, balance_after, meta)
    values (p_user_id, v_book, 'admin_reset', 10000 - v_old, 10000, jsonb_build_object('admin_id', auth.uid()));
    perform public.write_admin_audit('simulated_balance.reset', p_user_id, v_book, v_old, 10000, v_reason);
  end loop;

  return query
    select b.book, b.balance, b.version from public.simulated_balances b where b.user_id = p_user_id order by b.book;
end;
$$;

revoke all on function public.admin_reset_simulated_balances(uuid, text) from public, anon;
grant execute on function public.admin_reset_simulated_balances(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Simulated win rate (Demo / Practice outcomes only)
-- ---------------------------------------------------------------------------

create table if not exists public.simulation_settings (
  id boolean primary key default true check (id),
  win_rate numeric(5, 4) not null default 0.95 check (win_rate >= 0 and win_rate <= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.simulation_settings (id) values (true) on conflict (id) do nothing;

alter table public.simulation_settings enable row level security;
drop policy if exists simulation_settings_read on public.simulation_settings;
create policy simulation_settings_read on public.simulation_settings
  for select to authenticated using (public.is_superadmin());
revoke all on public.simulation_settings from anon, authenticated;
grant select on public.simulation_settings to authenticated;
grant all on public.simulation_settings to service_role;

-- win_rate null = use the global rate. Rows are updated to null instead of deleted so Realtime
-- UPDATE events reach the user's filtered subscription.
create table if not exists public.simulated_win_rate_overrides (
  user_id uuid primary key references auth.users (id) on delete cascade,
  win_rate numeric(5, 4) check (win_rate is null or (win_rate >= 0 and win_rate <= 1)),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.simulated_win_rate_overrides enable row level security;
drop policy if exists simulated_win_rate_overrides_read on public.simulated_win_rate_overrides;
create policy simulated_win_rate_overrides_read on public.simulated_win_rate_overrides
  for select to authenticated using (user_id = auth.uid() or public.is_superadmin());
revoke all on public.simulated_win_rate_overrides from anon, authenticated;
grant select on public.simulated_win_rate_overrides to authenticated;
grant all on public.simulated_win_rate_overrides to service_role;

-- Revision counter readable by every signed-in user: a change tells clients to re-resolve their own
-- effective rate (my_simulated_win_rate) without exposing the global value itself.
create table if not exists public.simulation_signals (
  id boolean primary key default true check (id),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.simulation_signals (id) values (true) on conflict (id) do nothing;

alter table public.simulation_signals enable row level security;
drop policy if exists simulation_signals_read on public.simulation_signals;
create policy simulation_signals_read on public.simulation_signals
  for select to authenticated using (true);
revoke all on public.simulation_signals from anon, authenticated;
grant select on public.simulation_signals to authenticated;
grant all on public.simulation_signals to service_role;

create or replace function public.my_simulated_win_rate()
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return coalesce(
    (select o.win_rate from public.simulated_win_rate_overrides o where o.user_id = auth.uid()),
    (select s.win_rate from public.simulation_settings s where s.id),
    0.95
  );
end;
$$;

revoke all on function public.my_simulated_win_rate() from public, anon;
grant execute on function public.my_simulated_win_rate() to authenticated;

create or replace function public.admin_set_global_win_rate(
  p_rate numeric,
  p_reason text default null
) returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old numeric(5, 4);
  v_new numeric(5, 4);
  v_reason text := public.clean_admin_reason(p_reason);
begin
  perform public.assert_superadmin();
  if p_rate is null or p_rate < 0 or p_rate > 1 then
    raise exception 'invalid_win_rate' using errcode = '22023';
  end if;
  v_new := round(p_rate, 4);
  insert into public.simulation_settings (id) values (true) on conflict (id) do nothing;
  select s.win_rate into v_old from public.simulation_settings s where s.id for update;
  update public.simulation_settings s set win_rate = v_new, updated_at = now(), updated_by = auth.uid() where s.id;
  insert into public.simulation_signals (id) values (true) on conflict (id) do nothing;
  update public.simulation_signals g set revision = g.revision + 1, updated_at = now() where g.id;
  perform public.write_admin_audit('win_rate.global_set', null, null, v_old, v_new, v_reason);
  return v_new;
end;
$$;

revoke all on function public.admin_set_global_win_rate(numeric, text) from public, anon;
grant execute on function public.admin_set_global_win_rate(numeric, text) to authenticated;

-- p_rate null clears the override (the user falls back to the global rate).
create or replace function public.admin_set_user_win_rate(
  p_user_id uuid,
  p_rate numeric,
  p_reason text default null
) returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old numeric(5, 4);
  v_new numeric(5, 4);
  v_reason text := public.clean_admin_reason(p_reason);
begin
  perform public.assert_superadmin();
  if p_rate is not null and (p_rate < 0 or p_rate > 1) then
    raise exception 'invalid_win_rate' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  v_new := case when p_rate is null then null else round(p_rate, 4) end;
  select o.win_rate into v_old from public.simulated_win_rate_overrides o where o.user_id = p_user_id for update;
  insert into public.simulated_win_rate_overrides (user_id, win_rate, updated_at, updated_by)
  values (p_user_id, v_new, now(), auth.uid())
  on conflict (user_id) do update set win_rate = excluded.win_rate, updated_at = now(), updated_by = auth.uid();
  perform public.write_admin_audit(
    case when v_new is null then 'win_rate.user_clear' else 'win_rate.user_set' end,
    p_user_id, null, v_old, v_new, v_reason
  );
  return v_new;
end;
$$;

revoke all on function public.admin_set_user_win_rate(uuid, numeric, text) from public, anon;
grant execute on function public.admin_set_user_win_rate(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['simulated_balances', 'simulated_win_rate_overrides', 'simulation_signals', 'admin_audit_log'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
