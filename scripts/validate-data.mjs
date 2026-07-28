#!/usr/bin/env node
/**
 * Sanity-check data/events.json before it ships.
 *   npm run validate
 * Run it after editing the register by hand. Catches the mistakes that would
 * otherwise show up as a blank table in production.
 */
import { readFile } from 'node:fs/promises';

const REQUIRED = ['n', 'd', 'c', 'cost', 'cat', 't', 'st', 'note'];
const TIERS = [1, 2, 3];
const STATUSES = ['ok', 'warn', 'tbc'];

const problems = [];
const warnings = [];

let data;
try {
  data = JSON.parse(await readFile('data/events.json', 'utf8'));
} catch (err) {
  console.error('events.json is not valid JSON:', err.message);
  process.exit(1);
}

const { categories, events } = data;
if (!categories || !events) {
  console.error('events.json must contain "categories" and "events".');
  process.exit(1);
}

const seenIds = new Set();
const seenNames = new Set();

events.forEach((e, i) => {
  const where = `events[${i}] ${e.n ? `"${e.n}"` : '(unnamed)'}`;

  for (const f of REQUIRED) {
    if (e[f] === undefined || e[f] === '') problems.push(`${where}: missing "${f}"`);
  }
  if (!e.id) problems.push(`${where}: missing "id"`);
  else if (seenIds.has(e.id)) problems.push(`${where}: duplicate id "${e.id}"`);
  else seenIds.add(e.id);

  if (seenNames.has(e.n)) warnings.push(`${where}: duplicate name`);
  else seenNames.add(e.n);

  if (!categories[e.cat]) problems.push(`${where}: category "${e.cat}" is not defined`);
  if (!TIERS.includes(e.t)) problems.push(`${where}: t must be 1, 2 or 3 (got ${e.t})`);
  if (!STATUSES.includes(e.st)) problems.push(`${where}: st must be ok, warn or tbc (got ${e.st})`);

  if (e.s !== null && e.s !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.s)) problems.push(`${where}: s must be YYYY-MM-DD or null`);
    else if (Number.isNaN(Date.parse(e.s))) problems.push(`${where}: s is not a real date`);
  } else if (e.st === 'ok') {
    warnings.push(`${where}: no sort date but marked as confirmed — it will not appear in the departures board or date filters`);
  }

  if (e.e && e.s && e.e < e.s) problems.push(`${where}: end date is before start date`);
  if (e.u && !/^https?:\/\//.test(e.u)) problems.push(`${where}: u must be a full URL or null`);
  if (e.note && e.note.length > 400) warnings.push(`${where}: note is very long (${e.note.length} chars)`);
});

const used = new Set(events.map(e => e.cat));
for (const k of Object.keys(categories)) {
  if (!used.has(k)) warnings.push(`category "${k}" has no events`);
}

console.log(`${events.length} events, ${Object.keys(categories).length} categories.`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  warnings.forEach(w => console.log('  - ' + w));
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  problems.forEach(p => console.error('  ! ' + p));
  process.exit(1);
}
console.log('\nAll checks passed.');
