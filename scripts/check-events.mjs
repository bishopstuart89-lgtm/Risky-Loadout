#!/usr/bin/env node
/**
 * Weekly conference check. Run by .github/workflows/weekly-check.yml.
 *
 *   node scripts/check-events.mjs
 *
 * Reads  data/events.json
 * Writes data/verification.json
 *
 * It never edits events.json. Findings go into the sidecar file, the workflow
 * opens a pull request, and a human decides what to accept. Automated date
 * scraping gets things wrong often enough that the gate is worth keeping.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { verifyEvents, discoverEvents, priorityTargets } from '../lib/check.mjs';

const log = msg => console.log(msg);

const CAP = Number(process.env.CHECK_CAP || 24);
const SKIP_DISCOVERY = process.env.SKIP_DISCOVERY === 'true';

const raw = await readFile('data/events.json', 'utf8');
const { events } = JSON.parse(raw);

log(`Loaded ${events.length} events.`);

const targets = priorityTargets(events, CAP);
log(`Verifying ${targets.length} priority events…\n`);

const results = await verifyEvents(targets, { onProgress: log });

let found = [];
if (!SKIP_DISCOVERY) {
  log('\nSweeping directories for new events…');
  try {
    found = await discoverEvents(events);
    found.forEach(f => log(`  + ${f.name} — ${f.dates} — ${f.location}`));
    if (!found.length) log('  none beyond what is already tracked');
  } catch (err) {
    log(`  × discovery failed: ${err.message}`);
  }
}

const flagged = results.filter(r => r.status === 'changed' || r.status === 'unclear');
const errored = results.filter(r => r.status === 'error');

const payload = {
  checkedAt: new Date().toISOString(),
  model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  summary: {
    checked: results.length,
    unchanged: results.filter(r => r.status === 'same').length,
    changed: results.filter(r => r.status === 'changed').length,
    unclear: results.filter(r => r.status === 'unclear').length,
    errors: errored.length,
    newCandidates: found.length
  },
  results,
  newCandidates: found
};

await writeFile('data/verification.json', JSON.stringify(payload, null, 2) + '\n');

log(`\n${payload.summary.checked} checked · ${payload.summary.changed} changed · ` +
    `${payload.summary.unclear} unclear · ${found.length} possible additions`);

// Signals to the workflow whether a pull request is worth opening.
const worthReview = flagged.length > 0 || found.length > 0;
if (process.env.GITHUB_OUTPUT) {
  const { appendFile } = await import('node:fs/promises');
  await appendFile(process.env.GITHUB_OUTPUT, `changes=${worthReview}\n`);
  const headline = worthReview
    ? `${payload.summary.changed} changed, ${payload.summary.unclear} unclear, ${found.length} new`
    : 'no changes detected';
  await appendFile(process.env.GITHUB_OUTPUT, `headline=${headline}\n`);
}

// Do not fail the run on individual lookup errors — a flaky search should not
// turn into a red build. Only a total failure is worth failing on.
if (errored.length && errored.length === results.length) {
  console.error('Every lookup failed. Check ANTHROPIC_API_KEY and the model name.');
  process.exit(1);
}
