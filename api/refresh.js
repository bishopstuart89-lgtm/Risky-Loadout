import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyEvents, discoverEvents, priorityTargets } from '../lib/check.mjs';

/**
 * On-demand refresh endpoint.
 *
 *   GET /api/refresh?mode=verify    re-check dates and costs
 *   GET /api/refresh?mode=discover  look for events not yet tracked
 *
 * If REFRESH_TOKEN is set in the environment, callers must send it as
 * ?token= or an x-refresh-token header. Set it if the site is public —
 * otherwise anyone can spend your API credit by holding down the button.
 *
 * This function does not write anything. Results are returned to the caller
 * and shown for that session only. Durable updates come from the weekly
 * GitHub Actions run, which commits data/verification.json.
 */
export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const gate = process.env.REFRESH_TOKEN;
  if (gate) {
    const supplied = req.headers['x-refresh-token'] ||
      new URL(req.url, 'http://x').searchParams.get('token');
    if (supplied !== gate) {
      return res.status(401).json({ error: 'Missing or incorrect refresh token.' });
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not configured on this deployment. Add it in Vercel under Settings → Environment Variables, then redeploy.'
    });
  }

  const mode = new URL(req.url, 'http://x').searchParams.get('mode') || 'verify';

  try {
    const raw = await readFile(join(process.cwd(), 'data', 'events.json'), 'utf8');
    const { events } = JSON.parse(raw);

    if (mode === 'discover') {
      const found = await discoverEvents(events);
      return res.status(200).json({ mode, checkedAt: new Date().toISOString(), found });
    }

    // Capped at 12 per request to stay inside the Vercel function timeout.
    // The weekly Actions run has no such limit and covers more.
    const targets = priorityTargets(events, 12);
    const results = await verifyEvents(targets);
    return res.status(200).json({
      mode,
      checkedAt: new Date().toISOString(),
      checked: results.length,
      flagged: results.filter(r => r.status !== 'same').length,
      results
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Verification makes several sequential searches, so it needs more than the
// 10s default. 60s is the Hobby-plan ceiling; Pro allows up to 300.
export const config = { maxDuration: 60 };
