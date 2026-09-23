// Read-only production snapshot of the CURRENT Sonnet results: calendars, benchmark recall and
// recorded model usage/cost. Only GET/HEAD requests to the production database are permitted.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';
import { createClient } from '@supabase/supabase-js';

process.loadEnvFile('.env.production.local');
const root = resolve('out/luna-pipeline'); mkdirSync(root, { recursive: true });
const originalFetch = globalThis.fetch;
const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  if (url.origin !== origin || !['GET', 'HEAD'].includes(method.toUpperCase())) throw new Error('Baseline permits database reads only');
  return originalFetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
};
const db = createClient(origin, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const checked = result => { if (result.error) throw result.error; return result.data; };
const adapter = join(root, 'calendar-scope.mjs');
writeFileSync(adapter, 'let scope; export const configure = value => { scope = value; }; export const getHotelScope = async () => scope; export const createServerClient = async () => scope.supabase;\n');
const empty = join(root, 'server-only.mjs'); writeFileSync(empty, 'export {};\n');
const server = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: { '@/lib/supabase/server': adapter, '@/features/workspace/hotel-context': adapter, 'server-only': empty, '@': resolve('src') } } });
try {
  const { configure } = await server.ssrLoadModule(adapter);
  const { getCalendarData } = await server.ssrLoadModule('/src/features/calendar/query.ts');
  const { longRangeMarketKey } = await server.ssrLoadModule('/src/features/collection/long-range-store.ts');
  const { evaluateDemandAcceptance } = await server.ssrLoadModule('/tests/helpers/demand-acceptance.ts');
  const { fetchAllRows } = await server.ssrLoadModule('/src/lib/supabase/fetch-in-batches.ts');
  // Same benchmark hotels as scripts/audit-demand-refresh.mjs.
  const targets = [{ market: 'eindhoven', hotelId: 'c22bedf2-178a-4932-9874-6c4d2913722e' }, { market: 'utrecht', hotelId: '71f162de-d941-4880-9ba5-83a3543e841f' }];
  const key = JSON.parse(readFileSync('tests/fixtures/hotel-demand-expectations.json', 'utf8'));
  const markets = [];
  for (const target of targets) {
    const hotel = checked(await db.from('hotels').select('*').eq('id', target.hotelId).single());
    const area = checked(await db.from('collection_areas').select('*').eq('hotel_id', hotel.id).single());
    configure({ supabase: db, hotels: [hotel], selectedHotelId: hotel.id, areaId: area.id, enabledSources: area.enabled_sources });
    const calendar = await getCalendarData(hotel.account_id, { month: new Date().toISOString().slice(0, 7), view: 'list', period: 'all' });
    const marketKey = longRangeMarketKey(area.search_location, area.radius_km);
    const state = checked(await db.from('long_range_markets').select('market_key,state,updated_at').eq('market_key', marketKey).maybeSingle());
    const runs = checked(await db.from('collection_runs').select('*').eq('collection_area_id', area.id).order('started_at', { ascending: false }).limit(20));
    const report = evaluateDemandAcceptance({ expected: key.positives.filter(row => row.market === target.market), negativePatterns: key.negativePatterns,
      calendar: calendar.events, traces: [], complete: Boolean(calendar.latestRun?.finishedAt) && !calendar.latestRun?.researchPending });
    markets.push({ market: target.market, hotel: { id: hotel.id, name: hotel.name, search_location: area.search_location, radius_km: area.radius_km }, marketKey,
      calendar, report, runs, longRange: { updatedAt: state?.updated_at, research: state?.state?.research, budget: state?.state?.budget, cycle: { finished: state?.state?.cycle?.finished, waves: state?.state?.cycle?.waves }, leads: state?.state?.leads?.length } });
    console.log(`${target.market}: ${report.positiveRecall}/${report.expectedPositives} benchmark events on the production calendar; ${calendar.events.length} calendar events`);
  }
  // Every recorded model request since September (all markets), to measure real monthly cost per horizon.
  const usage = await fetchAllRows((from, to) => db.from('collection_usage_events').select('*').gte('created_at', '2026-09-01').order('id').range(from, to));
  writeFileSync(join(root, 'sonnet-production.json'), JSON.stringify({ checkedAt: new Date().toISOString(), basis: 'production database, read-only', markets, usage }, null, 1));
  console.log(`${usage.length} usage rows saved`);
} finally { globalThis.fetch = originalFetch; await server.close(); }
