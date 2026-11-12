import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyEvents, discoverEvents, priorityTargets } from '../lib/check.mjs';

/**
 * On-demand refresh endpoint.
 *
 *   GET /api/refresh?mode=targets          list what needs checking (no API call, instant)
 *   GET /api/refresh?mode=verify&id=eN     verify ONE event
 *   GET /api/refresh?mode=discover         look for events not yet tracked
 *
 * One event per request, deliberately.
 *
 * A single verification makes several live web searches server-side and can
 * take anywhere from fifteen seconds to over a minute. Batching them into one
 * request meant the function was routinely killed at the platform's 60s
 * ceiling, and a killed function returns an HTML error page rather than JSON.
 * The page now drives the loop instead, calling this once per event, which
 * also means progress appears as it happens rather than after a long wait.
 */

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const params = new URL(req.url, 'http://x').searchParams;
  const mode = params.get('mode') || 'targets';

  const gate = process.env.REFRESH_TOKEN;
  if (gate) {
    const supplied = req.headers['x-refresh-token'] || params.get('token');
    if (supplied !== gate) {
      return res.status(401).json({ error: 'Missing or incorrect refresh token.' });
    }
  }

  const started = Date.now();

  let events;
  try {
    const raw = await readFile(join(process.cwd(), 'data', 'events.json'), 'utf8');
    ({ events } = JSON.parse(raw));
  } catch (err) {
    return res.status(500).json({ error: 'Could not read data/events.json: ' + err.message });
  }

  // Listing targets needs no API key and no network, so it is handled before
  // the key check and always returns fast.
  if (mode === 'targets') {
    const cap = Math.min(Number(params.get('limit')) || 24, 40);
    return res.status(200).json({
      mode,
      targets: priorityTargets(events, cap).map(e => ({ id: e.id, n: e.n }))
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not configured on this deployment. Add it in Vercel under Settings → Environment Variables, then redeploy.'
    });
  }

  try {
    if (mode === 'discover') {
      const found = await discoverEvents(events);
      return res.status(200).json({
        mode, checkedAt: new Date().toISOString(), found, elapsedMs: Date.now() - started
      });
    }

    if (mode === 'verify') {
      const id = params.get('id');
      if (!id) return res.status(400).json({ error: 'verify needs an id. Call mode=targets first.' });

      const event = events.find(e => e.id === id);
      if (!event) return res.status(404).json({ error: 'No event with id ' + id });

      const [result] = await verifyEvents([event], { batchSize: 1 });
      return res.status(200).json({
        mode, checkedAt: new Date().toISOString(),
        result, elapsedMs: Date.now() - started
      });
    }

    return res.status(400).json({ error: 'Unknown mode: ' + mode });
  } catch (err) {
    return res.status(500).json({ error: err.message, elapsedMs: Date.now() - started });
  }
}

// 60s is the Vercel Hobby ceiling and 300s the Pro ceiling. One event
// comfortably fits inside 60s; the value below is raised automatically on Pro.
export const config = { maxDuration: 60 };
