// Full-pipeline Luna quality gate: the real Refresh (near-term) and background long-range research,
// persistence and calendar code, in an ISOLATED local database. Research runs through the app's own
// Luna client (src/features/collection/luna-client.ts, RESEARCH_PROVIDER=luna); every OpenAI
// request is recorded in the shared ledger and held to its ceiling. Anthropic requests and
// production databases are blocked.
// Usage: node scripts/luna-pipeline/run.mjs eindhoven|utrecht --allow-paid [--reset]
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { createServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { Ledger, lunaCost } from './translate.mjs';

const market = process.argv[2];
const cities = { eindhoven: 'Eindhoven', utrecht: 'Utrecht' };
if (!cities[market]) throw new Error('Usage: run.mjs eindhoven|utrecht --allow-paid [--reset]');
if (!process.argv.includes('--allow-paid')) throw new Error('Luna API calls require --allow-paid');
const root = resolve('out/luna-pipeline'); mkdirSync(root, { recursive: true });
const runDir = join(root, `app-${market}-${Date.now()}`); mkdirSync(runDir);
const save = (name, value) => writeFileSync(join(runDir, name), JSON.stringify(value, null, 1));
const workdir = 'refs/luna-pipeline-db';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
if (process.argv.includes('--reset')) execSync(`${pnpm} exec supabase db reset --workdir ${workdir}`, { stdio: 'inherit' });
const local = JSON.parse(execSync(`${pnpm} exec supabase status --workdir ${workdir} -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
if (local.API_URL !== 'http://127.0.0.1:54531') throw new Error('Isolated Luna evaluation database required');

const openAiKey = process.env.OPENAI_API_KEY || parseEnv(readFileSync('.env.local', 'utf8')).OPENAI_API_KEY;
process.loadEnvFile('.env.local');
if (!openAiKey) throw new Error('OPENAI_API_KEY is required');
process.env.OPENAI_API_KEY = openAiKey;
process.env.RESEARCH_PROVIDER = 'luna';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_BASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = local.SERVICE_ROLE_KEY;
process.env.LONG_RANGE_DISCOVERY = 'enabled';
delete process.env.LONG_RANGE_MARKETS;

const db = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const checked = result => { if (result.error) throw result.error; return result.data; };
const queue = []; globalThis.__refreshQueue = queue;
let phase = 'setup';
const ledger = new Ledger(join(root, 'ledger.json'), 40);
const startSpent = ledger.spent();
const recordings = { startedAt: new Date().toISOString(), market, network: [], pages: [], summaries: [], timings: [] };
save('manifest.json', { capturedAt: recordings.startedAt, market, provider: 'gpt-6-luna via src/features/collection/luna-client.ts',
  gitHead: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
  workingDiffSha256: execSync('git diff -- src', { encoding: 'utf8' }).length ? 'src has uncommitted changes' : 'clean src',
  scope: 'Real Refresh, research, persistence and calendar code; isolated database; research answered by the app Luna client' });

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw);
  if (url.origin === local.API_URL) return originalFetch(input, init);
  if (url.hostname.endsWith('supabase.co')) throw new Error('Production database access blocked');
  if (url.hostname === 'api.anthropic.com') throw new Error('Anthropic requests are blocked in the Luna gate');
  if (url.hostname === 'api.openai.com') {
    if (url.pathname !== '/v1/responses') throw new Error(`OpenAI endpoint blocked: ${url.pathname}`);
    const params = JSON.parse(init.body);
    const id = randomUUID();
    const row = { id, phase, round: true, reasoning: params.reasoning?.effort, tools: (params.tools ?? []).map(t => t.name ?? t.type),
      startedAt: new Date().toISOString(), webActions: 0 };
    // Worst case for this round: long-context input, full answer allowance and every search.
    ledger.reserve(id, (Math.max(40_000, init.body.length / 2) * 0.2 + params.max_output_tokens * 0.75) / 1e6 + (params.max_tool_calls ?? 0) * 0.01 + 0.02);
    const entry = { request: { url: url.href, method: 'POST' }, phase, startedAt: row.startedAt, provider: 'luna' };
    recordings.network.push(entry);
    try {
      const response = await originalFetch(input, init);
      entry.response = { status: response.status };
      const body = await response.clone().json().catch(() => null);
      // A 429 is rejected unbilled and retried by the client; only final outcomes are ledger rows.
      if (response.status === 429 && !/insufficient_quota/.test(body?.error?.code ?? '')) return response;
      if (!response.ok) { row.status = 'error'; row.error = body?.error?.message ?? `HTTP ${response.status}`; return response; }
      row.webActions = (body.output ?? []).filter(o => o.type === 'web_search_call').length;
      row.usage = body.usage;
      row.cost = lunaCost(body.usage, row.webActions);
      row.status = body.status === 'completed' ? 'end_turn' : body.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : body.status;
      return response;
    } catch (error) {
      entry.error = String(error); row.status = 'error'; row.error = String(error);
      throw error;
    } finally {
      ledger.release(id);
      entry.finishedAt = row.finishedAt = new Date().toISOString();
      if (row.status) ledger.record(row);
    }
  }
  for (const key of [...url.searchParams.keys()]) if (/key|token|secret/i.test(key)) url.searchParams.set(key, 'REDACTED');
  const entry = { request: { url: url.href, method: init?.method ?? 'GET' }, phase, startedAt: new Date().toISOString() };
  recordings.network.push(entry);
  try {
    const response = await originalFetch(input, init);
    entry.response = { status: response.status };
    return response;
  } catch (error) { entry.error = String(error); throw error; }
  finally { entry.finishedAt = new Date().toISOString(); }
};
globalThis.__recordOfficialPage = async (url, fetcher) => {
  const entry = { url, phase, startedAt: new Date().toISOString() };
  recordings.pages.push(entry);
  try { const page = await fetcher(url); entry.chars = page.text.length; return page; }
  catch (error) { entry.error = String(error); throw error; }
};
const adapter = join(runDir, 'adapter.mjs');
writeFileSync(adapter, 'export const publishCollectionJob = async work => { globalThis.__refreshQueue.push(work); }; export const getHotelScope = async () => globalThis.__refreshScope; export const createServerClient = async () => globalThis.__refreshScope.supabase;\n');
const empty = join(runDir, 'empty.mjs'); writeFileSync(empty, 'export {};\n');
const server = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: { '@/lib/supabase/server': adapter, '@/features/workspace/hotel-context': adapter, 'server-only': empty, '@': resolve('src') } },
  plugins: [{ name: 'capture-refresh-boundaries', enforce: 'pre',
    resolveId(source, importer) { if (source === './jobs' && importer?.replaceAll('\\', '/').includes('/collection/')) return adapter; },
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/collection/official-pages.ts')) return;
      return code.replace('export const fetchOfficialPage: PageFetcher', 'const originalFetchOfficialPage: PageFetcher')
        + '\nexport const fetchOfficialPage: PageFetcher = url => (globalThis as any).__recordOfficialPage(url, originalFetchOfficialPage);\n';
    } }] });
const timed = async (label, work) => {
  phase = label; const started = Date.now();
  try { return await work(); }
  finally { recordings.timings.push({ phase: label, seconds: Math.round((Date.now() - started) / 1000) }); save('recordings.json', recordings); }
};
try {
  const existing = await db.from('events').select('id', { head: true, count: 'exact' });
  if (existing.error || existing.count) throw new Error('Evaluation requires an empty isolated events database (use --reset)');
  // Same starting rows as the saved Sonnet evaluation: the original production rows, no additions.
  const start = JSON.parse(readFileSync('tests/fixtures/hotel-demand-production.json', 'utf8')).filter(row => row.market === market).at(-1);
  const accountId = randomUUID(), hotelId = randomUUID();
  checked(await db.from('accounts').insert({ id: accountId, name: `Automatic ${cities[market]} Luna evaluation` }));
  const hotel = checked(await db.from('hotels').insert({ ...start.hotel, id: hotelId, account_id: accountId, revcontrol_code: 'LUNA-EVAL', search_location: cities[market] }).select().single());
  const area = checked(await db.from('collection_areas').select('*').eq('hotel_id', hotelId).single());
  const ids = new Map(start.rows.map(row => [row.event.id, randomUUID()]));
  if (start.rows.length) {
    checked(await db.from('events').insert(start.rows.map(row => ({ ...row.event, id: ids.get(row.event.id) }))));
    checked(await db.from('event_sources').insert(start.rows.flatMap(row => row.sources.map(source => ({ ...source, event_id: ids.get(row.event.id) })))));
    checked(await db.from('account_events').insert(start.rows.map(row => ({ account_id: accountId, event_id: ids.get(row.event.id), state: row.decision.state ?? 'needs_review', review_reason: row.decision.review_reason }))));
    checked(await db.from('account_event_areas').insert([...ids.values()].map(event_id => ({ account_id: accountId, collection_area_id: area.id, event_id }))));
  }
  save('setup.json', { accountId, hotel, area, startingRows: start.rows.length, startingCapturedAt: start.capturedAt ?? null });
  globalThis.__refreshScope = { supabase: db, hotels: [hotel], selectedHotelId: hotel.id, areaId: area.id, enabledSources: area.enabled_sources };
  const { runCollection } = await server.ssrLoadModule('/src/features/collection/run.ts');
  const { processMarketWork } = await server.ssrLoadModule('/src/features/collection/market-research.ts');
  const { getCalendarData } = await server.ssrLoadModule('/src/features/calendar/query.ts');
  const { evaluateDemandAcceptance } = await server.ssrLoadModule('/tests/helpers/demand-acceptance.ts');
  const { readDemandAssessment } = await server.ssrLoadModule('/src/features/events/demand-assessment.ts');
  const { fetchAllRows, fetchInBatches } = await server.ssrLoadModule('/src/lib/supabase/fetch-in-batches.ts');
  console.log(`Starting Luna ${cities[market]} Refresh (near-term) on the current app code`);
  const result = await timed('near-term', () => runCollection({ accountId, areaId: area.id, trigger: 'manual' }));
  recordings.summaries.push(result);
  console.log(`Near-term Refresh: ${result.status}; ${queue.length} background job(s)`);
  let rounds = 0;
  while (queue.length && rounds++ < 40) {
    save('queue.json', queue);
    const work = queue.shift(); console.log(`Processing ${work.kind}`);
    await timed(work.kind === 'market-research' ? 'long-range' : work.kind, () => processMarketWork(work));
  }
  phase = 'report';
  const calendar = await getCalendarData(accountId, { month: new Date().toISOString().slice(0, 7), view: 'list', period: 'all' });
  save('calendar.json', calendar);
  // Where every stored event stopped, using the same rules as scripts/audit-demand-refresh.mjs.
  const markets = checked(await db.from('long_range_markets').select('*'));
  const traces = markets.flatMap(row => (row.state?.leads ?? []).flatMap(lead => [{ title: lead.title, stage: lead.pendingStage ?? 'discovered', reason: lead.notes?.join('; ') },
    ...lead.editions.map(event => ({ title: event.title, start: event.startAt, end: event.endAt, stage: lead.pendingStage ?? 'extracted', reason: event.evidence?.demand?.length ? 'Recorded extracted evidence' : 'No recorded demand facts' }))]));
  const links = await fetchAllRows((from, to) => db.from('account_event_areas').select('event_id').eq('collection_area_id', area.id).order('event_id').range(from, to));
  const eventIds = links.map(link => link.event_id);
  const [events, decisions, sources, scores] = await Promise.all([
    fetchInBatches(eventIds, batch => db.from('events').select('*').in('id', batch)),
    fetchInBatches(eventIds, batch => db.from('account_events').select('*').eq('account_id', accountId).in('event_id', batch)),
    fetchInBatches(eventIds, batch => db.from('event_sources').select('*').in('event_id', batch)),
    fetchInBatches(eventIds, batch => db.from('hotel_event_scores').select('*').eq('hotel_id', hotel.id).in('event_id', batch)),
  ]);
  for (const event of events) {
    const decision = decisions.find(row => row.event_id === event.id);
    const assessment = readDemandAssessment(scores.find(row => row.event_id === event.id)?.demand_assessment);
    const eventSources = sources.filter(row => row.event_id === event.id && area.enabled_sources.includes(row.provider));
    const stage = decision?.state !== 'active' ? 'validation' : event.latitude === null || event.longitude === null ? 'location'
      : !eventSources.some(row => row.primary_source_confirmed && row.source_state === 'active') ? 'verification'
        : !assessment ? 'not_recalculated' : ['supported', 'probable'].includes(assessment.relevance) ? 'calendar_filter' : 'demand';
    traces.push({ title: event.title, start: event.start_at, end: event.end_at, stage, reason: decision?.review_reason ?? assessment?.reasons.join('; ') });
  }
  save('events-snapshot.json', { events, decisions, sources, scores, traces });
  // The answer key is read only after the whole pipeline has returned.
  const key = JSON.parse(readFileSync('tests/fixtures/hotel-demand-expectations.json', 'utf8'));
  const report = evaluateDemandAcceptance({ expected: key.positives.filter(row => row.market === market), negativePatterns: key.negativePatterns, calendar: calendar.events, traces,
    complete: Boolean(calendar.latestRun?.finishedAt) && !calendar.latestRun?.researchPending,
    integrityErrors: result.status === 'completed' ? [] : [`Main Refresh ended with status ${result.status}`] });
  save('report.json', report);
  save('final-markets.json', markets);
  save('collection-runs.json', checked(await db.from('collection_runs').select('*')));
  const rows = ledger.data.requests.filter(r => r.startedAt >= recordings.startedAt);
  const byPhase = Object.fromEntries(['near-term', 'long-range'].map(p => [p, { requests: rows.filter(r => r.phase === p).length, cost: rows.filter(r => r.phase === p).reduce((n, r) => n + (r.cost?.total ?? 0), 0) }]));
  save('cost.json', { total: ledger.spent() - startSpent, byPhase, timings: recordings.timings, statuses: rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}) });
  console.log(JSON.stringify({ run: runDir, status: report.status, recall: `${report.positiveRecall}/${report.expectedPositives}`, falsePositives: report.falsePositives,
    cost: (ledger.spent() - startSpent).toFixed(4), byPhase, calendar: calendar.events.map(row => `${row.title} ${String(row.startAt ?? row.start_at ?? '').slice(0, 10)}`) }, null, 1));
} finally {
  save('recordings.json', recordings);
  globalThis.fetch = originalFetch;
  await server.close();
}
