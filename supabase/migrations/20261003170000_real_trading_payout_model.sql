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
