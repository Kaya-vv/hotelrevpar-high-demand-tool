export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_event_areas: {
        Row: {
          account_id: string
          collection_area_id: string
          created_at: string
          event_id: string
        }
        Insert: {
          account_id: string
          collection_area_id: string
          created_at?: string
          event_id: string
        }
        Update: {
          account_id?: string
          collection_area_id?: string
          created_at?: string
          event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_event_areas_account_id_event_id_fkey"
            columns: ["account_id", "event_id"]
            isOneToOne: false
            referencedRelation: "account_events"
            referencedColumns: ["account_id", "event_id"]
          },
          {
            foreignKeyName: "account_event_areas_collection_area_id_fkey"
            columns: ["collection_area_id"]
            isOneToOne: false
            referencedRelation: "collection_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      account_events: {
        Row: {
          account_id: string
          decided_at: string | null
          decided_by: string | null
          event_id: string
          merged_into_event_id: string | null
          operator_note: string | null
          override_end_at: string | null
          override_start_at: string | null
          override_title: string | null
          override_venue: string | null
          review_reason: string | null
          state: Database["public"]["Enums"]["account_event_state"]
        }
        Insert: {
          account_id: string
          decided_at?: string | null
          decided_by?: string | null
          event_id: string
          merged_into_event_id?: string | null
          operator_note?: string | null
          override_end_at?: string | null
          override_start_at?: string | null
          override_title?: string | null
          override_venue?: string | null
          review_reason?: string | null
          state: Database["public"]["Enums"]["account_event_state"]
        }
        Update: {
          account_id?: string
          decided_at?: string | null
          decided_by?: string | null
          event_id?: string
          merged_into_event_id?: string | null
          operator_note?: string | null
          override_end_at?: string | null
          override_start_at?: string | null
          override_title?: string | null
          override_venue?: string | null
          review_reason?: string | null
          state?: Database["public"]["Enums"]["account_event_state"]
        }
        Relationships: [
          {
            foreignKeyName: "account_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_events_merged_into_event_id_fkey"
            columns: ["merged_into_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      account_members: {
        Row: {
          account_id: string
          role: Database["public"]["Enums"]["account_role"]
          user_id: string
        }
        Insert: {
          account_id: string
          role?: Database["public"]["Enums"]["account_role"]
          user_id: string
        }
        Update: {
          account_id?: string
          role?: Database["public"]["Enums"]["account_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      collection_areas: {
        Row: {
          account_id: string
          created_at: string
          enabled_sources: string[]
          hotel_id: string | null
          id: string
          latitude: number
          longitude: number
          name: string
          radius_km: number
          search_location: string
        }
        Insert: {
          account_id: string
          created_at?: string
          enabled_sources?: string[]
          hotel_id?: string | null
          id?: string
          latitude: number
          longitude: number
          name: string
          radius_km: number
          search_location?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          enabled_sources?: string[]
          hotel_id?: string | null
          id?: string
          latitude?: number
          longitude?: number
          name?: string
          radius_km?: number
          search_location?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_areas_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_areas_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_runs: {
        Row: {
          account_id: string
          collection_area_id: string
          cost_usage: Json
          error_summary: string | null
          finished_at: string | null
          id: string
          source_results: Json
          started_at: string
          trigger: Database["public"]["Enums"]["run_trigger"]
        }
        Insert: {
          account_id: string
          collection_area_id: string
          cost_usage?: Json
          error_summary?: string | null
          finished_at?: string | null
          id?: string
          source_results?: Json
          started_at?: string
          trigger: Database["public"]["Enums"]["run_trigger"]
        }
        Update: {
          account_id?: string
          collection_area_id?: string
          cost_usage?: Json
          error_summary?: string | null
          finished_at?: string | null
          id?: string
          source_results?: Json
          started_at?: string
          trigger?: Database["public"]["Enums"]["run_trigger"]
        }
        Relationships: [
          {
            foreignKeyName: "collection_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_runs_collection_area_id_fkey"
            columns: ["collection_area_id"]
            isOneToOne: false
            referencedRelation: "collection_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      event_sources: {
        Row: {
          attendance: number | null
          certainty: Database["public"]["Enums"]["event_certainty"]
          checked_at: string
          event_id: string
          evidence_text: string | null
          extracted_location: string | null
          extracted_start_at: string
          extracted_title: string
          id: string
          local_rank: number | null
          primary_source_confirmed: boolean
          provider: string
          provider_event_id: string
          source_state: string
          source_url: string
          venue_capacity: number | null
        }
        Insert: {
          attendance?: number | null
          certainty?: Database["public"]["Enums"]["event_certainty"]
          checked_at?: string
          event_id: string
          evidence_text?: string | null
          extracted_location?: string | null
          extracted_start_at: string
          extracted_title: string
          id?: string
          local_rank?: number | null
          primary_source_confirmed?: boolean
          provider: string
          provider_event_id: string
          source_state: string
          source_url: string
          venue_capacity?: number | null
        }
        Update: {
          attendance?: number | null
          certainty?: Database["public"]["Enums"]["event_certainty"]
          checked_at?: string
          event_id?: string
          evidence_text?: string | null
          extracted_location?: string | null
          extracted_start_at?: string
          extracted_title?: string
          id?: string
          local_rank?: number | null
          primary_source_confirmed?: boolean
          provider?: string
          provider_event_id?: string
          source_state?: string
          source_url?: string
          venue_capacity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_sources_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          category: string
          certainty: Database["public"]["Enums"]["event_certainty"]
          created_at: string
          end_at: string
          id: string
          latitude: number | null
          longitude: number | null
          normalized_identity: string
          region_scope: string | null
          source_state: string
          start_at: string
          title: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          category: string
          certainty?: Database["public"]["Enums"]["event_certainty"]
          created_at?: string
          end_at: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          normalized_identity: string
          region_scope?: string | null
          source_state?: string
          start_at: string
          title: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          category?: string
          certainty?: Database["public"]["Enums"]["event_certainty"]
          created_at?: string
          end_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          normalized_identity?: string
          region_scope?: string | null
          source_state?: string
          start_at?: string
          title?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: []
      }
      hotel_event_scores: {
        Row: {
          distance_km: number | null
          distance_points: number
          event_id: string
          hotel_id: string
          impact_basis: string
          impact_points: number
          importance_override: string | null
          override_note: string | null
          stay_pressure_points: number
          suggested_importance: string
          total: number
        }
        Insert: {
          distance_km?: number | null
          distance_points: number
          event_id: string
          hotel_id: string
          impact_basis: string
          impact_points: number
          importance_override?: string | null
          override_note?: string | null
          stay_pressure_points: number
          suggested_importance: string
          total: number
        }
        Update: {
          distance_km?: number | null
          distance_points?: number
          event_id?: string
          hotel_id?: string
          impact_basis?: string
          impact_points?: number
          importance_override?: string | null
          override_note?: string | null
          stay_pressure_points?: number
          suggested_importance?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "hotel_event_scores_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_event_scores_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      hotels: {
        Row: {
          account_id: string
          address: string | null
          created_at: string
          demand_radius_km: number
          enabled_sources: string[]
          holiday_region: string | null
          id: string
          latitude: number
          longitude: number
          name: string
          revcontrol_code: string
          search_location: string
        }
        Insert: {
          account_id: string
          address?: string | null
          created_at?: string
          demand_radius_km: number
          enabled_sources?: string[]
          holiday_region?: string | null
          id?: string
          latitude: number
          longitude: number
          name: string
          revcontrol_code: string
          search_location?: string
        }
        Update: {
          account_id?: string
          address?: string | null
          created_at?: string
          demand_radius_km?: number
          enabled_sources?: string[]
          holiday_region?: string | null
          id?: string
          latitude?: number
          longitude?: number
          name?: string
          revcontrol_code?: string
          search_location?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotels_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_account_member: { Args: { target: string }; Returns: boolean }
    }
    Enums: {
      account_event_state: "active" | "needs_review" | "excluded" | "ended"
      account_role: "operator" | "platform_admin"
      event_certainty: "confirmed" | "provisional"
      run_trigger: "cron" | "manual"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_event_state: ["active", "needs_review", "excluded", "ended"],
      account_role: ["operator", "platform_admin"],
      event_certainty: ["confirmed", "provisional"],
      run_trigger: ["cron", "manual"],
    },
  },
} as const

