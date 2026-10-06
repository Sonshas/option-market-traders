-- Settle expired REAL trades every minute even when nobody has the site open.
-- The x-sweep-secret value is read from Vault at run time; it never appears in cron.job.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'real-trade-settle-sweep',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://wkfyavcjjuyzvyeprklz.supabase.co/functions/v1/real-trade-settle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sweep-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'real_trade_sweep_secret')
    ),
    body := '{"mode":"sweep"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
