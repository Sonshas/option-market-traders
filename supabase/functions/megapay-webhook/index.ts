import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

/**
 * This site does not host the MegaPay webhook.
 * MegaPay dashboard webhook: https://binaryderivpilot.com/api/megapay/webhook
 * REAL deposits on optionmarkettraders.com settle via megapay-status polling only.
 */
function gone() {
  return new Response(
    JSON.stringify({
      error: 'MegaPay webhook is not hosted on this site.',
      webhook: 'https://binaryderivpilot.com/api/megapay/webhook',
    }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
}

Deno.serve((_req) => gone())
