import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RequireAdmin, RequireSuperadmin } from '@/components/RequireAdmin'
import { RequireAuth } from '@/components/RequireAuth'
import { SimulatedSync } from '@/components/SimulatedSync'
import { SuperAdminPanel } from '@/features/admin/SuperAdminPanel'
import { TRADE_ROUTE } from '@/lib/auth-redirect'
import { AuthProvider } from '@/hooks/useAuth'
import { AccountModeProvider } from '@/hooks/useAccountMode'
import { AdminLayout } from '@/layouts/AdminLayout'
import { AppLayout } from '@/layouts/AppLayout'
import { AuthCallbackLayout, AuthLayout } from '@/layouts/AuthLayout'
import { PublicLayout } from '@/layouts/PublicLayout'
import { ConfirmEmailPage } from '@/pages/auth/ConfirmEmailPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { TwoFactorPage } from '@/pages/auth/TwoFactorPage'
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage'
import {
  AdminAccountsPage,
  AdminAuditPage,
  AdminCopyTradersPage,
  AdminDashboardPage,
  AdminSystemPage,
  AdminDepositsPage,
  AdminFeesPage,
  AdminLedgerPage,
  AdminNotificationsPage,
  AdminSettingsPage,
  AdminSupportPage,
  AdminTradesPage,
  AdminUsersPage,
  AdminWithdrawalsPage,
} from '@/pages/admin/AdminPages'
import { NotificationsPage } from '@/pages/account/NotificationsPage'
import { ProfilePage } from '@/pages/account/ProfilePage'
import { SecurityPage } from '@/pages/account/SecurityPage'
import { SupportPage } from '@/pages/account/SupportPage'
import { CopyTraderProfilePage } from '@/pages/copy-trading/CopyTraderProfilePage'
import { CopyTradingPage } from '@/pages/copy-trading/CopyTradingPage'
import { UserDashboardPage } from '@/pages/dashboard/UserDashboardPage'
import { AboutPage, ContactPage, PrivacyPage, RiskPage, TermsPage } from '@/pages/legal/LegalPages'
import { LandingPage } from '@/pages/LandingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { TradeHistoryPage } from '@/pages/trading/TradeHistoryPage'
import { TradingPage } from '@/pages/trading/TradingPage'
import { TransactionsPage } from '@/pages/wallet/TransactionsPage'
import { WalletPage } from '@/pages/wallet/WalletPage'

/** Legacy trade URLs (/app, /trade, /markets) keep their query string, e.g. ?symbol=R_100. */
function RedirectToTrade() {
  const { search, hash } = useLocation()
  return <Navigate to={`${TRADE_ROUTE}${search}${hash}`} replace />
}

export default function App() {
  return (
    <AuthProvider>
    <SimulatedSync />
    <AccountModeProvider>
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
    </AccountModeProvider>
    </AuthProvider>
  )
}
