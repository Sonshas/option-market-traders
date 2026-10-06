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
