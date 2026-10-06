-- Smart Base Binary (wkfyavcjjuyzvyeprklz)
-- Migration: align_markets_catalog_with_app
-- Additive only. Does not enable REAL trading execution.

ALTER TABLE public.markets DROP CONSTRAINT IF EXISTS markets_category_check;
ALTER TABLE public.markets
  ADD CONSTRAINT markets_category_check
  CHECK (category = ANY (ARRAY['synthetic'::text, 'forex'::text, 'crypto'::text]));

ALTER TABLE public.markets DROP CONSTRAINT IF EXISTS markets_price_status_check;
ALTER TABLE public.markets
  ADD CONSTRAINT markets_price_status_check
  CHECK (price_status = ANY (ARRAY[
    'disconnected'::text,
    'connecting'::text,
    'live'::text,
    'simulated'::text,
    'reconnecting'::text,
    'error'::text
  ]));

INSERT INTO public.markets AS m (
  symbol, display_name, category, contract_kinds, durations_ms,
  last_price, price_status, feed_label, is_simulated, is_active
)
VALUES
  ('BTCUSDT', 'Bitcoin / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('ETHUSDT', 'Ethereum / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('BNBUSDT', 'BNB / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('SOLUSDT', 'Solana / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('XRPUSDT', 'XRP / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('ADAUSDT', 'Cardano / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('DOGEUSDT', 'Dogecoin / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('AVAXUSDT', 'Avalanche / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true)
ON CONFLICT (symbol) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  contract_kinds = EXCLUDED.contract_kinds,
  durations_ms = EXCLUDED.durations_ms,
  feed_label = EXCLUDED.feed_label,
  is_simulated = EXCLUDED.is_simulated,
  is_active = EXCLUDED.is_active,
  updated_at = now();

UPDATE public.feature_flags
SET value = false,
    note = 'REAL order execution remains disabled until a verified settlement stack is approved.',
    updated_at = now()
WHERE key = 'REAL_TRADING_ENABLED';

UPDATE public.feature_flags
SET value = false,
    note = 'REAL payments remain disabled until a payment provider is configured.',
    updated_at = now()
WHERE key = 'REAL_PAYMENTS_ENABLED';

INSERT INTO public.feature_flags (key, value, label, note)
VALUES (
  'REAL_MARKET_CATALOG_SYNCED',
  true,
  'Binance catalog mirrored',
  'Catalog symbols only — not live prices and not trade execution.'
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  label = EXCLUDED.label,
  note = EXCLUDED.note,
  updated_at = now();
