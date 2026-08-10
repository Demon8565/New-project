# Sol Sniper — Phase 1: Detection + Safety Filter

**Status: all checks implemented and unit-tested for BOTH Raydium and pump.fun. Paper trading only — no real trades execute from this code (`CONFIG.PAPER_TRADE` is hard-coded `true`).**

## Architecture: one shared filter core, two detectors

Not two separate bots. `evaluateCandidate()` is a single shared pipeline that both sources feed into — same mint/freeze authority checks, same holder concentration logic, same creator history check. Only detection (how a new token is spotted) and the liquidity-equivalent check differ by source, controlled by a `source: 'raydium' | 'pumpfun'` field on each candidate. This means any future bug fix or threshold change only has to happen once.

## Your agreed thresholds

| Threshold | Raydium | Pump.fun |
|---|---|---|
| Min liquidity | 10 SOL (pool reserve) | 5 SOL (real curve reserves) |
| Max pool/token age at buy | 2 minutes | 2 minutes |
| Max non-pool holder concentration | 20% | 20% |
| LP burned/locked | ≥90% required | N/A (no LP pre-graduation) |

## What's implemented and tested

| Check | Type | Applies to | Status |
|---|---|---|---|
| `checkMintAuthority` | hard | both | ✅ real |
| `checkFreezeAuthority` | hard | both | ✅ real |
| `checkPoolAge` | hard | both | ✅ real |
| `checkHolderConcentration` | hard | both | ✅ real + tested (5 cases) |
| `checkLiquidity` | hard | raydium only | ✅ real + tested (5 cases) — Raydium public API |
| `checkLpLockedOrBurned` | hard | raydium only | ✅ real + tested (6 cases) |
| `checkBondingCurveLiquidity` | hard | pumpfun only | ✅ real + tested (6 cases) — reads real (not virtual) SOL reserves from the curve account |
| `checkCreatorHistory` | soft/informational | both | ✅ real + tested (4 cases) |
| Raydium listener + extraction | — | raydium | ⚠️ implemented, **UNVERIFIED account layout** |
| Pump.fun listener + extraction | — | pumpfun | ⚠️ implemented, **UNVERIFIED account layout AND curve byte layout** |

26 unit test cases across 5 files, all passing, plus an end-to-end smoke test confirming both sources correctly flow through `evaluateCandidate()` (including pump.fun's `lpLocked` check correctly reporting "N/A" instead of blocking a candidate that has no LP yet).

## Design decisions worth knowing about

- **Pump.fun's liquidity check uses `realSolReserves`, not `virtualSolReserves`.** The virtual figure includes pump.fun's built-in curve-math offset and would overstate actual buyer-contributed SOL. Getting this wrong would make every curve look more liquid than it is.
- **A freshly-created curve will almost always fail the 5 SOL check immediately** — curves start at 0 and grow as people buy in. This is expected, not a bug. The listener logs it as a rejection with a clear reason; you may want to re-check candidates that failed *only* on liquidity as time passes, rather than treating an early rejection as permanent.
- **Graduated curves (`complete: true`) are explicitly rejected** by `checkBondingCurveLiquidity` with a clear reason — a graduated token has moved to Raydium and should be caught by the Raydium detector instead, not double-counted here.
- **Bug caught and fixed earlier:** the original `checkHolderConcentration` excluded the LP mint instead of the pool's actual token vault — would've been a silent no-op. Now takes `poolTokenVaultAddresses`, supplied by each detector.

## ⚠️ Two things NOT yet verified — do this before running live

Both listeners extract addresses **by position** in an instruction's account list. Both layouts came from public documentation, written with zero live network access to confirm against mainnet reality. This is the one failure mode fail-safe logic can't catch — wrong data flowing through correct logic looks identical to correct data from outside.

**1. Raydium `initialize2` layout:**
```bash
export HELIUS_RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
node verify_account_layout.js <a_real_raydium_pool_creation_tx_signature>
```

**2. Pump.fun `create` instruction + bonding curve byte layout:**
```bash
node verify_pumpfun_layout.js <a_real_pumpfun_create_tx_signature>
```
This one does double duty — it checks both the instruction account order AND decodes a real bonding curve account so you can sanity-check that `realSolReserves` prints a plausible number.

Also still unverified: the Streamflow program ID in `KNOWN_LOCKER_PROGRAMS` (used by `checkLpLockedOrBurned`).

Get real transaction signatures from Solscan by searching either program ID:
- Raydium AMM V4: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`
- Pump.fun: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`

If a printed layout doesn't match the assumed indices, update `INITIALIZE2_ACCOUNT_INDEX`, `PUMPFUN_CREATE_ACCOUNT_INDEX`, or `BONDING_CURVE_LAYOUT` in `sniper_filter.js` before trusting output.

## Setup

```bash
npm install
export HELIUS_RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
node verify_account_layout.js <raydium_signature>     # do this first
node verify_pumpfun_layout.js <pumpfun_signature>      # and this
node sniper_filter.js                                   # then run both listeners
```

Never hardcode your Helius key — always pass it as an env var/secret.

## Recommended path from here

1. Run both verification scripts against real recent transactions, fix any index mismatches.
2. Run `sniper_filter.js` live in Codespaces, paper mode only, and watch `candidates_log.jsonl` for both `source: "raydium"` and `source: "pumpfun"` entries for a day or two.
3. Given pump.fun's higher rug rate, consider watching its candidate log specifically before trusting it as much as the Raydium side — you may want a stricter holder-concentration or creator-history bar for pump.fun once you see real data.
4. Once you trust the candidate stream from both sources, that's when Phase 2 (paper-trade execution engine) makes sense.
