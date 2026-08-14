# RugCanary

A Solana token safety checker. Paste a token address, get a clear
plain-language safety report — no gimmicky numeric score.

## Structure

```
rugcanary/
  server/               Node.js/Express API
    src/
      index.js           App entry, static file serving
      config.js           Env var loading / Helius URL construction
      routes/
        scan.js            POST /api/scan
        waitlist.js         POST /api/waitlist
        publicConfig.js     GET /api/config (public PostHog key)
      services/
        solanaConnection.js  Shared Helius RPC connection
        solanaChecks.js       Mint/freeze authority checks (LP lock + holder
                               concentration land here next)
        riskSummary.js         Turns check results into "X of Y passed"
        analytics.js            PostHog server-side event capture
      db/
        waitlist.js             SQLite-backed waitlist table
    data/                  SQLite file lives here (gitignored)
    .env.example
  client/                Static single-page frontend (no build step)
    index.html
    style.css
    app.js
```

## Setup

```bash
cd rugcanary/server
cp .env.example .env
# fill in HELIUS_API_KEY (or HELIUS_RPC_URL) and, optionally, POSTHOG_API_KEY
npm install
npm start
```

Then open http://localhost:3001 — the Express server serves the client
directly, so there's no separate frontend dev server needed.

## What's implemented (Phase 1, in progress)

- [x] Mint authority check (revoked / still active)
- [x] Freeze authority check (revoked / still active)
- [ ] LP lock status, duration, provider
- [ ] Top 10-20 holder concentration
- [x] Plain-language summary ("N of M safety checks passed")
- [x] Waitlist email capture (SQLite table)
- [x] PostHog analytics wiring (scan_completed, waitlist_signup, + client
      pageview autocapture for the visitor step of the funnel)
- [x] Single-page frontend with screenshot-friendly results card
- [ ] "Coming Soon" feature previews — done, ships with the checks above

## Notes

- Never commit a real Helius or PostHog key. `.env` is gitignored;
  `.env.example` documents the shape.
- `checkMintAndFreezeAuthority` reads both authorities off a single
  `getParsedAccountInfo` call — one RPC round trip covers both checks.
- The risk summary is deliberately not a 0-100 score. It reports
  `passed`/`total` plus an `overall` bucket (`low` / `medium` / `high`)
  derived from how many hard checks failed.
