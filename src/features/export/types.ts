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
    announced?: boolean;
    available?: boolean;
    exportLevel?: DemandLevel | null;
    exportedAt?: string | null;
    manuallySelected?: boolean;
  }>;
};

export type ExportMode = "new" | "selected" | "all";
export type ExportChoice = { eventId: string; hotelId: string; importance: DemandLevel };
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
