import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyEvents, discoverEvents, priorityTargets } from '../lib/check.mjs';

/**
 * On-demand refresh endpoint.
 *
 *   GET /api/refresh?mode=verify           re-check dates and costs
 *   GET /api/refresh?mode=verify&limit=3   quick probe, finishes fast
 *   GET /api/refresh?mode=discover         look for events not yet tracked
 *
 * Works to a time budget. Each batch makes several live web searches, so the
 * full set will not always finish inside the platform's function limit.
 * Rather than being killed mid-run — which makes the platform return an HTML
 * error page the browser cannot parse — this returns whatever completed and
 * reports the remainder as pending.
 */

// Vercel caps functions at 60s on Hobby, 300s on Pro. Stop short of the cap
// so there is time left to serialise a response.
const LIMIT_MS = Number(process.env.REFRESH_BUDGET_MS || 45_000);
const BATCH = 3;

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const params = new URL(req.url, 'http://x').searchParams;

  const gate = process.env.REFRESH_TOKEN;
  if (gate) {
    const supplied = req.headers['x-refresh-token'] || params.get('token');
    if (supplied !== gate) {
      return res.status(401).json({ error: 'Missing or incorrect refresh token.' });
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not configured on this deployment. Add it in Vercel under Settings → Environment Variables, then redeploy.'
    });
  }

  const started = Date.now();
  const mode = params.get('mode') || 'verify';

  try {
    const raw = await readFile(join(process.cwd(), 'data', 'events.json'), 'utf8');
    const { events } = JSON.parse(raw);

    if (mode === 'discover') {
      const found = await discoverEvents(events);
      return res.status(200).json({
        mode, checkedAt: new Date().toISOString(), found,
        elapsedMs: Date.now() - started
      });
    }

    // Default 9 rather than 12 — three batches usually fit inside 45 seconds.
    // Narrow it further with ?limit=3 when probing.
    const cap = Math.min(Number(params.get('limit')) || 9, 24);
    const targets = priorityTargets(events, cap);

    const results = [];
    let pending = 0;

    for (let i = 0; i < targets.length; i += BATCH) {
      if (Date.now() - started > LIMIT_MS) { pending = targets.length - i; break; }
      results.push(...await verifyEvents(targets.slice(i, i + BATCH), { batchSize: BATCH }));
    }

    return res.status(200).json({
      mode,
      checkedAt: new Date().toISOString(),
      checked: results.length,
      flagged: results.filter(r => r.status !== 'same' && r.status !== 'error').length,
      pending,
      truncated: pending > 0,
      elapsedMs: Date.now() - started,
      results
    });
  } catch (err) {
    // Always answer in JSON so the page can show something useful.
    return res.status(500).json({
      error: err.message, stage: 'handler', elapsedMs: Date.now() - started
    });
  }
}

export const config = { maxDuration: 60 };
