# REAL withdrawals (M-Pesa payouts)

REAL withdrawals send money from the business M-Pesa to the user's Safaricom number. A withdrawal is **COMPLETED
only when the money has actually been sent** — either Safaricom's B2C result callback confirmed it, or a staff
member recorded the M-Pesa receipt of a payment they made by hand. Nothing in the web app can mark a withdrawal
completed, and nothing is completed on submission.

## Rules enforced server-side (`request_real_withdrawal`)

| Rule | Where |
| --- | --- |
| Amount ≤ the user's available REAL balance | DB function (wallet row lock) + Edge Function pre-check |
| Minimum KES 1,000, maximum **KES 400,000 per request** (≈ $3,076.92 at 130 KES/USD). The 400,000 cap is hard-coded in the DB and the shared module; `WITHDRAWAL_MAX_KES` can only lower it | DB function, `domain/withdrawals.ts` |
| At least one settled REAL trade (`won` or `lost`; ties/cancellations do not count) before the first payout. Without it the panel shows only "Complete at least one REAL trade before withdrawing." | DB function (`no_real_trade`) + Edge Function GET/POST |
| DEMO funds can never be withdrawn: the DB function only touches the `account_mode='real'`, `is_simulated=false` wallet; DEMO stays simulated in local storage | DB function |
| One open (PENDING/PROCESSING) withdrawal per user | partial unique index + explicit check |
| Valid Safaricom number (`2547XXXXXXXX` / `2541XXXXXXXX`) | DB check constraint + `normalizeKenyanPhone` |
| Only fee: `WITHDRAWAL_FEE_KES` (default **0**), shown before submit and deducted from the payout. No post-submission fees, tax, release or AI charges ever | DB function, panel quote |
| Clients cannot INSERT/UPDATE/DELETE `withdrawals`; the four money functions are `service_role` only | revokes + restrictive RLS policies |

## Money flow

1. **Request** (`mpesa-withdraw` POST → `request_real_withdrawal`): wallet `balance` and `available_balance` are
   debited immediately (hold). Rows: `withdrawals` (PENDING, reference `OMT-W-XXXXXXXX`), `wallet_ledger`
   (`withdrawal_hold`, −amount), `transactions` (type `withdrawal`, PENDING).
2. **Processing** (`mark_withdrawal_processing`): staff started paying, or the B2C dispatcher claimed the row.
   Idempotent; PENDING only.
3. **Completed** (`complete_withdrawal(id, receipt)`): receipt required (`^[A-Z0-9-]{6,40}$`, unique). Ledger
   `withdrawal_paid` (amount 0 — the hold is final). **No balance change.**
4. **Failed** (`fail_withdrawal(id, reason)`): refunds the hold **exactly once** (`withdrawal_refund`, +amount);
   the reason is shown to the user. Double complete/fail and complete-after-fail are rejected
   (`withdrawal_not_open`).

## Payout modes (`WITHDRAWAL_MODE` Edge Function secret)

### `manual` (default — active until B2C secrets exist)

Rows stay PENDING until a staff member pays and records the receipt at **/admin/withdrawals**:

1. Sign in with a staff account (JWT `app_metadata.role` = `admin`, `superadmin` or `finance`). Set it with
   `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' where email = '<you>'`
   and sign in again.
2. Open **/admin/withdrawals** → REAL tab (default). Filter "Open".
3. For the row: optionally click **Mark processing** (tells the user "Being sent to M-Pesa").
4. Send exactly the **"Send (net)" KES amount** to the **"Pay to M-Pesa"** number from the business M-Pesa
   (Lipa na M-Pesa / B2C portal / till).
5. Enter the M-Pesa **receipt / transaction code** from the confirmation SMS and click **Complete (money sent)**.
   The user sees "Withdrawal completed — KES X sent to 07… (receipt …)".
6. If you could not pay (wrong number, M-Pesa rejected it), type the reason and click **Fail + refund**. The hold
   returns to the user's REAL balance and they see "Could not be sent: <reason>. Your balance has been refunded."

Reconciliation: every completed row has a unique `mpesa_receipt`; match it against the M-Pesa statement. Open rows
older than 24 h should be paid or failed.

### `daraja_b2c`

`mpesa-withdraw-dispatch` (pg_cron, every minute, authenticated with the `real_trade_sweep_secret` Vault secret)
sends PENDING rows through Daraja B2C v3 (`/mpesa/b2c/v3/paymentrequest`), claiming each row as PROCESSING
**before** the call so it can never be sent twice. Safaricom calls back:

- `https://optionmarkettraders.com/api/mpesa/b2c/result` → `mpesa-b2c-result` (ResultCode 0 → `complete_withdrawal`
  with `TransactionReceipt`; non-zero → `fail_withdrawal` + refund)
- `https://optionmarkettraders.com/api/mpesa/b2c/timeout` → same function with `?kind=timeout` → `fail_withdrawal`
  + refund if the row is still open.

Both paths are Caddy reverse proxies to the Supabase Edge Function (see `deploy/vultr/Caddyfile`). The callback
always answers `200 {"ResultCode":0,"ResultDesc":"Accepted"}`, ignores malformed/unknown payloads, and never
auto-completes when the paid amount differs from `net_kes` or no receipt is present (flagged for review in
`admin_note`). A network timeout on the B2C request leaves the row PROCESSING with an `admin_note` for review — it
is never refunded automatically because the money may have gone out.

If `WITHDRAWAL_MODE` is not `daraja_b2c` or the secrets below are missing, the dispatcher logs
`withdraw dispatch skipped: B2C not configured` and does nothing.

## Secrets (Supabase Edge Function secrets — names only)

| Name | Purpose |
| --- | --- |
| `WITHDRAWAL_MODE` | `manual` (default) or `daraja_b2c` |
| `WITHDRAWAL_FEE_KES` | fixed fee shown upfront, default `0` |
| `WITHDRAWAL_MIN_KES` / `WITHDRAWAL_MAX_KES` | optional limits (max is capped at 400,000) |
| `KES_PER_USD` | rate, default `130` (shared with deposits) |
| `MPESA_B2C_SHORTCODE` | B2C shortcode (PartyA) |
| `MPESA_INITIATOR_NAME` | B2C initiator (API operator) username |
| `MPESA_SECURITY_CREDENTIAL` | initiator password encrypted with Safaricom's production certificate |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` | already set for deposits; the B2C product must be enabled on the same Daraja app |
| `MPESA_B2C_RESULT_URL` / `MPESA_B2C_TIMEOUT_URL` | optional overrides of the two callback URLs above |

To enable B2C: obtain the four B2C values from Safaricom (Daraja production app with B2C enabled, B2C shortcode,
initiator name + password, SecurityCredential), set the secrets, then set `WITHDRAWAL_MODE=daraja_b2c`. No redeploy
is needed; the panel copy switches to "usually within minutes".

## Pause switch

`feature_flags.REAL_WITHDRAWALS_ENABLED = false` stops new requests (the panel shows "Withdrawals are paused for
maintenance"). Open requests can still be completed or refunded.

## Tests

- `apps/web/src/domain/withdrawals.test.ts` — amount/phone validation, KES conversion, fee/net quote, the
  400,000 cap, the eligibility copy, status copy (never claims success before COMPLETED), B2C payload/result
  parsing, byte-identical web/edge mirror.
- Database: run `supabase/migrations/20261004130000_real_withdrawals.sql` plus the DO-block test inside
  `begin; … rollback;` — insufficient balance, limits/phone/reference, hold debits exactly once, second open request
  rejected, processing idempotent, complete requires receipt and does not move balance, double complete/fail
  rejected, fail refunds exactly once, receipt reuse rejected, fee deducted upfront, no settled REAL trade rejected,
  KES 400,000 cap, `authenticated` role cannot call the functions or write rows, pause flag.
- `npm run verify:ui` — DEMO withdrawal flow unchanged; REAL Withdraw has no "Soon" tag; panel renders with the
  limits, the eligibility sentence, and screenshots `docs/screenshots/withdraw-panel-desktop.png`,
  `withdraw-panel-mobile.png`, `admin-withdrawals.png` (Edge Function mocked; no payout is ever made).
