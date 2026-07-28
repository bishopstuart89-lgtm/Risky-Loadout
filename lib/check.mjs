/**
 * Shared conference-verification logic.
 * Used by api/refresh.js (on demand, from the site) and
 * scripts/check-events.mjs (weekly, from GitHub Actions).
 *
 * The Anthropic API key is only ever read from the environment here.
 * It must never reach the browser.
 */

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

async function ask(prompt, { maxTokens = 2000 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }]
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  // Responses interleave text, server_tool_use and web_search_tool_result
  // blocks. Only the text blocks carry the answer.
  return (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

function parseJsonArray(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  const open = clean.indexOf('[');
  const close = clean.lastIndexOf(']');
  if (open === -1 || close === -1) throw new Error('No JSON array in response');
  return JSON.parse(clean.slice(open, close + 1));
}

/**
 * Verify dates, location and cost for a set of events.
 * Returns [{ id, name, status, dates, cost, note }]
 * status: 'same' | 'changed' | 'unclear' | 'error'
 */
export async function verifyEvents(events, { batchSize = 3, onProgress } = {}) {
  const results = [];

  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    onProgress?.(`Checking ${batch.map(e => e.n).join(' / ')}`);

    const prompt =
`Verify each conference below using web search. For each one, find the current official dates, city and published registration cost. Prefer the organiser's own site over aggregator listings.

${batch.map(e => `${e.id} | ${e.n} | recorded as: ${e.d}, ${e.c}, cost: ${e.cost}`).join('\n')}

Respond with ONLY a JSON array. No prose, no markdown fences.
[{"id":"eN","status":"same"|"changed"|"unclear","dates":"","cost":"","source":"","note":""}]

Rules:
- "same" when the recorded dates still match what you find.
- "changed" when dates, location or cost differ. Put what you found in "dates" and "cost".
- "unclear" when search results do not settle it. Explain briefly in "note".
- "source" is the URL you relied on.
- Keep "note" under 25 words and only include it when something differs or is uncertain.`;

    try {
      const parsed = parseJsonArray(await ask(prompt));
      for (const r of parsed) {
        const src = batch.find(e => e.id === r.id);
        results.push({
          id: r.id,
          name: src?.n ?? r.id,
          status: r.status || 'unclear',
          dates: r.dates || '',
          cost: r.cost || '',
          source: r.source || '',
          note: r.note || ''
        });
        onProgress?.(r.status === 'same'
          ? `  · ${src?.n} unchanged`
          : `  ! ${src?.n} — ${[r.dates, r.cost, r.note].filter(Boolean).join(' · ')}`);
      }
    } catch (err) {
      onProgress?.(`  × batch failed: ${err.message}`);
      for (const e of batch) {
        results.push({ id: e.id, name: e.n, status: 'error', note: err.message.slice(0, 120) });
      }
    }
  }

  return results;
}

/**
 * Sweep the industry directories for events not already tracked.
 * Returns [{ name, dates, location, url, relevance }]
 */
export async function discoverEvents(events, { limit = 8 } = {}) {
  const known = events.map(e => e.n).join('; ');

  const prompt =
`Use web search across railway-news.com/events-exhibitions, progressiverailroading.com/industryevents, railpersonnel.com/events and organiser sites to find rail, transit, ticketing or fare-payment conferences taking place between now and March 2028 that are NOT already in this list:

${known}

Respond with ONLY a JSON array. No prose, no markdown fences.
[{"name":"","dates":"","location":"","url":"","relevance":""}]

"relevance" is one short sentence on the value to a US intercity passenger rail agency working on open-loop contactless fare payment, onboard Wi-Fi and operations. Return at most ${limit} genuinely new events. Return [] if there are none.`;

  return parseJsonArray(await ask(prompt, { maxTokens: 2000 }));
}

/** Events worth re-checking: the shortlist, anything relevant, anything unconfirmed. */
export function priorityTargets(events, cap = 20) {
  return events
    .filter(e => e.t <= 2 || e.st !== 'ok')
    .sort((a, b) => (a.s || '9999').localeCompare(b.s || '9999'))
    .slice(0, cap);
}
