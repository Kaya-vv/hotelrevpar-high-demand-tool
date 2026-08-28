import { CalendarView } from "@/features/calendar/calendar-view";
import { type CalendarFilters, getCalendarData } from "@/features/calendar/query";
import { RefreshHotelForm } from "@/features/collection/refresh-hotel-form";
import { overrideImportance } from "@/features/review/actions";
import { requireAccount } from "@/lib/auth/require-account";

export const maxDuration = 300;

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function value(params: Record<string, string | string[] | undefined>, key: string) {
  const item = params[key];
  return typeof item === "string" ? item : undefined;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { accountId } = await requireAccount();
  const params = await searchParams;
  const rawMonth = value(params, "month");
  const month = rawMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : currentMonth();
  const rawImportance = value(params, "importance");
  const rawDistance = value(params, "maxDistance");
  const parsedDistance = rawDistance ? Number(rawDistance) : undefined;
  const filters: CalendarFilters = {
    month,
    hotel: value(params, "hotel"),
    category: value(params, "category"),
    maxDistance: parsedDistance !== undefined && Number.isFinite(parsedDistance) && parsedDistance >= 0 ? parsedDistance : undefined,
    importance: ["Low", "Medium", "High"].includes(rawImportance ?? "") ? rawImportance as CalendarFilters["importance"] : undefined,
  };
  const data = await getCalendarData(accountId, filters);
  const selectedHotel = data.hotels.find((hotel) => hotel.id === data.selectedHotelId);

  return (
    <div>
      <div className="page-title-row">
        <header className="page-title"><span className="eyebrow">Vraagkalender</span><h1>{selectedHotel?.name ?? "Hoge-vraagmomenten"}</h1></header>
        {data.selectedHotelId && <RefreshHotelForm hotelId={data.selectedHotelId} />}
      </div>
      <form className="filter-bar">
        <label>Maand<input name="month" type="month" defaultValue={month} /></label>
        <label>Hotel<select name="hotel" defaultValue={data.selectedHotelId ?? ""}>{data.hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select></label>
        <label>Categorie<select name="category" defaultValue={filters.category ?? ""}><option value="">Alle categorieën</option>{data.categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>Max. afstand<input name="maxDistance" type="number" min="0" step="1" defaultValue={filters.maxDistance} /></label>
        <label>Importance<select name="importance" defaultValue={filters.importance ?? ""}><option value="">Alle scores</option><option>Low</option><option>Medium</option><option>High</option></select></label>
        <button className="secondary" type="submit">Filteren</button>
      </form>
      {!data.selectedHotelId && <p className="empty-state">Voeg eerst een hotel toe.</p>}
      <CalendarView month={month} events={data.events} latestRun={data.latestRun} overrideImportanceAction={overrideImportance} />
    </div>
  );
}
