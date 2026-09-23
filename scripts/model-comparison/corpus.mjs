import { existsSync, readFileSync } from 'node:fs';
import { hash, parseAnswer, anthropicCost } from './core.mjs';

export const SOURCES = [
  ['Eindhoven', 'refs/research-evaluation/1788783439036-eindhoven-1-recordings.json'],
  ['Rotterdam', 'refs/research-evaluation/1788785200015-rotterdam-1-recordings.json'],
  ['Eindhoven', 'refs/live-refresh-eindhoven/recordings.json'],
];
export const flatten = content => typeof content === 'string' ? content : (content ?? []).map(c => c.type === 'text' ? c.text : '').join('\n');
export function promptOf(params) {
  if (params.messages.some(m => m.role !== 'user')) throw new Error('Conversation includes assistant answers; exclude from blind comparison');
  return [flatten(params.system), ...params.messages.map(m => flatten(m.content))].filter(Boolean).join('\n');
}
export function pagesOf(prompt) {
  return [...prompt.matchAll(/PAGE URL: ([^\n]+)\nPAGE TEXT:\n([\s\S]*?)\nEND PAGE/g)].map(m => ({ url: m[1].trim(), text: m[2] }));
}
function searchEvidence(response) {
  return (response.content ?? []).filter(b => b.type === 'web_search_tool_result' && Array.isArray(b.content))
    .flatMap(b => b.content).filter(x => x.type === 'web_search_result').map(x => ({ title: x.title, url: x.url }));
}
export function recordsOf(data) {
  if (data.requests) return data.requests;
  return (data.network ?? []).filter(r => r.request.url === 'https://api.anthropic.com/v1/messages' && r.request.method === 'POST' && r.response?.status === 200)
    .map(r => ({ params: JSON.parse(r.request.body), response: JSON.parse(r.response.body), startedAt: r.startedAt }));
}
function taskOf(record) {
  const props = record.params.output_config?.format?.schema?.properties ?? {};
  if (props.reviews) return 'shortlist';
  if (props.url && record.params.model.includes('haiku')) return 'official_website';
  if (props.events && !(record.params.tools ?? []).length) return 'page_reading';
  return null;
}
export function buildCorpus(sources = SOURCES) {
  const pool = [], exclusions = [], files = [], allRecords = [];
  for (const [city, path] of sources) {
    if (!existsSync(path)) { exclusions.push({ path, reason: 'recording missing' }); continue; }
    const text = readFileSync(path, 'utf8'); const data = JSON.parse(text);
    files.push({ path, digest: hash(text) });
    for (const [index, record] of recordsOf(data).entries()) {
      allRecords.push({ city, record });
      const task = taskOf(record); if (!task) continue;
      try {
        const prompt = promptOf(record.params); const answer = parseAnswer(record.response);
        const pages = pagesOf(prompt); const observed = searchEvidence(record.response);
        if (task === 'page_reading' && !pages.length) throw new Error('Original supplied page text unavailable');
        if (record.response.stop_reason === 'max_tokens') throw new Error('Historical answer truncated');
        const instructions = task === 'official_website'
          ? `This is a saved-search replay. Search tools are unavailable. Follow the original task below using ONLY the supplied observed titles and URLs. The original encrypted search snippets cannot be recovered. Return null when these are insufficient.\nORIGINAL TASK:\n${prompt}\nOBSERVED SEARCH RESULTS:\n${JSON.stringify(observed)}` : prompt;
        if (Buffer.byteLength(instructions) > 160_000) throw new Error('Original input exceeds evaluation limit; excluded without truncation');
        const window = prompt.match(/between (\d{4}-\d\d-\d\d) and (\d{4}-\d\d-\d\d)/);
        const tags = [];
        if (/older|historical|vorig|2025/.test(prompt)) tags.push('old-edition');
        if (/online|registration|deadline/i.test(prompt)) tags.push('non-physical');
        if ((answer.events ?? []).some(e => !e.facts?.demand?.length)) tags.push('missing-demand');
        if (!answer.events?.length && task === 'page_reading') tags.push('no-confirmed-edition');
        const sourceKey = hash({ city, task, prompt, schema: record.params.output_config.format.schema });
        pool.push({ id: sourceKey, city, task, family: record.params.model.includes('haiku') ? 'haiku' : 'sonnet',
          source: { path, index, recordedAt: record.startedAt, model: record.params.model },
          originalPrompt: prompt, prompt: instructions, schema: record.params.output_config.format.schema, pages, observed,
          window: window ? { start: window[1], end: window[2] } : null,
          answer, rawResponse: record.response, baselineCost: anthropicCost(record), baselineBatchCost: anthropicCost(record, 'batch'),
          tags, exactInformation: task !== 'official_website', searchCalls: 0,
          dimensions: task === 'page_reading' ? ['dates_and_locations', 'demand_evidence'] : [task] });
      } catch (error) { exclusions.push({ path, index, task, reason: error.message }); }
    }
  }
  const unique = [...new Map(pool.map(row => [row.id, row])).values()];
  const cases = [];
  for (const task of ['shortlist', 'official_website', 'page_reading']) {
    const queues = ['Eindhoven', 'Rotterdam'].map(city => unique.filter(c => c.city === city && c.task === task).sort((a, b) => a.id.localeCompare(b.id)));
    const selected = [];
    while (selected.length < 30 && queues.some(q => q.length)) for (const queue of queues) if (queue.length && selected.length < 30) selected.push(queue.shift());
    // Group identical page sets before splitting: no page leaks from preparation to holdout.
    const groups = [...new Set(selected.map(c => c.pages.length ? hash(c.pages) : c.id))];
    const calibration = new Set(groups.slice(0, Math.ceil(groups.length * 0.2)));
    cases.push(...selected.map(c => ({ ...c, split: calibration.has(c.pages.length ? hash(c.pages) : c.id) ? 'preparation' : 'holdout' })));
  }
  const cost = { actualRecorded: 0, oneCopyStandard: 0, oneCopyBatch: 0, excludedDuplicateCost: 0 };
  const seen = new Set();
  for (const { record } of allRecords) {
    const charged = anthropicCost(record); if (!charged) continue;
    cost.actualRecorded += charged.total;
    // Identical complete prompts are repeats, not additional work. Do not dedupe by answer.
    const key = hash(record.params);
    if (seen.has(key)) { cost.excludedDuplicateCost += charged.total; continue; }
    seen.add(key); cost.oneCopyStandard += charged.total; cost.oneCopyBatch += anthropicCost(record, 'batch').total;
  }
  return { version: 1, createdAt: new Date().toISOString(), files, cases, exclusions, historicalCosts: cost,
    limitations: ['Historical prompts predate current production rules; both answers are checked using current rules.',
      'Official-website replays retain titles and URLs only: encrypted historical search snippets are unavailable.',
      'Shortlisting recordings cover Eindhoven only. No Rotterdam Haiku baseline was found.',
      'Dates and demand evidence share page-reading requests; costs are counted once, not once per metric.',
      'Saved runs include older tests and repeated work, not a measured current monthly portfolio bill.'] };
}
export function freshCases(date, schema) {
  const plus = days => new Date(Date.parse(`${date}T12:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
  return ['Eindhoven', 'Rotterdam'].flatMap(city => [
    { name: 'near', start: date, end: plus(90) },
    { name: 'broad', start: plus(91), end: plus(365) },
  ].flatMap(window => ['festivals, culture and major concerts', 'trade fairs, conferences and university events', 'national and international sports'].map(category => ({
    id: hash({ city, window, category, version: 1 }), city, task: 'fresh_search', family: 'sonnet', split: 'fresh', window,
    schema, searchCalls: 4, pages: [], exactInformation: false,
    prompt: `Research physical events within 25 km of ${city}, Netherlands, between ${window.start} and ${window.end}. Focus on ${category}. Find up to eight useful events that may generate hotel stays. Search and open official organiser, federation or host venue pages. Return dates and location only when the specific edition is supported. Quote the exact date and location passages in facts. Never move prior dates forward a year. Treat comparable past attendance separately. Include useful events with unknown demand; do not invent audience origins. Exclude online events, deadlines and ordinary local activities. Use sourceUrl for the actually observed official page. If evidence is unavailable, leave the claim unconfirmed. Use at most four web tool calls. Return JSON using the supplied schema.`,
  }))));
}
export function assertFrozen(manifest) {
  const { digest, ...body } = manifest;
  if (hash(body) !== digest) throw new Error('Frozen manifest changed');
  for (const file of manifest.files) if (hash(readFileSync(file.path, 'utf8')) !== file.digest) throw new Error(`Recording changed: ${file.path}`);
}
export function frozen(value) { return { ...value, digest: hash(value) }; }
