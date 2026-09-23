// Evaluation only. Answers the app's Anthropic Messages requests with GPT-6 Luna so the REAL
// pipeline code (prompts, validation, evidence checks, scoring, publication) runs unchanged.
// Anthropic's hosted web_fetch has no OpenAI equivalent; it becomes a local function tool that
// uses the app's own safe page fetcher, so the fetched text reaches the app's quote checks.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';

export const MODEL = 'gpt-6-luna';
// Standard processing, per 1M tokens (checked 23 September 2026). Long prompts cost double input
// and 1.5x output. Every hosted web action is conservatively charged $0.01.
const RATE = { input: 0.1, cached: 0.01, cacheWrite: 0.125, output: 0.5 };
// LUNA_REASONING=none runs the "thinking off" variant: no reasoning for any request, mirroring how
// the app calls Sonnet (thinking disabled). Everything else stays identical.
const thinkingOff = process.env.LUNA_REASONING === 'none';
export const VARIANT = thinkingOff ? 'nothink' : 'think';
export const SETTINGS = {
  maxOutputTokens: 32_000, // Round 1 used 8,192 including reasoning and ran out of room.
  effort: thinkingOff ? { sonnet: 'none', haiku: 'none' } : { sonnet: 'high', haiku: 'medium' },
  pageChars: 24_000, // Anthropic web_fetch max_content_tokens is 6,000 (~4 characters per token).
  maxRounds: 6,
};
export const LUNA_NOTE = [
  'Provider note: you are answering a request written for a different model. Follow the task exactly.',
  'Quote rule: every quoted evidence field (dateText, locationText, hostCityText, identityText, announcementText, evidenceText and each demand text) must be ONE unbroken passage copied character-for-character from ONE page. Never join separate lines or list entries, never insert "..." and never add words (such as an address) from elsewhere on the page. When the date and the place appear on different lines, quote each in its own field. locationText must be the passage that names this event\'s venue, hall or city (for example the location line of a listing), not just a street address.',
  'Tools: web search results are short snippets only. To read a page\'s full text, call the web_fetch function with a URL that appears in this task or in your search results. Respect the stated tool limits.',
  'Finish with the final JSON object only.',
].join('\n');

export function lunaCost(usage, webActions) {
  if (!usage) return null;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const written = usage.input_tokens_details?.cache_write_tokens ?? usage.input_tokens_details?.cache_creation_tokens ?? 0;
  const long = usage.input_tokens > 272_000;
  const processing = ((usage.input_tokens - cached - written) * RATE.input + cached * RATE.cached + written * RATE.cacheWrite) * (long ? 2 : 1) / 1e6
    + usage.output_tokens * RATE.output * (long ? 1.5 : 1) / 1e6;
  return { processing, search: webActions * 0.01, total: processing + webActions * 0.01 };
}

export class Ledger {
  constructor(path, ceiling) {
    this.path = path; this.ceiling = ceiling;
    // One spending process at a time: each process keeps the ledger in memory and rewrites it.
    const lock = `${path}.lock`;
    closeSync(openSync(lock, 'wx'));
    process.on('exit', () => { try { unlinkSync(lock); } catch { /* already released */ } });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));
    this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { ceiling, requests: [] };
    if (this.data.ceiling !== ceiling) throw new Error('Ledger ceiling changed; preserve the ledger and investigate');
    this.reserved = new Map();
  }
  spent() { return this.data.requests.reduce((n, r) => n + (r.cost?.total ?? 0), 0); }
  reserve(id, amount) {
    const open = [...this.reserved.values()].reduce((a, b) => a + b, 0);
    if (this.spent() + open + amount > this.ceiling) throw new Error(`Luna budget ceiling $${this.ceiling} reached; no request sent`);
    this.reserved.set(id, amount);
  }
  release(id) { this.reserved.delete(id); }
  record(row) { this.data.requests.push(row); this.save(); }
  save() { const temp = `${this.path}.tmp`; writeFileSync(temp, JSON.stringify(this.data, null, 1)); renameSync(temp, this.path); }
}

const text = content => typeof content === 'string' ? content
  : (content ?? []).map(c => c.type === 'text' ? c.text : c.type === 'document' ? (c.source?.data ?? '') : '').join('\n');
const normalizeUrl = url => { try { const u = new URL(url); u.hash = ''; return u.href.replace(/\/$/, '').toLowerCase(); } catch { return null; } };
const role = model => model.includes('haiku') ? 'haiku' : 'sonnet';

/** Anthropic JSON schemas become non-strict OpenAI schemas: constraints stay, app validation decides. */
function answerFormat(params) {
  const schema = params.output_config?.format?.schema;
  return schema ? { format: { type: 'json_schema', name: 'answer', schema, strict: false } } : undefined;
}

export function createLunaResponder({ apiKey, ledger, fetchPage, phase, transport = fetch, log = () => {}, concurrency = 4, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  // The account's tokens-per-minute limit (200,000 on 23 September) is below the app's 8 parallel
  // requests at Luna's token use. Queue locally and wait out rejected (unbilled) 429 responses.
  let active = 0; const queued = [];
  const acquire = () => active < concurrency ? (active++, Promise.resolve()) : new Promise(resolve => queued.push(resolve));
  const releaseSlot = () => { const next = queued.shift(); if (next) next(); else active--; };
  async function post(body) {
    await acquire();
    try {
      for (let attempt = 0; ; attempt++) {
        const reply = await transport('https://api.openai.com/v1/responses', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(600_000),
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': randomUUID() }, body: JSON.stringify(body) });
        const json = await reply.json().catch(() => null);
        const outOfCredits = json?.error?.code === 'insufficient_quota' || /no credits remaining|exceeded your current quota/i.test(json?.error?.message ?? '');
        if (reply.status === 429 && !outOfCredits && attempt < 30) {
          const seconds = Number(json?.error?.message?.match(/try again in ([\d.]+)(ms|s)/)?.[1] ?? 5) / (/try again in [\d.]+ms/.test(json?.error?.message ?? '') ? 1000 : 1);
          log(`rate limited; waiting ${(seconds + 1).toFixed(1)}s`);
          await wait((seconds + 1 + Math.random() * 2) * 1000);
          continue;
        }
        if (!reply.ok) { const error = new Error(`OpenAI HTTP ${reply.status}: ${json?.error?.message ?? 'no body'}`); error.status = reply.status; throw error; }
        return json;
      }
    } finally { releaseSlot(); }
  }

  return async function respond(params) {
    const id = randomUUID();
    const kind = role(params.model);
    const searchTool = params.tools?.find(t => t.type?.startsWith('web_search'));
    const fetchTool = params.tools?.find(t => t.type?.startsWith('web_fetch'));
    let searchesLeft = searchTool?.max_uses ?? 0, fetchesLeft = fetchTool?.max_uses ?? 0;
    const prompt = [text(params.system), ...params.messages.map(m => text(m.content))].filter(Boolean).join('\n\n');
    if (params.messages.some(m => m.role !== 'user')) throw new Error('Multi-turn Anthropic conversations are not translated');
    const allowed = new Set([...prompt.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)].map(m => normalizeUrl(m[0].replace(/[.,;]+$/, ''))).filter(Boolean));
    const row = { id, phase: phase(), anthropicModel: params.model, role: kind, anthropicMaxTokens: params.max_tokens,
      tools: (params.tools ?? []).map(t => `${t.type}:${t.max_uses ?? ''}`), startedAt: new Date().toISOString(), rounds: [], searches: 0, fetches: 0 };
    const content = []; let final = null, previous = null, input = prompt, status = 'failed';
    const usage = { input_tokens: 0, output_tokens: 0, reasoning: 0, visible: 0, cached: 0, written: 0 };
    let webActions = 0, cost = 0;
    try {
      for (let round = 0; round < SETTINGS.maxRounds; round++) {
        const tools = [];
        if (searchTool && searchesLeft > 0) tools.push({ type: 'web_search', search_context_size: 'medium',
          ...(searchTool.user_location ? { user_location: { type: 'approximate', country: searchTool.user_location.country, city: searchTool.user_location.city, timezone: searchTool.user_location.timezone } } : {}) });
        // Stays listed after its budget is spent, so earlier call outputs remain valid; further
        // calls receive Anthropic's max_uses_exceeded error instead of a page.
        if (fetchTool) tools.push({ type: 'function', name: 'web_fetch', strict: true,
          description: 'Fetch the full text of a public web page. Only URLs that appear in the task or in search results are allowed.',
          parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } });
        const body = { model: MODEL, service_tier: 'default', store: true, max_output_tokens: SETTINGS.maxOutputTokens,
          reasoning: { effort: SETTINGS.effort[kind] }, instructions: LUNA_NOTE, input, ...(previous ? { previous_response_id: previous } : {}),
          tools, ...(tools.some(t => t.type === 'web_search') ? { max_tool_calls: searchesLeft, include: ['web_search_call.action.sources'] } : {}),
          ...(answerFormat(params) ? { text: answerFormat(params) } : {}) };
        // Worst case for this round: long-context input, full answer allowance and every search.
        ledger.reserve(id, (Math.max(40_000, prompt.length / 2) * 0.2 + SETTINGS.maxOutputTokens * 0.75) / 1e6 + searchesLeft * 0.01 + 0.02);
        const response = await post(body).finally(() => ledger.release(id));
        const u = response.usage ?? {};
        usage.input_tokens += u.input_tokens ?? 0; usage.output_tokens += u.output_tokens ?? 0;
        usage.reasoning += u.output_tokens_details?.reasoning_tokens ?? 0;
        usage.cached += u.input_tokens_details?.cached_tokens ?? 0; usage.written += u.input_tokens_details?.cache_write_tokens ?? 0;
        const actions = (response.output ?? []).filter(o => o.type === 'web_search_call');
        webActions += actions.length;
        const roundCost = lunaCost(u, actions.length); cost += roundCost?.total ?? 0;
        row.rounds.push({ responseId: response.id, status: response.status, incomplete: response.incomplete_details?.reason ?? null, usage: u, webActions: actions.length, cost: roundCost?.total ?? null });
        const outputs = [];
        for (const item of response.output ?? []) {
          if (item.type === 'web_search_call') {
            const toolId = `srvtoolu_${randomUUID().replaceAll('-', '')}`;
            const sources = [...(item.action?.sources ?? []).map(s => s.url), ...(item.action?.url ? [item.action.url] : [])].filter(Boolean);
            sources.forEach(url => allowed.add(normalizeUrl(url)));
            if (item.action?.type === 'search') { searchesLeft--; row.searches++; }
            content.push({ type: 'server_tool_use', id: toolId, name: 'web_search', input: { query: item.action?.query ?? item.action?.url ?? '' } },
              { type: 'web_search_tool_result', tool_use_id: toolId, content: sources.map(url => ({ type: 'web_search_result', url, title: url, encrypted_content: '', page_age: null })) });
          } else if (item.type === 'function_call' && item.name === 'web_fetch') {
            const toolId = `srvtoolu_${randomUUID().replaceAll('-', '')}`;
            let url = null; try { url = JSON.parse(item.arguments).url; } catch { /* malformed call */ }
            content.push({ type: 'server_tool_use', id: toolId, name: 'web_fetch', input: { url } });
            let output, result;
            if (fetchesLeft <= 0) { result = { type: 'web_fetch_tool_result_error', error_code: 'max_uses_exceeded' }; output = 'Error: fetch limit reached.'; }
            else if (!url || !allowed.has(normalizeUrl(url))) { result = { type: 'web_fetch_tool_result_error', error_code: 'url_not_allowed' }; output = 'Error: URL not allowed; only URLs from the task or search results may be fetched.'; }
            else {
              fetchesLeft--;
              try {
                const page = await fetchPage(url);
                const pageText = page.text.slice(0, SETTINGS.pageChars);
                (page.links ?? []).forEach(link => allowed.add(normalizeUrl(link.url)));
                row.fetches++;
                result = { type: 'web_fetch_result', url: page.url ?? url, retrieved_at: new Date().toISOString(),
                  content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: pageText }, title: null } };
                output = `PAGE URL: ${page.url ?? url}\n${pageText}`;
              } catch (error) { result = { type: 'web_fetch_tool_result_error', error_code: 'unavailable' }; output = `Error: page unavailable (${error.message}).`; }
            }
            content.push({ type: 'web_fetch_tool_result', tool_use_id: toolId, content: result });
            outputs.push({ type: 'function_call_output', call_id: item.call_id, output });
          } else if (item.type === 'message') {
            const answer = (item.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('');
            if (answer) final = answer;
          }
        }
        previous = response.id;
        if (response.status === 'incomplete') { status = response.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : 'incomplete'; break; }
        if (response.status !== 'completed') { status = response.status; break; }
        if (!outputs.length) { status = 'end_turn'; break; }
        input = outputs;
      }
      if (status === 'failed' && !final) status = 'too_many_rounds';
    } catch (error) {
      row.error = error.message; status = 'error';
      if (!row.rounds.length) { row.finishedAt = new Date().toISOString(); row.status = status; ledger.record(row); throw error; }
    }
    if (final) content.push({ type: 'text', text: final });
    row.status = status; row.finishedAt = new Date().toISOString(); row.usage = usage; row.webActions = webActions;
    row.cost = { total: cost }; row.answerChars = final?.length ?? 0;
    ledger.record(row);
    log(`${row.phase} ${kind} ${row.tools.join('+') || 'no-tools'} ${status} searches=${row.searches} fetches=${row.fetches} $${cost.toFixed(4)}`);
    if (status === 'error') throw new Error(row.error);
    return {
      id: `msg_luna_${id.replaceAll('-', '')}`, type: 'message', role: 'assistant', model: params.model, content,
      stop_reason: status === 'end_turn' ? 'end_turn' : status === 'max_tokens' ? 'max_tokens' : 'end_turn', stop_sequence: null,
      // Visible answer tokens only: the app's own budget gate was calibrated for models without
      // thinking. Real Luna cost (including reasoning) is kept in the experiment ledger.
      usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens - usage.reasoning, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
        server_tool_use: { web_search_requests: row.searches, web_fetch_requests: row.fetches } },
    };
  };
}
