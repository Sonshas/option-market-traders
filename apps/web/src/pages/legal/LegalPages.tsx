import { PageHeader } from '@/components/ui'
import { RISK_DISCLAIMER } from '@/lib/constants'

export function RiskPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <PageHeader title="Risk disclosure" subtitle="Read this before using any future live mode." />
      <p className="text-sm leading-relaxed text-mist">{RISK_DISCLAIMER}</p>
      <p className="mt-4 text-sm text-mist">
        SmartBaseBinary does not operate live trading, live quotes, or real-money payments in this interface preview.
        Historical performance, when connected later, is not a guarantee of future results.
      </p>
    </main>
  )
}

export function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <PageHeader title="Terms of use" subtitle="UI-phase terms for the SmartBaseBinary interface preview." />
      <div className="space-y-3 text-sm text-mist">
        <p>This application is an original SmartBaseBinary user interface. It is not connected to production accounts.</p>
        <p>You must not treat placeholder screens, empty balances, or catalog records as live financial results.</p>
        <p>Access to trading, wallets, and copy tools is preview-only until services are connected in a later phase.</p>
        <p>DEMO mode is simulated practice only. REAL mode remains disconnected until legitimate providers exist.</p>
      </div>
    </main>
  )
}

export function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <PageHeader title="Privacy" />
      <p className="text-sm text-mist">
        We store your account details, balances, and trade history to operate your account. Payment details are handled
        by our payment partners. Never share your password with anyone, including support staff.
      </p>
    </main>
  )
}

export function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <PageHeader
        title="About SmartBaseBinary"
        subtitle="A binary trading workspace with honest DEMO and REAL separation."
      />
      <div className="space-y-3 text-sm text-mist">
        <p>
          SmartBaseBinary provides a professional terminal for digit-style contracts: EVEN / ODD, MATCH / DIFFER, and
          OVER / UNDER. This phase ships a fully functional local DEMO experience.
        </p>
        <p>
          REAL account screens are present for architecture completeness but return NOT CONNECTED until legitimate
          market-data, execution, payment, and compliance providers are wired. Simulated data is never presented as real.
        </p>
        <p>No profits or win rates are promised. Trading involves risk of loss.</p>
      </div>
    </main>
  )
}

export function ContactPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <PageHeader title="Contact & Support" subtitle="Local DEMO support tickets live in the app. Production desk is not connected." />
      <div className="space-y-3 text-sm text-mist">
        <p>
          For practice-mode help, open a DEMO support ticket from the signed-in workspace at{' '}
          <a href="/app/support" className="text-signal hover:underline">
            /app/support
          </a>
          .
        </p>
        <p>Email placeholders and production support channels are not connected in this development build.</p>
        <p>Brand: SmartBaseBinary · Mode: Development / Demo</p>
      </div>
    </main>
  )
}
