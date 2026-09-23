// Evaluation only. No production client, queue, mailer or Anthropic client is constructed.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { MODEL, LunaRunner, hash, lock, readJson, saveJson, requestBody, parseAnswer } from './model-comparison/core.mjs';
import { buildCorpus, freshCases, frozen, assertFrozen } from './model-comparison/corpus.mjs';
import { writeReport } from './model-comparison/report.mjs';
import { observedUrls, prepareLivePages } from './model-comparison/live-pages.mjs';

const dir = resolve('out/luna-comparison'); // One budget for every invocation; no --output/reset escape.
const manifestPath = join(dir, 'manifest.json');
const ledgerPath = join(dir, 'ledger.json');
const resultPath = join(dir, 'results.json');
const mode = process.argv[2] ?? 'report';
if (!['prepare', 'test', 'run', 'verify-live', 'report', 'reconcile', 'ack-rejected'].includes(mode)) throw new Error('Use prepare, test, run, verify-live, report, reconcile REQUEST_ID RESPONSE_ID, or ack-rejected REQUEST_ID');
const release = lock(join(dir, 'active.lock'));
let server;
function codeDigest() {
  const files = ['scripts/compare-research-models.mjs', 'src/features/collection/sources/claude.ts', 'src/features/collection/anthropic-batches.ts', 'src/features/collection/official-pages.ts'];
  for (const folder of ['scripts/model-comparison', 'src/features/events']) for (const f of readdirSync(folder)) if (/\.(mjs|ts)$/.test(f)) files.push(`${folder}/${f}`);
  return hash(files.sort().map(f => [f, readFileSync(f, 'utf8')]));
}
function key() {
  // Only take the OpenAI key. Never load production DB/Anthropic credentials into env.
  return process.env.OPENAI_API_KEY || (existsSync('.env.local') ? parseEnv(readFileSync('.env.local', 'utf8')).OPENAI_API_KEY : undefined);
}
try {
  if (mode === 'test') {
    execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'scripts/model-comparison', '--maxWorkers=1'], { stdio: 'inherit' });
    saveJson(join(dir, 'safety-gate.json'), { codeDigest: codeDigest(), checkedAt: new Date().toISOString(), paid: false });
    console.log('Safety tests passed. No API calls made.');
  } else {
    if (mode === 'prepare' && !existsSync(manifestPath)) {
      if (existsSync(ledgerPath)) throw new Error('Ledger already exists without manifest; preserve it and investigate');
      const corpus = buildCorpus();
      const schema = corpus.cases.find(c => c.task === 'page_reading')?.schema;
      if (!schema) throw new Error('No complete extraction recordings found');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
      const fresh = freshCases(today, schema);
      saveJson(manifestPath, frozen({ ...corpus, researchDate: today, cases: [...corpus.cases, ...fresh], model: MODEL,
        policy: { maxSpend: 20, preparationFraction: 0.2, maxPerTask: 30, maximumUsefulLoss: 0.05, sonnetSavingsTarget: 0.5 } }));
    }
    const manifest = readJson(manifestPath); assertFrozen(manifest);
    server = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null }, resolve: { alias: { '@': resolve('src') } } });
    const { evaluateAnswer } = await server.ssrLoadModule('/scripts/model-comparison/evaluate.ts');
    const results = readJson(resultPath, {});
    const runner = new LunaRunner({ path: ledgerPath, apiKey: ['run', 'verify-live', 'reconcile'].includes(mode) ? key() : undefined });
    const reviews = readJson(join(dir, 'reviews.json'), {});
    const report = () => {
      const live = readJson(join(dir, 'live-pages-manifest.json'), { cases: [], omissions: [] });
      const current = { ...manifest, livePageOmissions: live.omissions, cases: [...manifest.cases, ...live.cases].map(c => results[c.id]?.pages ? { ...c, pages: results[c.id].pages } : c) };
      return writeReport({ dir, manifest: current, ledger: runner.ledger, results, evaluate: evaluateAnswer, reviews, workload: readJson(join(dir, 'monthly-workload.json'), null) });
    };
    try {
      if (['run', 'verify-live', 'reconcile'].includes(mode)) {
        const gate = readJson(join(dir, 'safety-gate.json'), {});
        if (gate.codeDigest !== codeDigest()) throw new Error('Run the safety tests for this code before paid work');
        if (!key()) throw new Error('OPENAI_API_KEY missing; no new request made');
      }
      if (mode === 'reconcile') {
        await runner.reconcile(process.argv[3], process.argv[4]);
        console.log('Retrieved an existing response. No replacement request made.');
      }
      if (mode === 'ack-rejected') runner.acknowledgeRejected(process.argv[3]);
      if (mode === 'verify-live') {
        const { fetchOfficialPage } = await server.ssrLoadModule('/src/features/collection/official-pages.ts');
        const { evidenceInstructions } = await server.ssrLoadModule('/src/features/events/evidence.ts');
        const live = await prepareLivePages({ manifest, results, dir, fetchPage: fetchOfficialPage, instructions: evidenceInstructions });
        for (let offset = 0; offset < live.cases.length; offset += 3) {
          const completed = await Promise.allSettled(live.cases.slice(offset, offset + 3).map(async test => {
            const body = requestBody(test, live.settings.effort); body.max_output_tokens = live.settings.maxOutputTokens;
            results[test.id] = await runner.run(test.id, body, 'fresh'); saveJson(resultPath, results);
            console.log(`Verified page: ${test.city} ${test.window.name} ${test.id.slice(0, 8)} ${results[test.id].succeeded ? 'received' : 'failed'}`);
          }));
          const failed = completed.filter(r => r.status === 'rejected');
          if (failed.length) throw new AggregateError(failed.map(r => r.reason), 'Live page verification stopped; reservations and completed results retained');
        }
      }
      if (mode === 'run') {
        const { fetchOfficialPage } = await server.ssrLoadModule('/src/features/collection/official-pages.ts');
        async function runCase(test, effort, phase, repeat = false) {
          const body = requestBody(test, effort);
          const reused = runner.ledger.requests[hash({ caseId: test.id, body, repeat })]?.state === 'complete';
          const record = await runner.run(test.id, body, phase, repeat);
          const pages = results[test.id]?.pages ?? [];
          if (test.task === 'fresh_search' && record.succeeded && !results[test.id]?.pageFetchComplete) {
            const observed = new Set(observedUrls(record.response));
            let answer;
            try { answer = parseAnswer(record.response); } catch { answer = {}; }
            const urls = [...new Set((answer.events ?? []).flatMap(e => [e.sourceUrl, e.facts?.locationSourceUrl, ...(e.facts?.demand ?? []).map(d => d.sourceUrl)]))]
              .filter(u => observed.has(u)).slice(0, 24);
            for (const url of urls) {
              if (pages.some(p => p.requestedUrl === url)) continue;
              try { pages.push({ ...(await fetchOfficialPage(url)), requestedUrl: url, checkedAt: new Date().toISOString() }); }
              catch (error) { pages.push({ url, requestedUrl: url, text: '', error: error.message }); }
              results[test.id] = { ...record, pages }; saveJson(resultPath, results);
            }
          }
          if (!repeat) { results[test.id] = { ...record, ...(test.task === 'fresh_search' ? { pages, pageFetchComplete: true } : {}) }; saveJson(resultPath, results); }
          console.log(`${repeat ? 'repeat' : test.split}: ${test.city} ${test.task} ${test.id.slice(0, 8)} ${reused ? 'reused, no new charge' : record.succeeded ? 'received' : 'failed'}; recorded cost $${record.cost?.total.toFixed(4) ?? 'reserved'}`);
          return record;
        }
        const settingsPath = join(dir, 'settings.json');
        let settings = readJson(settingsPath, null);
        if (!settings) {
          settings = { manifestDigest: manifest.digest, codeDigest: codeDigest(), efforts: {} };
          for (const task of ['shortlist', 'official_website', 'page_reading']) {
            let improvements = 0;
            for (const test of manifest.cases.filter(c => c.task === task && c.split === 'preparation')) {
              const medium = await runCase(test, 'medium', 'saved');
              const errors = row => { try { return evaluateAnswer(test, parseAnswer(row.response)).errors.length; } catch { return 999; } };
              if (!medium.succeeded || errors(medium) > 0) {
                const high = await runCase(test, 'high', 'saved');
                if (high.succeeded && errors(high) < errors(medium)) improvements++;
              }
            }
            settings.efforts[task] = improvements ? 'high' : 'medium';
          }
          settings.efforts.fresh_search = settings.efforts.page_reading;
          settings.frozenAt = new Date().toISOString(); saveJson(settingsPath, settings);
        }
        if (settings.manifestDigest !== manifest.digest) throw new Error('Settings belong to a different frozen experiment');
        // Report/validation fixes do not unfreeze the chosen model effort or repurchase
        // completed cases. Body identity below remains authoritative for paid requests.
        for (const test of manifest.cases.filter(c => c.split === 'holdout')) {
          const completed = results[test.id];
          if (completed && completed.bodyHash !== hash(requestBody(test, settings.efforts[test.task]))) throw new Error('Held-out paid request changed after settings were frozen');
        }
        for (const test of manifest.cases.filter(c => c.split === 'holdout')) await runCase(test, settings.efforts[test.task], 'saved');
        report();
        for (const test of manifest.cases.filter(c => c.split === 'fresh')) await runCase(test, settings.efforts.fresh_search, 'fresh');
        // Repeat a fixed case per task and city, not whichever happened to look best.
        for (const task of ['shortlist', 'official_website', 'page_reading']) for (const city of ['Eindhoven', 'Rotterdam']) {
          const test = manifest.cases.find(c => c.split === 'holdout' && c.task === task && c.city === city);
          if (test) await runCase(test, settings.efforts[task], 'repeat', true);
        }
      }
    } finally {
      const output = report();
      console.log(`Report: ${join(dir, 'report.html')}. Known new spending $${output.spending.known.toFixed(4)}; reserved $${output.spending.reserved.toFixed(4)}.`);
    }
  }
} finally {
  await server?.close(); release();
}
