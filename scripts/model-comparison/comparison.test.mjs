// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LunaRunner, requestBody, reservation, hash, committed, saveJson, lunaCost, anthropicCost, lock } from './core.mjs';
import { pagesOf, promptOf, frozen, assertFrozen, freshCases } from './corpus.mjs';
import { recommendation, monthlyScenarios, matchEvent, compareRow, writeReport } from './report.mjs';
import { evaluateAnswer } from './evaluate';
import { prepareLivePages } from './live-pages.mjs';
const testCase = { prompt: 'Return JSON about public events.', schema: { type: 'object' }, city: 'Eindhoven' };
const response = (extra = {}) => ({ id: 'resp_test123', status: 'completed', model: 'gpt-6-luna', usage: { input_tokens: 1000, output_tokens: 300, output_tokens_details: { reasoning_tokens: 200 } }, output: [{ type: 'message', content: [{ type: 'output_text', text: '{"events":[]}' }] }], ...extra });
function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'luna-comparison-'));
    return { path: join(dir, 'ledger.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
describe('Luna spending and isolation', () => {
    it('reserves concurrent requests before I/O and refuses the request that would exceed the phase cap', async () => {
        const s = setup();
        const complete = [];
        try {
            const transport = vi.fn(() => new Promise(resolve => complete.push(resolve)));
            const runner = new LunaRunner({ ...s, apiKey: 'test', transport });
            const body = requestBody({ ...testCase, searchCalls: 4 });
            const first = runner.run('first', body, 'saved');
            const second = runner.run('second', body, 'saved');
            const third = runner.run('third', body, 'saved');
            await expect(runner.run('fourth', body, 'saved')).rejects.toThrow('budget');
            expect(committed(runner.ledger)).toBeCloseTo(3 * reservation(body));
            complete.forEach(resolve => resolve(Response.json(response())));
            await Promise.all([first, second, third]);
            expect(transport).toHaveBeenCalledTimes(3);
        } finally { s.cleanup(); }
    });
    it('persists reservations before submission and reuses results after restart/key reordering', async () => {
        const s = setup();
        try {
            const transport = vi.fn(async (url, options) => {
                expect(url).toBe('https://api.openai.com/v1/responses');
                expect(JSON.parse(options.body).model).toBe('gpt-6-luna');
                const ledger = JSON.parse(readFileSync(s.path, 'utf8'));
                expect(Object.values(ledger.requests).every((r) => r.state === 'reserved')).toBe(true);
                return Response.json(response());
            });
            const first = new LunaRunner({ ...s, apiKey: 'test', transport });
            const body = requestBody(testCase);
            await first.run('one', body, 'saved');
            const second = new LunaRunner({ ...s, apiKey: 'test', transport });
            await second.run('one', Object.fromEntries(Object.entries(body).reverse()), 'saved');
            expect(transport).toHaveBeenCalledTimes(1);
            expect(committed(second.ledger)).toBeCloseTo(0.00025);
            expect(readFileSync(s.path, 'utf8')).not.toContain('Bearer test');
        }
        finally {
            s.cleanup();
        }
    });
    it('rejects other models, tools, uncapped output and oversized inputs before any call', async () => {
        const s = setup();
        const transport = vi.fn();
        try {
            const runner = new LunaRunner({ ...s, apiKey: 'test', transport });
            for (const body of [
                { ...requestBody(testCase), model: 'claude-sonnet-5' },
                { ...requestBody(testCase), model: 'claude-haiku-4-5' },
                { ...requestBody(testCase), tools: [{ type: 'function' }] },
                { ...requestBody(testCase), max_output_tokens: undefined },
                { ...requestBody(testCase), max_output_tokens: 16385 },
                { ...requestBody(testCase), previous_response_id: 'resp_other' },
                { ...requestBody(testCase), input: 'x'.repeat(190_000) },
            ])
                await expect(runner.run('no', body, 'saved')).rejects.toThrow();
            expect(transport).not.toHaveBeenCalled();
        }
        finally {
            s.cleanup();
        }
    });
    it('stops before phase/total ceiling including reservations from previous invocations', async () => {
        const s = setup();
        const transport = vi.fn();
        try {
            saveJson(s.path, { ceiling: 20, requests: { old: { state: 'complete', cost: { total: 19.999 }, reserved: 0 } } });
            const runner = new LunaRunner({ ...s, apiKey: 'test', transport });
            await expect(runner.run('no', requestBody(testCase), 'repeat')).rejects.toThrow('budget');
            await expect(runner.run('no', requestBody(testCase), 'saved')).rejects.toThrow('budget');
            expect(transport).not.toHaveBeenCalled();
        }
        finally {
            s.cleanup();
        }
    });
    it('retains unknown charges after a timeout and never retries or falls back', async () => {
        const s = setup();
        const transport = vi.fn().mockRejectedValue(new Error('timeout'));
        try {
            const runner = new LunaRunner({ ...s, apiKey: 'test', transport });
            await expect(runner.run('one', requestBody(testCase), 'saved')).rejects.toThrow('timeout');
            expect(committed(runner.ledger)).toBe(reservation(requestBody(testCase)));
            const resumed = new LunaRunner({ ...s, apiKey: 'test', transport });
            await expect(resumed.run('one', requestBody(testCase), 'saved')).rejects.toThrow('reconcile');
            await expect(resumed.run('two', requestBody(testCase), 'fresh')).rejects.toThrow('Unresolved');
            expect(transport).toHaveBeenCalledTimes(1);
        }
        finally {
            s.cleanup();
        }
    });
    it('retains reservations for missing usage and non-success HTTP responses', async () => {
        for (const reply of [Response.json(response({ usage: null })), Response.json({ error: 'bad' }, { status: 500 })]) {
            const s = setup();
            try {
                const runner = new LunaRunner({ ...s, apiKey: 'test', transport: async () => reply });
                await expect(runner.run('one', requestBody(testCase), 'saved')).rejects.toThrow();
                expect(committed(runner.ledger)).toBe(reservation(requestBody(testCase)));
            }
            finally {
                s.cleanup();
            }
        }
    });
    it('saves streaming response identity before a lost connection', async () => {
        const s = setup();
        try {
            const stream = 'data: ' + JSON.stringify({ type: 'response.created', response: { id: 'resp_early' } }) + '\n\n';
            const runner = new LunaRunner({ ...s, apiKey: 'test', transport: async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }) });
            await expect(runner.run('one', requestBody(testCase), 'saved')).rejects.toThrow('Stream ended');
            expect(Object.values(runner.ledger.requests)[0]).toMatchObject({ responseId: 'resp_early', state: 'uncertain' });
        }
        finally {
            s.cleanup();
        }
    });
    it('retrieves an existing response without POST for reconciliation', async () => {
        const s = setup();
        try {
            saveJson(s.path, { ceiling: 20, requests: { one: { state: 'uncertain', reserved: 1, responseId: 'resp_test123' } } });
            const transport = vi.fn(async (_url, opts) => { expect(opts.method).toBe('GET'); return Response.json(response()); });
            const runner = new LunaRunner({ ...s, apiKey: 'test', transport });
            await runner.reconcile('one', 'resp_test123');
            expect(runner.ledger.requests.one.state).toBe('complete');
            expect(committed(runner.ledger)).toBeCloseTo(0.00025);
        }
        finally {
            s.cleanup();
        }
    });
    it('prevents two concurrent invocations sharing the same budget', () => {
        const s = setup();
        try {
            const release = lock(s.path);
            expect(() => lock(s.path)).toThrow();
            release();
        }
        finally {
            s.cleanup();
        }
    });
    it('accounts for reasoning once, failed calls, search actions, cache and batch fees', () => {
        expect(lunaCost(response())?.total).toBeCloseTo(0.00025);
        expect(lunaCost(response({ status: 'incomplete' }))?.total).toBeCloseTo(0.00025);
        expect(lunaCost(response({ output: [{ type: 'web_search_call', action: { type: 'search' } }, { type: 'web_search_call', action: { type: 'open_page' } }] }))?.search).toBe(0.02);
        const record = { params: { model: 'claude-sonnet-5' }, response: { usage: { input_tokens: 1000, output_tokens: 1000, server_tool_use: { web_search_requests: 2 } } } };
        expect(anthropicCost(record, 'standard')?.total).toBeCloseTo(0.032);
        expect(anthropicCost(record, 'batch')?.total).toBeCloseTo(0.026);
        expect(reservation(requestBody({ ...testCase, searchCalls: 4 }))).toBeGreaterThan(1.3);
    });
});
describe('frozen evidence and honest comparisons', () => {
    it('does not send saved answers or expected event names to new discovery', () => {
        expect(() => promptOf({ messages: [{ role: 'assistant', content: 'secret answer' }] })).toThrow();
        const cases = freshCases('2026-09-23', {});
        expect(cases).toHaveLength(12);
        expect(cases.every(c => !/Dutch Design Week|BRIDGE|InfraTech/.test(c.prompt))).toBe(true);
        expect(cases.find(c => c.window.name === 'near')?.window.end).toBe('2026-12-22');
        expect(cases.find(c => c.window.name === 'broad')?.window.start).toBe('2026-12-23');
    });
    it('rejects changed recordings and manifest edits', () => {
        const s = setup();
        try {
            writeFileSync(s.path, 'original');
            const manifest = frozen({ files: [{ path: s.path, digest: hash('original') }], cases: [] });
            expect(() => assertFrozen(manifest)).not.toThrow();
            expect(() => assertFrozen({ ...manifest, cases: ['changed'] })).toThrow();
            writeFileSync(s.path, 'changed');
            expect(() => assertFrozen(manifest)).toThrow('Recording changed');
        }
        finally {
            s.cleanup();
        }
    });
    it('extracts only supplied source pages, not answer text', () => {
        expect(pagesOf('PAGE URL: https://example.com/\nPAGE TEXT:\nReal source\nEND PAGE')).toEqual([{ url: 'https://example.com/', text: 'Real source' }]);
    });
    it('never reports a switch from missing, unreviewed or unmatched coverage', () => {
        expect(recommendation([], 'sonnet').decision).toBe('insufficient evidence');
        expect(recommendation([], 'haiku').decision).toBe('insufficient evidence');
        expect(matchEvent({ title: 'GLOW', start: '2026-11-07', end: '2026-11-14' }, { title: 'GLOW', start: '2027-11-07', end: '2027-11-14' })).toBe(false);
    });
    it('counts a failed Luna answer against Luna, while an unsettled request stays inconclusive', () => {
        const row = (city, status, retained) => ({ family: 'sonnet', split: 'holdout', city, exactInformation: true, status, reviewStatus: 'reviewed',
            expected: 10, retained, baselineRetained: 10, lunaRetainedOfBaseline: retained, baselineBatchCost: { total: 1 }, cost: { total: 0.1 }, baseline: { checks: 10 }, luna: status === 'complete' ? { checks: 10, errors: [] } : null,
            review: { baselineErrors: 0, lunaErrors: status === 'complete' ? 0 : 1 } });
        expect(recommendation([row('Eindhoven', 'complete', 10), row('Rotterdam', 'complete', 10)], 'sonnet').decision).toBe('switch');
        expect(recommendation([row('Eindhoven', 'complete', 10), row('Rotterdam', 'failed', 0)], 'sonnet').decision).toBe('keep');
        expect(recommendation([row('Eindhoven', 'complete', 10), row('Rotterdam', 'reserved', 0)], 'sonnet').decision).toBe('insufficient evidence');
    });
    it('counts shared areas and broad work once and keeps unknown monthly costs unknown', () => {
        expect(monthlyScenarios(null, {}).available).toBe(false);
        const workload = { complete: true, areas: [{ area: 'shared Eindhoven', source: 'reconciled cycle', includesBroad: true, includesLongRange: true, sonnet: 10, haiku: 2, other: 1 }] };
        const m = monthlyScenarios(workload, { sonnet: 0.25, haiku: 0.5 });
        expect(m.options[0].estimate).toBeCloseTo(13 * 365.25 / 360);
        expect(m.options[3].estimate).toBeCloseTo(4.5 * 365.25 / 360);
        expect(() => monthlyScenarios({ ...workload, areas: [...workload.areas, ...workload.areas] }, {})).toThrow('Duplicate');
    });
    it('uses production triage guards to preserve concerts and sports', () => {
        const test = { task: 'shortlist', city: 'Eindhoven', pages: [], prompt: 'Kandidaten:\n' + JSON.stringify([{ index: 0, title: 'PSV - Inter', startDate: '2026-10-01', endDate: null }]) };
        const r = evaluateAnswer(test, { reviews: [{ index: 0, decision: 'exclude', excludeAs: 'routine', act: 'PSV' }] });
        expect(r.errors).toContain('unsafe_exclusion:0');
        expect(r.decisions?.[0].decision).toBe('verify');
    });
});
describe('source integrity regressions', () => {
    const url = 'https://example.com/event';
    const facts = { dateText: 'Festival 10 October 2026', locationText: 'This event is in Eindhoven.', hostCity: 'Eindhoven', locationScope: 'citywide', continuous: true, majorCompetition: false, demand: [] };
    const event = { title: 'Festival', sourceUrl: url, category: 'culture', venue: 'City', startAt: '2026-10-10', endAt: '2026-10-10', status: 'active', ownerType: 'organizer', attendance: null, venueCapacity: null, impactPoints: 35, overnightAudience: null, titleConfirmed: true, dateConfirmed: true, locationConfirmed: true, facts };
    const test = { task: 'page_reading', city: 'Eindhoven', prompt: '', pages: [{ url, text: `${facts.dateText}. ${facts.locationText}` }], window: { start: '2026-09-23', end: '2027-09-23' } };
    it('rejects moving an old edition into a new year', () => {
        const r = evaluateAnswer(test, { events: [{ ...event, startAt: '2027-10-10', endAt: '2027-10-10' }] });
        expect(r.errors.some(e => e.includes('wrong_year'))).toBe(true);
        const invalid = evaluateAnswer(test, { events: [{ ...event, startAt: '2027-02-30', endAt: '2027-02-30' }] });
        expect(invalid.errors).toContain('0:invalid_dates');
    });
    it('rejects an unfetched page or unsupported hotel demand quote', () => {
        const r = evaluateAnswer(test, { events: [{ ...event, sourceUrl: 'https://example.com/not-read' }] });
        expect(r.errors.some(e => e.includes('unsupported_date'))).toBe(true);
        const q = evaluateAnswer(test, { events: [{ ...event, facts: { ...facts, demand: [{ sourceUrl: url, text: '10000 visitors book hotel rooms', scope: 'edition', year: 2026, comparable: true }] } }] });
        expect(q.errors.some(e => e.includes('unsupported_demand'))).toBe(true);
        expect(q.events[0].verified).toBe(true);
    });
    it('reports duplicate events instead of inflating retention', () => {
        const r = evaluateAnswer(test, { events: [event, event] });
        expect(r.errors.some(e => e.includes('duplicate'))).toBe(true);
    });
    it('compares Amsterdam calendar dates and distinguishes unscored historical facts from invented quotes', () => {
        const dated = evaluateAnswer(test, { events: [{ ...event, startAt: '2026-10-09T22:00:00Z', endAt: '2026-10-10T21:59:59Z' }] });
        expect(dated.events[0].start).toBe('2026-10-10');
        const historical = { sourceUrl: url, text: 'The 2015 edition had 1000 visitors.', scope: 'historical', year: 2015, comparable: false, applicability: 'Different host area.' };
        const result = evaluateAnswer({ ...test, pages: [{ url, text: test.pages[0].text + historical.text }] }, { events: [{ ...event, facts: { ...facts, demand: [historical] } }] });
        expect(result.errors).not.toContain('0:unsupported_demand_quote');
        expect(result.events[0].supportedEvidence.demand).toHaveLength(0);
    });
    it('separates unresolved coordinates from a supported event and flags other cities', () => {
        const supported = evaluateAnswer(test, { events: [{ ...event, venue: null }] });
        expect(supported.events[0].verified).toBe(true);
        expect(supported.events[0].validation.reason).toBe('missing_fields');
        const outside = evaluateAnswer(test, { events: [{ ...event, facts: { ...facts, hostCity: 'Drachten' } }] });
        expect(outside.errors.some(e => e.includes('area_unresolved'))).toBe(true);
        const old = evaluateAnswer(test, { events: [{ ...event, venue: null, startAt: '2025-10-10', endAt: '2025-10-10' }] });
        expect(old.errors.some(e => e.includes('out_of_window'))).toBe(true);
    });
});

describe('report integrity', () => {
    it('freezes live verification from observed URLs only and never leaks the historical answer key', async () => {
        const s = setup();
        try {
            const dir = s.path.replace(/ledger\.json$/, '');
            const cases = [{ task: 'page_reading', schema: {}, answer: { title: 'SECRET BASELINE NAME' } }, ...freshCases('2026-09-23', {}).map((c, index) => ({ ...c, id: String(index) }))];
            const results = Object.fromEntries(cases.filter(c => c.task === 'fresh_search').map(c => [c.id, { response: response({ output: [{ type: 'web_search_call', action: { type: 'search', sources: [{ url: 'https://example.com/official' }] } }] }) }]));
            const fetchPage = vi.fn(async url => ({ url, text: 'Real official page text' }));
            const input = { manifest: { digest: 'frozen', cases }, results, dir, fetchPage, instructions: 'Extract facts' };
            const live = await prepareLivePages(input);
            expect(live.cases).toHaveLength(4);
            expect(fetchPage).toHaveBeenCalledTimes(1);
            expect(live.cases.every(c => !c.prompt.includes('SECRET BASELINE'))).toBe(true);
            expect((await prepareLivePages(input)).digest).toBe(live.digest);
            expect(fetchPage).toHaveBeenCalledTimes(1);
        } finally { s.cleanup(); }
    });
    it('acknowledges only explicit rejected requests and keeps their full money reserved', async () => {
        const s = setup();
        try {
            saveJson(s.path, { ceiling: 20, requests: { bad: { state: 'uncertain', httpStatus: 400, reserved: 1.5 }, timeout: { state: 'uncertain', reserved: 0.2 }, accepted: { state: 'uncertain', httpStatus: 400, responseId: 'resp_known', reserved: 0.2 } } });
            const runner = new LunaRunner({ ...s, apiKey: 'test', transport: vi.fn() });
            expect(() => runner.acknowledgeRejected('timeout')).toThrow();
            expect(() => runner.acknowledgeRejected('accepted')).toThrow();
            runner.acknowledgeRejected('bad');
            expect(runner.ledger.requests.bad.state).toBe('rejected_reserved');
            expect(committed(runner.ledger)).toBeCloseTo(1.9);
        } finally { s.cleanup(); }
    });
    it('does not enable JSON mode with hosted web search', () => {
        const body = requestBody({ ...testCase, searchCalls: 4 });
        expect(body.text).toBeUndefined();
        expect(body.input).toContain('OUTPUT JSON SCHEMA');
        expect(body.max_tool_calls).toBe(4);
        expect(requestBody(testCase).text.format.type).toBe('json_object');
    });
    it('accepts evidenced metadata review and invalidates it when the answer changes', () => {
        const answer = { reviews: [] };
        const test = { id: 'triage', task: 'shortlist', city: 'Eindhoven', family: 'haiku', split: 'holdout', prompt: 'Original title: vintage/rommelmarkt', pages: [], answer };
        const row = { state: 'complete', succeeded: true, response: response({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }) };
        const review = { triage: { answerHash: hash({ baseline: answer, luna: answer }), status: 'reviewed', notes: 'Checked metadata', evidence: [{ kind: 'metadata', quote: 'vintage/rommelmarkt' }], baselineErrors: 0, lunaErrors: 0 } };
        const evaluator = () => ({ events: [], errors: [], checks: 1, decisions: [] });
        expect(compareRow(test, row, evaluator, review).reviewStatus).toBe('reviewed');
        row.response = response();
        expect(compareRow(test, row, evaluator, review).reviewStatus).toBe('needs_review');
    });
    it('reports fresh coverage across categories once, while costs include failures and repeats', () => {
        const s = setup();
        try {
            const e = { title: 'Useful Festival', identity: 'festival|2026-10-01', start: '2026-10-01', end: '2026-10-02', verified: true };
            const baseline = { id: 'saved', city: 'Eindhoven', task: 'page_reading', family: 'sonnet', split: 'holdout', exactInformation: true, pages: [], answer: { events: [e] } };
            const live = ['one', 'two'].map(id => ({ id, task: 'fresh_search', city: 'Eindhoven', family: 'sonnet', split: 'fresh', pages: [], window: { name: 'near', start: '2026-09-23', end: '2026-12-22' } }));
            const r = { state: 'complete', succeeded: true, cost: { total: 0.05, processing: 0.01, search: 0.04 }, response: response({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ events: [e] }) }] }] }) };
            const ledger = { requests: { one: { ...r, caseId: 'one' }, two: { ...r, caseId: 'two' }, repeated: { ...r, caseId: 'one', repeat: true } } };
            const report = writeReport({ dir: s.path.replace(/ledger\.json$/, ''), manifest: { digest: 'test', cases: [baseline, ...live], limitations: [], historicalCosts: {} }, ledger, results: { one: r, two: r }, evaluate: (_test, answer) => ({ ...answer, errors: [], checks: 1 }) });
            expect(report.freshCoverage[0].retained).toBe(1);
            expect(report.freshCoverage[0].historicalExpected).toBe(1);
            expect(report.spending.known).toBeCloseTo(0.15);
            expect(report.repeatability).toHaveLength(1);
            expect(report.monthly.available).toBe(false);
        } finally { s.cleanup(); }
    });
});
