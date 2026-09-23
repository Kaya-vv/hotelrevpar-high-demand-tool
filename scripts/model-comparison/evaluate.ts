// Only pure production rules are called here. No collection/queue/database entrypoint.
import { outputSchema, normalizeEventResponse, triageExclusionAllowed } from '../../src/features/collection/sources/claude';
import { verifyEventEvidence, localDateBoundary } from '../../src/features/events/evidence';
import { scoreHotelEvent } from '../../src/features/events/score';
import { validateCandidate } from '../../src/features/events/validate';
import { normalizeText, validEventRange, eventLocalDate } from '../../src/features/events/normalize';
import type { EventCandidate } from '../../src/features/events/types';

type Page = { url: string; text: string };
type Case = { task: string; city: string; originalPrompt?: string; prompt: string; pages: Page[]; observed?: { url: string }[]; window?: { start: string; end: string } | null; source?: { recordedAt: string } };
const cities: Record<string, { latitude: number; longitude: number }> = { Eindhoven: { latitude: 51.4372, longitude: 5.4774 }, Rotterdam: { latitude: 51.906, longitude: 4.488 } };
const text = (v: unknown) => typeof v === 'string' ? v : '';
export function evaluateAnswer(test: Case, answer: unknown) {
  if (!answer || typeof answer !== 'object') throw new Error('Answer is not an object');
  const raw = answer as Record<string, unknown>;
  if (test.task === 'official_website') {
    if (raw.url !== null && typeof raw.url !== 'string') throw new Error('Missing URL decision');
    const supported = raw.url === null || (test.observed ?? []).some(x => x.url === raw.url);
    return { events: [], errors: supported ? [] : ['unobserved_url'], url: raw.url, checks: 1, reviewRequired: true };
  }
  if (test.task === 'shortlist') {
    const tail = (test.originalPrompt ?? test.prompt).split('Kandidaten:\n').at(-1)!;
    const candidates = JSON.parse(tail) as { index: number; title: string; startDate: string; endDate: string | null }[];
    if (!Array.isArray(raw.reviews)) throw new Error('Missing shortlist decisions');
    const errors: string[] = [];
    const reviews = raw.reviews as { index: number; decision: string; excludeAs: string | null; act: string | null }[];
    const decisions = candidates.map(c => {
      const matches = reviews.filter(r => r.index === c.index);
      if (matches.length !== 1 || !['exclude', 'verify'].includes(matches[0]?.decision)) errors.push(`missing_or_duplicate_decision:${c.index}`);
      const excluded = matches.length === 1 && triageExclusionAllowed(matches[0], c);
      if (matches[0]?.decision === 'exclude' && !excluded) errors.push(`unsafe_exclusion:${c.index}`);
      return { index: c.index, title: c.title, decision: excluded ? 'exclude' : 'verify' };
    });
    if (reviews.some(r => !candidates.some(c => c.index === r.index))) errors.push('unknown_candidate_index');
    return { events: [], errors, decisions, checks: candidates.length, reviewRequired: true };
  }
  const normalized = normalizeEventResponse(answer) as { events?: unknown[] };
  if (!Array.isArray(normalized.events)) throw new Error('Missing events array');
  const errors: string[] = [];
  const seen = new Set<string>();
  const events = normalized.events.map((value, index) => {
    const parsed = outputSchema.shape.events.element.safeParse(value);
    if (!parsed.success) { errors.push(`invalid_event:${index}`); return { title: text((value as Record<string, unknown>)?.title), verified: false, errors: ['invalid_event'] }; }
    const event = parsed.data;
    const issues: string[] = [];
    const evidence = verifyEventEvidence(event.facts, event.sourceUrl, test.pages, test.source?.recordedAt ?? new Date().toISOString(), event);
    const start = eventLocalDate(event.startAt), end = eventLocalDate(event.endAt);
    const dateValid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
    if (!dateValid(event.startAt.slice(0, 10)) || !dateValid(event.endAt.slice(0, 10)) || !dateValid(start) || !dateValid(end) || start > end) issues.push('invalid_dates');
    // validateCandidate reports missing location fields before checking dates. Keep
    // independent date/status checks even when publication awaits a venue lookup.
    if (test.window && (start > test.window.end || end < test.window.start)) issues.push('out_of_window');
    if (event.status !== 'active') issues.push(event.status);
    if (!evidence?.dateText || !event.dateConfirmed || !event.titleConfirmed) issues.push('unsupported_date_or_title');
    if (event.ownerType === 'other') issues.push('not_official_owner');
    if (!evidence?.locationText || !event.locationConfirmed) issues.push('unsupported_location');
    if (event.facts?.announcedAt && !evidence?.announcedAt) issues.push('unsupported_announcement');
    if (evidence?.hostCity && normalizeText(evidence.hostCity) !== normalizeText(test.city)) issues.push('area_unresolved');
    // Current scoring intentionally ignores non-comparable historical facts. That is
    // not an invented quote: check source support separately from scoring eligibility.
    const plain = (value: string) => value.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
    if (event.facts?.demand.some(f => f.text.trim().length < 12 || !test.pages.some(p => p.url === f.sourceUrl && plain(p.text).includes(plain(f.text))))) issues.push('unsupported_demand_quote');
    const quotedYears: string[] = evidence?.dateText.match(/\b20\d{2}\b/g) ?? [];
    if (quotedYears.length && (!quotedYears.includes(start.slice(0, 4)) || !quotedYears.includes(end.slice(0, 4)))) issues.push('wrong_year');
    if (/\bonline\b/i.test(`${event.title} ${evidence?.dateText ?? ''}`)) issues.push('online_event');
    const identity = `${normalizeText(event.title)}|${start}|${end}`;
    if (seen.has(identity)) issues.push('duplicate'); seen.add(identity);
    let score = null, validation = null;
    // Never invent venue coordinates. Citywide events use the same city reference for
    // both answers; venue-level grading stays explicitly provisional without a geocode.
    const city = cities[test.city];
    const local = evidence?.locationScope === 'citywide' && evidence.hostCity?.toLowerCase() === test.city.toLowerCase();
    if (dateValid(start) && dateValid(end)) {
      const candidate: EventCandidate = {
        provider: 'claude', providerEventId: identity, sourceUrl: event.sourceUrl, title: event.title, category: event.category,
        venue: event.venue, latitude: local ? city.latitude : null, longitude: local ? city.longitude : null, regionScope: null,
        startAt: localDateBoundary(start), endAt: localDateBoundary(end, true), sourceState: event.status,
        certainty: 'confirmed', localRank: null, attendance: evidence?.demand.some(f => f.scope === 'edition') ? event.attendance : null,
        venueCapacity: event.venueCapacity, aiImpactPoints: event.impactPoints, overnightAudience: event.overnightAudience,
        evidenceText: evidence?.demand.map(f => f.text).join(' ') ?? null, primarySourceConfirmed: Boolean(evidence?.dateText && evidence.locationText), evidence,
      };
      if (!validEventRange(candidate)) issues.push('invalid_range');
      validation = validateCandidate(candidate, test.window ?? { start: '2000-01-01', end: '2100-01-01' }, null);
      // A city-only record still has testable dates/location evidence. Missing venue
      // coordinates are a publication gap, not an extraction mistake by the model.
      if (validation.state !== 'active' && validation.reason !== 'missing_fields' && !issues.includes(validation.reason ?? 'excluded')) issues.push(validation.reason ?? 'excluded');
      score = scoreHotelEvent({ candidate, hotel: { ...city, demandRadiusKm: 25, holidayRegion: null }, overlaps: [] });
    }
    errors.push(...issues.map(e => `${index}:${e}`));
    return { title: event.title, start, end, sourceUrl: event.sourceUrl, venue: event.venue, hostCity: evidence?.hostCity,
      // A bad extra claim must be reported, but does not erase an otherwise useful
      // event whose dates and location the app can retain with unknown demand.
      verified: !issues.some(e => !['unsupported_demand_quote', 'unsupported_announcement'].includes(e)), errors: issues, identity, facts: event.facts, supportedEvidence: evidence,
      score, scoreLocationComplete: local, validation };
  });
  return { events, errors, checks: Math.max(1, events.length), reviewRequired: true };
}
