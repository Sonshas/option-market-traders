-- =============================================================================
-- Remove every payout-desk fee.
-- =============================================================================
-- - No tax compliance or AI bot fee: withdrawals are never held waiting on a fee.
-- - No percentage withdrawal fee and no exchange-rate spread between deposits and payouts.
-- - New members start with a zero balance (no starting credit).
-- - Pending fee prompts are cancelled and held withdrawals move straight to review.
-- Apply after 20261004140000_payout_desk.sql.
-- =============================================================================

alter table public.wallets alter column balance_usd set default 0;

update public.payout_settings
  set withdrawal_fee_percent = 0,
      tax_fee_usd = 0,
      bot_fee_usd = 0,
      kes_per_usd_withdrawal = kes_per_usd_deposit
  where id = 1;

alter table public.payout_settings
  alter column withdrawal_fee_percent set default 0,
  alter column tax_fee_usd set default 0,
  alter column bot_fee_usd set default 0;

update public.service_fees set status = 'cancelled', updated_at = now() where status = 'pending';

update public.withdrawals set workflow = 'queued' where workflow = 'held';

create or replace function public.fees_clear(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select true;
$fn$;

create or replace function public.gate_message(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select 'Withdrawal request submitted for review.'::text;
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
    else 'Submitted for review'
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
  v_kes numeric;
  v_phone text;
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
  v_kes := round(v_amount * v_settings.kes_per_usd_withdrawal, 2);
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

  insert into public.withdrawals (user_id, amount_usd, fee_usd, net_usd, kes_payout, phone, workflow)
  values (v_user, v_amount, 0, v_amount, v_kes, v_phone, 'queued');
  update public.wallets set balance_usd = round(balance_usd - v_amount, 2) where user_id = v_user;
  update public.profiles set phone = v_phone where id = v_user;
  return public.action_result(true, 'info', 'member_withdrawal_create', 'Withdrawal request submitted for review.', v_user);
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
begin
  return jsonb_build_object('ok', false, 'level', 'warning', 'operation', 'service_fee_removed', 'message', 'There are no withdrawal fees.');
end;
$fn$;

create or replace function public.confirm_pending_fee(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return jsonb_build_object('ok', false, 'level', 'warning', 'operation', 'service_fee_removed', 'message', 'There are no withdrawal fees.');
end;
$fn$;

create or replace function public.settle_service_fee(p_ref text, p_receipt text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.activity_log (user_id, level, operation, message)
  values (null, 'warning', 'service_fee_settle', 'Fee callback received after fees were removed: ' || coalesce(p_ref, ''));
  return jsonb_build_object('ok', false, 'level', 'warning', 'operation', 'service_fee_removed', 'message', 'There are no withdrawal fees.');
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
    kes_per_usd_deposit = case
      when v_patch ? 'kesPerUsdDeposit' then greatest(1, (v_patch->>'kesPerUsdDeposit')::numeric)
      when v_patch ? 'kesPerUsdWithdrawal' then greatest(1, (v_patch->>'kesPerUsdWithdrawal')::numeric)
      else kes_per_usd_deposit end,
    mpesa_cap_kes = case
      when v_patch ? 'mpesaCapKes' then greatest(1, (v_patch->>'mpesaCapKes')::numeric)
      else mpesa_cap_kes end,
    withdrawal_fee_percent = 0,
    tax_fee_usd = 0,
    bot_fee_usd = 0
  where id = 1
  returning * into v_settings;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Payout settings row missing.');
  end if;

  update public.payout_settings set kes_per_usd_withdrawal = kes_per_usd_deposit where id = 1
  returning * into v_settings;

  insert into public.activity_log (user_id, level, operation, message)
  values (auth.uid(), 'info', 'admin_update_payout_settings', 'Payout desk rates updated.');

  return jsonb_build_object(
    'ok', true,
    'message', 'Payout desk settings saved.',
    'minWithdrawUsd', v_settings.min_withdraw_usd::float,
    'withdrawalFeePercent', 0,
    'kesPerUsdWithdrawal', v_settings.kes_per_usd_withdrawal::float,
    'kesPerUsdDeposit', v_settings.kes_per_usd_deposit::float,
    'mpesaCapKes', v_settings.mpesa_cap_kes::float,
    'taxFeeUsd', 0,
    'botFeeUsd', 0,
    'previewStkConfirm', coalesce(v_settings.preview_stk_confirm, false)
  );
end;
$fn$;

revoke execute on function public.start_service_fee(text) from authenticated;
revoke execute on function public.confirm_pending_fee(text) from authenticated;
