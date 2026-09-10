import Link from "next/link";
import { MonthNavigation } from "@/features/calendar/month-navigation";
import { calendarBounds, overviewMonth } from "@/features/calendar/navigation";

import { CalendarFilters } from "@/features/calendar/calendar-filters";
import { CalendarView } from "@/features/calendar/calendar-view";
import {
  type CalendarFilters as CalendarQueryFilters,
  getCalendarData,
} from "@/features/calendar/query";
import {
  demandLabels,
  publishableDemandLevels,
} from "@/features/events/importance";
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

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId, role } = await requireAccount();
  const params = await searchParams;
  const rawMonth = value(params, "month");
  const month =
    rawMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth)
      ? rawMonth
      : currentMonth();
  const rawImportance = value(params, "importance");
  const view = value(params, "view") === "calendar" ? "calendar" : "list";
  const rawPeriod = value(params, "period");
  const period = rawPeriod === "3" || rawPeriod === "12" ? rawPeriod : "all";
  const bounds = calendarBounds(month, view, period);
  const filters: CalendarQueryFilters = {
    month,
    view,
    period,
    category: value(params, "category"),
    importance: publishableDemandLevels.includes(
      rawImportance as (typeof publishableDemandLevels)[number]
    )
      ? (rawImportance as CalendarQueryFilters["importance"])
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
    next.set("period", period);
    if (filters.category) next.set("category", filters.category);
    if (filters.importance) next.set("importance", filters.importance);
    Object.entries(changes).forEach(([key, item]) =>
      item ? next.set(key, item) : next.delete(key)
    );
    return `/calendar?${next.toString()}`;
  };
  const activeFilterCount =
    Number(Boolean(filters.category)) + Number(Boolean(filters.importance));

  return (
    <div>
      <div className="page-title-row">
        <header className="page-title">
          <span className="eyebrow">Overzicht</span>
          <h1>{selectedHotel?.name ?? "Hoge-vraagmomenten"}</h1>
          <p>Alle relevante momenten met hun verwachte hotelvraag en score.</p>
        </header>
      </div>
      <div className="event-toolbar">
        {view === "calendar" ? (
          <MonthNavigation key={month} month={month} todayMonth={currentMonth()} baseHref={href({})} />
        ) : (
          <p className="muted">Van vandaag tot {new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${bounds.end}T00:00:00Z`))}</p>
        )}
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
            Maandkalender
          </Link>
        </nav>
      </div>
      <CalendarFilters
        month={month}
        view={view}
        period={period}
        category={filters.category}
        importance={filters.importance}
        categories={data.categories}
        levels={publishableDemandLevels.map((level) => ({
          value: level,
          label: demandLabels[level],
        }))}
      />
      {activeFilterCount > 0 && (
        <div className="active-filters">
          <span>
            {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}{" "}
            actief
          </span>
          <Link
            href={href({
              category: undefined,
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
        rangeStart={bounds.start}
        monthHrefs={Object.fromEntries(data.events.map((event) => {
          const target = overviewMonth(event.startAt, bounds.start);
          return [target, href({ month: target, view: "calendar" })];
        }))}
        events={data.events}
        latestRun={data.latestRun}
        view={view}
        overrideImportanceAction={
          role === "platform_admin" ? overrideImportance : undefined
        }
      />
    </div>
  );
}
