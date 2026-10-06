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
