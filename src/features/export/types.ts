import type { DemandLevel } from "@/features/events/importance";

export type ExportEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  hotels: Array<{
    id: string;
    code: string;
    importance: DemandLevel;
    impactBasis: string;
  }>;
};

export type RevControlRow = {
  show: "Yes";
  event: string;
  startDate: Date;
  endDate: Date;
  importance: "Low" | "Medium" | "High";
  supplementPercentage: null;
  supplement: null;
  mls: null;
  addSupplementFor: null;
  hotels: string;
  splitPerHotel: null;
  note: null;
  source: null;
};

