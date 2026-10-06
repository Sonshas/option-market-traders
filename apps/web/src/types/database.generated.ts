/**
 * Generated from Smart Base Binary (wkfyavcjjuyzvyeprklz) via Supabase MCP.
 * Do not import this into DEMO providers. Optional for future REAL wiring.
 * Regenerate with MCP generate_typescript_types when schema changes.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_mode: string
          created_at: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_mode: string
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_mode?: string
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          account_id: string | null
          account_mode: string | null
          action: string
          actor_email: string | null
          actor_id: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string
          id: number
          ip: string | null
          target_id: string | null
          target_type: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          account_mode?: string | null
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: never
          ip?: string | null
          target_id?: string | null
          target_type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          account_mode?: string | null
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: never
          ip?: string | null
          target_id?: string | null
          target_type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'audit_log_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      bot_runs: {
        Row: {
          account_id: string
          account_mode: string
          bot_id: string
          created_at: string
          id: string
          is_simulated: boolean
          loss_streak_limit: number
          max_runs: number
          note: string
          realized_pnl: number | null
          stake: number
          started_at: string | null
          status: string
          stop_loss: number | null
          stopped_at: string | null
          take_profit: number | null
          trades_placed: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          account_mode: string
          bot_id: string
          created_at?: string
          id?: string
          is_simulated?: boolean
          loss_streak_limit?: number
          max_runs?: number
          note?: string
          realized_pnl?: number | null
          stake: number
          started_at?: string | null
          status?: string
          stop_loss?: number | null
          stopped_at?: string | null
          take_profit?: number | null
          trades_placed?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          account_mode?: string
          bot_id?: string
          created_at?: string
          id?: string
          is_simulated?: boolean
          loss_streak_limit?: number
          max_runs?: number
          note?: string
          realized_pnl?: number | null
          stake?: number
          started_at?: string | null
          status?: string
          stop_loss?: number | null
          stopped_at?: string | null
          take_profit?: number | null
          trades_placed?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'bot_runs_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'bot_runs_bot_id_fkey'
            columns: ['bot_id']
            isOneToOne: false
            referencedRelation: 'bots'
            referencedColumns: ['id']
          },
        ]
      }
      bots: {
        Row: {
          created_at: string
          default_stake: number
          description: string
          historical_performance: string
          id: string
          is_active: boolean
          loss_streak_limit: number
          market_symbol: string
          max_runs: number
          name: string
          risk_level: string
          stop_loss: number | null
          take_profit: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_stake?: number
          description?: string
          historical_performance?: string
          id?: string
          is_active?: boolean
          loss_streak_limit?: number
          market_symbol: string
          max_runs?: number
          name: string
          risk_level?: string
          stop_loss?: number | null
          take_profit?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_stake?: number
          description?: string
          historical_performance?: string
          id?: string
          is_active?: boolean
          loss_streak_limit?: number
          market_symbol?: string
          max_runs?: number
          name?: string
          risk_level?: string
          stop_loss?: number | null
          take_profit?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'bots_market_symbol_fkey'
            columns: ['market_symbol']
            isOneToOne: false
            referencedRelation: 'markets'
            referencedColumns: ['symbol']
          },
        ]
      }
      copy_traders: {
        Row: {
          created_at: string
          display_name: string
          handle: string
          historical_pnl: string
          historical_roi: string
          historical_win_rate: string
          id: string
          is_active: boolean
          record_kind: string
          risk_level: string
          style: string
          trade_count: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          handle: string
          historical_pnl?: string
          historical_roi?: string
          historical_win_rate?: string
          id?: string
          is_active?: boolean
          record_kind?: string
          risk_level?: string
          style?: string
          trade_count?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          handle?: string
          historical_pnl?: string
          historical_roi?: string
          historical_win_rate?: string
          id?: string
          is_active?: boolean
          record_kind?: string
          risk_level?: string
          style?: string
          trade_count?: string
          updated_at?: string
        }
        Relationships: []
      }
      copy_trades: {
        Row: {
          account_id: string
          account_mode: string
          allocation: number | null
          copy_trader_id: string
          created_at: string
          id: string
          is_simulated: boolean
          max_daily_loss: number | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          account_mode: string
          allocation?: number | null
          copy_trader_id: string
          created_at?: string
          id?: string
          is_simulated?: boolean
          max_daily_loss?: number | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          account_mode?: string
          allocation?: number | null
          copy_trader_id?: string
          created_at?: string
          id?: string
          is_simulated?: boolean
          max_daily_loss?: number | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'copy_trades_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'copy_trades_copy_trader_id_fkey'
            columns: ['copy_trader_id']
            isOneToOne: false
            referencedRelation: 'copy_traders'
            referencedColumns: ['id']
          },
        ]
      }
      deposits: {
        Row: {
          account_id: string
          account_mode: string
          amount: number
          created_at: string
          currency: string
          details: Json
          id: string
          is_simulated: boolean
          method: string
          provider: string | null
          provider_reference: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          account_id: string
          account_mode: string
          amount: number
          created_at?: string
          currency?: string
          details?: Json
          id?: string
          is_simulated?: boolean
          method?: string
          provider?: string | null
          provider_reference?: string | null
          status?: string
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          account_id?: string
          account_mode?: string
          amount?: number
          created_at?: string
          currency?: string
          details?: Json
          id?: string
          is_simulated?: boolean
          method?: string
          provider?: string | null
          provider_reference?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'deposits_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'deposits_wallet_id_fkey'
            columns: ['wallet_id']
            isOneToOne: false
            referencedRelation: 'wallets'
            referencedColumns: ['id']
          },
        ]
      }
      feature_flags: {
        Row: {
          key: string
          label: string | null
          note: string | null
          updated_at: string
          updated_by: string | null
          value: boolean
        }
        Insert: {
          key: string
          label?: string | null
          note?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: boolean
        }
        Update: {
          key?: string
          label?: string | null
          note?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: boolean
        }
        Relationships: []
      }
      kyc_reviews: {
        Row: {
          created_at: string
          document_paths: string[]
          id: string
          notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_paths?: string[]
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_paths?: string[]
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      markets: {
        Row: {
          category: string
          contract_kinds: string[]
          created_at: string
          display_name: string
          durations_ms: number[]
          feed_label: string
          is_active: boolean
          is_simulated: boolean
          last_price: number | null
          price_status: string
          symbol: string
          updated_at: string
        }
        Insert: {
          category: string
          contract_kinds?: string[]
          created_at?: string
          display_name: string
          durations_ms?: number[]
          feed_label?: string
          is_active?: boolean
          is_simulated?: boolean
          last_price?: number | null
          price_status?: string
          symbol: string
          updated_at?: string
        }
        Update: {
          category?: string
          contract_kinds?: string[]
          created_at?: string
          display_name?: string
          durations_ms?: number[]
          feed_label?: string
          is_active?: boolean
          is_simulated?: boolean
          last_price?: number | null
          price_status?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          account_id: string | null
          account_mode: string | null
          body: string
          created_at: string
          id: string
          is_simulated: boolean
          kind: string
          read: boolean
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          account_mode?: string | null
          body: string
          created_at?: string
          id?: string
          is_simulated?: boolean
          kind: string
          read?: boolean
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          account_mode?: string | null
          body?: string
          created_at?: string
          id?: string
          is_simulated?: boolean
          kind?: string
          read?: boolean
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          timezone: string
          two_factor_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          timezone?: string
          two_factor_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          timezone?: string
          two_factor_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          read_at: string | null
          sender_role: string
          sender_user_id: string
          ticket_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read_at?: string | null
          sender_role?: string
          sender_user_id: string
          ticket_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read_at?: string | null
          sender_role?: string
          sender_user_id?: string
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'support_messages_ticket_id_fkey'
            columns: ['ticket_id']
            isOneToOne: false
            referencedRelation: 'support_tickets'
            referencedColumns: ['id']
          },
        ]
      }
      support_tickets: {
        Row: {
          account_id: string | null
          account_mode: string | null
          created_at: string
          id: string
          message: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          account_mode?: string | null
          created_at?: string
          id?: string
          message: string
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          account_mode?: string | null
          created_at?: string
          id?: string
          message?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'support_tickets_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      trade_settlements: {
        Row: {
          account_id: string
          account_mode: string
          created_at: string
          exit_price: number | null
          id: string
          is_simulated: boolean
          outcome: string
          payout: number | null
          profit_loss: number | null
          settlement_digit: number | null
          trade_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          account_mode: string
          created_at?: string
          exit_price?: number | null
          id?: string
          is_simulated?: boolean
          outcome: string
          payout?: number | null
          profit_loss?: number | null
          settlement_digit?: number | null
          trade_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          account_mode?: string
          created_at?: string
          exit_price?: number | null
          id?: string
          is_simulated?: boolean
          outcome?: string
          payout?: number | null
          profit_loss?: number | null
          settlement_digit?: number | null
          trade_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'trade_settlements_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trade_settlements_trade_id_fkey'
            columns: ['trade_id']
            isOneToOne: true
            referencedRelation: 'trades'
            referencedColumns: ['id']
          },
        ]
      }
      trades: {
        Row: {
          account_id: string
          account_mode: string
          barrier: number | null
          contract_option: string
          contract_type: string
          created_at: string
          duration_ms: number
          entry_price: number | null
          exit_price: number | null
          expires_at: string | null
          id: string
          idempotency_key: string | null
          is_simulated: boolean
          payout: number | null
          payout_rate: number | null
          profit_loss: number | null
          resolved_at: string | null
          selected_digit: number | null
          stake: number
          status: string
          symbol: string
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          account_id: string
          account_mode: string
          barrier?: number | null
          contract_option: string
          contract_type: string
          created_at?: string
          duration_ms: number
          entry_price?: number | null
          exit_price?: number | null
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          is_simulated?: boolean
          payout?: number | null
          payout_rate?: number | null
          profit_loss?: number | null
          resolved_at?: string | null
          selected_digit?: number | null
          stake: number
          status?: string
          symbol: string
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          account_id?: string
          account_mode?: string
          barrier?: number | null
          contract_option?: string
          contract_type?: string
          created_at?: string
          duration_ms?: number
          entry_price?: number | null
          exit_price?: number | null
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          is_simulated?: boolean
          payout?: number | null
          payout_rate?: number | null
          profit_loss?: number | null
          resolved_at?: string | null
          selected_digit?: number | null
          stake?: number
          status?: string
          symbol?: string
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'trades_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trades_symbol_fkey'
            columns: ['symbol']
            isOneToOne: false
            referencedRelation: 'markets'
            referencedColumns: ['symbol']
          },
          {
            foreignKeyName: 'trades_wallet_id_fkey'
            columns: ['wallet_id']
            isOneToOne: false
            referencedRelation: 'wallets'
            referencedColumns: ['id']
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          account_mode: string
          amount: number
          created_at: string
          currency: string
          id: string
          is_simulated: boolean
          note: string | null
          reference: string | null
          status: string
          type: string
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          account_id: string
          account_mode: string
          amount: number
          created_at?: string
          currency?: string
          id?: string
          is_simulated?: boolean
          note?: string | null
          reference?: string | null
          status?: string
          type: string
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          account_id?: string
          account_mode?: string
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          is_simulated?: boolean
          note?: string | null
          reference?: string | null
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'transactions_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transactions_wallet_id_fkey'
            columns: ['wallet_id']
            isOneToOne: false
            referencedRelation: 'wallets'
            referencedColumns: ['id']
          },
        ]
      }
      users: {
        Row: {
          account_status: string
          created_at: string
          email: string | null
          id: string
          kyc_status: string
          live_trading_enabled: boolean
          name: string | null
          role: string
          suspended_at: string | null
          updated_at: string
        }
        Insert: {
          account_status?: string
          created_at?: string
          email?: string | null
          id: string
          kyc_status?: string
          live_trading_enabled?: boolean
          name?: string | null
          role?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Update: {
          account_status?: string
          created_at?: string
          email?: string | null
          id?: string
          kyc_status?: string
          live_trading_enabled?: boolean
          name?: string | null
          role?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      wallet_ledger: {
        Row: {
          account_id: string
          account_mode: string
          amount: number
          available_after: number | null
          balance_after: number | null
          created_at: string
          entry_type: string
          id: string
          is_simulated: boolean
          locked_after: number | null
          note: string | null
          reference_id: string | null
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          account_id: string
          account_mode: string
          amount: number
          available_after?: number | null
          balance_after?: number | null
          created_at?: string
          entry_type: string
          id?: string
          is_simulated?: boolean
          locked_after?: number | null
          note?: string | null
          reference_id?: string | null
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          account_id?: string
          account_mode?: string
          amount?: number
          available_after?: number | null
          balance_after?: number | null
          created_at?: string
          entry_type?: string
          id?: string
          is_simulated?: boolean
          locked_after?: number | null
          note?: string | null
          reference_id?: string | null
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'wallet_ledger_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'wallet_ledger_wallet_id_fkey'
            columns: ['wallet_id']
            isOneToOne: false
            referencedRelation: 'wallets'
            referencedColumns: ['id']
          },
        ]
      }
      wallets: {
        Row: {
          account_id: string
          account_mode: string
          available_balance: number
          balance: number
          created_at: string
          currency: string
          id: string
          is_simulated: boolean
          locked_balance: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          account_mode: string
          available_balance?: number
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          is_simulated?: boolean
          locked_balance?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          account_mode?: string
          available_balance?: number
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          is_simulated?: boolean
          locked_balance?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'wallets_account_id_fkey'
            columns: ['account_id']
            isOneToOne: true
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      withdrawals: {
        Row: {
          account_id: string
          account_mode: string
          amount: number
          created_at: string
          currency: string
          destination: string
          destination_details: Json
          id: string
          is_simulated: boolean
          provider: string | null
          provider_reference: string | null
          status: string
          updated_at: string
          user_id: string
          admin_note: string | null
          admin_user_id: string | null
          amount_kes: number | null
          completed_at: string | null
          conversation_id: string | null
          details: Json
          failed_at: string | null
          failure_reason: string | null
          fee_kes: number
          mpesa_receipt: string | null
          msisdn: string | null
          net_kes: number | null
          originator_conversation_id: string | null
          processing_at: string | null
          reference: string | null
          result_code: string | null
          result_desc: string | null
          wallet_id: string
        }
        Insert: {
          account_id: string
          account_mode: string
          amount: number
          created_at?: string
          currency?: string
          destination: string
          destination_details?: Json
          id?: string
          is_simulated?: boolean
          provider?: string | null
          provider_reference?: string | null
          status?: string
          updated_at?: string
          user_id: string
          admin_note?: string | null
          admin_user_id?: string | null
          amount_kes?: number | null
          completed_at?: string | null
          conversation_id?: string | null
          details?: Json
          failed_at?: string | null
          failure_reason?: string | null
          fee_kes?: number
          mpesa_receipt?: string | null
          msisdn?: string | null
          net_kes?: number | null
          originator_conversation_id?: string | null
          processing_at?: string | null
          reference?: string | null
          result_code?: string | null
          result_desc?: string | null
          wallet_id: string
        }
        Update: {
          account_id?: string
          account_mode?: string
          amount?: number
          created_at?: string
          currency?: string
          destination?: string
          destination_details?: Json
          id?: string
          is_simulated?: boolean
          provider?: string | null
          provider_reference?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          admin_note?: string | null
          admin_user_id?: string | null
          amount_kes?: number | null
          completed_at?: string | null
          conversation_id?: string | null
          details?: Json
          failed_at?: string | null
          failure_reason?: string | null
          fee_kes?: number
          mpesa_receipt?: string | null
          msisdn?: string | null
          net_kes?: number | null
          originator_conversation_id?: string | null
          processing_at?: string | null
          reference?: string | null
          result_code?: string | null
          result_desc?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'withdrawals_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'withdrawals_wallet_id_fkey'
            columns: ['wallet_id']
            isOneToOne: false
            referencedRelation: 'wallets'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_app_role: { Args: never; Returns: string }
      is_platform_staff: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
