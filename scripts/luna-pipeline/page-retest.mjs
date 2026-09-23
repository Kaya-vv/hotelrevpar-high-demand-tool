// Round 2 of the saved-page test: the SAME 23 recorded Sonnet page-reading requests, now answered by
// Luna through the pipeline translator (32,000-token allowance, single-passage quote rule).
// Graded against the hand-reviewed events from round 1. Makes no Anthropic requests.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { createServer } from 'vite';
import { Ledger, createLunaResponder, SETTINGS, VARIANT } from './translate.mjs';
import { recordsOf } from '../model-comparison/corpus.mjs';
import { matchEvent } from '../model-comparison/report.mjs';

const dir = resolve('out/luna-pipeline'); mkdirSync(dir, { recursive: true });
const apiKey = process.env.OPENAI_API_KEY || parseEnv(readFileSync('.env.local', 'utf8')).OPENAI_API_KEY;
const manifest = JSON.parse(readFileSync('out/luna-comparison/manifest.json', 'utf8'));
const reviews = JSON.parse(readFileSync('out/luna-comparison/reviews.json', 'utf8'));
const roundOne = JSON.parse(readFileSync('out/luna-comparison/report.json', 'utf8')).rows;
const cases = manifest.cases.filter(c => c.task === 'page_reading' && c.split === 'holdout');
const ledger = new Ledger(join(dir, 'ledger.json'), 40);
const suffix = VARIANT === 'nothink' ? '-nothink' : '';
const respond = createLunaResponder({ apiKey, ledger, phase: () => `page-retest${suffix}`, fetchPage: async () => { throw new Error('No tools in page reading'); }, log: console.log });
const recordings = new Map();
const paramsOf = source => {
  if (!recordings.has(source.path)) recordings.set(source.path, recordsOf(JSON.parse(readFileSync(source.path, 'utf8'))));
  return recordings.get(source.path)[source.index].params;
};
const server = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { '@': resolve('src') } } });
try {
  const { evaluateAnswer } = await server.ssrLoadModule('/scripts/model-comparison/evaluate.ts');
  const outPath = join(dir, `page-retest${suffix}.json`);
  const saved = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
  for (let i = 0; i < cases.length; i += 4) {
    await Promise.all(cases.slice(i, i + 4).map(async test => {
      if (saved[test.id]?.message) return;
      const message = await respond(paramsOf(test.source));
      saved[test.id] = { message }; writeFileSync(outPath, JSON.stringify(saved, null, 1));
    }));
  }
  const rows = cases.map(test => {
    const message = saved[test.id].message;
    const text = message.content.findLast(b => b.type === 'text')?.text;
    let luna; try { luna = evaluateAnswer(test, JSON.parse(text)); } catch (error) { luna = { events: [], errors: [error.message] }; }
    const baseline = evaluateAnswer(test, test.answer);
    const expected = reviews[test.id].expectedEvents;
    const kept = events => expected.filter(e => events.some(x => x.verified && matchEvent(e, x))).length;
    const before = roundOne.find(r => r.id === test.id);
    return { id: test.id, city: test.city, stop: message.stop_reason, expected: expected.length, lunaRound2: kept(luna.events), lunaRound1: before.retained, sonnet: kept(baseline.events),
      lunaEvents: luna.events.map(e => ({ title: e.title, start: e.start, end: e.end, verified: e.verified, errors: e.errors })), lunaErrors: luna.errors };
  });
  const total = key => rows.reduce((n, r) => n + r[key], 0);
  // Exactly the requests behind these saved answers (message ids carry the ledger id).
  const ids = new Set(cases.map(test => saved[test.id].message.id.replace('msg_luna_', '')));
  const cost = ledger.data.requests.filter(r => ids.has(r.id.replaceAll('-', ''))).reduce((n, r) => n + r.cost.total, 0);
  const summary = { settings: SETTINGS, expected: total('expected'), lunaRound2: total('lunaRound2'), lunaRound1: total('lunaRound1'), sonnet: total('sonnet'),
    cutOff: rows.filter(r => r.stop === 'max_tokens').length, cost, rows };
  writeFileSync(join(dir, `page-retest${suffix}-report.json`), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ...summary, rows: rows.filter(r => r.expected || r.lunaRound2 !== r.lunaRound1).map(r => `${r.id.slice(0, 8)} ${r.city} ${r.stop} expected=${r.expected} round2=${r.lunaRound2} round1=${r.lunaRound1} sonnet=${r.sonnet}`) }, null, 1));
} finally { await server.close(); }
