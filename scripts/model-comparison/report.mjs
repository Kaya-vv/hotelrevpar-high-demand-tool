import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAnswer, committed, hash, saveJson } from './core.mjs';

const money = n => n == null ? 'Not measured' : `$${n.toFixed(4)}`;
const taskName = task => ({ shortlist: 'Candidate shortlist · Haiku', official_website: 'Official websites · Haiku', page_reading: 'Dates and demand facts · Sonnet', fresh_search: 'Live event searches · Luna only', live_verification: 'Read discovered pages · Luna only' })[task] ?? task;
const escape = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const normalized = x => String(x).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\b20\d\d\b/g, '').replace(/[^a-z0-9]/g, '');
export function matchEvent(expected, actual) {
  const names = [expected.title, ...(expected.aliases ?? [])].map(normalized).filter(n => n.length >= 4);
  const name = normalized(actual.title);
  return expected.start === actual.start && expected.end === actual.end && names.some(n => n === name || name.includes(n) || n.includes(name));
}
function evaluated(test, answer, evaluate) {
  try { return evaluate(test, answer); }
  catch (error) { return { events: [], errors: [error.message], checks: 1, reviewRequired: true }; }
}
export function compareRow(test, row, evaluate, reviews = {}) {
  const baseline = test.answer ? evaluated(test, test.answer, evaluate) : null;
  let luna = null, answer = null;
  if (row?.succeeded) {
    try { answer = parseAnswer(row.response); luna = evaluated(test, answer, evaluate); }
    catch (error) { luna = { events: [], errors: [error.message], checks: 1 }; }
  }
  const candidates = (baseline?.events ?? []).filter(e => e.verified);
  const found = candidates.filter(e => luna?.events?.some(l => l.verified && matchEvent(e, l)));
  const review = reviews[test.id];
  // An adjudication is invalidated if either answer changes. Evidence is compulsory;
  // this is a local human review record, never another paid model's verdict.
  const reviewValid = review?.answerHash === hash({ baseline: test.answer ?? null, luna: answer })
    && review.status === 'reviewed' && review.notes?.trim() && review.evidence?.length
    && review.evidence.every(e => e.quote?.length >= 12 && (e.kind === 'metadata' && test.task === 'shortlist'
      ? (test.originalPrompt ?? test.prompt).includes(e.quote)
      : test.pages.some(p => p.url === e.url && p.text.replace(/\s+/g, ' ').includes(e.quote.replace(/\s+/g, ' ')))))
    && Number.isInteger(review.baselineErrors) && review.baselineErrors >= 0
    && Number.isInteger(review.lunaErrors) && review.lunaErrors >= 0;
  const expected = reviewValid && Array.isArray(review.expectedEvents) ? review.expectedEvents : candidates;
  const retained = expected.filter(e => luna?.events?.some(l => l.verified && matchEvent(e, l)));
  // The same reviewed events measured for Sonnet, so neither model is treated as the answer key.
  const baselineRetained = expected.filter(e => baseline?.events?.some(b => b.verified && matchEvent(e, b)));
  const mismatches = [];
  if (baseline?.decisions && luna?.decisions) for (const b of baseline.decisions) {
    const l = luna.decisions.find(x => x.index === b.index);
    if (!l || b.decision !== l.decision) mismatches.push({ title: b.title, baseline: b.decision, luna: l?.decision ?? 'missing' });
  }
  return { id: test.id, city: test.city, task: test.task, family: test.family, split: test.split, window: test.window,
    exactInformation: test.exactInformation, source: test.source, status: !row ? 'not_run' : row.state !== 'complete' ? row.state : !row.succeeded ? 'failed' : 'complete',
    failureReason: row && !row.succeeded ? row.response?.incomplete_details?.reason ?? row.error ?? 'No completed answer' : null,
    baseline, luna, baselineCost: test.baselineCost, baselineBatchCost: test.baselineBatchCost, cost: row?.cost ?? null,
    expected: expected.length, retained: retained.length, baselineRetained: baselineRetained.length,
    lunaRetainedOfBaseline: baselineRetained.filter(e => retained.includes(e)).length,
    unreviewedBaselineCandidates: candidates.length, unreviewedMatches: found.length,
    reviewStatus: reviewValid ? 'reviewed' : 'needs_review', review: reviewValid ? review : null,
    answerHash: hash({ baseline: test.answer ?? null, luna: answer }), mismatches,
    missing: expected.filter(e => !retained.includes(e)),
    added: (luna?.events ?? []).filter(l => l.verified && !expected.some(e => matchEvent(e, l))),
    assessmentDifferences: candidates.flatMap(b => {
      const l = luna?.events?.find(l => matchEvent(b, l));
      return l && b.score?.suggestedImportance !== l.score?.suggestedImportance ? [{ title: b.title, baseline: b.score?.suggestedImportance, luna: l.score?.suggestedImportance, locationComplete: b.scoreLocationComplete && l.scoreLocationComplete }] : [];
    }),
  };
}
export function recommendation(rows, family) {
  const sample = rows.filter(r => r.family === family && r.split === 'holdout');
  const reasons = [];
  // A failed Luna answer is a measured Luna failure (nothing retained, reviewed as an error),
  // not missing evidence. Only unsent or unreconciled requests leave the comparison incomplete.
  if (!sample.length || sample.some(r => !['complete', 'failed'].includes(r.status))) reasons.push('Comparison requests are incomplete.');
  if (sample.some(r => r.reviewStatus !== 'reviewed')) reasons.push('Source-based review is unfinished.');
  const expected = sample.reduce((n, r) => n + r.expected, 0), retained = sample.reduce((n, r) => n + r.retained, 0);
  const baselineRetained = sample.reduce((n, r) => n + r.baselineRetained, 0), lunaRetainedOfBaseline = sample.reduce((n, r) => n + r.lunaRetainedOfBaseline, 0);
  if (family === 'sonnet' && expected < 20) reasons.push('Fewer than 20 independently reviewed useful events.');
  for (const city of ['Eindhoven', 'Rotterdam']) if (!sample.some(r => r.city === city && r.exactInformation)) reasons.push(`No complete same-information sample for ${city}.`);
  if (family === 'haiku' && (!sample.some(r => r.task === 'shortlist') || !sample.some(r => r.task === 'official_website' && r.exactInformation))) reasons.push('Both Haiku tasks need adequately supported comparisons.');
  const baseline = sample.reduce((n, r) => n + (r.baselineBatchCost?.total ?? 0), 0), luna = sample.reduce((n, r) => n + (r.cost?.total ?? 0), 0);
  const savings = baseline > 0 && sample.every(r => r.cost && r.exactInformation) ? 1 - luna / baseline : null;
  if (savings === null) reasons.push('Comparable costs are incomplete.');
  if (reasons.length) return { decision: 'insufficient evidence', reasons, expected, retained, baselineRetained, lunaRetainedOfBaseline, savings };
  const baselineChecks = sample.reduce((n, r) => n + (r.baseline?.checks ?? 1), 0);
  const lunaChecks = sample.reduce((n, r) => n + (r.luna?.checks ?? 1), 0);
  const baselineErrorRate = sample.reduce((n, r) => n + r.review.baselineErrors, 0) / baselineChecks;
  const lunaErrorRate = sample.reduce((n, r) => n + r.review.lunaErrors, 0) / lunaChecks;
  const failed = [];
  if (expected && retained / expected < 0.95) failed.push(`Luna kept ${retained}/${expected} reviewed events (Sonnet ${baselineRetained}/${expected}); at least 95% is required.`);
  if (lunaErrorRate > baselineErrorRate) failed.push('Luna made more reviewed errors than Sonnet.');
  if (sample.some(r => r.luna?.errors.some(e => /wrong_year|unsupported/.test(e)))) failed.push('Some Luna answers contain wrong-year or unsupported (non-verbatim) evidence.');
  if (family === 'sonnet' ? savings < 0.5 : savings <= 0) failed.push('Cost savings are below the agreed threshold.');
  return { decision: failed.length ? 'keep' : 'switch', reasons: failed.length ? failed : ['Reviewed quality and complete task cost meet the agreed threshold.'], expected, retained, baselineRetained, lunaRetainedOfBaseline, savings, baselineErrorRate, lunaErrorRate };
}
export function monthlyScenarios(workload, ratios) {
  // One entry per shared area and work component. Never multiply by hotel count.
  // A full monthly observation includes broad/near-term/long-range work exactly once.
  if (!workload?.areas?.length || workload.complete !== true) return { available: false, reason: 'No reconciled full monthly portfolio cycle after the repair is available. Historical $49 was an incomplete scenario, not a current bill.', options: [] };
  const keys = workload.areas.map(a => a.area);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate shared areas in monthly workload');
  let s = 0, h = 0, other = 0;
  for (const area of workload.areas) {
    if (!area.source || !area.includesBroad || !area.includesLongRange || ['sonnet', 'haiku', 'other'].some(k => !Number.isFinite(area[k]) || area[k] < 0)) throw new Error('Monthly workload needs complete sourced cost components');
    s += area.sonnet; h += area.haiku; other += area.other;
  }
  const multiplier = 365.25 / 12 / 30;
  return { available: true, source: workload.source, excludes: 'New areas, onboarding, manual runs and hosting', options: [
    { option: 'Keep Sonnet and Haiku', estimate: (s + h + other) * multiplier },
    { option: 'Replace only Haiku', estimate: ratios.haiku == null ? null : (s + h * ratios.haiku + other) * multiplier },
    { option: 'Replace only Sonnet', estimate: ratios.sonnet == null ? null : (s * ratios.sonnet + h + other) * multiplier },
    { option: 'Replace both', estimate: ratios.sonnet == null || ratios.haiku == null ? null : (s * ratios.sonnet + h * ratios.haiku + other) * multiplier },
  ] };
}
export function writeReport({ dir, manifest, ledger, results, evaluate, reviews = {}, workload = null }) {
  const rows = manifest.cases.map(test => compareRow(test, results[test.id], evaluate, reviews));
  const historicalPages = new Map(manifest.cases.filter(c => c.task === 'page_reading').flatMap(c => c.pages.map(p => [p.url, p.text])));
  const livePages = new Map(manifest.cases.filter(c => ['fresh_search', 'live_verification'].includes(c.task)).flatMap(c => c.pages.map(p => [p.url, p.text])));
  const sourceChanges = [...livePages].filter(([url]) => historicalPages.has(url)).map(([url, value]) => ({ url,
    pageTextChanged: hash(value.replace(/\s+/g, ' ').trim()) !== hash(historicalPages.get(url).replace(/\s+/g, ' ').trim()),
    note: 'A text change may be navigation, a refreshed page or changed event information. It is not proof of a new announcement.' }));
  const historicalInventory = new Map();
  for (const row of rows.filter(r => r.task === 'page_reading')) for (const event of row.baseline?.events ?? []) {
    if (event.verified) historicalInventory.set(`${row.city}|${event.identity}`, { ...event, city: row.city });
  }
  for (const row of rows.filter(r => r.task === 'fresh_search')) {
    const test = manifest.cases.find(c => c.id === row.id);
    // Each category is only part of a city/window search. Retention is scored on their
    // union below; never require every category request to find the whole city's events.
    row.historicalReferenceCount = [...historicalInventory.values()].filter(e => e.city === row.city && e.start <= test.window.end && e.end >= test.window.start).length;
  }
  const freshCoverage = [];
  for (const city of ['Eindhoven', 'Rotterdam']) for (const window of ['near', 'broad']) {
    const tests = manifest.cases.filter(c => c.city === city && c.task === 'fresh_search' && c.window.name === window);
    if (!tests.length) continue;
    const sample = rows.filter(r => tests.some(t => t.id === r.id));
    const expected = [...historicalInventory.values()].filter(e => e.city === city && e.start <= tests[0].window.end && e.end >= tests[0].window.start);
    const verifiedRows = rows.filter(r => r.task === 'live_verification' && r.city === city && r.window?.name === window);
    const actual = [...new Map([...sample, ...verifiedRows].flatMap(r => r.luna?.events ?? []).filter(e => e.verified).map(e => [e.identity, e])).values()];
    freshCoverage.push({ city, window, complete: sample.every(r => r.status === 'complete') && verifiedRows.every(r => r.status === 'complete'), historicalExpected: expected.length,
      searchAnswersComplete: sample.filter(r => r.status === 'complete').length, searchRequests: sample.length,
      verificationRequests: verifiedRows.length, verificationComplete: verifiedRows.filter(r => r.status === 'complete').length,
      workflowCost: [...sample, ...verifiedRows].reduce((n, r) => n + (r.cost?.total ?? 0), 0),
      retained: expected.filter(e => actual.some(a => matchEvent(e, a))).length,
      missing: expected.filter(e => !actual.some(a => matchEvent(e, a))),
      extra: actual.filter(a => !expected.some(e => matchEvent(e, a))),
      caveat: 'Historical references are drawn from the selected saved pages only. Missing references may have changed; extra events are not proof of a new announcement. Independent source review is required.' });
  }
  const decisions = Object.fromEntries(['sonnet', 'haiku'].map(f => [f, recommendation(rows, f)]));
  if (decisions.sonnet.decision === 'switch' && (freshCoverage.some(c => !c.complete || !c.verificationRequests) || rows.some(r => ['fresh_search', 'live_verification'].includes(r.task) && r.reviewStatus !== 'reviewed'))) {
    decisions.sonnet.decision = 'insufficient evidence'; decisions.sonnet.reasons.push('Live search/source-change review remains unfinished.');
  }
  const ratios = Object.fromEntries(['sonnet', 'haiku'].map(f => {
    const samples = rows.filter(r => r.family === f && r.split === 'holdout' && r.exactInformation);
    const complete = samples.length && samples.every(r => r.status === 'complete' && r.cost && r.baselineBatchCost);
    // A shortlist-only or page-only ratio is not a complete provider replacement ratio.
    return [f, complete && decisions[f].decision !== 'insufficient evidence' ? samples.reduce((n, r) => n + r.cost.total, 0) / samples.reduce((n, r) => n + r.baselineBatchCost.total, 0) : null];
  }));
  // Task samples cannot establish the mix of a whole production research cycle.
  const monthly = monthlyScenarios(workload, ratios);
  const entries = Object.values(ledger.requests);
  const taskSummary = ['shortlist', 'official_website', 'page_reading', 'fresh_search', 'live_verification'].map(task => {
    const sample = rows.filter(r => r.task === task && r.split !== 'preparation');
    const completed = sample.filter(r => r.cost);
    const baseline = completed.reduce((n, r) => n + (r.baselineBatchCost?.total ?? 0), 0);
    const luna = completed.reduce((n, r) => n + r.cost.total, 0);
    return { task, cases: sample.length, finished: sample.filter(r => r.status === 'complete').length,
      failed: sample.filter(r => r.status === 'failed').length, reviewed: sample.filter(r => r.reviewStatus === 'reviewed').length,
      decisions: completed.reduce((n, r) => n + (r.luna?.decisions?.length ?? 0), 0),
      decisionDisagreements: completed.reduce((n, r) => n + r.mismatches.length, 0),
      baselineBatchCost: baseline || null, lunaCost: completed.length ? luna : null,
      measuredTaskSavings: baseline && sample.every(r => r.cost && r.exactInformation) ? 1 - luna / baseline : null,
      scope: task === 'official_website' ? 'Partial replay: titles and URLs only, excludes buying a new search' : task === 'fresh_search' ? 'Live searches, no simultaneous Anthropic baseline' : task === 'live_verification' ? 'Exact fetched pages discovered by Luna; additional verification cost' : 'Same recorded input, current common validation' };
  });
  const repeatability = entries.filter(r => r.repeat).map(r => {
    const main = results[r.caseId];
    let identical = false;
    try { identical = hash(parseAnswer(r.response)) === hash(parseAnswer(main.response)); } catch { /* failed outputs remain failures */ }
    return { caseId: r.caseId, succeeded: r.succeeded, cost: r.cost, identicalJson: identical,
      explanation: identical ? 'Same structured answer' : 'Different wording/facts or incomplete output; inspect saved responses' };
  });
  const spending = { processing: entries.reduce((n, r) => n + (r.cost?.processing ?? 0), 0), searches: entries.reduce((n, r) => n + (r.cost?.search ?? 0), 0),
    known: entries.reduce((n, r) => n + (r.cost?.total ?? 0), 0), reserved: entries.filter(r => !r.cost).reduce((n, r) => n + r.reserved, 0), committed: committed(ledger), ceiling: 20,
    unsuccessfulKnown: entries.filter(r => !r.succeeded).reduce((n, r) => n + (r.cost?.total ?? 0), 0) };
  const quality = ['Eindhoven', 'Rotterdam'].map(city => {
    const paired = rows.filter(r => r.city === city && r.task === 'page_reading' && r.split === 'holdout');
    const reviewed = paired.filter(r => r.reviewStatus === 'reviewed');
    const measures = field => {
      const events = paired.flatMap(r => r[field]?.events ?? []);
      const count = pattern => events.filter(e => e.errors?.some(x => pattern.test(x))).length;
      return { returned: events.length, usableDateLocation: events.filter(e => e.verified).length,
        unsupportedDates: count(/invalid_dates|unsupported_date|wrong_year|out_of_window/),
        unsupportedLocations: count(/unsupported_location|area_unresolved/),
        unsupportedDemand: count(/unsupported_demand/), duplicates: count(/duplicate/),
        reviewedErrors: reviewed.reduce((n, r) => n + r.review[field === 'baseline' ? 'baselineErrors' : 'lunaErrors'], 0) };
    };
    return { city, cases: paired.length, reviewed: reviewed.length, reviewedExpected: reviewed.reduce((n, r) => n + r.expected, 0),
      reviewedRetained: reviewed.reduce((n, r) => n + r.retained, 0), reviewedBaselineRetained: reviewed.reduce((n, r) => n + r.baselineRetained, 0),
      baseline: measures('baseline'), luna: measures('luna') };
  });
  const report = { generatedAt: new Date().toISOString(), manifestDigest: manifest.digest, spending, decisions, monthly,
    historicalCosts: manifest.historicalCosts, limitations: manifest.limitations, rows, taskSummary, quality, freshCoverage, repeatability, sourceChanges,
    returnedModels: [...new Set(entries.map(r => r.response?.model).filter(Boolean))], livePageOmissions: manifest.livePageOmissions ?? [],
    caveats: ['Usage-priced estimates are not a provider invoice. Web-action fees are conservatively counted.',
      'Original standard-price estimates and batch-equivalent baselines are shown separately; no hypothetical Luna batch discount is claimed.',
      'Fresh searches are a different date and workflow from historical searches. They cannot establish an end-to-end production cost ratio.',
      'Unreviewed matching and source quotes are provisional, not independent proof of correctness.',
      'Each event grade uses current app rules and the same reference location, with no user overrides. Venue distance remains unresolved without saved coordinates.'] };
  saveJson(join(dir, 'report.json'), report);
  const csv = value => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
  const header = ['city', 'task', 'split', 'status', 'review', 'expected', 'retained', 'baseline_actual_usd', 'baseline_batch_usd', 'luna_usd', 'id'];
  writeFileSync(join(dir, 'comparison.csv'), [header, ...rows.map(r => [r.city, r.task, r.split, r.status, r.reviewStatus, r.expected, r.retained, r.baselineCost?.total, r.baselineBatchCost?.total, r.cost?.total, r.id])].map(r => r.map(csv).join(',')).join('\n'));
  const summary = `# Luna comparison\n\nSonnet: **${decisions.sonnet.decision}**. Haiku: **${decisions.haiku.decision}**.\n\n${decisions.sonnet.reasons.map(x => `- ${x}`).join('\n')}\n\n${decisions.sonnet.expected ? `Reviewed page reading: Luna kept ${decisions.sonnet.retained}/${decisions.sonnet.expected} usable events, Sonnet ${decisions.sonnet.baselineRetained}/${decisions.sonnet.expected}. Of Sonnet's ${decisions.sonnet.baselineRetained} usable events, Luna also kept ${decisions.sonnet.lunaRetainedOfBaseline}.\n\n` : ''}New measured spending: ${money(spending.known)}. Unresolved reservations: ${money(spending.reserved)}. Ceiling: $20.\n\n${rows.filter(r => r.status === 'complete').length}/${rows.length} cases completed.\n\n## Measured task costs\n\n| Task | Finished / planned | Baseline batch equivalent | Luna | Savings |\n| --- | --- | --- | --- | --- |\n${taskSummary.map(t => `| ${taskName(t.task)} | ${t.finished}/${t.cases} | ${money(t.baselineBatchCost)} | ${money(t.lunaCost)} | ${t.measuredTaskSavings == null ? 'Not comparable' : (100*t.measuredTaskSavings).toFixed(1)+'%'} |`).join('\n')}\n\nThese are test-task costs, not prices per hotel. Failed attempts are included.\n\n## Monthly costs\n\n${monthly.available ? monthly.options.map(x => `${x.option}: ${money(x.estimate)}`).join('\n\n') : monthly.reason}\n\n## Limits\n\n${[...manifest.limitations, ...report.caveats].map(x => `- ${x}`).join('\n')}\n\nLive page omissions: ${report.livePageOmissions.length}; see report.json for each source and reason.\n`;
  writeFileSync(join(dir, 'report.md'), summary);
  const taskTable = '<section><h2>Measured task results</h2><p>These are test-task costs, not prices per hotel. Page reading includes date extraction and demand evidence once.</p><table><tr><th>Task</th><th>Finished / planned</th><th>Baseline batch equivalent</th><th>Luna</th><th>Measured savings</th></tr>' + taskSummary.map(t => '<tr><td>'+escape(taskName(t.task))+'<br><small>'+escape(t.scope)+'</small></td><td>'+t.finished+' / '+t.cases+' ('+t.failed+' failed)</td><td>'+money(t.baselineBatchCost)+'</td><td>'+money(t.lunaCost)+'</td><td>'+(t.measuredTaskSavings == null ? 'Not comparable' : (100*t.measuredTaskSavings).toFixed(1)+'%')+'</td></tr>').join('')+'</table></section>';
  const freshTable = '<section><h2>Live search coverage</h2><p>Compared with the limited historical reference set. Differences in websites and announcement dates still need review.</p><table><tr><th>City / window</th><th>Progress</th><th>Historical references retained</th><th>Additional results passing date/location checks</th><th>Search + page cost</th></tr>'+freshCoverage.map(c => '<tr><td>'+escape(c.city)+' / '+c.window+'</td><td>'+(c.searchAnswersComplete+'/'+c.searchRequests+' search answers; '+c.verificationComplete+'/'+c.verificationRequests+' pages read')+'</td><td>'+c.retained+' / '+c.historicalExpected+'</td><td>'+c.extra.length+'</td><td>'+money(c.workflowCost)+'</td></tr>').join('')+'</table></section>';
  const repeatTable = '<section><h2>Repeatability and historical spending</h2><p>'+repeatability.length+' repeat requests: '+repeatability.filter(r => r.succeeded).length+' completed, '+repeatability.filter(r => r.identicalJson).length+' returned exactly the same structured answer. Wording differences alone do not prove a quality problem; incomplete answers remain failures. Repeat costs are included above.</p><p>Historical recordings: '+money(manifest.historicalCosts?.actualRecorded)+' total at recorded pricing; '+money(manifest.historicalCosts?.excludedDuplicateCost)+' came from repeated identical requests. Those repeats are excluded from the one-copy cost comparison. This is recorded usage, not a complete account invoice.</p></section>';
  const qualityTable = '<section><h2>Saved-page quality checks</h2><p>Automatic checks compare both models with the same saved evidence. Counts are events with at least one problem in that category; one event can appear in several columns. Usable dates and location do not establish hotel demand. An unsupported extra claim is counted separately, while the event can remain useful with unknown demand. Missing answers are failures, never zero-error successes.</p><div class="scroll"><table><tr><th>City / model</th><th>Returned / usable dates &amp; location</th><th>Date problems</th><th>Location problems</th><th>Unsupported demand</th><th>Duplicates</th></tr>' + quality.flatMap(q => ['baseline', 'luna'].map(f => '<tr><td>'+q.city+' / '+(f === 'baseline' ? 'Sonnet' : 'Luna')+'</td><td>'+q[f].returned+' / '+q[f].usableDateLocation+'</td><td>'+q[f].unsupportedDates+'</td><td>'+q[f].unsupportedLocations+'</td><td>'+q[f].unsupportedDemand+'</td><td>'+q[f].duplicates+'</td></tr>')).join('')+'</table></div><p>'+quality.map(q => q.city+': '+q.reviewed+'/'+q.cases+' page cases reviewed against sources; '+q.reviewedRetained+'/'+q.reviewedExpected+' reviewed expected events kept by Luna, '+q.reviewedBaselineRetained+'/'+q.reviewedExpected+' by Sonnet.').join(' ')+'</p><details><summary>Source-based findings</summary><ul>'+rows.filter(r => r.reviewStatus === 'reviewed').map(r => '<li>'+escape(r.review.notes)+'</li>').join('')+'</ul></details></section>';
  const changesTable = '<section><h2>Changed websites and extra discoveries</h2><p>'+sourceChanges.length+' exact page URLs overlap the saved and live evidence; '+sourceChanges.filter(x => x.pageTextChanged).length+' have different text. A changed page is not proof of changed event dates or a new announcement. Extra discoveries remain separate from missed historical events and require source review before they can be called newly announced.</p><details><summary>Comparable pages</summary><ul>'+sourceChanges.map(x => '<li>'+escape(x.url)+' — '+(x.pageTextChanged ? 'text changed' : 'same saved text')+'</li>').join('')+'</ul></details></section>';
  const omittedTable = report.livePageOmissions.length ? '<section><h2>Live sources that could not be fully checked</h2><p>'+report.livePageOmissions.length+' source omissions or source-limit groups. These reduce coverage and remain unresolved.</p><details><summary>Show sources and reasons</summary><ul>'+report.livePageOmissions.map(o => '<li>'+escape(o.city+' / '+o.window+': '+o.reason+' '+(o.url ?? (o.omitted ?? []).join(', ')))+'</li>').join('')+'</ul></details></section>' : '';
  const table = rows.map(r => `<tr><td>${escape(r.city)}</td><td>${escape(taskName(r.task))}<br><small>${escape(({holdout: "Final test", preparation: "Preparation", fresh: "Live search", verification: "Live page"})[r.split] ?? r.split)}</small></td><td>${escape(r.status)}</td><td>${r.reviewStatus === "reviewed" ? "Reviewed" : "Needs review"}</td><td>${r.retained}/${r.expected}</td><td>${money(r.baselineBatchCost?.total)}</td><td>${money(r.cost?.total)}</td><td><details><summary>Evidence and differences</summary><pre>${escape(JSON.stringify({ source: r.source, failureReason: r.failureReason, review: r.review, baseline: r.baseline, luna: r.luna, missing: r.missing, added: r.added, mismatches: r.mismatches, assessmentDifferences: r.assessmentDifferences }, null, 2))}</pre></details></td></tr>`).join('');
  writeFileSync(join(dir, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Luna comparison</title><style>body{font:16px system-ui;margin:40px auto;max-width:1200px;padding:0 24px;color:#17253b;background:#f5f7fb}h1{font-size:36px}section{background:white;border:1px solid #dce3ed;border-radius:12px;padding:24px;margin:20px 0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:450px;overflow:auto;max-width:430px}small{color:#657189}a{color:#135ab0}.scroll{overflow:auto}</style><h1>Luna comparison</h1><p>Research quality and complete costs, assessed separately.</p><section><h2>Decision</h2><p>Sonnet: <strong>${escape(decisions.sonnet.decision)}</strong> · Haiku: <strong>${escape(decisions.haiku.decision)}</strong></p><ul>${[...new Set([...decisions.sonnet.reasons, ...decisions.haiku.reasons])].map(x => `<li>${escape(x)}</li>`).join('')}</ul></section><section><h2>New spending</h2><p><strong>${money(spending.known)}</strong> usage-priced total · ${money(spending.reserved)} reserved · $20 ceiling</p><p>Processing ${money(spending.processing)} · Web actions ${money(spending.searches)} · Unsuccessful requests included ${money(spending.unsuccessfulKnown)}</p></section><section><h2>Monthly costs</h2><p>${escape(monthly.available ? 'Modeled from complete shared-area costs; broad work included once. New-hotel work excluded.' : monthly.reason)}</p><table><tr><th>Option</th><th>Estimated monthly cost</th></tr>${(monthly.available ? monthly.options : ['Keep Sonnet and Haiku', 'Replace only Haiku', 'Replace only Sonnet', 'Replace both'].map(option => ({ option, estimate: null }))).map(x => `<tr><td>${escape(x.option)}</td><td>${money(x.estimate)}</td></tr>`).join('')}</table></section>${taskTable}${qualityTable}${freshTable}${changesTable}${omittedTable}${repeatTable}<section><h2>Case comparison</h2><p>Retention counts remain provisional until source review. <a href="comparison.csv" download>Download comparison table</a> · <a href="report.json">Underlying results</a></p><div class="scroll"><table><tr><th>City</th><th>Task</th><th>Progress</th><th>Review</th><th>Retained</th><th>Baseline batch equivalent</th><th>Luna</th><th>Details</th></tr>${table}</table></div></section><section><h2>What this can and cannot prove</h2><ul>${[...manifest.limitations, ...report.caveats].map(x => `<li>${escape(x)}</li>`).join('')}</ul></section></html>`);
  return report;
}
