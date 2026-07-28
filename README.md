# CCJPA Conference Register

Internal register of conferences relevant to Capitol Corridor operations: digital train
communications and onboard connectivity, fare payment and ticketing, and the wider rail
sector. 79 events, filterable, with links through to each organiser.

Static site plus one serverless function. No framework, no build step, no database.

---

## Layout

```
index.html                        the site — reads data/events.json at runtime
data/events.json                  source of truth for the register. Edit this file.
data/verification.json            written by the weekly check. Absent until it first runs.
api/refresh.js                    serverless endpoint for on-demand checks
lib/check.mjs                     shared verification logic (API route + cron script)
scripts/check-events.mjs          the weekly checker
scripts/validate-data.mjs         sanity-checks events.json before deploy
.github/workflows/weekly-check.yml  Monday 07:00 UTC schedule
vercel.json                       cache and security headers
```

## Deploying to Vercel

1. Push this directory to a Git repository.
2. In Vercel, **Add New → Project**, import the repo. No framework preset — leave the
   build command and output directory blank. Vercel serves the root statically and treats
   `api/` as functions.
3. Under **Settings → Environment Variables**, add:

   | Name | Required | Notes |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | yes | From console.anthropic.com. Server-side only. |
   | `REFRESH_TOKEN` | if public | Any random string. See below. |
   | `CLAUDE_MODEL` | no | Override if the default model string is retired. |

4. Redeploy so the variables take effect.

### About the API key

The key lives only in Vercel's environment and is read inside `api/refresh.js`. It is never
sent to the browser. Do not move those `fetch` calls into `index.html` — that would publish
the key to anyone who opens developer tools.

### About `REFRESH_TOKEN`

If the site is reachable without authentication, set it. The refresh endpoint then requires
`?token=…`, and you open the page as
`https://your-site.vercel.app/?token=THE_SAME_VALUE`. Without it, anyone who finds the URL
can run searches against your API credit.

Better still, put the whole deployment behind Vercel Authentication
(**Settings → Deployment Protection**) so only your team can reach it, and leave the token
unset.

## The weekly check

`.github/workflows/weekly-check.yml` runs every Monday at 07:00 UTC. It:

1. re-checks dates, location and cost for the shortlist plus anything with unconfirmed
   dates (24 events by default),
2. sweeps the industry directories for events not already tracked,
3. writes `data/verification.json`,
4. opens a pull request if anything changed, or commits quietly if nothing did.

Add `ANTHROPIC_API_KEY` as a repository secret under
**Settings → Secrets and variables → Actions**. Merging the pull request triggers a Vercel
deploy, and the site picks up the new findings automatically.

Run it by hand any time from the **Actions** tab, or locally:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run check              # verify + look for new events
npm run check:verify-only  # skip discovery, cheaper
```

### Why it opens a pull request instead of editing the register

`scripts/check-events.mjs` never writes to `events.json`. It writes findings to a sidecar
file and asks a human to apply them. This is deliberate:

- Organisers publish inconsistent dates. Three entries in this register already disagree
  across sources, including UITP's own site disagreeing with its own venue page.
- The checker will sometimes read an aggregator listing as authoritative when the organiser
  says something different.
- People book non-refundable travel against these dates.

Treat every finding as a lead to confirm on the organiser's own site, not a fact.

## Editing the register

Everything lives in `data/events.json`. One object per event:

```json
{
  "id": "e79",
  "n": "Event name",
  "s": "2027-03-16",
  "e": "2027-03-17",
  "d": "16–17 Mar 2027",
  "c": "Olympia London, UK",
  "cost": "Free for operators and authorities",
  "cat": "ticketing",
  "t": 1,
  "st": "ok",
  "u": "https://organiser.example/event",
  "note": "Why this matters to CCJPA."
}
```

| Field | Meaning |
|---|---|
| `id` | Unique. Keep it stable — verification results are keyed on it. |
| `s`, `e` | Machine dates for sorting and filtering. `null` if unknown. |
| `d` | Human-readable dates, shown in the table. |
| `cat` | Must match a key in `categories`. |
| `t` | Relevance: `1` shortlist, `2` relevant, `3` reference only. |
| `st` | Date confidence: `ok` confirmed, `warn` sources disagree, `tbc` not published. |
| `u` | Organiser URL, or `null` to show a search link instead. |

Use `null` for `u` rather than guessing a URL. A wrong link is worse than a search box.

After editing:

```bash
npm run validate
```

It catches missing fields, unknown categories, duplicate ids, malformed dates and end dates
that fall before start dates. Add it as a required check on pull requests if you want it
enforced.

## Known gaps in the data

Carried over from the original compilation, and worth revisiting:

- Roughly two thirds of entries have no published registration cost. Normal for this sector.
- Three date conflicts are marked `warn`: Contactless Payments for Transit US
  (Sep vs Oct 2026), the UITP Summit 2027, and the next Railway Interchange edition.
- Vendor-run user conferences are not tracked at all — Xentrans, Littlepay, Nomad Digital
  and Zoho each run their own, and those are often the cheapest and most directly useful
  sessions available.
- Payments-industry events outside transit are mostly excluded.

## Cost

The weekly run makes roughly 9 API calls with web search enabled. At current pricing that is
cents per week, not dollars. On-demand checks from the site cost the same per press. If the
site is public and unprotected, that arithmetic changes — set `REFRESH_TOKEN`.

## Local development

```bash
npx vercel dev
```

Needs `.env.local` with `ANTHROPIC_API_KEY` for the refresh endpoint to work. Copy
`.env.example` as a starting point. The static page works without it; only the two refresh
buttons need the key.
