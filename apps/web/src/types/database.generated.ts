/**
 * Generated from Smart Base Binary (wkfyavcjjuyzvyeprklz).
 * Do not import this into DEMO providers. Optional for future REAL wiring.
 * Regenerate with: npx supabase gen types typescript --linked --schema public
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
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
      admin_audit_log: {
        Row: {
          action: string
          admin_email: string | null
          admin_id: string
          book: string | null
          created_at: string
          id: number
          new_value: number | null
          old_value: number | null
          reason: string | null
          target_email: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_email?: string | null
          admin_id: string
          book?: string | null
          created_at?: string
          id?: never
          new_value?: number | null
          old_value?: number | null
          reason?: string | null
          target_email?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_email?: string | null
          admin_id?: string
          book?: string | null
          created_at?: string
          id?: never
          new_value?: number | null
          old_value?: number | null
          reason?: string | null
          target_email?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      app_admins: {
        Row: {
          created_at: string
          email: string
          role: string
        }
        Insert: {
          created_at?: string
          email: string
          role?: string
        }
        Update: {
          created_at?: string
          email?: string
          role?: string
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
            foreignKeyName: "audit_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
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
            foreignKeyName: "bot_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_runs_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
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
            foreignKeyName: "bots_market_symbol_fkey"
            columns: ["market_symbol"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["symbol"]
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
            foreignKeyName: "copy_trades_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_trades_copy_trader_id_fkey"
            columns: ["copy_trader_id"]
            isOneToOne: false
            referencedRelation: "copy_traders"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          account_id: string
          account_mode: string
          amount: number
          callback_amount_kes: number | null
          callback_at: string | null
          checkout_request_id: string | null
          created_at: string
          currency: string
          details: Json
          id: string
          is_simulated: boolean
          last_query_at: string | null
          merchant_request_id: string | null
          method: string
          mpesa_receipt: string | null
          provider: string | null
          provider_reference: string | null
          result_code: string | null
          result_desc: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          account_id: string
          account_mode: string
          amount: number
          callback_amount_kes?: number | null
          callback_at?: string | null
          checkout_request_id?: string | null
          created_at?: string
          currency?: string
          details?: Json
          id?: string
          is_simulated?: boolean
          last_query_at?: string | null
          merchant_request_id?: string | null
          method?: string
          mpesa_receipt?: string | null
          provider?: string | null
          provider_reference?: string | null
          result_code?: string | null
          result_desc?: string | null
          status?: string
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          account_id?: string
          account_mode?: string
          amount?: number
          callback_amount_kes?: number | null
          callback_at?: string | null
          checkout_request_id?: string | null
          created_at?: string
          currency?: string
          details?: Json
          id?: string
          is_simulated?: boolean
          last_query_at?: string | null
          merchant_request_id?: string | null
          method?: string
          mpesa_receipt?: string | null
          provider?: string | null
          provider_reference?: string | null
          result_code?: string | null
          result_desc?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
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
      megapay_webhook_events: {
        Row: {
          attempts: number
          content_type: string | null
          forward_error: string | null
          forward_status: number | null
          id: string
          last_attempt_at: string | null
          payload: Json | null
          process_result: string | null
          processed: boolean
          raw_body: string
          received_at: string
          reference: string | null
          routed_to: string
          transaction_id: string | null
        }
        Insert: {
          attempts?: number
          content_type?: string | null
          forward_error?: string | null
          forward_status?: number | null
          id?: string
          last_attempt_at?: string | null
          payload?: Json | null
          process_result?: string | null
          processed?: boolean
          raw_body?: string
          received_at?: string
          reference?: string | null
          routed_to?: string
          transaction_id?: string | null
        }
        Update: {
          attempts?: number
          content_type?: string | null
          forward_error?: string | null
          forward_status?: number | null
          id?: string
          last_attempt_at?: string | null
          payload?: Json | null
          process_result?: string | null
          processed?: boolean
          raw_body?: string
          received_at?: string
          reference?: string | null
          routed_to?: string
          transaction_id?: string | null
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
            foreignKeyName: "notifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      payout_fee_stk_requests: {
        Row: {
          amount_kes: number
          checkout_request_id: string | null
          created_at: string
          details: Json
          fee_ref: string
          id: string
          kind: string
          merchant_request_id: string | null
          mpesa_receipt: string | null
          payout_user_id: string | null
          phone_masked: string
          result_code: string | null
          result_desc: string | null
          settled_at: string | null
          status: string
        }
        Insert: {
          amount_kes: number
          checkout_request_id?: string | null
          created_at?: string
          details?: Json
          fee_ref: string
          id?: string
          kind: string
          merchant_request_id?: string | null
          mpesa_receipt?: string | null
          payout_user_id?: string | null
          phone_masked?: string
          result_code?: string | null
          result_desc?: string | null
          settled_at?: string | null
          status?: string
        }
        Update: {
          amount_kes?: number
          checkout_request_id?: string | null
          created_at?: string
          details?: Json
          fee_ref?: string
          id?: string
          kind?: string
          merchant_request_id?: string | null
          mpesa_receipt?: string | null
          payout_user_id?: string | null
          phone_masked?: string
          result_code?: string | null
          result_desc?: string | null
          settled_at?: string | null
          status?: string
        }
        Relationships: []
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
      simulated_balance_ledger: {
        Row: {
          balance_after: number
          book: string
          created_at: string
          delta: number
          id: number
          kind: string
          meta: Json
          ref: string | null
          user_id: string
        }
        Insert: {
          balance_after: number
          book: string
          created_at?: string
          delta: number
          id?: never
          kind: string
          meta?: Json
          ref?: string | null
          user_id: string
        }
        Update: {
          balance_after?: number
          book?: string
          created_at?: string
          delta?: number
          id?: never
          kind?: string
          meta?: Json
          ref?: string | null
          user_id?: string
        }
        Relationships: []
      }
      simulated_balances: {
        Row: {
          balance: number
          book: string
          updated_at: string
          updated_by: string
          user_id: string
          version: number
        }
        Insert: {
          balance?: number
          book: string
          updated_at?: string
          updated_by?: string
          user_id: string
          version?: number
        }
        Update: {
          balance?: number
          book?: string
          updated_at?: string
          updated_by?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      simulated_open_stakes: {
        Row: {
          book: string
          created_at: string
          ref: string
          stake: number
          user_id: string
        }
        Insert: {
          book: string
          created_at?: string
          ref: string
          stake: number
          user_id: string
        }
        Update: {
          book?: string
          created_at?: string
          ref?: string
          stake?: number
          user_id?: string
        }
        Relationships: []
      }
      simulated_win_rate_overrides: {
        Row: {
          updated_at: string
          updated_by: string | null
          user_id: string
          win_rate: number | null
        }
        Insert: {
          updated_at?: string
          updated_by?: string | null
          user_id: string
          win_rate?: number | null
        }
        Update: {
          updated_at?: string
          updated_by?: string | null
          user_id?: string
          win_rate?: number | null
        }
        Relationships: []
      }
      simulation_settings: {
        Row: {
          id: boolean
          updated_at: string
          updated_by: string | null
          win_rate: number
        }
        Insert: {
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          win_rate?: number
        }
        Update: {
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          win_rate?: number
        }
        Relationships: []
      }
      simulation_signals: {
        Row: {
          id: boolean
          revision: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          revision?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          revision?: number
          updated_at?: string
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
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
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
            foreignKeyName: "support_tickets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      system_issues: {
        Row: {
          area: string
          code: string | null
          fingerprint: string
          first_seen: string
          id: string
          last_seen: string
          last_user_id: string | null
          message: string
          occurrences: number
          operation: string
          resolved_at: string | null
          resolved_by: string | null
          route: string | null
          source: string
        }
        Insert: {
          area: string
          code?: string | null
          fingerprint: string
          first_seen?: string
          id?: string
          last_seen?: string
          last_user_id?: string | null
          message: string
          occurrences?: number
          operation: string
          resolved_at?: string | null
          resolved_by?: string | null
          route?: string | null
          source: string
        }
        Update: {
          area?: string
          code?: string | null
          fingerprint?: string
          first_seen?: string
          id?: string
          last_seen?: string
          last_user_id?: string | null
          message?: string
          occurrences?: number
          operation?: string
          resolved_at?: string | null
          resolved_by?: string | null
          route?: string | null
          source?: string
        }
        Relationships: []
      }
      trade_settlements: {
        Row: {
          account_id: string
          account_mode: string
          created_at: string
          details: Json
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
          details?: Json
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
          details?: Json
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
            foreignKeyName: "trade_settlements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_settlements_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: true
            referencedRelation: "trades"
            referencedColumns: ["id"]
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
          details: Json
          duration_ms: number
          duration_ticks: number | null
          entry_epoch: number | null
          entry_pip_size: number | null
          entry_price: number | null
          exit_digit: number | null
          exit_epoch: number | null
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
          tick_anchor_epoch: number | null
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
          details?: Json
          duration_ms: number
          duration_ticks?: number | null
          entry_epoch?: number | null
          entry_pip_size?: number | null
          entry_price?: number | null
          exit_digit?: number | null
          exit_epoch?: number | null
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
          tick_anchor_epoch?: number | null
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
          details?: Json
          duration_ms?: number
          duration_ticks?: number | null
          entry_epoch?: number | null
          entry_pip_size?: number | null
          entry_price?: number | null
          exit_digit?: number | null
          exit_epoch?: number | null
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
          tick_anchor_epoch?: number | null
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["symbol"]
          },
          {
            foreignKeyName: "trades_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      trading_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: number
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: number
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
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
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
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
            foreignKeyName: "wallet_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
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
            foreignKeyName: "wallets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          account_id: string
          account_mode: string
          admin_note: string | null
          admin_user_id: string | null
          amount: number
          amount_kes: number | null
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          currency: string
          destination: string
          destination_details: Json
          details: Json
          failed_at: string | null
          failure_reason: string | null
          fee_kes: number
          id: string
          is_simulated: boolean
          mpesa_receipt: string | null
          msisdn: string | null
          net_kes: number | null
          originator_conversation_id: string | null
          processing_at: string | null
          provider: string | null
          provider_reference: string | null
          reference: string | null
          result_code: string | null
          result_desc: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          account_id: string
          account_mode: string
          admin_note?: string | null
          admin_user_id?: string | null
          amount: number
          amount_kes?: number | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          currency?: string
          destination: string
          destination_details?: Json
          details?: Json
          failed_at?: string | null
          failure_reason?: string | null
          fee_kes?: number
          id?: string
          is_simulated?: boolean
          mpesa_receipt?: string | null
          msisdn?: string | null
          net_kes?: number | null
          originator_conversation_id?: string | null
          processing_at?: string | null
          provider?: string | null
          provider_reference?: string | null
          reference?: string | null
          result_code?: string | null
          result_desc?: string | null
          status?: string
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          account_id?: string
          account_mode?: string
          admin_note?: string | null
          admin_user_id?: string | null
          amount?: number
          amount_kes?: number | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          currency?: string
          destination?: string
          destination_details?: Json
          details?: Json
          failed_at?: string | null
          failure_reason?: string | null
          fee_kes?: number
          id?: string
          is_simulated?: boolean
          mpesa_receipt?: string | null
          msisdn?: string | null
          net_kes?: number | null
          originator_conversation_id?: string | null
          processing_at?: string | null
          provider?: string | null
          provider_reference?: string | null
          reference?: string | null
          result_code?: string | null
          result_desc?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_access_level: { Args: never; Returns: string }
      admin_reset_simulated_balances: {
        Args: { p_reason?: string; p_user_id: string }
        Returns: {
          balance: number
          book: string
          version: number
        }[]
      }
      admin_set_global_win_rate: {
        Args: { p_rate: number; p_reason?: string }
        Returns: number
      }
      admin_set_simulated_balance: {
        Args: {
          p_balance: number
          p_book: string
          p_reason?: string
          p_user_id: string
        }
        Returns: {
          balance: number
          book: string
          version: number
        }[]
      }
      admin_set_user_win_rate: {
        Args: { p_rate: number; p_reason?: string; p_user_id: string }
        Returns: number
      }
      apply_simulated_change: {
        Args: {
          p_amount: number
          p_book: string
          p_kind: string
          p_meta?: Json
          p_ref?: string
        }
        Returns: {
          applied: boolean
          balance: number
          book: string
          version: number
        }[]
      }
      assert_superadmin: { Args: never; Returns: undefined }
      clean_admin_reason: { Args: { p_reason: string }; Returns: string }
      complete_withdrawal: {
        Args: {
          p_admin_user_id: string
          p_note: string
          p_raw: Json
          p_receipt: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      credit_megapay_deposit: {
        Args: {
          p_amount_kes: number
          p_deposit_id: string
          p_raw: Json
          p_receipt: string
        }
        Returns: Json
      }
      current_app_role: { Args: never; Returns: string }
      ensure_simulated_balances: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      fail_megapay_deposit: {
        Args: {
          p_deposit_id: string
          p_kind: string
          p_raw: Json
          p_reason: string
          p_status: string
        }
        Returns: Json
      }
      fail_withdrawal: {
        Args: {
          p_admin_user_id: string
          p_raw: Json
          p_reason: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      get_demo_trade_result: { Args: never; Returns: boolean }
      get_real_trade_result: { Args: never; Returns: boolean }
      is_platform_staff: { Args: never; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      is_superadmin_user: { Args: { p_user_id: string }; Returns: boolean }
      mark_withdrawal_processing: {
        Args: {
          p_admin_user_id: string
          p_conversation_id: string
          p_note: string
          p_provider: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      my_simulated_balances: {
        Args: never
        Returns: {
          balance: number
          book: string
          updated_at: string
          updated_by: string
          version: number
        }[]
      }
      my_simulated_win_rate: { Args: never; Returns: number }
      place_real_tick_trade: {
        Args: {
          p_barrier: number
          p_contract_option: string
          p_contract_type: string
          p_duration_ticks: number
          p_entry_epoch: number
          p_entry_price: number
          p_idempotency_key: string
          p_payout_rate: number
          p_pip_size: number
          p_selected_digit: number
          p_stake: number
          p_symbol: string
          p_user_id: string
        }
        Returns: Json
      }
      place_real_trade: {
        Args: {
          p_barrier: number
          p_contract_option: string
          p_contract_type: string
          p_duration_ms: number
          p_entry_epoch: number
          p_entry_price: number
          p_idempotency_key: string
          p_payout_rate: number
          p_pip_size: number
          p_selected_digit: number
          p_stake: number
          p_symbol: string
          p_user_id: string
        }
        Returns: Json
      }
      real_digit_payout_rate: {
        Args: {
          p_barrier: number
          p_contract_option: string
          p_contract_type: string
          p_selected_digit: number
        }
        Returns: number
      }
      real_max_open_trades: { Args: never; Returns: number }
      real_stake_bounds: {
        Args: never
        Returns: {
          max_usd: number
          min_usd: number
        }[]
      }
      real_trade_daily_status: { Args: { p_user_id: string }; Returns: Json }
      refund_real_trade: {
        Args: { p_raw: Json; p_reason: string; p_trade_id: string }
        Returns: Json
      }
      report_system_issue: {
        Args: {
          p_area: string
          p_code: string
          p_message: string
          p_operation: string
          p_route: string
          p_source: string
          p_user_id: string
        }
        Returns: string
      }
      request_real_withdrawal: {
        Args: {
          p_amount_usd: number
          p_fee_kes: number
          p_kes_per_usd: number
          p_max_kes: number
          p_min_kes: number
          p_msisdn: string
          p_provider: string
          p_reference: string
          p_user_id: string
        }
        Returns: Json
      }
      settle_real_trade: {
        Args: {
          p_exit_digit: number
          p_exit_epoch: number
          p_exit_price: number
          p_outcome: string
          p_pip_size: number
          p_raw: Json
          p_trade_id: string
        }
        Returns: Json
      }
      verify_real_trade_sweep_secret: {
        Args: { p_secret: string }
        Returns: boolean
      }
      write_admin_audit: {
        Args: {
          p_action: string
          p_book: string
          p_new: number
          p_old: number
          p_reason: string
          p_target_user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
