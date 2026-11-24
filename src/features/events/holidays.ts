/** Public and school holidays come from the government lists. They are calendar context, not events. */
export function isHoliday(category: string) {
  return category === "public_holiday" || category === "school_holiday";
}

/**
 * Whether a holiday applies to a hotel. A public holiday applies everywhere. A school holiday
 * applies to its own region; the Christmas and May holidays are `national` and apply to every
 * hotel. Until November 2026 `national` matched no hotel, so neither ever reached a calendar.
 */
export function holidayApplies(holiday: { category: string; regionScope: string | null }, holidayRegion: string | null) {
  if (holiday.category === "public_holiday") return true;
  return holiday.category === "school_holiday"
    && (holiday.regionScope === "national" || (holidayRegion !== null && holiday.regionScope === holidayRegion));
}

/**
 * Two rows are one holiday only with the same kind and region. The north's and the middle's 2027
 * spring holiday share name and dates; matching on those merged them, and every northern hotel
 * lost its spring holiday.
 */
export function holidaysConflict(
  left: { category: string; regionScope: string | null },
  right: { category: string; regionScope: string | null },
) {
  return (isHoliday(left.category) || isHoliday(right.category))
    && (left.category !== right.category || left.regionScope !== right.regionScope);
}
