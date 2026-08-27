export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: Record<
      string,
      {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      }
    >;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      account_role: "operator" | "platform_admin";
      account_event_state: "active" | "needs_review" | "excluded" | "ended";
      event_certainty: "confirmed" | "provisional";
      run_trigger: "cron" | "manual";
    };
    CompositeTypes: Record<string, never>;
  };
};

