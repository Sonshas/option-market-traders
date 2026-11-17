import { lazy, Suspense, type ComponentType } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RequireAdmin, RequireSuperadmin } from '@/components/RequireAdmin'
import { RequireAuth } from '@/components/RequireAuth'
import { SimulatedSync } from '@/components/SimulatedSync'
import { TRADE_ROUTE } from '@/lib/auth-redirect'
import { AuthProvider } from '@/hooks/useAuth'
import { AccountModeProvider } from '@/hooks/useAccountMode'
import { AdminLayout } from '@/layouts/AdminLayout'
import { AppLayout } from '@/layouts/AppLayout'
import { AuthCallbackLayout, AuthLayout } from '@/layouts/AuthLayout'
import { PublicLayout } from '@/layouts/PublicLayout'
import { LoginPage } from '@/pages/auth/LoginPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'

const LandingPage = lazy(() => import('@/pages/LandingPage').then((m) => ({ default: m.LandingPage })))
const AboutPage = lazy(() => import('@/pages/legal/LegalPages').then((m) => ({ default: m.AboutPage })))
const ContactPage = lazy(() => import('@/pages/legal/LegalPages').then((m) => ({ default: m.ContactPage })))
const PrivacyPage = lazy(() => import('@/pages/legal/LegalPages').then((m) => ({ default: m.PrivacyPage })))
const RiskPage = lazy(() => import('@/pages/legal/LegalPages').then((m) => ({ default: m.RiskPage })))
const TermsPage = lazy(() => import('@/pages/legal/LegalPages').then((m) => ({ default: m.TermsPage })))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })))

const VerifyEmailPage = lazy(() => import('@/pages/auth/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })))
const TwoFactorPage = lazy(() => import('@/pages/auth/TwoFactorPage').then((m) => ({ default: m.TwoFactorPage })))
const ResetPasswordPage = lazy(() =>
  import('@/pages/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
)
const ConfirmEmailPage = lazy(() =>
  import('@/pages/auth/ConfirmEmailPage').then((m) => ({ default: m.ConfirmEmailPage })),
)

const TradingPage = lazy(() => import('@/pages/trading/TradingPage').then((m) => ({ default: m.TradingPage })))
const TradeHistoryPage = lazy(() =>
  import('@/pages/trading/TradeHistoryPage').then((m) => ({ default: m.TradeHistoryPage })),
)
const WalletPage = lazy(() => import('@/pages/wallet/WalletPage').then((m) => ({ default: m.WalletPage })))
const TransactionsPage = lazy(() =>
  import('@/pages/wallet/TransactionsPage').then((m) => ({ default: m.TransactionsPage })),
)
const CopyTradingPage = lazy(() =>
  import('@/pages/copy-trading/CopyTradingPage').then((m) => ({ default: m.CopyTradingPage })),
)
const CopyTraderProfilePage = lazy(() =>
  import('@/pages/copy-trading/CopyTraderProfilePage').then((m) => ({ default: m.CopyTraderProfilePage })),
)
const UserDashboardPage = lazy(() =>
  import('@/pages/dashboard/UserDashboardPage').then((m) => ({ default: m.UserDashboardPage })),
)
const NotificationsPage = lazy(() =>
  import('@/pages/account/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
)
const SupportPage = lazy(() => import('@/pages/account/SupportPage').then((m) => ({ default: m.SupportPage })))
const ProfilePage = lazy(() => import('@/pages/account/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const SecurityPage = lazy(() => import('@/pages/account/SecurityPage').then((m) => ({ default: m.SecurityPage })))

const SuperAdminPanel = lazy(() =>
  import('@/features/admin/SuperAdminPanel').then((m) => ({ default: m.SuperAdminPanel })),
)

function adminPage(name: string) {
  return lazy(() =>
    import('@/pages/admin/AdminPages').then((m) => {
      const Comp = (m as Record<string, ComponentType>)[name]
      if (!Comp) throw new Error(`Missing admin page ${name}`)
      return { default: Comp }
    }),
  )
}

const AdminUsersPage = adminPage('AdminUsersPage')
const AdminAccountsPage = adminPage('AdminAccountsPage')
const AdminDepositsPage = adminPage('AdminDepositsPage')
const AdminDashboardPage = adminPage('AdminDashboardPage')
const AdminSystemPage = adminPage('AdminSystemPage')
const AdminWithdrawalsPage = adminPage('AdminWithdrawalsPage')
const AdminFeesPage = adminPage('AdminFeesPage')
const AdminTradesPage = adminPage('AdminTradesPage')
const AdminLedgerPage = adminPage('AdminLedgerPage')
const AdminSupportPage = adminPage('AdminSupportPage')
const AdminNotificationsPage = adminPage('AdminNotificationsPage')
const AdminCopyTradersPage = adminPage('AdminCopyTradersPage')
const AdminSettingsPage = adminPage('AdminSettingsPage')
const AdminAuditPage = adminPage('AdminAuditPage')

/** Legacy trade URLs (/app, /trade, /markets) keep their query string, e.g. ?symbol=R_100. */
function RedirectToTrade() {
  const { search, hash } = useLocation()
  return <Navigate to={`${TRADE_ROUTE}${search}${hash}`} replace />
}

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-mist" role="status">
      Loading…
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <SimulatedSync />
      <AccountModeProvider>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<LandingPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/legal/risk" element={<RiskPage />} />
              <Route path="/legal/terms" element={<TermsPage />} />
              <Route path="/legal/privacy" element={<PrivacyPage />} />
            </Route>

            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/register" element={<SignupPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/two-factor" element={<TwoFactorPage />} />
            </Route>

            <Route element={<AuthCallbackLayout />}>
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/auth/confirm" element={<ConfirmEmailPage />} />
            </Route>

            <Route
              path="/app"
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route index element={<RedirectToTrade />} />
              <Route path="trade" element={<TradingPage />} />
              <Route path="markets" element={<RedirectToTrade />} />
              <Route path="wallet" element={<WalletPage />} />
              <Route path="bots" element={<RedirectToTrade />} />
              <Route path="copy" element={<CopyTradingPage />} />
              <Route path="copy/:traderId" element={<CopyTraderProfilePage />} />
              <Route path="history" element={<TradeHistoryPage />} />
              <Route path="transactions" element={<TransactionsPage />} />
              <Route path="dashboard" element={<UserDashboardPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="support" element={<SupportPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="security" element={<SecurityPage />} />
            </Route>

            <Route
              path="/admin"
              element={
                <RequireAdmin>
                  <AdminLayout />
                </RequireAdmin>
              }
            >
              <Route
                index
                element={
                  <RequireSuperadmin>
                    <SuperAdminPanel />
                  </RequireSuperadmin>
                }
              />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="accounts" element={<AdminAccountsPage />} />
              <Route path="deposits" element={<AdminDepositsPage />} />
              <Route path="dashboard" element={<AdminDashboardPage />} />
              <Route path="system" element={<AdminSystemPage />} />
              <Route path="withdrawals" element={<AdminWithdrawalsPage />} />
              <Route path="fees" element={<AdminFeesPage />} />
              <Route path="trades" element={<AdminTradesPage />} />
              <Route path="ledger" element={<AdminLedgerPage />} />
              <Route path="support" element={<AdminSupportPage />} />
              <Route path="notifications" element={<AdminNotificationsPage />} />
              <Route path="bots" element={<Navigate to="/admin" replace />} />
              <Route path="copy-traders" element={<AdminCopyTradersPage />} />
              <Route path="settings" element={<AdminSettingsPage />} />
              <Route
                path="audit"
                element={
                  <RequireSuperadmin>
                    <AdminAuditPage />
                  </RequireSuperadmin>
                }
              />
            </Route>

            <Route path="/trade" element={<RedirectToTrade />} />
            <Route path="/markets" element={<RedirectToTrade />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </AccountModeProvider>
    </AuthProvider>
  )
}
