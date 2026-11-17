# MegaPay (M-Pesa) REAL deposits

Live on https://optionmarkettraders.com. REAL **deposits** via MegaPay STK Push.
This file contains no secret values.

## Architecture

```
Browser (REAL wallet → Deposit · M-Pesa)
  │  supabase.functions.invoke (user JWT)
  ▼
megapay-deposit  (verify_jwt=true)   GET  → config {enabled, till, account_name, kes_per_usd, …}
                                     POST → validate, insert deposits row (PENDING), MegaPay /initiatestk
megapay-status   (verify_jwt=true)   POST {deposit_id} → owner check, MegaPay /transactionstatus, settle
  ▲  polled every 3 s for up to 2 min by the frontend
  │
MegaPay webhook (NOT on this site):
  https://binaryderivpilot.com/api/megapay/webhook
```

**This site does not use** `https://optionmarkettraders.com/api/megapay/webhook`.
Caddy no longer proxies that path. The Edge Function `megapay-webhook` returns HTTP 410 if called.
Deposits settle only when `megapay-status` confirms payment with MegaPay `/transactionstatus`.

Settlement always goes through two `SECURITY DEFINER` functions executable **only by `service_role`**:

- `public.credit_megapay_deposit(p_deposit_id, p_receipt, p_amount_kes, p_raw)`
- `public.fail_megapay_deposit(p_deposit_id, p_status, p_kind, p_reason, p_raw)`

Money is credited only when MegaPay's own `/transactionstatus` reports `TransactionStatus=Completed`,
`TransactionCode=0` and the exact KES amount.

### Timeouts and late payments

- The frontend polls for 2 minutes, then shows "Still waiting for M-Pesa".
- `megapay-status` marks a deposit `FAILED` with `failure_kind=expired` once it is older than 10 minutes and
  MegaPay still hasn't confirmed it.
- If MegaPay later confirms an `expired` deposit (late PIN entry), a later `megapay-status` call still
  credits it. `credit_megapay_deposit` accepts `FAILED` + `expired`.

## Secrets (Supabase Dashboard → Edge Functions → Secrets)

| Name | Required | Default |
| --- | --- | --- |
| `MEGAPAY_API_KEY` | **yes** | none. Without it, deposits return 503 "Deposits temporarily unavailable" |
| `MEGAPAY_EMAIL` | **yes** | none (MegaPay login email) |
| `MEGAPAY_TILL` | no | Buy-goods Till shown in the deposit UI (also overridable via `payment_settings.MEGAPAY_TILL`) |
| `MEGAPAY_ACCOUNT_NAME` | no | Business name shown in the deposit UI |
| `DEPOSIT_PROVIDER` | no | `megapay` (Daraja deposits are retired) |
| `KES_PER_USD` | no | `130` |
| `MEGAPAY_MIN_KES` | no | `1600` |
| `MEGAPAY_MAX_KES` | no | `150000` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically. The API key must never go in the
repo, the frontend, migrations or logs.

## MegaPay dashboard

- Webhook URL: **`https://binaryderivpilot.com/api/megapay/webhook`** (not this site).
- Linked till / account name must match the Edge secrets / `payment_settings` display values.

## Files

- `supabase/functions/megapay-deposit/index.ts`, `megapay-status/index.ts`
- `supabase/functions/megapay-webhook/index.ts` (returns 410; not routed by Caddy)
- `supabase/functions/_shared/server.ts` and `_shared/payments/megapay.ts`
- Frontend: `features/wallet/RealDepositPanel.tsx`, `services/megapay.ts`, `services/deposits.ts`
- `deploy/vultr/Caddyfile` — no `/api/megapay/webhook` handle
