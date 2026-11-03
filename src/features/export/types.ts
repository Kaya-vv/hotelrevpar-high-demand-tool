import type { DemandLevel } from "@/features/events/importance";

export type ExportEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status?: string;
  hotels: Array<{
    id: string;
    code: string;
    importance: DemandLevel;
    impactBasis: string;
    /** Shown as Medium: likely hotel demand of unknown size. */
    announced?: boolean;
    available?: boolean;
    /** In the hidden Laag tier; exported only when the account sends Laag too. */
    laag?: boolean;
    exportedAt?: string | null;
  }>;
};

export type ExportMode = "new" | "selected" | "all";
/** The lowest level an account sends to RevControl (`accounts.export_min_level`). */
export type ExportMinLevel = "Low" | "Medium" | "High";
export type ExportSnapshot = { eventId: string; hotelId: string; title: string; startDate: string; endDate: string; hotelCode: string; importance: "Low" | "Medium" | "High"; status: string; manual: boolean };

export type RevControlRow = {
  show: "Yes";
  event: string;
  startDate: Date;
  endDate: Date;
  importance: "Low" | "Medium" | "High";
  supplementPercentage: null;
  supplement: null;
  mls: null;
  addSupplementFor: "Both";
  hotels: string;
  splitPerHotel: null;
  note: null;
  source: null;
};
