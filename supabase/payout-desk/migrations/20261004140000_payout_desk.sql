-- =============================================================================
-- Payout desk — consolidated schema (fresh Supabase install)
-- =============================================================================
-- FOR FRESH SUPABASE INSTALLS ONLY. Merges:
--   - 20261004140000_payout_desk.sql
--   - 20261005180000_admin_payout_settings.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- from: 20261004140000_payout_desk.sql
-- ---------------------------------------------------------------------------

-- Real-account M-Pesa payout desk.
-- The browser uses the anon key and can only call the granted functions.
-- Wallet debits, fee order, and admin payout steps run here.
-- Apply this file in the Supabase SQL editor. Do not put the service role key in the React app.

create table if not exists public.payout_settings (
  id integer primary key default 1 check (id = 1),
  min_withdraw_usd numeric(14,2) not null default 1.00,
  withdrawal_fee_percent numeric(8,4) not null default 10,
  kes_per_usd_withdrawal numeric(14,4) not null default 125,
  kes_per_usd_deposit numeric(14,4) not null default 134,
  mpesa_cap_kes numeric(14,2) not null default 400000,
  tax_fee_usd numeric(14,2) not null default 25.00,
  bot_fee_usd numeric(14,2) not null default 40.00,
  -- true: the member can confirm a pending prompt in this app.
  -- Set false before live money. The main site callback then calls settle_service_fee.
  preview_stk_confirm boolean not null default true
);

insert into public.payout_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  role text not null default 'member' check (role in ('member', 'admin')),
  external_user_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance_usd numeric(14,2) not null default 250.00 check (balance_usd >= 0)
);

create table if not exists public.service_fees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('tax_compliance', 'ai_bot')),
  status text not null check (status in ('pending', 'completed', 'cancelled')),
  amount_usd numeric(14,2) not null check (amount_usd > 0),
  amount_kes integer not null check (amount_kes > 0),
  ref text not null unique,
  wallet_credited boolean not null default false check (wallet_credited = false),
  mpesa_receipt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_fees_one_pending
  on public.service_fees (user_id, kind)
  where status = 'pending';

create unique index if not exists service_fees_one_completed
  on public.service_fees (user_id, kind)
  where status = 'completed';

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_usd numeric(14,2) not null check (amount_usd > 0),
  fee_usd numeric(14,2) not null check (fee_usd >= 0),
  net_usd numeric(14,2) not null check (net_usd > 0),
  kes_payout numeric(14,2) not null check (kes_payout > 0),
  phone text not null,
  workflow text not null check (workflow in ('held', 'queued', 'approved', 'processing', 'paid', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists withdrawals_user_created
  on public.withdrawals (user_id, created_at desc);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  level text not null check (level in ('info', 'warning', 'error')),
  operation text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created
  on public.activity_log (created_at desc);

alter table public.payout_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.service_fees enable row level security;
alter table public.withdrawals enable row level security;
alter table public.activity_log enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$fn$;

create or replace function public.normalize_ke_phone(p_raw text)
returns text
language plpgsql
immutable
as $fn$
declare
  d text := regexp_replace(coalesce(p_raw, ''), '\D', '', 'g');
begin
  if d like '254%' and char_length(d) = 12 then
    d := substring(d from 4);
  elsif d like '0%' and char_length(d) = 10 then
    d := substring(d from 2);
  end if;
  if d ~ '^[17][0-9]{8}$' then
    return d;
  end if;
  return null;
end;
$fn$;

create or replace function public.fee_stage(p_user uuid, p_kind text)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    when exists (
      select 1 from public.service_fees
      where user_id = p_user and kind = p_kind and status = 'completed'
    ) then 'completed'
    when exists (
      select 1 from public.service_fees
      where user_id = p_user and kind = p_kind and status = 'pending'
    ) then 'pending'
    else 'unpaid'
  end;
$fn$;

create or replace function public.fees_clear(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.fee_stage(p_user, 'tax_compliance') = 'completed'
     and public.fee_stage(p_user, 'ai_bot') = 'completed';
$fn$;

create or replace function public.gate_message(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    when public.fee_stage(p_user, 'tax_compliance') <> 'completed' then 'Pay the account tax compliance fee.'
    when public.fee_stage(p_user, 'ai_bot') <> 'completed' then 'Tax compliance is complete. You can pay the AI bot fee.'
    else 'Withdrawal request submitted for review.'
  end;
$fn$;

create or replace function public.workflow_label(p_workflow text, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    when p_workflow = 'rejected' then 'Returned to real account'
    when p_workflow = 'paid' then 'Paid'
    when p_workflow = 'processing' then 'M-Pesa send started'
    when p_workflow = 'approved' then 'Approved'
    when not public.fees_clear(p_user) and public.fee_stage(p_user, 'tax_compliance') <> 'completed'
      then 'Waiting on tax compliance fee'
    when not public.fees_clear(p_user) then 'Waiting on AI bot fee'
    when p_workflow in ('queued', 'held') then 'Submitted for review'
    else 'Pending'
  end;
$fn$;

create or replace function public.action_result(
  p_ok boolean,
  p_level text,
  p_operation text,
  p_message text,
  p_user uuid,
  p_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.activity_log (user_id, level, operation, message)
  values (p_user, p_level, p_operation, p_message);
  return jsonb_strip_nulls(jsonb_build_object(
    'ok', p_ok,
    'level', p_level,
    'operation', p_operation,
    'message', p_message,
    'ref', p_ref
  ));
end;
$fn$;

create or replace function public.release_holds(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if public.fees_clear(p_user) then
    update public.withdrawals
      set workflow = 'queued'
      where user_id = p_user and workflow = 'held';
  end if;
end;
$fn$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  insert into public.wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.withdrawal_rows(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(jsonb_agg(row.obj order by row.created_at desc), '[]'::jsonb)
  from (
    select
      w.created_at,
      jsonb_build_object(
        'id', w.id,
        'amountUsd', w.amount_usd::float,
        'feeUsd', w.fee_usd::float,
        'netUsd', w.net_usd::float,
        'kesPayout', w.kes_payout::float,
        'phone', w.phone,
        'createdAt', w.created_at,
        'workflow', w.workflow,
        'label', public.workflow_label(w.workflow, w.user_id)
      ) as obj
    from public.withdrawals w
    where w.user_id = p_user
  ) row;
$fn$;

create or replace function public.desk_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_balance numeric;
  v_email text;
  v_settings public.payout_settings%rowtype;
  v_tax_ref text;
  v_bot_ref text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'level', 'warning', 'operation', 'desk_state_auth', 'message', 'Sign in to open the payout desk.');
  end if;
  select * into v_profile from public.profiles where id = v_user;
  select balance_usd into v_balance from public.wallets where user_id = v_user;
  select email into v_email from auth.users where id = v_user;
  select * into v_settings from public.payout_settings where id = 1;
  select ref into v_tax_ref from public.service_fees
    where user_id = v_user and kind = 'tax_compliance' and status = 'pending'
    order by created_at desc limit 1;
  select ref into v_bot_ref from public.service_fees
    where user_id = v_user and kind = 'ai_bot' and status = 'pending'
    order by created_at desc limit 1;
  return jsonb_build_object(
    'ok', true,
    'email', coalesce(v_email, ''),
    'role', coalesce(v_profile.role, 'member'),
    'balanceUsd', coalesce(v_balance, 0)::float,
    'phone', coalesce(v_profile.phone, ''),
    'tax', public.fee_stage(v_user, 'tax_compliance'),
    'bot', public.fee_stage(v_user, 'ai_bot'),
    'taxRef', v_tax_ref,
    'botRef', v_bot_ref,
    'previewStkConfirm', coalesce(v_settings.preview_stk_confirm, false),
    'rates', jsonb_build_object(
      'minWithdrawUsd', v_settings.min_withdraw_usd::float,
      'withdrawalFeePercent', v_settings.withdrawal_fee_percent::float,
      'kesPerUsdWithdrawal', v_settings.kes_per_usd_withdrawal::float,
      'kesPerUsdDeposit', v_settings.kes_per_usd_deposit::float,
      'mpesaCapKes', v_settings.mpesa_cap_kes::float,
      'taxFeeUsd', v_settings.tax_fee_usd::float,
      'botFeeUsd', v_settings.bot_fee_usd::float
    ),
    'withdrawals', public.withdrawal_rows(v_user)
  );
end;
$fn$;

create or replace function public.request_withdrawal(p_amount text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
  v_settings public.payout_settings%rowtype;
  v_amount numeric;
  v_balance numeric;
  v_fee numeric;
  v_net numeric;
  v_kes numeric;
  v_phone text;
  v_workflow text;
begin
  if v_user is null then
    return public.action_result(false, 'warning', 'member_withdrawal_auth', 'Sign in to request a payout.', null);
  end if;
  if p_amount is null or btrim(p_amount) = '' or btrim(p_amount) !~ '^[0-9]+(\.[0-9]{1,2})?$' then
    return public.action_result(false, 'warning', 'member_withdrawal_amount', 'Enter a withdrawal amount.', v_user);
  end if;
  select * into v_settings from public.payout_settings where id = 1;
  v_amount := round(btrim(p_amount)::numeric, 2);
  if v_amount < v_settings.min_withdraw_usd then
    return public.action_result(false, 'warning', 'member_withdrawal_min', 'Minimum withdrawal is USD ' || to_char(v_settings.min_withdraw_usd, 'FM999999990.00') || '.', v_user);
  end if;
  v_phone := public.normalize_ke_phone(p_phone);
  if v_phone is null then
    return public.action_result(false, 'warning', 'member_withdrawal_phone', 'Enter a Kenyan M-Pesa number.', v_user);
  end if;
  v_fee := round(v_amount * v_settings.withdrawal_fee_percent / 100, 2);
  v_net := round(v_amount - v_fee, 2);
  v_kes := round(v_net * v_settings.kes_per_usd_withdrawal, 2);
  if v_net <= 0 then
    return public.action_result(false, 'warning', 'member_withdrawal_net', 'The amount is too small after the withdrawal fee.', v_user);
  end if;
  if v_kes > v_settings.mpesa_cap_kes then
    return public.action_result(false, 'warning', 'member_withdrawal_cap', 'M-Pesa withdrawals are limited to KES 400,000 per transaction. Enter a smaller amount. You can submit another withdrawal for the rest.', v_user);
  end if;

  select balance_usd into v_balance
  from public.wallets
  where user_id = v_user
  for update;
  if not found then
    return public.action_result(false, 'error', 'member_withdrawal_wallet', 'Real account wallet was not found.', v_user);
  end if;
  if v_amount > v_balance then
    return public.action_result(false, 'warning', 'member_withdrawal_balance', 'Your real-account balance is too low for this amount.', v_user);
  end if;

  v_workflow := case when public.fees_clear(v_user) then 'queued' else 'held' end;
  insert into public.withdrawals (user_id, amount_usd, fee_usd, net_usd, kes_payout, phone, workflow)
  values (v_user, v_amount, v_fee, v_net, v_kes, v_phone, v_workflow);
  update public.wallets set balance_usd = round(balance_usd - v_amount, 2) where user_id = v_user;
  update public.profiles set phone = v_phone where id = v_user;
  return public.action_result(true, 'info', 'member_withdrawal_create', public.gate_message(v_user), v_user);
exception
  when others then
    insert into public.activity_log (user_id, level, operation, message)
    values (v_user, 'error', 'member_withdrawal_create', sqlerrm);
    return jsonb_build_object('ok', false, 'level', 'error', 'operation', 'member_withdrawal_create', 'message', 'Withdrawal could not be created.');
end;
$fn$;

create or replace function public.start_service_fee(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
  v_settings public.payout_settings%rowtype;
  v_usd numeric;
  v_kes integer;
  v_ref text;
  v_operation text;
begin
  if v_user is null then
    return public.action_result(false, 'warning', 'service_fee_auth', 'Sign in to pay this fee.', null);
  end if;
  if p_kind not in ('tax_compliance', 'ai_bot') then
    return public.action_result(false, 'warning', 'service_fee_kind', 'Choose the tax compliance fee or the AI bot fee.', v_user);
  end if;
  if p_kind = 'ai_bot' and public.fee_stage(v_user, 'tax_compliance') <> 'completed' then
    return public.action_result(false, 'warning', 'bot_fee_before_tax', 'Pay the account tax compliance fee first.', v_user);
  end if;
  select * into v_settings from public.payout_settings where id = 1;
  v_usd := case when p_kind = 'tax_compliance' then v_settings.tax_fee_usd else v_settings.bot_fee_usd end;
  v_kes := round(v_usd * v_settings.kes_per_usd_deposit)::integer;
  v_operation := case when p_kind = 'tax_compliance' then 'tax_stk_start' else 'bot_fee_stk_start' end;
  if v_usd <= 0 or v_kes < 1 then
    return public.action_result(false, 'error', v_operation, case when p_kind = 'tax_compliance' then 'Tax compliance fee is not available.' else 'AI bot fee is not available.' end, v_user);
  end if;
  if public.fee_stage(v_user, p_kind) = 'completed' then
    return public.action_result(
      false, 'warning',
      case when p_kind = 'tax_compliance' then 'tax_fee_already_paid' else 'bot_fee_already_paid' end,
      case when p_kind = 'tax_compliance' then 'Tax compliance is already complete on this account.' else 'The AI bot fee is already complete on this account.' end,
      v_user
    );
  end if;
  if public.fee_stage(v_user, p_kind) = 'pending' then
    return public.action_result(
      false, 'warning',
      case when p_kind = 'tax_compliance' then 'tax_fee_pending' else 'bot_fee_pending' end,
      case when p_kind = 'tax_compliance'
        then 'A tax compliance payment is already pending. Approve it on your phone or cancel it first.'
        else 'An AI bot payment is already pending. Approve it on your phone or cancel it first.'
      end,
      v_user
    );
  end if;
  v_ref := case when p_kind = 'tax_compliance' then 'FEE-TAX-' else 'FEE-BOT-' end
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into public.service_fees (user_id, kind, status, amount_usd, amount_kes, ref, wallet_credited)
  values (v_user, p_kind, 'pending', v_usd, v_kes, v_ref, false);
  return public.action_result(
    true,
    'info',
    v_operation,
    case when p_kind = 'tax_compliance'
      then 'M-Pesa prompt sent for the tax compliance fee. It does not credit your real account.'
      else 'M-Pesa prompt sent for the AI bot fee. It does not credit your real account.'
    end,
    v_user,
    v_ref
  );
exception
  when unique_violation then
    return public.action_result(false, 'warning', v_operation, 'A payment for this fee is already pending.', v_user);
  when others then
    insert into public.activity_log (user_id, level, operation, message)
    values (v_user, 'error', coalesce(v_operation, 'service_fee_start'), sqlerrm);
    return jsonb_build_object('ok', false, 'level', 'error', 'operation', 'service_fee_start', 'message', 'The fee payment could not be started.');
end;
$fn$;

create or replace function public.finish_fee(p_fee_id uuid, p_receipt text, p_operation text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fee public.service_fees%rowtype;
  v_message text;
begin
  select * into v_fee from public.service_fees where id = p_fee_id for update;
  if not found then
    return public.action_result(false, 'error', p_operation, 'That fee payment is not pending.', null);
  end if;
  if v_fee.status <> 'pending' then
    return public.action_result(false, 'error', p_operation, 'That fee payment is not pending.', v_fee.user_id);
  end if;
  if v_fee.kind = 'ai_bot' and public.fee_stage(v_fee.user_id, 'tax_compliance') <> 'completed' then
    return public.action_result(false, 'error', 'bot_fee_before_tax', 'Pay the account tax compliance fee first.', v_fee.user_id);
  end if;
  update public.service_fees
    set status = 'completed',
        wallet_credited = false,
        mpesa_receipt = nullif(btrim(coalesce(p_receipt, '')), ''),
        updated_at = now()
    where id = v_fee.id;
  perform public.release_holds(v_fee.user_id);
  if v_fee.kind = 'ai_bot' and exists (
    select 1 from public.withdrawals where user_id = v_fee.user_id and workflow = 'queued'
  ) then
    v_message := 'Withdrawal request submitted for review.';
  elsif v_fee.kind = 'ai_bot' then
    v_message := 'AI bot fee paid. You can request an M-Pesa payout.';
  else
    v_message := public.gate_message(v_fee.user_id);
  end if;
  return public.action_result(true, 'info', p_operation, v_message, v_fee.user_id, v_fee.ref);
end;
$fn$;

create or replace function public.confirm_pending_fee(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
  v_preview boolean;
  v_fee_id uuid;
  v_operation text;
begin
  if v_user is null then
    return public.action_result(false, 'warning', 'fee_confirm_auth', 'Sign in to continue.', null);
  end if;
  select preview_stk_confirm into v_preview from public.payout_settings where id = 1;
  v_operation := case when p_kind = 'tax_compliance' then 'tax_fee_complete' else 'bot_fee_complete' end;
  if coalesce(v_preview, false) = false then
    return public.action_result(false, 'warning', v_operation, 'Approve the prompt on your phone. This page updates when M-Pesa confirms the payment.', v_user);
  end if;
  if p_kind = 'ai_bot' and public.fee_stage(v_user, 'tax_compliance') <> 'completed' then
    return public.action_result(false, 'warning', 'bot_fee_before_tax', 'Pay the account tax compliance fee first.', v_user);
  end if;
  select id into v_fee_id
  from public.service_fees
  where user_id = v_user and kind = p_kind and status = 'pending'
  order by created_at desc
  limit 1
  for update;
  if v_fee_id is null then
    return public.action_result(false, 'error', v_operation, case when p_kind = 'tax_compliance' then 'Tax compliance fee is not pending.' else 'AI bot fee is not pending.' end, v_user);
  end if;
  return public.finish_fee(v_fee_id, '', v_operation);
exception
  when others then
    insert into public.activity_log (user_id, level, operation, message)
    values (v_user, 'error', 'fee_confirm', sqlerrm);
    return jsonb_build_object('ok', false, 'level', 'error', 'operation', 'fee_confirm', 'message', 'The fee payment could not be completed.');
end;
$fn$;

create or replace function public.settle_service_fee(p_ref text, p_receipt text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fee public.service_fees%rowtype;
  v_operation text;
begin
  select * into v_fee
  from public.service_fees
  where ref = upper(btrim(coalesce(p_ref, '')))
  for update;
  if not found then
    insert into public.activity_log (user_id, level, operation, message)
    values (null, 'error', 'service_fee_settle', 'Unknown fee reference.');
    return jsonb_build_object('ok', false, 'level', 'error', 'operation', 'service_fee_settle', 'message', 'Unknown fee reference.');
  end if;
  if v_fee.status = 'completed' then
    return public.action_result(true, 'info', 'service_fee_settle', 'Fee payment was already complete.', v_fee.user_id, v_fee.ref);
  end if;
  v_operation := case when v_fee.kind = 'tax_compliance' then 'tax_fee_complete' else 'bot_fee_complete' end;
  return public.finish_fee(v_fee.id, p_receipt, v_operation);
exception
  when others then
    insert into public.activity_log (user_id, level, operation, message)
    values (null, 'error', 'service_fee_settle', sqlerrm);
    return jsonb_build_object('ok', false, 'level', 'error', 'operation', 'service_fee_settle', 'message', 'The fee payment could not be completed.');
end;
$fn$;

create or replace function public.cancel_pending_fee(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_operation text;
begin
  if v_user is null then
    return public.action_result(false, 'warning', 'fee_cancel_auth', 'Sign in to continue.', null);
  end if;
  v_operation := case when p_kind = 'tax_compliance' then 'tax_fee_cancel' else 'bot_fee_cancel' end;
  select id into v_id
  from public.service_fees
  where user_id = v_user and kind = p_kind and status = 'pending'
  order by created_at desc
  limit 1
  for update;
  if v_id is null then
    return public.action_result(
      false, 'warning', v_operation,
      case when p_kind = 'tax_compliance' then 'There is no tax compliance payment to cancel.' else 'There is no AI bot payment to cancel.' end,
      v_user
    );
  end if;
  update public.service_fees set status = 'cancelled', updated_at = now() where id = v_id;
  return public.action_result(
    true, 'info', v_operation,
    case when p_kind = 'tax_compliance'
      then 'Tax compliance payment cancelled. The withdrawal stays on that fee.'
      else 'AI bot payment cancelled. The withdrawal stays on that fee.'
    end,
    v_user
  );
exception
  when others then
    insert into public.activity_log (user_id, level, operation, message)
    values (v_user, 'error', v_operation, sqlerrm);
    return jsonb_build_object('ok', false, 'level', 'error', 'operation', 'fee_cancel', 'message', 'The fee payment could not be cancelled.');
end;
$fn$;

create or replace function public.require_admin()
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not public.is_admin() then
    return null;
  end if;
  return v_user;
end;
$fn$;

create or replace function public.admin_queue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_admin uuid := public.require_admin();
begin
  if v_admin is null then
    return jsonb_build_object('ok', false, 'level', 'warning', 'operation', 'admin_queue', 'message', 'This account is not an admin.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'withdrawals', coalesce((
      select jsonb_agg(row.obj order by row.created_at desc)
      from (
        select
          w.created_at,
          jsonb_build_object(
            'id', w.id,
            'amountUsd', w.amount_usd::float,
            'feeUsd', w.fee_usd::float,
            'netUsd', w.net_usd::float,
            'kesPayout', w.kes_payout::float,
            'phone', w.phone,
            'createdAt', w.created_at,
            'workflow', w.workflow,
            'label', public.workflow_label(w.workflow, w.user_id),
            'email', u.email,
            'member', p.full_name
          ) as obj
        from public.withdrawals w
        join public.profiles p on p.id = w.user_id
        join auth.users u on u.id = w.user_id
      ) row
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(row.obj order by row.created_at desc)
      from (
        select
          a.created_at,
          jsonb_build_object(
            'id', a.id,
            'at', a.created_at,
            'level', a.level,
            'operation', a.operation,
            'message', a.message
          ) as obj
        from public.activity_log a
        order by a.created_at desc
        limit 20
      ) row
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.admin_set_workflow(p_id uuid, p_next text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_admin uuid := public.require_admin();
  v_row public.withdrawals%rowtype;
  v_operation text;
  v_message text;
begin
  if v_admin is null then
    return public.action_result(false, 'warning', 'admin_withdraw_auth', 'This account is not an admin.', auth.uid());
  end if;
  select * into v_row from public.withdrawals where id = p_id for update;
  if not found or v_row.workflow in ('paid', 'rejected') then
    return public.action_result(false, 'error', 'admin_withdraw_missing', 'That withdrawal is no longer open.', v_admin);
  end if;

  if p_next = 'rejected' then
    update public.withdrawals set workflow = 'rejected' where id = v_row.id;
    update public.wallets
      set balance_usd = round(balance_usd + v_row.amount_usd, 2)
      where user_id = v_row.user_id;
    return public.action_result(true, 'info', 'admin_withdraw_reject', 'The live-wallet amount was returned. Tax and bot fees stay as paid, because they never credited the wallet.', v_row.user_id);
  end if;

  if not public.fees_clear(v_row.user_id) then
    return public.action_result(false, 'warning', 'admin_withdraw_fees', 'Both fees must be completed before this payout can be sent.', v_row.user_id);
  end if;

  if p_next = 'approved' then
    v_operation := 'admin_withdraw_approve';
    if v_row.workflow <> 'queued' then
      return public.action_result(false, 'warning', v_operation, 'Approve is only available once the withdrawal is in review.', v_row.user_id);
    end if;
    v_message := 'Withdrawal approved. Send the M-Pesa payout next.';
  elsif p_next = 'processing' then
    v_operation := 'admin_withdraw_send';
    if v_row.workflow <> 'approved' then
      return public.action_result(false, 'warning', v_operation, 'Approve the withdrawal before sending M-Pesa.', v_row.user_id);
    end if;
    v_message := 'M-Pesa send started to 254' || v_row.phone || ' for KES ' || to_char(v_row.kes_payout, 'FM999999990.00') || '. Mark it paid when the payout is confirmed.';
  elsif p_next = 'paid' then
    v_operation := 'admin_withdraw_paid';
    if v_row.workflow <> 'processing' then
      return public.action_result(false, 'warning', v_operation, 'Send the M-Pesa payout before marking it paid.', v_row.user_id);
    end if;
    v_message := 'M-Pesa payout marked paid.';
  else
    return public.action_result(false, 'error', 'admin_withdraw_step', 'That payout step is not available.', v_admin);
  end if;

  update public.withdrawals set workflow = p_next where id = v_row.id;
  return public.action_result(true, 'info', v_operation, v_message, v_row.user_id);
exception
  when others then
    insert into public.activity_log (user_id, level, operation, message)
    values (v_admin, 'error', 'admin_withdraw_step', sqlerrm);
    return jsonb_build_object('ok', false, 'level', 'error', 'operation', 'admin_withdraw_step', 'message', 'The payout could not be updated.');
end;
$fn$;

create or replace function public.admin_approve(p_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  select public.admin_set_workflow(p_id, 'approved');
$fn$;

create or replace function public.admin_send(p_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  select public.admin_set_workflow(p_id, 'processing');
$fn$;

create or replace function public.admin_mark_paid(p_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  select public.admin_set_workflow(p_id, 'paid');
$fn$;

create or replace function public.admin_reject(p_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  select public.admin_set_workflow(p_id, 'rejected');
$fn$;

-- Main site only. Funds the Supabase wallet from the PHP real account once.
create or replace function public.link_real_account(
  p_user_id uuid,
  p_external_user_id text,
  p_balance_usd numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_external text := nullif(btrim(coalesce(p_external_user_id, '')), '');
begin
  if p_user_id is null or v_external is null then
    return jsonb_build_object('ok', false, 'level', 'warning', 'operation', 'link_real_account', 'message', 'A member and a main-site user id are required.');
  end if;
  if coalesce(p_balance_usd, 0) < 0 then
    return jsonb_build_object('ok', false, 'level', 'warning', 'operation', 'link_real_account', 'message', 'Balance cannot be negative.');
  end if;
  if exists (
    select 1 from public.withdrawals
    where user_id = p_user_id and workflow <> 'rejected'
  ) then
    return jsonb_build_object('ok', false, 'level', 'warning', 'operation', 'link_real_account', 'message', 'This payout wallet already has a withdrawal. Do not overwrite it.');
  end if;
  update public.profiles set external_user_id = v_external where id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'level', 'error', 'operation', 'link_real_account', 'message', 'Supabase profile was not found.');
  end if;
  update public.wallets set balance_usd = round(p_balance_usd, 2) where user_id = p_user_id;
  insert into public.activity_log (user_id, level, operation, message)
  values (p_user_id, 'info', 'link_real_account', 'Real account linked from the main site.');
  return jsonb_build_object('ok', true, 'level', 'info', 'operation', 'link_real_account', 'message', 'Real account linked.');
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'level', 'warning', 'operation', 'link_real_account', 'message', 'That main-site user is already linked to another payout account.');
  when others then
    insert into public.activity_log (user_id, level, operation, message)
    values (p_user_id, 'error', 'link_real_account', sqlerrm);
    return jsonb_build_object('ok', false, 'level', 'error', 'operation', 'link_real_account', 'message', 'The real account could not be linked.');
end;
$fn$;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "read own wallet" on public.wallets;
create policy "read own wallet" on public.wallets
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "read own fees" on public.service_fees;
create policy "read own fees" on public.service_fees
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "read own withdrawals" on public.withdrawals;
create policy "read own withdrawals" on public.withdrawals
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "read own activity" on public.activity_log;
create policy "read own activity" on public.activity_log
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.normalize_ke_phone(text) from public, anon, authenticated;
revoke all on function public.fee_stage(uuid, text) from public, anon, authenticated;
revoke all on function public.fees_clear(uuid) from public, anon, authenticated;
revoke all on function public.gate_message(uuid) from public, anon, authenticated;
revoke all on function public.workflow_label(text, uuid) from public, anon, authenticated;
revoke all on function public.action_result(boolean, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.release_holds(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.withdrawal_rows(uuid) from public, anon, authenticated;
revoke all on function public.finish_fee(uuid, text, text) from public, anon, authenticated;
revoke all on function public.require_admin() from public, anon, authenticated;
revoke all on function public.admin_set_workflow(uuid, text) from public, anon, authenticated;
revoke all on function public.settle_service_fee(text, text) from public, anon, authenticated;
revoke all on function public.link_real_account(uuid, text, numeric) from public, anon, authenticated;

revoke all on function public.desk_state() from public, anon;
revoke all on function public.request_withdrawal(text, text) from public, anon;
revoke all on function public.start_service_fee(text) from public, anon;
revoke all on function public.confirm_pending_fee(text) from public, anon;
revoke all on function public.cancel_pending_fee(text) from public, anon;
revoke all on function public.admin_queue() from public, anon;
revoke all on function public.admin_approve(uuid) from public, anon;
revoke all on function public.admin_send(uuid) from public, anon;
revoke all on function public.admin_mark_paid(uuid) from public, anon;
revoke all on function public.admin_reject(uuid) from public, anon;

grant execute on function public.desk_state() to authenticated;
grant execute on function public.request_withdrawal(text, text) to authenticated;
grant execute on function public.start_service_fee(text) to authenticated;
grant execute on function public.confirm_pending_fee(text) to authenticated;
grant execute on function public.cancel_pending_fee(text) to authenticated;
grant execute on function public.admin_queue() to authenticated;
grant execute on function public.admin_approve(uuid) to authenticated;
grant execute on function public.admin_send(uuid) to authenticated;
grant execute on function public.admin_mark_paid(uuid) to authenticated;
grant execute on function public.admin_reject(uuid) to authenticated;

grant execute on function public.settle_service_fee(text, text) to service_role;
grant execute on function public.link_real_account(uuid, text, numeric) to service_role;


-- ---------------------------------------------------------------------------
-- from: 20261005180000_admin_payout_settings.sql
-- ---------------------------------------------------------------------------

-- Allow the host admin-fees Edge Function (service role) to read/update desk rates.
-- Members still only see rates through desk_state(); browsers never get the service role.

revoke insert, update, delete, truncate, references, trigger on public.payout_settings from anon, authenticated;
grant select on public.payout_settings to authenticated;
grant select, update on public.payout_settings to service_role;

create or replace function public.admin_payout_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_settings public.payout_settings%rowtype;
begin
  if auth.role() is distinct from 'service_role'
     and (auth.uid() is null or not public.is_admin()) then
    return jsonb_build_object('ok', false, 'message', 'Admin only.');
  end if;
  select * into v_settings from public.payout_settings where id = 1;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Payout settings row missing.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'minWithdrawUsd', v_settings.min_withdraw_usd::float,
    'withdrawalFeePercent', v_settings.withdrawal_fee_percent::float,
    'kesPerUsdWithdrawal', v_settings.kes_per_usd_withdrawal::float,
    'kesPerUsdDeposit', v_settings.kes_per_usd_deposit::float,
    'mpesaCapKes', v_settings.mpesa_cap_kes::float,
    'taxFeeUsd', v_settings.tax_fee_usd::float,
    'botFeeUsd', v_settings.bot_fee_usd::float,
    'previewStkConfirm', coalesce(v_settings.preview_stk_confirm, false)
  );
end;
$fn$;

create or replace function public.admin_update_payout_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_settings public.payout_settings%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  if auth.role() is distinct from 'service_role'
     and (auth.uid() is null or not public.is_admin()) then
    return jsonb_build_object('ok', false, 'message', 'Admin only.');
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'message', 'Invalid settings payload.');
  end if;

  update public.payout_settings set
    min_withdraw_usd = case
      when v_patch ? 'minWithdrawUsd' then greatest(0.01, (v_patch->>'minWithdrawUsd')::numeric)
      else min_withdraw_usd end,
    withdrawal_fee_percent = case
      when v_patch ? 'withdrawalFeePercent' then greatest(0, least(90, (v_patch->>'withdrawalFeePercent')::numeric))
      else withdrawal_fee_percent end,
    kes_per_usd_withdrawal = case
      when v_patch ? 'kesPerUsdWithdrawal' then greatest(1, (v_patch->>'kesPerUsdWithdrawal')::numeric)
      else kes_per_usd_withdrawal end,
    kes_per_usd_deposit = case
      when v_patch ? 'kesPerUsdDeposit' then greatest(1, (v_patch->>'kesPerUsdDeposit')::numeric)
      else kes_per_usd_deposit end,
    mpesa_cap_kes = case
      when v_patch ? 'mpesaCapKes' then greatest(1, (v_patch->>'mpesaCapKes')::numeric)
      else mpesa_cap_kes end,
    tax_fee_usd = case
      when v_patch ? 'taxFeeUsd' then greatest(0.01, (v_patch->>'taxFeeUsd')::numeric)
      else tax_fee_usd end,
    bot_fee_usd = case
      when v_patch ? 'botFeeUsd' then greatest(0.01, (v_patch->>'botFeeUsd')::numeric)
      else bot_fee_usd end,
    preview_stk_confirm = case
      when v_patch ? 'previewStkConfirm' then (v_patch->>'previewStkConfirm')::boolean
      else preview_stk_confirm end
  where id = 1
  returning * into v_settings;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Payout settings row missing.');
  end if;

  insert into public.activity_log (user_id, level, operation, message)
  values (auth.uid(), 'info', 'admin_update_payout_settings', 'Payout desk fees and rates updated.');

  return jsonb_build_object(
    'ok', true,
    'message', 'Payout desk fees saved.',
    'minWithdrawUsd', v_settings.min_withdraw_usd::float,
    'withdrawalFeePercent', v_settings.withdrawal_fee_percent::float,
    'kesPerUsdWithdrawal', v_settings.kes_per_usd_withdrawal::float,
    'kesPerUsdDeposit', v_settings.kes_per_usd_deposit::float,
    'mpesaCapKes', v_settings.mpesa_cap_kes::float,
    'taxFeeUsd', v_settings.tax_fee_usd::float,
    'botFeeUsd', v_settings.bot_fee_usd::float,
    'previewStkConfirm', coalesce(v_settings.preview_stk_confirm, false)
  );
end;
$fn$;

revoke all on function public.admin_payout_settings() from public, anon;
revoke all on function public.admin_update_payout_settings(jsonb) from public, anon;
grant execute on function public.admin_payout_settings() to authenticated, service_role;
grant execute on function public.admin_update_payout_settings(jsonb) to authenticated, service_role;
