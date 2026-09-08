"use client";

import { useRef } from "react";

export function CalendarFilters({
  month,
  view,
  period,
  category,
  importance,
  categories,
  levels,
}: {
  month: string;
  view: "list" | "calendar";
  period: "3" | "12" | "all";
  category?: string;
  importance?: string;
  categories: string[];
  levels: Array<{ value: string; label: string }>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form
      key={`${month}|${view}|${period}|${category ?? ""}|${importance ?? ""}`}
      ref={formRef}
      action="/calendar"
      className="filter-bar"
    >
      <input name="month" type="hidden" value={month} />
      <input name="view" type="hidden" value={view} />
      {view === "list" ? (
        <label>Periode
          <select name="period" defaultValue={period} onChange={submit}>
            <option value="3">Komende 3 maanden</option>
            <option value="12">Komende 12 maanden</option>
            <option value="all">Alle toekomstige events</option>
          </select>
        </label>
      ) : <input name="period" type="hidden" value={period} />}
      <label>
        Categorie
        <select name="category" defaultValue={category ?? ""} onChange={submit}>
          <option value="">Alle categorieën</option>
          {[...new Set([...categories, ...(category ? [category] : [])])].sort().map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label>
        Vraaginschatting
        <select
          name="importance"
          defaultValue={importance ?? ""}
          onChange={submit}
        >
          <option value="">Alle niveaus</option>
          {levels.map((level) => (
            <option key={level.value} value={level.value}>
              {level.label}
            </option>
          ))}
        </select>
      </label>
      <button className="visually-hidden" type="submit">
        Filteren
      </button>
    </form>
  );
}
