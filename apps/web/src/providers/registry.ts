import type { AccountMode } from '@/types'
import { demoWalletProvider, type WalletProvider } from '@/providers/wallet/demo-wallet-provider'
import { realWalletProvider } from '@/providers/wallet/real-wallet-provider'
import { demoTradingProvider, type TradingProvider } from '@/providers/trading/demo-trading-provider'
import { realTradingProvider } from '@/providers/trading/real-trading-provider'
import {
  demoMarketDataProvider,
  resolveRealMarketDataProvider,
  type MarketDataProvider,
} from '@/providers/market-data/providers'
import { demoBotProvider, realBotProvider, type BotProvider } from '@/providers/bots/providers'
import {
  demoCopyTradingProvider,
  realCopyTradingProvider,
  type CopyTradingProvider,
} from '@/providers/copy-trading/providers'
import {
  demoNotificationProvider,
  demoSupportProvider,
  realNotificationProvider,
  realSupportProvider,
  type NotificationProvider,
  type SupportProvider,
} from '@/providers/notifications/providers'

export interface AccountProviders {
  mode: AccountMode
  wallet: WalletProvider
  trading: TradingProvider
  marketData: MarketDataProvider
  bots: BotProvider
  copyTrading: CopyTradingProvider
  notifications: NotificationProvider
  support: SupportProvider
}

export function getAccountProviders(mode: AccountMode): AccountProviders {
  if (mode === 'demo') {
    return {
      mode,
      wallet: demoWalletProvider,
      trading: demoTradingProvider,
      marketData: demoMarketDataProvider,
      bots: demoBotProvider,
      copyTrading: demoCopyTradingProvider,
      notifications: demoNotificationProvider,
      support: demoSupportProvider,
    }
  }
  return {
    mode,
    wallet: realWalletProvider,
    trading: realTradingProvider,
    marketData: resolveRealMarketDataProvider(),
    bots: realBotProvider,
    copyTrading: realCopyTradingProvider,
    notifications: realNotificationProvider,
    support: realSupportProvider,
  }
}
