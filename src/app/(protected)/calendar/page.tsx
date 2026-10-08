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
import { trialHorizonEnd } from "@/features/accounts/trial";
import { requireViewedAccount } from "@/features/workspace/viewed-account";

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
  const { viewedAccountId, viewedAccountName, viewingOtherAccount, viewedTrialEndsAt } =
    await requireViewedAccount();
  const params = await searchParams;
  const rawMonth = value(params, "month");
  const month =
    rawMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth)
      ? rawMonth
      : currentMonth();
  const rawImportance = value(params, "importance");
  const includeLow = value(params, "low") === "1";
  const view = value(params, "view") === "calendar" ? "calendar" : "list";
  const rawPeriod = value(params, "period");
  const period = rawPeriod === "3" || rawPeriod === "12" ? rawPeriod : "all";
  const horizonEnd = trialHorizonEnd(viewedTrialEndsAt);
  const bounds = calendarBounds(month, view, period, undefined, horizonEnd);
  const selectableLevels = includeLow
    ? (["Low", "Medium", ...publishableDemandLevels] as const)
    : (["Medium", ...publishableDemandLevels] as const);
  const filters: CalendarQueryFilters = {
    month,
    view,
    period,
    includeLow,
    horizonEnd,
    category: value(params, "category"),
    importance: (selectableLevels as readonly string[]).includes(rawImportance ?? "")
      ? (rawImportance as CalendarQueryFilters["importance"])
      : undefined,
  };
  const data = await getCalendarData(viewedAccountId, filters);
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
    if (includeLow) next.set("low", "1");
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
      {viewingOtherAccount && (
        <p role="status" className="notice warning">
          Je kijkt mee in het account van {viewedAccountName}. Je ziet dezelfde
          kalender als deze klant en kunt hier niets wijzigen.
        </p>
      )}
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
        horizonEnd={horizonEnd}
        category={filters.category}
        importance={filters.importance}
        includeLow={includeLow}
        categories={data.categories}
        levels={selectableLevels.map((level) => ({
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
        hiddenEvents={data.hiddenEvents}
        latestRun={data.latestRun}
        view={view}
        includeLow={includeLow}
        lowHref={href({ low: "1" })}
        overrideImportanceAction={
          !viewingOtherAccount
            ? overrideImportance
            : undefined
        }
      />
    </div>
  );
}
