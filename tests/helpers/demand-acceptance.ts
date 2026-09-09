import { eventLocalDate, normalizeText } from "../../src/features/events/normalize";

type Expected = { title: string; match: string; start: string; end: string };
type CalendarRow = { title: string; startAt: string; endAt: string };
type Trace = { title: string; start?: string; end?: string; stage: string; reason?: string };

/** Answer key is consumed only after collection/publication has finished. */
export function evaluateDemandAcceptance(input: {
  expected: Expected[]; negativePatterns: string[]; calendar: CalendarRow[];
  traces: Trace[]; complete: boolean; integrityErrors?: string[];
}) {
  const matches = (title: string, pattern: string) => normalizeText(title).includes(normalizeText(pattern));
  const positives = input.expected.map(expected => {
    const named = input.calendar.filter(row => matches(row.title, expected.match));
    const found = named.some(row => eventLocalDate(row.startAt) === expected.start && eventLocalDate(row.endAt) === expected.end);
    const traces = input.traces.filter(row => matches(row.title, expected.match));
    return { ...expected, found, stage: found ? "calendar" : named.length ? "wrong_dates" : traces.at(-1)?.stage ?? "not_discovered",
      traces: found ? [] : traces };
  });
  const negatives = input.calendar.filter(row => input.negativePatterns.some(pattern => matches(row.title, pattern)));
  const integrityErrors = input.integrityErrors ?? [];
  const passed = input.complete && !integrityErrors.length && positives.every(row => row.found) && !negatives.length;
  return { status: !input.complete ? "in_progress" : passed ? "passed" : "failed", passed,
    positiveRecall: positives.filter(row => row.found).length, expectedPositives: positives.length,
    falsePositives: negatives.length, positives, negatives, integrityErrors };
}
