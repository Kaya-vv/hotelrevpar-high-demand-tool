"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { changeMonth, monthLabel } from "./navigation";

export function MonthNavigation({ month, todayMonth, baseHref }: {
  month: string;
  todayMonth: string;
  baseHref: string;
}) {
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const picker = useRef<HTMLDetailsElement>(null);
  const currentYear = Number(todayMonth.slice(0, 4));
  const years = Array.from({ length: Math.max(currentYear + 2, year) - Math.min(currentYear - 2, year) + 1 }, (_, index) => Math.min(currentYear - 2, year) + index);
  const href = (target: string) => {
    const params = new URLSearchParams(baseHref.split("?")[1]);
    params.set("month", target);
    params.set("view", "calendar");
    return `/calendar?${params}`;
  };
  return (
    <nav className="month-navigation" aria-label="Maand kiezen">
      <Link className="secondary link-button" href={href(changeMonth(month, -1))} aria-label="Vorige maand">‹</Link>
      <details className="month-picker" ref={picker} onKeyDown={(event) => {
        if (event.key === "Escape" && picker.current) {
          picker.current.open = false;
          picker.current.querySelector("summary")?.focus();
        }
      }} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}>
        <summary>{monthLabel(month)} <span aria-hidden="true">▾</span></summary>
        <div className="month-picker-panel">
          <label>Jaar<select value={year} onChange={(event) => setYear(Number(event.target.value))}>
            {years.map((item) => <option key={item} value={item}>{item}</option>)}
          </select></label>
          <div className="month-picker-grid">
            {Array.from({ length: 12 }, (_, index) => {
              const target = `${year}-${String(index + 1).padStart(2, "0")}`;
              return <Link key={target} href={href(target)} aria-current={target === month ? "date" : undefined} onClick={() => { if (picker.current) picker.current.open = false; }}>{monthLabel(target).replace(` ${year}`, "")}</Link>;
            })}
          </div>
        </div>
      </details>
      <Link className="secondary link-button" href={href(changeMonth(month, 1))} aria-label="Volgende maand">›</Link>
      <Link className="secondary link-button" href={href(todayMonth)}>Deze maand</Link>
    </nav>
  );
}
