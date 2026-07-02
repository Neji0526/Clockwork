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
      activity_events: {
        Row: {
          app: string | null
          duration_sec: number
          id: string
          platform: string | null
          session_id: string
          source: string | null
          started_at: string
          title: string | null
          url: string | null
          va_id: string
        }
        Insert: {
          app?: string | null
          duration_sec?: number
          id?: string
          platform?: string | null
          session_id: string
          source?: string | null
          started_at?: string
          title?: string | null
          url?: string | null
          va_id: string
        }
        Update: {
          app?: string | null
          duration_sec?: number
          id?: string
          platform?: string | null
          session_id?: string
          source?: string | null
          started_at?: string
          title?: string | null
          url?: string | null
          va_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_orphan_24h"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "activity_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "work_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_actions: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json
          target_email: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          target_email?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          target_email?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      admin_invite_tokens: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          label: string | null
          max_uses: number
          revoked_at: string | null
          token: string
          uses: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          label?: string | null
          max_uses?: number
          revoked_at?: string | null
          token: string
          uses?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          label?: string | null
          max_uses?: number
          revoked_at?: string | null
          token?: string
          uses?: number
        }
        Relationships: []
      }
      app_config: {
        Row: {
          billing_address: string | null
          billing_business_name: string | null
          billing_default_currency: string
          billing_email: string | null
          billing_logo_url: string | null
          billing_payment_notes: string | null
          heartbeat_sec: number
          id: number
          idle_threshold_sec: number
          low_engagement_minutes: number
          max_break_sec: number
          screenshot_retention_days: number
          session_timeout_minutes: number
          updated_at: string
        }
        Insert: {
          billing_address?: string | null
          billing_business_name?: string | null
          billing_default_currency?: string
          billing_email?: string | null
          billing_logo_url?: string | null
          billing_payment_notes?: string | null
          heartbeat_sec?: number
          id?: number
          idle_threshold_sec?: number
          low_engagement_minutes?: number
          max_break_sec?: number
          screenshot_retention_days?: number
          session_timeout_minutes?: number
          updated_at?: string
        }
        Update: {
          billing_address?: string | null
          billing_business_name?: string | null
          billing_default_currency?: string
          billing_email?: string | null
          billing_logo_url?: string | null
          billing_payment_notes?: string | null
          heartbeat_sec?: number
          id?: number
          idle_threshold_sec?: number
          low_engagement_minutes?: number
          max_break_sec?: number
          screenshot_retention_days?: number
          session_timeout_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      break_segments: {
        Row: {
          break_type: string | null
          created_at: string
          duration_sec: number
          ended_at: string | null
          id: string
          reason: string | null
          session_id: string | null
          started_at: string
          va_id: string
        }
        Insert: {
          break_type?: string | null
          created_at?: string
          duration_sec?: number
          ended_at?: string | null
          id?: string
          reason?: string | null
          session_id?: string | null
          started_at?: string
          va_id: string
        }
        Update: {
          break_type?: string | null
          created_at?: string
          duration_sec?: number
          ended_at?: string | null
          id?: string
          reason?: string | null
          session_id?: string | null
          started_at?: string
          va_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "break_segments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_orphan_24h"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "break_segments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "work_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "break_segments_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      capture_requests: {
        Row: {
          created_at: string
          expires_at: string
          fulfilled_at: string | null
          id: string
          reason: string | null
          requested_by: string
          screenshot_id: string | null
          status: string
          va_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          fulfilled_at?: string | null
          id?: string
          reason?: string | null
          requested_by: string
          screenshot_id?: string | null
          status?: string
          va_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          fulfilled_at?: string | null
          id?: string
          reason?: string | null
          requested_by?: string
          screenshot_id?: string | null
          status?: string
          va_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capture_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "capture_requests_screenshot_id_fkey"
            columns: ["screenshot_id"]
            isOneToOne: false
            referencedRelation: "screenshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capture_requests_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      client_share_tokens: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          label: string | null
          revoked_at: string | null
          token: string
          va_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          label?: string | null
          revoked_at?: string | null
          token: string
          va_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          label?: string | null
          revoked_at?: string | null
          token?: string
          va_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_share_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_share_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_share_tokens_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      clients: {
        Row: {
          archived: boolean
          bill_currency: string
          bill_rate_cents: number | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          archived?: boolean
          bill_currency?: string
          bill_rate_cents?: number | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          archived?: boolean
          bill_currency?: string
          bill_rate_cents?: number | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      consent_records: {
        Row: {
          agreed_at: string
          id: string
          ip: string | null
          policy_version: string
          va_id: string
        }
        Insert: {
          agreed_at?: string
          id?: string
          ip?: string | null
          policy_version: string
          va_id: string
        }
        Update: {
          agreed_at?: string
          id?: string
          ip?: string | null
          policy_version?: string
          va_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          created_at: string
          created_by: string
          id: string
          label: string
          last_seen_at: string | null
          platform: string
          revoked_at: string | null
          token_hash: string
          va_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          label: string
          last_seen_at?: string | null
          platform: string
          revoked_at?: string | null
          token_hash: string
          va_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          last_seen_at?: string | null
          platform?: string
          revoked_at?: string | null
          token_hash?: string
          va_id?: string
        }
        Relationships: []
      }
      engagement_samples: {
        Row: {
          click_count: number
          id: string
          interacted: boolean
          key_count: number
          platform: string | null
          sampled_at: string
          scroll_count: number
          session_id: string | null
          source: string | null
          va_id: string
          window_sec: number
        }
        Insert: {
          click_count?: number
          id?: string
          interacted?: boolean
          key_count?: number
          platform?: string | null
          sampled_at?: string
          scroll_count?: number
          session_id?: string | null
          source?: string | null
          va_id: string
          window_sec?: number
        }
        Update: {
          click_count?: number
          id?: string
          interacted?: boolean
          key_count?: number
          platform?: string | null
          sampled_at?: string
          scroll_count?: number
          session_id?: string | null
          source?: string | null
          va_id?: string
          window_sec?: number
        }
        Relationships: [
          {
            foreignKeyName: "engagement_samples_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_orphan_24h"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "engagement_samples_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "work_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_samples_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      idle_segments: {
        Row: {
          duration_sec: number
          id: string
          session_id: string
          started_at: string
          va_id: string
        }
        Insert: {
          duration_sec?: number
          id?: string
          session_id: string
          started_at?: string
          va_id: string
        }
        Update: {
          duration_sec?: number
          id?: string
          session_id?: string
          started_at?: string
          va_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idle_segments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_orphan_24h"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "idle_segments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "work_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idle_segments_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      internal_secrets: {
        Row: {
          created_at: string
          name: string
          value: string
        }
        Insert: {
          created_at?: string
          name: string
          value: string
        }
        Update: {
          created_at?: string
          name?: string
          value?: string
        }
        Relationships: []
      }
      invoice_line_items: {
        Row: {
          amount_cents: number
          created_at: string
          description: string
          hours: number
          id: string
          invoice_id: string
          rate_cents: number
          sort: number
          va_id: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          description?: string
          hours?: number
          id?: string
          invoice_id: string
          rate_cents?: number
          sort?: number
          va_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          description?: string
          hours?: number
          id?: string
          invoice_id?: string
          rate_cents?: number
          sort?: number
          va_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          currency: string
          due_date: string | null
          id: string
          issued_at: string | null
          notes: string | null
          number: string
          period_end: string
          period_start: string
          status: string
          subtotal_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          due_date?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          number: string
          period_end: string
          period_start: string
          status?: string
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          due_date?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          number?: string
          period_end?: string
          period_start?: string
          status?: string
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      productivity_rules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          pattern: string
          rating: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          pattern: string
          rating: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          pattern?: string
          rating?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          consent_at: string | null
          created_at: string
          display_name: string | null
          pay_currency: string
          pay_rate_cents: number
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["profile_status"]
          user_id: string
        }
        Insert: {
          consent_at?: string | null
          created_at?: string
          display_name?: string | null
          pay_currency?: string
          pay_rate_cents?: number
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["profile_status"]
          user_id: string
        }
        Update: {
          consent_at?: string | null
          created_at?: string
          display_name?: string | null
          pay_currency?: string
          pay_rate_cents?: number
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["profile_status"]
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          archived: boolean
          client_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          archived?: boolean
          client_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          archived?: boolean
          client_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_started_at: string
        }
        Insert: {
          count?: number
          key: string
          window_started_at: string
        }
        Update: {
          count?: number
          key?: string
          window_started_at?: string
        }
        Relationships: []
      }
      screenshots: {
        Row: {
          captured_at: string
          id: string
          platform: string | null
          session_id: string
          source: string | null
          storage_path: string
          va_id: string
        }
        Insert: {
          captured_at?: string
          id?: string
          platform?: string | null
          session_id: string
          source?: string | null
          storage_path: string
          va_id: string
        }
        Update: {
          captured_at?: string
          id?: string
          platform?: string | null
          session_id?: string
          source?: string | null
          storage_path?: string
          va_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "screenshots_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_orphan_24h"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "screenshots_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "work_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenshots_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      session_commands: {
        Row: {
          applied_at: string | null
          command: string
          created_at: string
          expires_at: string
          id: string
          issued_by: string
          reason: string | null
          session_id: string | null
          status: string
          va_id: string
        }
        Insert: {
          applied_at?: string | null
          command: string
          created_at?: string
          expires_at?: string
          id?: string
          issued_by: string
          reason?: string | null
          session_id?: string | null
          status?: string
          va_id: string
        }
        Update: {
          applied_at?: string | null
          command?: string
          created_at?: string
          expires_at?: string
          id?: string
          issued_by?: string
          reason?: string | null
          session_id?: string | null
          status?: string
          va_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_commands_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "session_commands_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_orphan_24h"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "session_commands_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "work_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_commands_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      session_orphan_telemetry: {
        Row: {
          events_after_end: number
          events_in_window: number
          events_total: number
          finalized_active_sec: number
          id: string
          last_event_at: string | null
          orphan_lag_sec: number | null
          orphan_sec_after_end: number
          session_ended_at: string
          session_id: string
          session_platform: string | null
          session_source: string | null
          session_started_at: string
          session_status: string
          session_wall_sec: number
          snapshot_at: string
          va_id: string
          va_name: string | null
        }
        Insert: {
          events_after_end: number
          events_in_window: number
          events_total: number
          finalized_active_sec: number
          id?: string
          last_event_at?: string | null
          orphan_lag_sec?: number | null
          orphan_sec_after_end: number
          session_ended_at: string
          session_id: string
          session_platform?: string | null
          session_source?: string | null
          session_started_at: string
          session_status: string
          session_wall_sec: number
          snapshot_at?: string
          va_id: string
          va_name?: string | null
        }
        Update: {
          events_after_end?: number
          events_in_window?: number
          events_total?: number
          finalized_active_sec?: number
          id?: string
          last_event_at?: string | null
          orphan_lag_sec?: number | null
          orphan_sec_after_end?: number
          session_ended_at?: string
          session_id?: string
          session_platform?: string | null
          session_source?: string | null
          session_started_at?: string
          session_status?: string
          session_wall_sec?: number
          snapshot_at?: string
          va_id?: string
          va_name?: string | null
        }
        Relationships: []
      }
      session_segments: {
        Row: {
          active_sec: number
          break_type: string | null
          client_id: string | null
          created_at: string
          ended_at: string | null
          id: string
          idle_sec: number
          kind: string
          project_id: string | null
          session_id: string
          started_at: string
          va_id: string
        }
        Insert: {
          active_sec?: number
          break_type?: string | null
          client_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          idle_sec?: number
          kind: string
          project_id?: string | null
          session_id: string
          started_at?: string
          va_id: string
        }
        Update: {
          active_sec?: number
          break_type?: string | null
          client_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          idle_sec?: number
          kind?: string
          project_id?: string | null
          session_id?: string
          started_at?: string
          va_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_segments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_segments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_segments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_orphan_24h"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "session_segments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "work_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_segments_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sop_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          is_question: boolean
          sop_id: string
          step_index: number | null
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          is_question?: boolean
          sop_id: string
          step_index?: number | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          is_question?: boolean
          sop_id?: string
          step_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sop_comments_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_completions: {
        Row: {
          completed_at: string
          id: string
          signature_name: string | null
          sop_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          id?: string
          signature_name?: string | null
          sop_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          id?: string
          signature_name?: string | null
          sop_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_completions_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_completions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sop_share_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          sop_id: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          sop_id: string
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          sop_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_share_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sop_share_tokens_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_versions: {
        Row: {
          created_at: string
          description: string | null
          edited_by: string | null
          id: string
          sop_id: string
          steps: Json
          title: string
          version: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          edited_by?: string | null
          id?: string
          sop_id: string
          steps: Json
          title: string
          version: number
        }
        Update: {
          created_at?: string
          description?: string | null
          edited_by?: string | null
          id?: string
          sop_id?: string
          steps?: Json
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "sop_versions_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sop_versions_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
        ]
      }
      sops: {
        Row: {
          created_at: string
          description: string | null
          generated_for_va: string | null
          generated_from_signature: string | null
          id: string
          needs_review: boolean
          source: string
          status: Database["public"]["Enums"]["sop_status"]
          steps: Json
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          generated_for_va?: string | null
          generated_from_signature?: string | null
          id?: string
          needs_review?: boolean
          source?: string
          status?: Database["public"]["Enums"]["sop_status"]
          steps?: Json
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          generated_for_va?: string | null
          generated_from_signature?: string | null
          id?: string
          needs_review?: boolean
          source?: string
          status?: Database["public"]["Enums"]["sop_status"]
          steps?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sops_generated_for_va_fkey"
            columns: ["generated_for_va"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      timesheet_approvals: {
        Row: {
          approved_at: string
          approved_by: string
          created_at: string
          id: string
          notes: string | null
          total_active_sec: number
          total_idle_sec: number
          va_id: string
          week_start: string
        }
        Insert: {
          approved_at?: string
          approved_by: string
          created_at?: string
          id?: string
          notes?: string | null
          total_active_sec?: number
          total_idle_sec?: number
          va_id: string
          week_start: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          created_at?: string
          id?: string
          notes?: string | null
          total_active_sec?: number
          total_idle_sec?: number
          va_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_approvals_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      work_sessions: {
        Row: {
          active_sec: number
          client_id: string | null
          ended_at: string | null
          id: string
          idle_sec: number
          last_activity_at: string
          platform: string | null
          project_id: string | null
          source: string
          started_at: string
          status: Database["public"]["Enums"]["session_status"]
          va_id: string
        }
        Insert: {
          active_sec?: number
          client_id?: string | null
          ended_at?: string | null
          id?: string
          idle_sec?: number
          last_activity_at?: string
          platform?: string | null
          project_id?: string | null
          source?: string
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          va_id: string
        }
        Update: {
          active_sec?: number
          client_id?: string | null
          ended_at?: string | null
          id?: string
          idle_sec?: number
          last_activity_at?: string
          platform?: string | null
          project_id?: string | null
          source?: string
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          va_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_sessions_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      workflow_signatures: {
        Row: {
          generated_sop_id: string | null
          id: string
          last_seen_at: string
          occurrence_count: number
          signature: string
          va_id: string
        }
        Insert: {
          generated_sop_id?: string | null
          id?: string
          last_seen_at?: string
          occurrence_count?: number
          signature: string
          va_id: string
        }
        Update: {
          generated_sop_id?: string | null
          id?: string
          last_seen_at?: string
          occurrence_count?: number
          signature?: string
          va_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_signatures_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      workflow_steps: {
        Row: {
          created_at: string
          dpr: number | null
          id: string
          label: string | null
          platform: string | null
          rect: Json | null
          screenshot_path: string | null
          session_id: string
          source: string | null
          step_index: number
          tag: string | null
          url: string | null
          va_id: string
          viewport: Json | null
        }
        Insert: {
          created_at?: string
          dpr?: number | null
          id?: string
          label?: string | null
          platform?: string | null
          rect?: Json | null
          screenshot_path?: string | null
          session_id: string
          source?: string | null
          step_index?: number
          tag?: string | null
          url?: string | null
          va_id: string
          viewport?: Json | null
        }
        Update: {
          created_at?: string
          dpr?: number | null
          id?: string
          label?: string | null
          platform?: string | null
          rect?: Json | null
          screenshot_path?: string | null
          session_id?: string
          source?: string | null
          step_index?: number
          tag?: string | null
          url?: string | null
          va_id?: string
          viewport?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_steps_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_orphan_24h"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "workflow_steps_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "work_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_steps_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      session_orphan_24h: {
        Row: {
          events_after_end: number | null
          events_in_window: number | null
          events_total: number | null
          finalized_active_sec: number | null
          last_event_at: string | null
          orphan_lag_sec: number | null
          orphan_sec_after_end: number | null
          session_ended_at: string | null
          session_id: string | null
          session_platform: string | null
          session_source: string | null
          session_started_at: string | null
          session_status: string | null
          session_wall_sec: number | null
          va_id: string | null
          va_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_sessions_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Functions: {
      admin_get_billing_config: {
        Args: never
        Returns: {
          billing_address: string
          billing_business_name: string
          billing_default_currency: string
          billing_email: string
          billing_logo_url: string
          billing_payment_notes: string
        }[]
      }
      admin_invoice_preview: {
        Args: {
          p_client_id: string
          p_period_end: string
          p_period_start: string
          p_rate_cents: number
        }
        Returns: {
          active_sec: number
          amount_cents: number
          hours: number
          va_id: string
          va_name: string
        }[]
      }
      admin_list_clients_with_billing: {
        Args: never
        Returns: {
          archived: boolean
          bill_currency: string
          bill_rate_cents: number
          created_at: string
          id: string
          name: string
        }[]
      }
      admin_save_invoice: {
        Args: {
          p_due_date: string
          p_expected_updated_at: string
          p_invoice_id: string
          p_issued_at: string
          p_lines: Json
          p_notes: string
          p_number: string
        }
        Returns: Json
      }
      bridge_session_idle_and_close: {
        Args: { p_proposed_ended_at: string; p_session_id: string }
        Returns: undefined
      }
      close_open_session_segment: {
        Args: { p_ended_at: string; p_final?: boolean; p_session_id: string }
        Returns: undefined
      }
      close_stale_sessions: { Args: never; Returns: number }
      end_break: { Args: { p_va_id: string }; Returns: number }
      get_client_share_billable: { Args: { p_token: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      issue_self_session_command: {
        Args: { p_command: string; p_session_id: string }
        Returns: string
      }
      next_invoice_number: { Args: never; Returns: string }
      open_session_segment: {
        Args: {
          p_client_id: string
          p_kind: string
          p_project_id: string
          p_session_id: string
        }
        Returns: string
      }
      report_segment_day_slices: {
        Args: { p_from: string; p_to: string; p_va_id?: string }
        Returns: {
          active_sec: number
          client_id: string
          idle_sec: number
          kind: string
          local_day: string
          project_id: string
          segment_id: string
          session_id: string
          slice_end: string
          slice_start: string
          va_id: string
        }[]
      }
      start_break:
        | { Args: { p_reason: string; p_session_id: string }; Returns: string }
        | {
            Args: {
              p_break_type?: string
              p_reason: string
              p_session_id: string
            }
            Returns: string
          }
      switch_session_client: {
        Args: {
          p_client_id: string
          p_project_id: string
          p_session_id: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "va"
      profile_status: "active" | "invited" | "disabled"
      session_status: "active" | "ended" | "abandoned"
      sop_status: "auto" | "reviewed" | "archived"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "va"],
      profile_status: ["active", "invited", "disabled"],
      session_status: ["active", "ended", "abandoned"],
      sop_status: ["auto", "reviewed", "archived"],
    },
  },
} as const
