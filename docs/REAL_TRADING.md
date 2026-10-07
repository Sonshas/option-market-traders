# REAL money trading

In-house digit-options engine. **The platform is the counterparty** (house model): every REAL stake is held
in the player's own wallet while the trade is open, and wins are paid out of the house. No orders are sent
to Deriv; Deriv's public tick feed is used only as the price oracle.

Supabase project: `wkfyavcjjuyzvyeprklz` (Smart Base Binary). Feature flag: `REAL_TRADING_ENABLED`.

## Architecture

```
Browser (REAL mode)                     Edge Functions (Deno)                 Postgres (service_role only)
───────────────────                     ─────────────────────                 ───────────────────────────
TradeTicket ── POST real-trade ───────▶ real-trade
  (no prices sent)                        • JWT → user
                                          • validateRealTradeRequest (shared)
                                          • flag check
                                          • fresh entry tick from Deriv  ────▶ place_real_trade(...)
                                            (≤ 3.5 s old, server-side)           lock wallet, re-check everything
                                                                                  insert trade + ledger + txn
watchRealTradeSettlement ─ POST real-trade-settle (JWT, own trades)
                                        real-trade-settle
pg_cron (every minute) ── POST real-trade-settle  (x-sweep-secret, sweep all due trades)
                                          • tick contract: ticks [anchor, anchor+600s],
                                            Nth tick with epoch > anchor   ─▶ settle_real_trade(...)
                                          • seconds contract: ticks [expiry-1s, expiry+60s],
                                            first tick with epoch ≥ expiry ─▶ settle_real_trade(...)
                                          • none after 10 min              ─▶ refund_real_trade(...)
```

| Piece | Location |
| --- | --- |
| Shared contract logic (outcomes, payout, validation, exit-tick rule) | `apps/web/src/domain/digit-contracts.ts`, byte-identical copy in `supabase/functions/_shared/digit-contracts.ts` (a vitest test enforces identity) |
| Server helpers (Deriv socket, settlement loop) | `supabase/functions/_shared/trading-server.ts` |
| Place trade | `supabase/functions/real-trade` (`verify_jwt = true`). `GET` returns the public config. |
| Settle | `supabase/functions/real-trade-settle` (`verify_jwt = false`; auth is either a user JWT or the Vault sweep secret) |
| Money functions | `supabase/migrations/20260920111952_smartbasebinary_host_schema.sql` (sections: real trading engine, payout model, tick duration, payment settings, stake bounds, 90% win rate — see `MIGRATION_MANIFEST.md`) |
| Cron sweep | Same consolidated file — job `real-trade-settle-sweep`, `* * * * *` |
| Frontend | `providers/trading/real-trading-provider.ts`, `services/real-trading.ts`, `hooks/useRealTradingConfig.ts`, `features/trading/TradeTicket.tsx` |

The client never sends a price, payout or outcome. It sends only symbol, contract, digit/barrier, stake,
duration and an idempotency key. The entry tick, exit tick, digit and outcome are all fetched or computed on
the server, and `settle_real_trade` recomputes the digit and outcome in SQL before moving money.

## Security model

- RLS: clients can only `SELECT` their own `trades`, `trade_settlements`, `wallets`, `wallet_ledger`,
  `transactions`. Restrictive `*_block_client_*` policies plus revoked `INSERT/UPDATE/DELETE/TRUNCATE` grants
  for `anon` and `authenticated` on all five tables.
- `place_real_trade`, `settle_real_trade`, `refund_real_trade`, `verify_real_trade_sweep_secret` are
  `SECURITY DEFINER`, `search_path = ''`, executable by `service_role` only.
- Sweep secret lives in Vault (`real_trade_sweep_secret`); cron reads it at run time. Rotate with
  `select vault.update_secret((select id from vault.secrets where name='real_trade_sweep_secret'), encode(extensions.gen_random_bytes(32),'hex'));`
  (cron picks the new value up automatically).
- `mode: "diagnose"` on `real-trade-settle` (sweep secret required) only fetches a live tick; it never reads
  or writes money.

## Accounting model (lock model, same as DEMO)

| Event | available_balance | locked_balance | balance | wallet_ledger (amount = Δ available) | transactions |
| --- | --- | --- | --- | --- | --- |
| Place | − stake | + stake | 0 | `trade_stake`, −stake | `trade_stake` −stake |
| Win | + payout | − stake | + (payout − stake) | `trade_payout`, +payout | payout |
| Loss | 0 | − stake | − stake | `trade_payout`, 0 | none |
| Refund (no exit tick 10 min after expiry, status `cancelled`) | + stake | − stake | 0 | `trade_refund`, +stake | refund |

Invariant at all times: `available_balance + locked_balance = balance`.
There are no ties: on OVER/UNDER the barrier digit itself loses (Deriv's rule).

## Payout model (DEMO and REAL, 5% house margin)

Profit rate per $1 = `0.95 / P(win) − 1`, rounded **down** to 4 decimals, so the expected return of every
contract that can win is at most $0.95 per $1. Payout on a win = `stake × (1 + rate)` rounded **down** to the
cent. Both are computed by `digitPayoutRate()` / `payoutFor()` in the shared module; `place_real_trade`
recomputes the rate in SQL (`public.real_digit_payout_rate`) and rejects any mismatch (`invalid_payout_rate`).
The client never sends a rate.

| Contract | Winning digits | P(win) | Profit rate | $10 stake wins (payout / profit) | Expected return per $1 |
| --- | --- | --- | --- | --- | --- |
| EVEN / ODD | 5 | 0.5 | 0.9000 | $19.00 / $9.00 | 0.950 |
| MATCH d | 1 | 0.1 | 8.5000 | $95.00 / $85.00 | 0.950 |
| DIFFER d | 9 | 0.9 | 0.0555 | $10.55 / $0.55 | 0.94995 |
| OVER 0 / UNDER 9 | 9 | 0.9 | 0.0555 | $10.55 / $0.55 | 0.94995 |
| OVER 1 / UNDER 8 | 8 | 0.8 | 0.1875 | $11.87 / $1.87 | 0.950 |
| OVER 2 / UNDER 7 | 7 | 0.7 | 0.3571 | $13.57 / $3.57 | 0.94997 |
| OVER 3 / UNDER 6 | 6 | 0.6 | 0.5833 | $15.83 / $5.83 | 0.94998 |
| OVER 4 / UNDER 5 | 5 | 0.5 | 0.9000 | $19.00 / $9.00 | 0.950 |
| OVER 5 / UNDER 4 | 4 | 0.4 | 1.3750 | $23.75 / $13.75 | 0.950 |
| OVER 6 / UNDER 3 | 3 | 0.3 | 2.1666 | $31.66 / $21.66 | 0.94998 |
| OVER 7 / UNDER 2 | 2 | 0.2 | 3.7500 | $47.50 / $37.50 | 0.950 |
| OVER 8 / UNDER 1 | 1 | 0.1 | 8.5000 | $95.00 / $85.00 | 0.950 |
| OVER 9 / UNDER 0 | 0 | 0 | 0 (cannot win) | $0.00 / $0.00 | 0 |

OVER 9 and UNDER 0 stay selectable (owner's decision). The ticket shows "This contract cannot win — 0% chance"
with payout and profit $0.00; the server accepts them with rate 0 and they always settle as a loss.
Every trade stores the rate it was opened with (`trades.payout_rate`), so later rate changes never affect
open trades.

## Settlement rule

- Entry: latest Deriv tick at placement, at most 3.5 s old (edge function retries up to 5 s; SQL also requires
  it inside [now − 10 s, now + 5 s]).
- **Tick contracts (current ticket, 1–10 ticks, default 5)** — `place_real_tick_trade`
  (migration `20261003200000_real_trading_tick_duration.sql`):
  - Anchor: `tick_anchor_epoch = max(entry tick epoch, placement second)`, so a quote that was already
    published when the order arrived can never count.
  - Exit: **the Nth distinct Deriv tick with `epoch > anchor`** (1HZ indices tick every 1 s, R_ indices every
    2 s). `expires_at` / `duration_ms` on these rows are only an estimate (`details.expires_at_is_estimate`).
  - SQL checks `p_raw.tick_epochs`: exactly N strictly increasing epochs, all after the anchor, the last one
    equal to `exit_epoch`, exit within anchor + 600 s and not in the future.
  - No Nth tick by anchor + 10 minutes → full refund (`cancelled`).
- **Seconds contracts (legacy, still accepted from old tabs)** — `place_real_trade`:
  - Expiry: `entry time + duration` (15 s, 30 s, 1 m, 2 m, 5 m).
  - Exit: **the first tick with `epoch ≥ expiry`** (same rule as DEMO). SQL rejects exit ticks outside
    [expiry, expiry + 61 s] or in the future.
  - No exit tick by expiry + 10 minutes → full refund (`cancelled`).
- Digit: last digit of the price formatted to the symbol's pip size (e.g. 670.86 → 6).
- Settlement is idempotent: a trade that is no longer `open` is returned unchanged.

## Limits

| Limit | Value |
| --- | --- |
| Stake | $1.00 – $500.00, max 2 decimals |
| Open REAL trades per user | 5 |
| Symbols | R_10, R_25, R_50, R_75, R_100, 1HZ10V, 1HZ25V, 1HZ50V, 1HZ75V, 1HZ100V |
| Max payout per trade | $4,750 (MATCH / OVER 8 / UNDER 1 at $500 stake), i.e. house loses at most $4,250 per trade |
| Daily winnings limit | $1,000 net per user per Africa/Nairobi day (see below) |

### Daily safety limit

`place_real_trade` sums the user's settled REAL `trade_settlements.profit_loss` since local midnight
(Africa/Nairobi, UTC+3). Once the total is **≥ the limit**, new REAL trades are rejected with
"Daily REAL limit reached — trading resumes tomorrow." (`daily_limit_reached`). Open trades still settle.
The ticket shows the same message (the `real-trade` GET reports `daily_limit_reached`). Because the check runs
before each placement, a user can finish a day above the limit by at most the profit of their open trades
(≤ 5 × $4,250 in the extreme).

```sql
-- Current value / change it (takes effect on the next placement)
select * from public.trading_settings where key = 'REAL_DAILY_PROFIT_LIMIT_USD';
update public.trading_settings set value = 1000, updated_at = now() where key = 'REAL_DAILY_PROFIT_LIMIT_USD';
-- A user's status today
select public.real_trade_daily_status('<user_id>');
```

## Pause / resume

```sql
-- Pause: new REAL trades are rejected immediately (open trades still settle normally).
update public.feature_flags set value = false where key = 'REAL_TRADING_ENABLED';
-- Resume
update public.feature_flags set value = true  where key = 'REAL_TRADING_ENABLED';
-- Stop the settlement sweep (only in an emergency; users' own pages still settle their trades)
select cron.unschedule('real-trade-settle-sweep');
```

## Reconciliation queries

```sql
-- 1. Wallet invariant (expect zero rows)
select id, user_id, balance, available_balance, locked_balance
from public.wallets
where account_mode = 'real' and available_balance + locked_balance <> balance;

-- 2. Locked balance equals open stakes (expect zero rows)
select w.id, w.locked_balance, coalesce(sum(t.stake), 0) as open_stakes
from public.wallets w
left join public.trades t on t.wallet_id = w.id and t.status = 'open'
where w.account_mode = 'real'
group by w.id, w.locked_balance
having w.locked_balance <> coalesce(sum(t.stake), 0);

-- 3. Ledger sum equals available balance (expect zero rows; deposits are ledgered too)
select w.id, w.available_balance, coalesce(sum(l.amount), 0) as ledger_sum
from public.wallets w
left join public.wallet_ledger l on l.wallet_id = w.id
where w.account_mode = 'real'
group by w.id, w.available_balance
having w.available_balance <> coalesce(sum(l.amount), 0);

-- 4. Every closed trade has exactly one settlement (expect zero rows)
select t.id, t.status, count(s.id)
from public.trades t
left join public.trade_settlements s on s.trade_id = t.id
where t.account_mode = 'real' and t.status <> 'open'
group by t.id, t.status
having count(s.id) <> 1;

-- 5. Overdue open trades (should be empty; anything here means the sweep is failing)
select id, user_id, symbol, stake, expires_at
from public.trades
where account_mode = 'real' and status = 'open' and expires_at < now() - interval '2 minutes';

-- 6. House P&L (positive = house profit)
select date_trunc('day', s.created_at) as day,
       count(*) as trades,
       sum(t.stake) as staked,
       sum(s.payout) as paid,
       sum(t.stake) - sum(s.payout) as house_pnl
from public.trades t
join public.trade_settlements s on s.trade_id = t.id
where t.account_mode = 'real'
group by 1 order by 1 desc;

-- 7. Cron health
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 20;
select status_code, left(content, 200), created from net._http_response order by created desc limit 20;
```

## Risks

- **House exposure (variance).** The 5% margin makes the house's *expected* result positive on every contract,
  but single trades can be large: MATCH / OVER 8 / UNDER 1 at $500 pay $4,750 (house −$4,250). Short-run
  losses of several thousand dollars are normal variance. Size the house float accordingly; the daily limit
  caps how much one user can win per day (plus open trades).
- The house edge assumes Deriv's last digits are uniformly random. Players cannot see the exit tick in
  advance (entry is the server's latest tick ≤ 3.5 s old; the exit is the Nth tick strictly after
  max(entry, placement second), or for legacy seconds contracts the first tick at or after expiry ≥ 15 s later).
  A 1-tick contract on a 1HZ index settles about 1 s after placement — the shortest exposure the ticket allows.
- OVER 9 and UNDER 0 can never win and remain selectable by the owner's choice; the ticket warns clearly.
- Oracle risk: settlement depends on Deriv's public feed. If Deriv is unavailable, trades are refunded after
  10 minutes (never settled on a stale price).
- Placement latency: the entry is the latest tick when the server receives the order (≈ 0.5 s fetch); on 1 s
  symbols the player cannot see the entry tick in advance, but the 3.5 s freshness window is the tolerance.
- KYC: `KYC_REQUIRED=true` is not enforced by the trading path yet.
- There is a per-user daily *winnings* limit, but no global house exposure cap and no per-user loss limit.

## Disputes

1. Find the trade: `select * from public.trades where id = '<trade_id>';`
   `entry_price`, `entry_epoch`, `entry_pip_size`, `exit_price`, `exit_epoch`, `exit_digit`, `details`.
2. Settlement record: `select * from public.trade_settlements where trade_id = '<trade_id>';`
   `details` holds the raw Deriv tick used and the computed outcome.
3. Ledger: `select * from public.wallet_ledger where reference_id = '<trade_id>' order by created_at;`
4. Independently re-verify against Deriv:
   - Tick contract (`duration_ticks` set): `ticks_history` with `start = tick_anchor_epoch`,
     `end = tick_anchor_epoch + 600`; drop ticks with `epoch ≤ tick_anchor_epoch`; the `duration_ticks`-th
     remaining tick must match `exit_epoch` / `exit_price` (and `trade_settlements.details.tick_epochs`).
   - Seconds contract: `start = expires_at epoch − 1`, `end = start + 61`; the first tick with
     `epoch ≥ expiry` must match `exit_epoch` / `exit_price`.
5. Corrections are made only by an admin with an explicit adjusting ledger entry and transaction; never edit
   the trade or settlement rows.
