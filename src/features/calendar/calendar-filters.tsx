"use client";

import { useRef } from "react";

export function CalendarFilters({
  month,
  view,
  category,
  importance,
  categories,
  levels,
}: {
  month: string;
  view: "list" | "calendar";
  category?: string;
  importance?: string;
  categories: string[];
  levels: Array<{ value: string; label: string }>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form
      key={`${month}|${view}|${category ?? ""}|${importance ?? ""}`}
      ref={formRef}
      action="/calendar"
      className="filter-bar"
    >
      <input name="month" type="hidden" value={month} />
      <input name="view" type="hidden" value={view} />
      <label>
        Categorie
        <select name="category" defaultValue={category ?? ""} onChange={submit}>
          <option value="">Alle categorieën</option>
          {categories.map((item) => (
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
