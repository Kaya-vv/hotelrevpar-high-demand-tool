import Link from "next/link";

import { CalendarView } from "@/features/calendar/calendar-view";
import {
  type CalendarFilters,
  getCalendarData,
} from "@/features/calendar/query";
import { RefreshHotelForm } from "@/features/collection/refresh-hotel-form";
import { demandLabels, demandLevels } from "@/features/events/importance";
import { overrideImportance } from "@/features/review/actions";
import { requireAccount } from "@/lib/auth/require-account";

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${
    parts.find((part) => part.type === "month")?.value
  }`;
}

function value(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const item = params[key];
  return typeof item === "string" ? item : undefined;
}

function changeMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId } = await requireAccount();
  const params = await searchParams;
  const rawMonth = value(params, "month");
  const month =
    rawMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth)
      ? rawMonth
      : currentMonth();
  const rawImportance = value(params, "importance");
  const view = value(params, "view") === "calendar" ? "calendar" : "list";
  const rawDistance = value(params, "maxDistance");
  const parsedDistance = rawDistance ? Number(rawDistance) : undefined;
  const filters: CalendarFilters = {
    month,
    category: value(params, "category"),
    maxDistance:
      parsedDistance !== undefined &&
      Number.isFinite(parsedDistance) &&
      parsedDistance >= 0
        ? parsedDistance
        : undefined,
    importance: demandLevels.includes(
      rawImportance as typeof demandLevels[number]
    )
      ? (rawImportance as CalendarFilters["importance"])
      : undefined,
  };
  const data = await getCalendarData(accountId, filters);
  const selectedHotel = data.hotels.find(
    (hotel) => hotel.id === data.selectedHotelId
  );
  const href = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    next.set("month", month);
    next.set("view", view);
    if (filters.category) next.set("category", filters.category);
    if (filters.maxDistance !== undefined)
      next.set("maxDistance", String(filters.maxDistance));
    if (filters.importance) next.set("importance", filters.importance);
    Object.entries(changes).forEach(([key, item]) =>
      item ? next.set(key, item) : next.delete(key)
    );
    return `/calendar?${next.toString()}`;
  };
  const activeFilterCount =
    Number(Boolean(filters.category)) +
    Number(filters.maxDistance !== undefined) +
    Number(Boolean(filters.importance));

  return (
    <div>
      <div className="page-title-row">
        <header className="page-title">
          <span className="eyebrow">Vraagmomenten</span>
          <h1>{selectedHotel?.name ?? "Hoge-vraagmomenten"}</h1>
          <p>Alle relevante momenten met hun verwachte hotelvraag en score.</p>
        </header>
        {data.selectedHotelId && (
          <RefreshHotelForm hotelId={data.selectedHotelId} />
        )}
      </div>
      <div className="event-toolbar">
        <nav className="month-navigation" aria-label="Maand kiezen">
          <Link
            className="secondary link-button"
            href={href({ month: changeMonth(month, -1) })}
            aria-label="Vorige maand"
          >
            ‹
          </Link>
          <strong>{monthLabel(month)}</strong>
          <Link
            className="secondary link-button"
            href={href({ month: changeMonth(month, 1) })}
            aria-label="Volgende maand"
          >
            ›
          </Link>
        </nav>
        <nav className="view-switch" aria-label="Weergave kiezen">
          <Link
            href={href({ view: "list" })}
            aria-current={view === "list" ? "page" : undefined}
          >
            Overzicht
          </Link>
          <Link
            href={href({ view: "calendar" })}
            aria-current={view === "calendar" ? "page" : undefined}
          >
            Kalender
          </Link>
        </nav>
      </div>
      <form className="filter-bar">
        <input name="view" type="hidden" value={view} />
        <label>
          Maand
          <input name="month" type="month" defaultValue={month} />
        </label>
        <label>
          Categorie
          <select name="category" defaultValue={filters.category ?? ""}>
            <option value="">Alle categorieën</option>
            {data.categories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        <label>
          Max. afstand
          <input
            name="maxDistance"
            type="number"
            min="0"
            step="1"
            defaultValue={filters.maxDistance}
          />
        </label>
        <label>
          Vraaginschatting
          <select name="importance" defaultValue={filters.importance ?? ""}>
            <option value="">Alle niveaus</option>
            {demandLevels.map((level) => (
              <option key={level} value={level}>
                {demandLabels[level]}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" type="submit">
          Filteren
        </button>
      </form>
      {activeFilterCount > 0 && (
        <div className="active-filters">
          <span>
            {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}{" "}
            actief
          </span>
          <Link
            href={href({
              category: undefined,
              maxDistance: undefined,
              importance: undefined,
            })}
          >
            Filters wissen
          </Link>
        </div>
      )}
      {!data.selectedHotelId && (
        <p className="empty-state">Voeg eerst een hotel toe.</p>
      )}
      <CalendarView
        month={month}
        events={data.events}
        latestRun={data.latestRun}
        view={view}
        overrideImportanceAction={overrideImportance}
      />
    </div>
  );
}
