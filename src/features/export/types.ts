export type ExportEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  hotels: Array<{ id: string; code: string; importance: "Low" | "Medium" | "High" }>;
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

