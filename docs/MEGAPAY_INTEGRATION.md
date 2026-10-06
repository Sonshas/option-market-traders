# MegaPay (M-Pesa) REAL deposits

Live on https://optionmarkettraders.com since 2026-10-03 (web release `20261003-034226`).
REAL **deposits only**. Withdrawals and REAL trading stay disabled. This file contains no secret values.

## Architecture

```
Browser (REAL wallet → Deposit · M-Pesa)
  │  supabase.functions.invoke (user JWT)
  ▼
megapay-deposit  (verify_jwt=true)   GET  → config {enabled, kes_per_usd, min_kes, max_kes}
                                     POST → validate, insert deposits row (PENDING), MegaPay /initiatestk
megapay-status   (verify_jwt=true)   POST {deposit_id} → owner check, MegaPay /transactionstatus, settle
  ▲  polled every 3 s for up to 2 min by the frontend
  │
MegaPay ──POST──► https://optionmarkettraders.com/api/megapay/webhook
                    (Cloudflare → Caddy → https://wkfyavcjjuyzvyeprklz.supabase.co/functions/v1/megapay-webhook)
megapay-webhook  (verify_jwt=false)  logs the event, then:
                    OMT- reference / known request id → re-verify with /transactionstatus → settle
                    any other JSON object            → forward raw body to VAST_WEBHOOK_URL
                    empty / non-JSON body            → logged only
```

Settlement always goes through two `SECURITY DEFINER` functions executable **only by `service_role`**:

- `public.credit_megapay_deposit(p_deposit_id, p_receipt, p_amount_kes, p_raw)` locks the deposit row and returns
  early if it is already `COMPLETED`. It checks provider `megapay`, mode `real`, the KES amount against
  `details.amount_kes`, and that `amount = round(amount_kes / rate, 2)`. Then, in one transaction, it credits
  `wallets.balance` and `available_balance`, inserts a `wallet_ledger` row (`deposit`) and a `transactions` row
  (`deposit`, `COMPLETED`), and marks the deposit `COMPLETED` with the M-Pesa receipt.
- `public.fail_megapay_deposit(p_deposit_id, p_status, p_kind, p_reason, p_raw)` moves `PENDING` to `FAILED`
  or `CANCELLED`.

Money is credited only when MegaPay's own `/transactionstatus` reports `TransactionStatus=Completed`,
`TransactionCode=0` and the exact KES amount. Webhook payloads are unsigned and are never trusted.

### Data model (migration `20261003000000_megapay_deposits`, applied as `megapay_deposits`)

| Field | Meaning |
| --- | --- |
| `deposits.provider` | `megapay` |
| `deposits.method` | `mpesa` |
| `deposits.amount` / `currency` | USD credited (KES ÷ rate, 2 dp) / `USD` |
| `deposits.provider_reference` | MegaPay `transaction_request_id` (= webhook `TransactionID`) |
| `deposits.details.reference` | our `OMT-XXXXXXXX` (12 chars, sent to MegaPay as `reference`) |
| `deposits.details` | `amount_kes`, `rate`, `phone_masked`, `megapay_request_id`, `mpesa_receipt`, `confirmation`, `failure_kind`, `failure_reason` |
| status | `PENDING` → `COMPLETED` / `FAILED` / `CANCELLED` |

Idempotency comes from unique indexes on `(provider, provider_reference)`, `details->>'reference'` (megapay),
`details->>'mpesa_receipt'` (megapay), and `wallet_ledger.reference_id` for `deposit` entries.
A restrictive RLS policy (`deposits_block_client_megapay`) stops browsers from inserting `megapay` rows
directly. Only the Edge Function (service role) can create them.

`public.megapay_webhook_events` is the audit log and forward-retry queue. RLS is on with no policies, so it is
service-role only. Columns: `payload`, `raw_body`, `content_type`, `reference`, `transaction_id`, `routed_to`
(`omt`/`vast`/`unknown`), `forward_status`, `forward_error`, `attempts`, `last_attempt_at`, `processed`,
`process_result`.

### Timeouts and late payments

- The frontend polls for 2 minutes, then shows "Still waiting for M-Pesa".
- `megapay-status` marks a deposit `FAILED` with `failure_kind=expired` once it is older than 10 minutes and
  MegaPay still hasn't confirmed it.
- If MegaPay later confirms an `expired` deposit (late PIN entry, slow callback), the webhook path still
  credits it. `credit_megapay_deposit` accepts `FAILED` + `expired`. Definitive failures (`megapay_failed`,
  `megapay_cancelled`, `initiation_failed`, `amount_mismatch`) are never credited automatically.

## Webhook sharing with vastderiv-traders.com

MegaPay allows one webhook URL per account. Both sites use the same MegaPay account, so the webhook URL in
the MegaPay dashboard must be **`https://optionmarkettraders.com/api/megapay/webhook`**.

- `TransactionReference` starting with `OMT-`, or a `TransactionID` equal to one of our
  `deposits.provider_reference` values, is processed here and is **never forwarded**.
- Any other JSON object is forwarded **verbatim** (same raw body and `Content-Type`) by POST to
  `VAST_WEBHOOK_URL` (default `https://vastderiv-traders.com/api/megapay/webhook`) with an 8-second timeout. We
  never process vast events.
- If a forward fails (no response or a non-2xx status), the event is retried on later webhook calls: up to 5
  attempts, at least 60 seconds apart, within 24 hours. An optimistic claim on `attempts` prevents
  double-forwarding.
- MegaPay always gets HTTP 200 straight away. Processing and forwarding run in `EdgeRuntime.waitUntil`.

vastderiv's handler answers unverifiable payloads with `401 {"error":"Unverified webhook"}`, which suggests it
re-verifies payloads itself. If it also checks the **source IP** or a header, forwarded requests (coming from
Supabase's egress IPs, not MegaPay's) would be rejected. Check `forward_status` after the first real vast
payment (see Reconcile below).

## Secrets (Supabase Dashboard → Edge Functions → Secrets)

| Name | Required | Default |
| --- | --- | --- |
| `MEGAPAY_API_KEY` | **yes** | none. Without it, deposits return 503 "Deposits temporarily unavailable" |
| `MEGAPAY_EMAIL` | **yes** | none (MegaPay login email) |
| `KES_PER_USD` | no | `130` |
| `MEGAPAY_MIN_KES` | no | `1600` |
| `MEGAPAY_MAX_KES` | no | `150000` |
| `VAST_WEBHOOK_URL` | no | `https://vastderiv-traders.com/api/megapay/webhook` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically. The API key must never go in the
repo, the frontend, migrations or logs.

### Changing the rate

Set the `KES_PER_USD` secret (up to 4 decimals, e.g. `129.5`). Redeploying isn't needed: secrets are read
per request. The frontend reads the rate from `megapay-deposit` (GET), so it is defined in one place. Each
deposit stores the rate it was created with (`details.rate`), so changing the rate never affects pending
deposits.

## Feature flags

- `REAL_PAYMENTS_ENABLED = true` (set 2026-10-03). Server-side gate for `megapay-deposit`. Set it to `false` to
  stop new deposits immediately. Pending deposits can still settle.
- `REAL_TRADING_ENABLED = false` (unchanged).
- `KYC_REQUIRED = true`, but the app has no working KYC flow (`kyc_reviews` is empty and every user is
  `not_started`), so deposits are **not** blocked on KYC.
- Frontend: `REAL_INTEGRATION.depositsConfigured = true`. `paymentConfigured` stays `false`, which keeps
  withdrawals disabled ("Coming soon").

## How to test

1. Set the two secrets, then sign in on the live site, switch to REAL, and open Wallet → **Deposit · M-Pesa**.
2. Deposit **KES 10** to your own Safaricom number and enter the PIN.
3. Expected: "Deposit received" within a few seconds. The REAL balance goes up by $0.08 (at 130), and the
   Deposits tab and Transactions page show the row with the M-Pesa receipt.
4. Cancel a second prompt on the phone. Expected: "The M-Pesa request was cancelled." and no credit.

Webhook routing check without touching vastderiv (only ever use `OMT-` test references):

```powershell
$f = "$env:TEMP\omt-test.json"
Set-Content $f -NoNewline -Encoding ascii -Value '{"ResponseCode":1032,"TransactionID":"SOFTPID-TEST","TransactionAmount":10,"TransactionReference":"OMT-TEST-NONEXISTENT"}'
curl.exe -s -X POST https://optionmarkettraders.com/api/megapay/webhook -H "Content-Type: application/json" --data-binary "@$f"
```

Expect `{"status":"received"}` and an event with `routed_to=omt`, `process_result=no_matching_deposit`, and no
forward. Always send test bodies from a file: inline PowerShell quoting splits JSON at spaces.

Unit tests (`apps/web/src/domain/megapay.test.ts`) cover phone normalization, KES→USD rounding (matching
Postgres), config parsing, the reference format, webhook routing, status classification, and that
`supabase/functions/_shared/megapay.ts` is byte-identical to `apps/web/src/domain/megapay.ts`.

## Reconcile

```sql
-- Deposits needing attention
select id, status, amount, details->>'amount_kes' kes, details->>'reference' ref, provider_reference,
       details->>'failure_kind' kind, details->>'mpesa_receipt' receipt, created_at
from public.deposits where provider = 'megapay' order by created_at desc limit 50;

-- Ledger matches completed deposits (expect zero rows)
select d.id from public.deposits d
left join public.wallet_ledger l on l.reference_id = d.id::text and l.entry_type = 'deposit'
where d.provider = 'megapay' and d.status = 'COMPLETED' and l.id is null;

-- Webhook routing / forwarding health
select routed_to, process_result, forward_status, count(*) from public.megapay_webhook_events
where received_at > now() - interval '7 days' group by 1, 2, 3 order by 4 desc;

-- Vast events that exhausted their retries (forward manually or check vastderiv)
select id, received_at, reference, forward_status, forward_error from public.megapay_webhook_events
where routed_to = 'vast' and attempts >= 5 and (forward_status is null or forward_status >= 300);
```

Compare completed deposits with the MegaPay dashboard by receipt (`details->>'mpesa_receipt'`). If a customer
was charged but the deposit shows `FAILED` with kind `expired`, re-run settlement by calling `megapay-status`
for that deposit as the owner. If it's older than the polling window, run
`select public.credit_megapay_deposit(...)` as service role, but only after confirming the payment in the
MegaPay dashboard.

## Failure modes

| Situation | Behaviour |
| --- | --- |
| Secrets missing | `megapay-deposit` POST → 503; the UI shows "Deposits temporarily unavailable" |
| `REAL_PAYMENTS_ENABLED=false` | POST → 403; the UI hides the form |
| MegaPay rejects the STK push | deposit `FAILED` (`initiation_failed`); the user sees a friendly error |
| MegaPay times out on initiation | deposit `FAILED` (`expired`); a later confirmed webhook still credits it |
| User cancels / wrong PIN / phone unreachable | `CANCELLED` / `FAILED` after status verification |
| Webhook never arrives | frontend polling of `megapay-status` settles the deposit anyway |
| Caddy, Cloudflare or the VPS is down | our deposits still settle by polling; vast webhooks are lost until it's back. MegaPay may not retry, so this is a single point of failure for vast |
| vastderiv down | event kept, retried up to 5× in 24 h on later webhook calls |
| Duplicate webhook | idempotent: `credit_megapay_deposit` returns early once `COMPLETED` |

## Security notes

- **Rotate the MegaPay API key** in the MegaPay dashboard (Linked Accounts). It was shared in a chat, and the
  same key also serves vastderiv-traders.com, so update vastderiv's configuration too, then set the new value
  as `MEGAPAY_API_KEY`.
- **Change the MegaPay account password**. It was shared in a chat too.
- The webhook endpoint is public and unsigned. It only routes and logs, and never credits on payload content.
  Bodies are capped at 64 KB.
- The browser cannot create MegaPay deposit rows (restrictive RLS policy) or call the settlement functions
  (no `EXECUTE` for `anon`/`authenticated`).
- The API key is only read inside Edge Functions. It isn't in the repo, the bundle, migrations or logs.

## Files

- `supabase/migrations/20261003000000_megapay_deposits.sql`
- `supabase/functions/megapay-deposit/index.ts`, `megapay-status/index.ts`, `megapay-webhook/index.ts`
- `supabase/functions/_shared/server.ts` (env, MegaPay client, reconciliation) and `_shared/megapay.ts` (pure
  logic, a copy of `apps/web/src/domain/megapay.ts`)
- Frontend: `features/wallet/RealDepositPanel.tsx`, `services/megapay.ts`, `lib/real-wallet-events.ts`,
  `features/wallet/WalletPanels.tsx`, `pages/wallet/TransactionsPage.tsx`, `hooks/useWallet.ts`,
  `providers/wallet/real-wallet-provider.ts`, `providers/config.ts`, `domain/account.ts`
- `deploy/vultr/Caddyfile` (`handle /api/megapay/webhook`). Server backup:
  `/etc/caddy/Caddyfile.bak-20261003-002954`

When `_shared/*` changes, redeploy **all three** functions. Each bundles its own copy of the shared files.
