# Integration guide

This folder is the real-account M-Pesa payout desk. Supabase is its backend. Wire it into the host site you were given. The browser never decides a balance, a fee, or a payout.

## Styling: host site first

When you place this desk on the host site, the host site’s existing styling is the priority. Do not collide with it.

- Use the host site’s colors, type, spacing, buttons, cards, and form controls. If it already has Bootstrap, utility classes, or CSS variables, use those.
- Do not introduce a second visual system. The ink, signal blue, and IBM Plex styles in this folder are only for running the desk on its own. Drop them when it sits inside the host site.
- Do not add global CSS. Do not style `html`, `body`, `button`, `a`, `input`, or headings in a way that changes the rest of the site. Do not load a second Tailwind preflight over the host stylesheet.
- Keep any leftover desk CSS under one root element, or replace it with the host’s classes. Class names and variables must not override the host’s.
- Match the host’s existing pages so the payout desk looks like it belongs there.

## What each side owns

| Piece | Where it lives |
| --- | --- |
| Member screen and admin screen | This React app |
| Wallet balance, fee rows, withdrawals, activity | Supabase, changed only by SQL functions |
| M-Pesa STK | Host site server. This app does not hold provider secrets |
| STK callback that marks a fee paid | Host site calls `settle_service_fee` with the service role |
| Linking a host-site member to a payout wallet | Host site calls `link_real_account` with the service role |

The anon key in `.env.local` is safe for the browser. The service role key stays on the main site server. Do not put it in Vite, in git, or in this React app.

## 1. Create the Supabase project

1. Create a project.
2. Open the SQL editor and run `supabase/migrations/20261004140000_payout_desk.sql`.
3. In Authentication, turn off “Confirm email” while you are testing. Turn it back on before real members use it.
4. Copy the project URL and the anon key into `real-mpesa-withdraw/.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

5. From this folder, run `npm install` and `npm run dev`. Sign up, then sign in.

A new account gets a preview wallet of **USD 250.00**. That seed is not live money.

To make an admin, run this in the SQL editor after the person has signed up:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users where email = 'you@example.com'
);
```

Fee amounts, the 10% withdrawal fee, the KES rates, the USD 1 minimum, and the KES 400,000 cap are the `payout_settings` row. Change them there. The screen reads them back from `desk_state`.

`preview_stk_confirm` starts as `true`, so “Approve M-Pesa prompt” completes a pending fee inside the app. Set it to `false` before live money:

```sql
update public.payout_settings
set preview_stk_confirm = false
where id = 1;
```

After that, only the main-site callback can complete a fee.

## 2. The rules Supabase enforces

Real account only. Method is M-Pesa only. Minimum withdrawal is the `min_withdraw_usd` setting (installed as USD 1.00).

1. The member requests a payout. Supabase checks the amount, the Kenyan phone, the balance, and the KES 400,000 cap. It debits `wallets.balance_usd` immediately and inserts a withdrawal. Another request can spend whatever balance is left.
2. While the tax compliance fee is not completed, the withdrawal stays `held`. The member is told: “Pay the account tax compliance fee.” The AI bot fee is rejected if they try to pay it.
3. `start_service_fee('tax_compliance')` inserts a pending fee. It does not credit the wallet (`wallet_credited` cannot be true). A second pending fee for the same kind is rejected.
4. When that fee is completed, held withdrawals stay held and the member is told: “Tax compliance is complete. You can pay the AI bot fee.”
5. `start_service_fee('ai_bot')` is rejected until the tax fee is completed.
6. When the bot fee is completed, held withdrawals become `queued`. If one is waiting, the member is told: “Withdrawal request submitted for review.”
7. An admin can reject at any open step. Reject adds the USD back to the same wallet. Completed fees are not returned, because they never entered the wallet.
8. Approve, Send M-Pesa, and Mark paid are rejected until both fees are completed. The order is queued → approved → processing → paid.

Every failure and success is written to `activity_log` with an `operation` name. The admin screen shows the latest rows. Unexpected database errors store `sqlerrm` there and show the member a short message.

## 3. Link a host-site member

Do this from the host site server, with the service role. Never from the browser.

`link_real_account` sets `profiles.external_user_id` to the host site’s member id and sets the Supabase balance. It refuses if that payout wallet already has a withdrawal that was not rejected, so a later sync cannot overwrite a debit.

```php
$payload = json_encode([
    'p_user_id' => $supabaseUserId,
    'p_external_user_id' => (string) $hostUserId,
    'p_balance_usd' => round((float) $realBalanceUsd, 2),
]);
$ch = curl_init(rtrim(getenv('SUPABASE_URL'), '/') . '/rest/v1/rpc/link_real_account');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'apikey: ' . getenv('SUPABASE_SERVICE_ROLE_KEY'),
        'Authorization: Bearer ' . getenv('SUPABASE_SERVICE_ROLE_KEY'),
    ],
    CURLOPT_POSTFIELDS => $payload,
]);
$body = curl_exec($ch);
```

Store `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the host site environment. Do not commit them.

After a successful link, do not also pay that same balance from the host site wallet. The Supabase wallet is the payout ledger. Freeze or move the host balance in your own step so the member cannot withdraw it twice.

Create the Supabase auth user with the Auth admin API (service role) before calling `link_real_account`, or let the member sign up in this app and then link the id you see in `auth.users`.

## 4. M-Pesa prompts stay on the host site

The host site sends the M-Pesa prompt. This app does not hold those secrets.

When `VITE_MAIN_SITE_STK_URL` is set, a successful `start_service_fee` POSTs JSON to that URL:

```json
{
  "ref": "FEE-TAX-…",
  "kind": "tax_compliance",
  "phone": "712345678"
}
```

The header is `Authorization: Bearer <supabase access token>`.

The host endpoint should:

1. Verify the access token with Supabase (`/auth/v1/user`, anon key plus the bearer token).
2. Load the pending `service_fees` row by `ref` with the service role. Use the amount and phone stored there, not a second amount from the browser.
3. Ignore the call unless `status` is `pending` and `kind` matches.
4. Send the STK for `amount_kes` to the member’s phone. The fee is a charge, not a wallet deposit.
5. On the provider callback, call `settle_service_fee`.

```php
$payload = json_encode([
    'p_ref' => $reference,
    'p_receipt' => $mpesaReceipt,
]);
// POST {SUPABASE_URL}/rest/v1/rpc/settle_service_fee
// Headers: apikey and Authorization use the service role.
```

`settle_service_fee` is granted only to `service_role`. A member JWT cannot mark a fee paid once `preview_stk_confirm` is false. Completing the bot fee is still rejected if the tax fee is not completed.

Log STK failures on the host site with the member id, `ref`, `kind`, and an operation name such as `payout_stk_start` or `payout_fee_callback`. Do not log the service role or the provider secret.

Put the new endpoint on the host site’s server. Do not start the M-Pesa prompt from the browser.

## 5. What the browser is allowed to call

Signed-in members, anon key plus their JWT:

- `desk_state`
- `request_withdrawal`
- `start_service_fee`
- `confirm_pending_fee` (no use once preview mode is off)
- `cancel_pending_fee`
- `admin_queue`, `admin_approve`, `admin_send`, `admin_mark_paid`, `admin_reject` (these return “not an admin” unless `profiles.role` is `admin`)

Service role only:

- `settle_service_fee`
- `link_real_account`

Tables have row level security. Members can read their own rows. They cannot insert or update them. Direct writes from the browser do not move money.

## 6. Run and build

```bash
cd real-mpesa-withdraw
npm install
npm run dev
```

`npm run build` writes `dist/`. Serve that as its own host or as a path on the host site. It does not replace the host site’s own withdraw page until the STK URL and the service-role calls above are in place.

Apply this SQL only in Supabase. It is Postgres. Do not run it against the host site’s existing database.
