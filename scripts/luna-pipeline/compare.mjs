// Builds the Luna vs Sonnet comparison from saved files only. Makes no network requests.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'out/luna-pipeline';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const money = n => n == null ? 'n/a' : `$${n.toFixed(2)}`;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
const generic = new Set(['the', 'and', 'van', 'het', 'een', 'der', 'den', 'des', 'champions', 'league', 'festival', 'edition', 'eindhoven', 'utrecht', 'rotterdam',
  'nederland', 'netherlands', 'international', 'global', 'conference', 'congress', 'symposium', 'open', 'live', 'week', 'days', 'championships', 'kampioenschappen']);
const words = s => String(s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\b(19|20)\d\d\b/g, ' ')
  .split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !generic.has(w));

// Lenient benchmark check applied identically to every calendar: overlapping dates and one shared
// name word (prefixes allowed), so "Dutch Design Week" matches "Dutch Design Week 2026".
function found(benchmark, calendar) {
  const names = words(benchmark.match ?? benchmark.title);
  return calendar.some(event => {
    const start = String(event.startAt).slice(0, 10), end = String(event.endAt).slice(0, 10);
    if (start > benchmark.end || end < benchmark.start) return false;
    const title = words(event.title);
    return names.some(n => title.some(t => t.startsWith(n) || n.startsWith(t)));
  });
}
function benchmarkRows(market, calendar, runDate) {
  const key = read('tests/fixtures/hotel-demand-expectations.json').positives.filter(p => p.market === market);
  return key.map(p => ({ title: p.title, start: p.start, end: p.end, upcoming: p.end >= runDate,
    horizon: p.start <= addDays(runDate, 90) ? 'near-term' : 'long-range', found: found(p, calendar) }));
}
const recall = (rows, horizon) => { const r = rows.filter(x => x.upcoming && (!horizon || x.horizon === horizon)); return `${r.filter(x => x.found).length}/${r.length}`; };

// Sonnet request stages, from the request shape of the recorded app requests.
function sonnetStage(params) {
  const tools = (params.tools ?? []).map(t => `${t.type.split('_2')[0]}:${t.max_uses}`).sort().join('+');
  const long = { '3000:web_search:1': 1, '4000:web_search:2': 1, '8000:': 1, '8000:web_search:1': 1, '1000:web_fetch:1': 1 };
  return long[`${params.max_tokens}:${tools}`] ? 'long-range' : 'near-term';
}
function anthropicCost(params, response, batch) {
  const u = response.usage, rate = params.model.includes('haiku') ? 1 : 2, c = u.cache_creation;
  const write = c ? (c.ephemeral_5m_input_tokens ?? 0) * 1.25 + (c.ephemeral_1h_input_tokens ?? 0) * 2 : (u.cache_creation_input_tokens ?? 0) * 1.25;
  return ((u.input_tokens + write + (u.cache_read_input_tokens ?? 0) * 0.1) * rate + u.output_tokens * rate * 5) / 1e6 * (batch ? 0.5 : 1) + (u.server_tool_use?.web_search_requests ?? 0) * 0.01;
}
function savedSonnetRun(root) {
  const recordings = read(join(root, 'recordings.json'));
  const cost = { 'near-term': { standard: 0, batch: 0, requests: 0 }, 'long-range': { standard: 0, batch: 0, requests: 0 } };
  for (const entry of recordings.network) {
    if (!entry.request.url.includes('api.anthropic.com/v1/messages') || entry.response?.status !== 200) continue;
    const params = JSON.parse(entry.request.body), response = JSON.parse(entry.response.body), stage = sonnetStage(params);
    cost[stage].standard += anthropicCost(params, response, false); cost[stage].batch += anthropicCost(params, response, true); cost[stage].requests++;
  }
  return { date: recordings.startedAt.slice(0, 10), calendar: read(join(root, 'calendar.json')).events, cost };
}
// Every completed Luna run of a market. Rate-limited or aborted attempts are kept on disk but
// excluded here; see the ledger for their cost.
function lunaRuns(market, variant) {
  const pattern = variant === 'nothink' ? new RegExp(`^nothink-${market}-\\d+$`) : variant === 'app' ? new RegExp(`^app-${market}-\\d+$`)
    : new RegExp(`^(run\\d+-)?${market}-\\d+$`);
  return readdirSync(dir).filter(d => pattern.test(d) && existsSync(join(dir, d, 'report.json'))).sort((a, b) => a.split('-').at(-1) - b.split('-').at(-1)).map(lunaRun);
}
function lunaRun(name) {
  const root = join(dir, name), manifest = read(join(root, 'manifest.json'));
  const finished = statSync(join(root, 'report.json')).mtime.toISOString();
  const rows = read(join(dir, 'ledger.json')).requests.filter(r => r.startedAt >= manifest.capturedAt && r.startedAt <= finished);
  const cost = Object.fromEntries(['near-term', 'long-range'].map(phase => {
    const own = rows.filter(r => r.phase === phase);
    const total = own.reduce((n, r) => n + (r.cost?.total ?? 0), 0), search = own.reduce((n, r) => n + (r.webActions ?? 0) * 0.01, 0);
    return [phase, { standard: total, batch: (total - search) / 2 + search, requests: own.length, failed: own.filter(r => !['end_turn'].includes(r.status)).length }];
  }));
  return { root, date: manifest.capturedAt.slice(0, 10), calendar: read(join(root, 'calendar.json')).events, cost, timings: read(join(root, 'recordings.json')).timings };
}
function productionSonnet(market) {
  const data = read(join(dir, 'sonnet-production.json')), m = data.markets.find(x => x.market === market);
  const rate = model => model.includes('haiku') ? 1 : 2;
  const est = (u, batch) => ((u.input_tokens + u.cache_write_tokens * 1.25 + u.cache_read_tokens * 0.1) * rate(u.model) + u.output_tokens * rate(u.model) * 5) / 1e6 * (batch ? 0.5 : 1) + u.web_search_requests * 0.01;
  const runIds = new Set(m.runs.map(r => r.id));
  const near = data.usage.filter(u => runIds.has(u.collection_run_id) && !u.horizon);
  const byRun = Object.values(Object.groupBy(near, u => u.collection_run_id)).filter(r => r.length >= 40).sort((a, b) => a[0].created_at.localeCompare(b[0].created_at)).at(-1) ?? [];
  const long = data.usage.filter(u => u.market_key === m.marketKey);
  const byDay = Object.values(Object.groupBy(long, u => u.created_at.slice(0, 10))).sort((a, b) => a[0].created_at.localeCompare(b[0].created_at)).at(-1) ?? [];
  const sum = (rows, batch) => rows.reduce((n, u) => n + est(u, batch), 0);
  // Several live-calendar events are only there because someone set a level by hand. The
  // automatic view drops events that would be hidden without that hand-set level.
  const automatic = m.calendar.events.filter(e => e.announced || e.hotelScores.some(s => s.impactBasis !== 'manual_override' || ['High', 'Peak'].includes(s.suggestedLevel)));
  return { checkedAt: data.checkedAt.slice(0, 10), calendar: m.calendar.events, automatic,
    cost: { 'near-term': { standard: sum(byRun, false), batch: sum(byRun, true), requests: byRun.length, date: byRun[0]?.created_at.slice(0, 10) },
      'long-range': { standard: sum(byDay, false), batch: sum(byDay, true), requests: byDay.length, date: byDay[0]?.created_at.slice(0, 10) } } };
}

const report = { generatedAt: new Date().toISOString(), markets: {} };
const lines = ['# Luna vs Sonnet: round 2', '', `Generated ${report.generatedAt.slice(0, 16)} UTC from saved files. No new Sonnet requests.`, ''];
// Saved-page retests.
const pageRows = [['Luna round 2, thinking on (32,000 tokens + quote rule)', 'page-retest-report.json'], ['Luna round 2, thinking off', 'page-retest-nothink-report.json']]
  .filter(([, file]) => existsSync(join(dir, file))).map(([name, file]) => [name, read(join(dir, file))]);
if (pageRows.length) {
  const first = pageRows[0][1];
  report.pages = Object.fromEntries(pageRows.map(([name, r]) => [name, { expected: r.expected, found: r.lunaRound2, cutOff: r.cutOff, cost: r.cost }]));
  lines.push('## Saved pages (same 23 pages, hand-checked answers)', '', '| | Usable real events found (of 26) | Answers cut off | Cost |', '| --- | --- | --- | --- |',
    `| Sonnet (saved) | ${first.sonnet} | 0 | |`, `| Luna round 1 (8,192 tokens) | ${first.lunaRound1} | 1 | |`,
    ...pageRows.map(([name, r]) => `| ${name} | ${r.lunaRound2} | ${r.cutOff} | ${money(r.cost)} |`),
    '', 'Name matching is automatic: "Feyenoord vs PSV" does not match "Feyenoord – PSV", so true counts can be slightly higher.', '');
}
// A run is compared when at most 10% of its Luna requests failed (for example a few rate-limit
// rejections); the count is shown. Runs where credits ran out mid-way are excluded.
const failedCount = run => run.cost['near-term'].failed + run.cost['long-range'].failed;
const complete = run => failedCount(run) <= 0.1 * (run.cost['near-term'].requests + run.cost['long-range'].requests);
for (const market of ['eindhoven', 'utrecht']) {
  const title = `## ${market[0].toUpperCase()}${market.slice(1)}`;
  const allOn = lunaRuns(market), allOff = lunaRuns(market, 'nothink'), allApp = lunaRuns(market, 'app');
  // A run with failed Luna requests is not a fair pass (for example, credits ran out mid-run).
  const on = allOn.filter(complete), off = allOff.filter(complete), app = allApp.filter(complete);
  const excluded = [...allOn, ...allOff, ...allApp].filter(run => !complete(run));
  if (!on.length && !off.length && !app.length) {
    if (excluded.length) lines.push(title, '', `No complete Luna run. ${excluded.length} attempt(s) had failed requests; they are excluded.`, '');
    continue;
  }
  const luna = [...on, ...off, ...app].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const production = productionSonnet(market);
  const saved = market === 'eindhoven' ? savedSonnetRun('refs/live-refresh-eindhoven') : null;
  const label = (runs, name) => runs.map((run, i) => [runs.length > 1 ? `${name}, run ${i + 1}` : name, run]);
  const sides = [...label(on, 'Luna, thinking on'), ...label(off, 'Luna, thinking off'), ...label(app, 'Luna, app client'),
    ['Sonnet, live calendar', production], ['Sonnet, live calendar without hand-set levels', { ...production, calendar: production.automatic }],
    ...(saved ? [['Sonnet, one full run (9 Sep, older code)', saved]] : [])];
  const runs = [...label(on, 'Luna, thinking on'), ...label(off, 'Luna, thinking off'), ...label(app, 'Luna, app client')];
  const bench = Object.fromEntries(sides.map(([name, side]) => [name, benchmarkRows(market, side.calendar, luna.date)]));
  const brief = side => side && { ...side, calendar: side.calendar.map(e => ({ title: e.title, start: e.startAt, end: e.endAt })), automatic: undefined };
  report.markets[market] = { luna: runs.map(([name, run]) => ({ name, ...brief(run) })), production: brief(production), saved: brief(saved), bench };
  const costed = sides.filter(([name]) => !name.includes('without hand-set'));
  lines.push(title, '', `Benchmark events still ahead on ${luna.date}, found on each calendar:`, '',
    '| | Near-term (next 90 days) | Long-range | Total | Calendar events |', '| --- | --- | --- | --- | --- |',
    ...sides.map(([name, side]) => `| ${name} | ${recall(bench[name], 'near-term')} | ${recall(bench[name], 'long-range')} | ${recall(bench[name])} | ${side.calendar.length} |`), '',
    '| Benchmark event | Dates | ' + sides.map(([n]) => n).join(' | ') + ' |', '| --- | --- | ' + sides.map(() => '---').join(' | ') + ' |',
    ...bench[sides[0][0]].filter(r => r.upcoming).map((r, i) => `| ${r.title} | ${r.start} | ${sides.map(([n]) => bench[n].filter(x => x.upcoming)[i].found ? 'yes' : '—').join(' | ')} |`), '',
    'Cost of one run (standard price; batch-equivalent in brackets):', '', '| | Near-term | Long-range | Total |', '| --- | --- | --- | --- |',
    ...costed.map(([name, side]) => `| ${name}${side === production ? ` (near ${side.cost['near-term'].date}, long ${side.cost['long-range'].date})` : ''} | ${money(side.cost['near-term'].standard)} (${money(side.cost['near-term'].batch)}) | ${money(side.cost['long-range'].standard)} (${money(side.cost['long-range'].batch)}) | ${money(side.cost['near-term'].standard + side.cost['long-range'].standard)} (${money(side.cost['near-term'].batch + side.cost['long-range'].batch)}) |`), '',
    ...runs.map(([name, run]) => `${name} time: ${run.timings.map(t => `${t.phase} ${Math.round(t.seconds / 60)} min`).join(', ')}.${failedCount(run) ? ` ${failedCount(run)} of ${run.cost['near-term'].requests + run.cost['long-range'].requests} Luna checks were lost to the OpenAI speed limit.` : ''}`),
    ...(excluded.length ? [`${excluded.length} incomplete attempt(s) excluded.`] : []), '',
    '<details><summary>Calendars</summary>', '', ...sides.flatMap(([name, side]) => [`**${name}**`, '', ...side.calendar.map(e => `- ${String(e.startAt).slice(0, 10)} ${e.title}`), '']), '</details>', '');
}
writeFileSync(join(dir, 'comparison.json'), JSON.stringify(report, null, 1));
writeFileSync(join(dir, 'comparison.md'), lines.join('\n'));
console.log(lines.join('\n'));
