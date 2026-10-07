# Safaricom Daraja (M-Pesa Express / STK Push) deposits

REAL deposits go straight to our own M-Pesa **Paybill 4088285** through Safaricom Daraja
(Lipa na M-Pesa Online / STK Push). MegaPay stays deployed as a fallback (see "Switching provider").

## Flow

1. The user opens **Deposit** (wallet, or the trading page's Deposit button) → `RealDepositPanel`.
   The panel calls `mpesa-deposit` (GET), which reports the active provider (`DEPOSIT_PROVIDER`),
   the Paybill, KES limits (min 1,600, max 150,000) and the rate (130 KES = $1).
2. The user enters an amount and phone and taps **Deposit** → `mpesa-deposit` (POST, auth required):
   - validates the whole-KES amount and normalises the phone to `2547XXXXXXXX` / `2541XXXXXXXX`;
   - creates a `PENDING` `deposits` row (`provider='daraja'`, `details.reference = OMT-XXXXXXXX`);
   - gets an OAuth token (`GET /oauth/v1/generate?grant_type=client_credentials`, cached in memory until
     shortly before expiry);
   - sends `POST /mpesa/stkpush/v1/processrequest` with `BusinessShortCode=PartyB=4088285`,
     `Password=base64(shortcode+passkey+timestamp)`, `Timestamp` (YYYYMMDDHHmmss, Africa/Nairobi),
     `TransactionType=CustomerPayBillOnline`, `AccountReference=OPTIONMARKET` (constant, max 12 chars,
     overridable with the `MPESA_ACCOUNT_REFERENCE` secret), `TransactionDesc=Deposit`,
     `CallBackURL=https://optionmarkettraders.com/api/mpesa/callback`;
   - the customer's prompt reads "pay KES X to WINSOFT WRITERS, Account no. OPTIONMARKET". The business name
     comes from Safaricom's shortcode registration and cannot be changed via the API;
   - `AccountReference` is never used for matching or crediting (it is the same for every deposit). Deposits
     are matched by `CheckoutRequestID` and confirmed by STK query; the per-deposit `OMT-XXXXXXXX` stays in
     `details->>'reference'` (shown in the panel as the support reference) and `details->>'account_reference'`
     records what was sent;
   - stores `MerchantRequestID` → `merchant_request_id` and `CheckoutRequestID` → `checkout_request_id`
     (also `provider_reference`).
3. Safaricom POSTs the result to `https://optionmarkettraders.com/api/mpesa/callback` → Caddy →
   Edge Function `mpesa-callback` (public, `verify_jwt=false`). It always answers
   `{"ResultCode":0,"ResultDesc":"Accepted"}` immediately and then, in the background:
   - parses `Body.stkCallback`, matches the deposit by `CheckoutRequestID` (unknown/malformed → ignored);
   - stores `result_code`, `result_desc`, `callback_at`, the callback `Amount` and `MpesaReceiptNumber`;
   - **confirms with STK Push Query** (`POST /mpesa/stkpushquery/v1/query`). Callbacks are unsigned, so
     only a query `ResultCode 0` credits money, and the callback amount must equal the requested KES.
4. Crediting uses the existing SECURITY DEFINER `credit_megapay_deposit` (now accepts `megapay` and
   `daraja`): it locks the row, re-checks the KES and USD amounts and the wallet, writes the wallet,
   `wallet_ledger` and `transactions` rows once, and returns `already=true` for repeats. Unique indexes on
   `checkout_request_id`, `mpesa_receipt` and the ledger `reference_id` make double credits impossible.
   Non-zero results go through `fail_megapay_deposit`: `1032` → `CANCELLED`, others (e.g. `1` insufficient
   funds, `1037` unreachable, `2001` wrong PIN) → `FAILED`.
5. The panel polls `mpesa-status` every 3 s for 2 minutes. After ~30 s without a final state (or right after
   a callback) it runs an STK query itself (at most every 10 s), so deposits settle even if the callback is lost.
6. pg_cron job `mpesa-deposit-sweep` (every minute) calls `mpesa-status` in sweep mode: open Daraja deposits
   older than 2 minutes are STK-queried; after 10 minutes without a result they become `FAILED` /
   `failure_kind=expired`. An expired deposit is still credited if Safaricom later confirms payment.

Logs contain only deposit ids, result codes, receipts and masked phones (`254712***678`).

## Secrets (Supabase Dashboard → Edge Functions → Secrets)

| Name | Purpose |
| --- | --- |
| `MPESA_SHORTCODE` | Paybill / BusinessShortCode (4088285) |
| `MPESA_PASSKEY` | Lipa na M-Pesa Online passkey for that shortcode |
| `MPESA_CONSUMER_KEY` | Daraja app consumer key |
| `MPESA_CONSUMER_SECRET` | Daraja app consumer secret |
| `MPESA_ENV` | `production` (default) or `sandbox` |
| `DEPOSIT_PROVIDER` | `daraja` (default) or `megapay` |
| `MPESA_CALLBACK_URL` | optional override; defaults to `https://optionmarkettraders.com/api/mpesa/callback` |
| `MPESA_ACCOUNT_REFERENCE` | optional; "Account no." in the STK prompt, default `OPTIONMARKET`, cut to 12 chars |

`KES_PER_USD`, `MEGAPAY_MIN_KES` and `MEGAPAY_MAX_KES` are shared with MegaPay. Values never go in code,
migrations or the web bundle (the Paybill shown in the UI comes from the server at runtime).

## Components

- Edge Functions: `mpesa-deposit` (verify_jwt on), `mpesa-status` and `mpesa-callback` (verify_jwt off; status
  does its own user auth, and the sweep/health modes require the Vault `real_trade_sweep_secret`).
- Shared: `supabase/functions/_shared/payments/daraja.ts` (pure, byte-identical to
  `apps/web/src/domain/payments/daraja.ts`, enforced by `payments/daraja.test.ts`) and
  `_shared/payments/daraja-server.ts` (OAuth, STK push/query, reconciliation).
  Legacy `_shared/daraja.ts` / `domain/daraja.ts` paths are thin re-export shims.
  Deploy with `npx supabase functions deploy <name> --project-ref wkfyavcjjuyzvyeprklz --use-api`
  (`--no-verify-jwt` for `mpesa-callback` and `mpesa-status`). Redeploy all three when `_shared/payments/daraja*.ts`,
  `server.ts` or `payments/megapay.ts` change.
- Migration: `supabase/migrations/20260920111952_smartbasebinary_host_schema.sql` (section `from: 20261004090000_daraja_deposits.sql`).
- Web: `services/deposits.ts` (provider switch), `features/wallet/RealDepositPanel.tsx`.
- Caddy: `handle /api/mpesa/callback` in `deploy/vultr/Caddyfile`.

## Health check (OAuth)

Run in the Supabase SQL editor, then read the response a few seconds later:

```sql
select net.http_post(
  url := 'https://wkfyavcjjuyzvyeprklz.supabase.co/functions/v1/mpesa-status',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-sweep-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'real_trade_sweep_secret')),
  body := '{"mode":"health"}'::jsonb);
select status_code, content from net._http_response order by created desc limit 1;
```

Expect `"oauth":"ok"`. OAuth success proves the consumer key/secret; only a real STK push proves the passkey
matches the shortcode (a mismatch shows up as an STK push error such as "Invalid Password"/`Bad Request`).

## Testing with a small amount

The in-app minimum is KES 1,600. To test lower, temporarily set the secret `MEGAPAY_MIN_KES=10`
(takes effect on the next request, no deploy) and restore it afterwards.

1. Sign in, switch to REAL, open **Deposit**. The panel shows "M-Pesa (Paybill 4088285)".
2. Enter the amount and your Safaricom number, tap **Deposit**, enter your PIN on the phone.
3. The panel should show "Deposit received" within a few seconds with the M-Pesa receipt.
4. Check in SQL:
   ```sql
   select status, details->>'reference' ref, details->>'amount_kes' kes, amount usd, mpesa_receipt,
          result_code, result_desc, checkout_request_id, created_at
     from deposits where provider = 'daraja' order by created_at desc limit 5;
   ```
   and that exactly one `wallet_ledger` row exists with `reference_id = <deposit id>`.
5. Also try cancelling the prompt on the phone: the deposit becomes `CANCELLED` (result code 1032).

## Switching back to MegaPay (no deploy)

`npx supabase secrets set --project-ref wkfyavcjjuyzvyeprklz DEPOSIT_PROVIDER=megapay`
(or edit it in the Dashboard). The next time the deposit panel opens it uses `megapay-deposit` /
`megapay-status`. Set it back to `daraja` to return. Open Daraja deposits keep settling through the
sweep and callback either way.

## Reconciliation

- **Open deposits**: `select id, created_at, result_code from deposits where provider='daraja' and status in ('PENDING','PROCESSING');`
  The sweep settles these automatically; anything older than 10 minutes is marked expired.
- **Paid but not credited** (e.g. callback amount mismatch or a duplicate receipt): every STK payment shows
  Account No. `OPTIONMARKET` on the M-Pesa org portal statement, so match by receipt number
  (`mpesa_receipt`), or by phone (masked in `details->>'phone_masked'`), amount and time against the deposit row;
  the user's support reference is `details->>'reference'` (`OMT-XXXXXXXX`). If the STK query confirms success, re-run settlement by calling `mpesa-status` as the
  user, or credit manually via `select credit_megapay_deposit('<deposit id>', '<receipt>', <amount_kes>, '{}'::jsonb);`
  as service role (an expired deposit is still creditable; a `FAILED amount_mismatch` one needs review).
- **Daily check**: sum of `COMPLETED` daraja deposits' `details->>'amount_kes'` for the day should equal the
  Paybill's STK (CustomerPayBillOnline) receipts with account number `OPTIONMARKET` on the M-Pesa statement.
- Receipt for a deposit credited via STK query before its callback arrived is filled in by the late callback;
  if the callback never arrives, `mpesa_receipt` stays empty (look it up on the statement by phone, amount and time).

## Safaricom portal checklist

- The Daraja app must be **live (production)** with the M-Pesa Express (Lipa na M-Pesa Online) product for
  shortcode 4088285, and the passkey must be the production one Safaricom emailed for that shortcode.
- No callback URL registration is needed for STK Push: `CallBackURL` is sent with every request. (C2B
  `registerurl` is a separate product and is not used here.)
- The callback host must be publicly reachable over HTTPS with a valid certificate and must not challenge
  Safaricom's POSTs (verified: Cloudflare passes them through; Caddy proxies `/api/mpesa/callback`).
