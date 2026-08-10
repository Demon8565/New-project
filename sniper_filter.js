/**
 * sniper_filter.js
 * -----------------------------------------------------------------------
 * PHASE 1: Detection + Safety Filter (PAPER TRADING ONLY — NO REAL TRADES)
 * -----------------------------------------------------------------------
 * Watches for new Raydium/pump.fun pool creations on Solana, runs each
 * candidate through hard + soft safety filters, and logs the ones that
 * pass to candidates_log.jsonl for review. Nothing here spends real SOL.
 *
 * Thresholds (as agreed):
 *   - Min liquidity:        10 SOL
 *   - Max pool age to buy:  2 minutes (120,000 ms) from creation
 *   - Max non-LP holder %:  20%
 *
 * ENV VARS REQUIRED (set these as secrets, never hardcode):
 *   HELIUS_API_KEY   - your Helius API key
 *   HELIUS_RPC_URL   - e.g. https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
 *
 * Run:
 *   node sniper_filter.js
 * -----------------------------------------------------------------------
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------
const CONFIG = {
  HELIUS_RPC_URL: process.env.HELIUS_RPC_URL, // must be set as env secret
  MIN_LIQUIDITY_SOL: 10,
  MAX_POOL_AGE_MS: 2 * 60 * 1000, // 2 minutes
  MAX_HOLDER_PCT: 20, // reject if any single non-LP wallet holds > 20%
  LP_LOCK_MIN_PCT: 90, // at least this % of LP supply must be burned/locked to pass
  CREATOR_HISTORY_LOOKBACK: 25, // how many recent creator txs to scan (informational only)
  PUMPFUN_MIN_REAL_SOL: 5, // min real SOL reserves in bonding curve before sniping (agreed: moderate)
  LOG_FILE: path.join(__dirname, 'candidates_log.jsonl'),
  PAPER_TRADE: true, // HARD-CODED true for Phase 1. Do not flip until Phase 2/3.
};

// ⚠️ VERIFY THESE BEFORE RELYING ON THEM ⚠️
// Addresses that count as "burned" — LP tokens sent here are unspendable.
const KNOWN_BURN_ADDRESSES = new Set([
  '1nc1nerator11111111111111111111111111111111', // Solana's official incinerator address
]);
// Program IDs whose vaults count as "locked" — LP tokens held here are
// time-locked by a locker program rather than freely withdrawable by the
// creator. Verify this against Streamflow's current mainnet program ID
// before trusting it (protocol program IDs can change/add new versions).
const KNOWN_LOCKER_PROGRAMS = new Set([
  'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m', // Streamflow protocol — VERIFY before use
]);

// Well-known program IDs we watch for pool creation activity
const PROGRAM_IDS = {
  RAYDIUM_AMM_V4: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
  // pump.fun program id (bonding curve launches) — verify current value before use
  PUMP_FUN: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
};

if (!CONFIG.HELIUS_RPC_URL) {
  console.error('ERROR: HELIUS_RPC_URL env var is not set. Set it as a secret before running.');
  process.exit(1);
}

const connection = new Connection(CONFIG.HELIUS_RPC_URL, 'confirmed');

// ---------------------------------------------------------------------
// LOGGING HELPERS
// ---------------------------------------------------------------------
function logCandidate(entry) {
  fs.appendFileSync(CONFIG.LOG_FILE, JSON.stringify(entry) + '\n');
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------
// SAFETY FILTER FUNCTIONS
// Each returns { pass: boolean, reason: string, value?: any }
// These are STUBS with the correct shape / intended Helius calls marked.
// Fill in the TODOs with live Helius RPC / DAS API calls before going live.
// ---------------------------------------------------------------------

/**
 * Checks whether mint authority has been revoked (set to null).
 */
async function checkMintAuthority(mintAddress) {
  try {
    const mintInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
    const parsed = mintInfo?.value?.data?.parsed?.info;
    const mintAuthority = parsed?.mintAuthority;
    return {
      pass: mintAuthority === null,
      reason: mintAuthority === null ? 'Mint authority revoked' : 'Mint authority still active',
      value: mintAuthority,
    };
  } catch (err) {
    return { pass: false, reason: `Error checking mint authority: ${err.message}` };
  }
}

/**
 * Checks whether freeze authority has been revoked (set to null).
 */
async function checkFreezeAuthority(mintAddress) {
  try {
    const mintInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
    const parsed = mintInfo?.value?.data?.parsed?.info;
    const freezeAuthority = parsed?.freezeAuthority;
    return {
      pass: freezeAuthority === null,
      reason: freezeAuthority === null ? 'Freeze authority revoked' : 'Freeze authority still active',
      value: freezeAuthority,
    };
  } catch (err) {
    return { pass: false, reason: `Error checking freeze authority: ${err.message}` };
  }
}

/**
 * Checks whether LP tokens are burned or locked, by looking at the LP
 * mint's largest holder accounts and classifying each one:
 *   - owner is a known burn address        -> counts as burned
 *   - owner is a known locker program      -> counts as locked
 *   - anything else (incl. a normal wallet) -> counts as "free" (risky —
 *     the pool creator could pull liquidity at any time)
 *
 * Passes only if burned+locked accounts for >= CONFIG.LP_LOCK_MIN_PCT of
 * total LP supply. Any RPC error fails safe.
 */
async function checkLpLockedOrBurned(lpMintAddress) {
  try {
    const lpMintPubkey = new PublicKey(lpMintAddress);

    const supplyInfo = await connection.getTokenSupply(lpMintPubkey);
    const totalSupply = supplyInfo?.value?.uiAmount;
    if (!totalSupply || totalSupply <= 0) {
      return { pass: false, reason: 'Could not read LP mint total supply — failing safe' };
    }

    const largest = await connection.getTokenLargestAccounts(lpMintPubkey);
    const holderAccounts = largest?.value || [];
    if (holderAccounts.length === 0) {
      return { pass: false, reason: 'No LP holder accounts found — failing safe' };
    }

    let lockedOrBurnedAmount = 0;
    const breakdown = [];

    for (const holder of holderAccounts) {
      // Each holder here is a TOKEN ACCOUNT address, not a wallet — we need
      // its owner to know who actually controls those LP tokens.
      const accountInfo = await connection.getParsedAccountInfo(new PublicKey(holder.address));
      const owner = accountInfo?.value?.data?.parsed?.info?.owner;
      const amount = holder.uiAmount || 0;

      let classification = 'free';
      if (owner && KNOWN_BURN_ADDRESSES.has(owner)) {
        classification = 'burned';
        lockedOrBurnedAmount += amount;
      } else if (owner && KNOWN_LOCKER_PROGRAMS.has(owner)) {
        classification = 'locked';
        lockedOrBurnedAmount += amount;
      }

      breakdown.push({ account: holder.address, owner, amount, classification });
    }

    const lockedPct = (lockedOrBurnedAmount / totalSupply) * 100;

    return {
      pass: lockedPct >= CONFIG.LP_LOCK_MIN_PCT,
      reason: `${lockedPct.toFixed(1)}% of LP supply burned/locked (min ${CONFIG.LP_LOCK_MIN_PCT}%)`,
      value: { lockedPct, breakdown },
    };
  } catch (err) {
    return { pass: false, reason: `Error checking LP lock: ${err.message} — failing safe` };
  }
}

// Wrapped SOL mint — used to identify which side of a pool is the SOL reserve
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const RAYDIUM_POOL_INFO_URL = 'https://api-v3.raydium.io/pools/info/ids';

/**
 * Checks pool liquidity in SOL terms via Raydium's public pool-info API.
 *
 * Why the API instead of parsing the raw AMM account bytes: Raydium's
 * on-chain layout has changed across versions, and a wrong byte-offset
 * guess would silently produce a garbage number instead of an error.
 * Their API returns the same reserve figures their own UI uses, and a
 * network/parsing failure here throws instead of returning a bogus value
 * — so this still fails safe.
 *
 * NOTE: this makes a live HTTP call. If Raydium's API is down or the pool
 * isn't indexed yet (very new pools can lag by a few seconds), this will
 * fail safe (pass: false) rather than guess.
 */
async function checkLiquidity(poolAddress) {
  try {
    const url = `${RAYDIUM_POOL_INFO_URL}?ids=${poolAddress}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) {
      return { pass: false, reason: `Raydium API returned ${res.status} — failing safe` };
    }

    const json = await res.json();
    const pool = json?.data?.[0];

    if (!pool) {
      return { pass: false, reason: 'Pool not yet indexed by Raydium API — failing safe' };
    }

    // Identify which side of the pool is SOL and read that reserve amount
    let liquiditySol = null;
    if (pool.mintA?.address === WSOL_MINT) {
      liquiditySol = pool.mintAmountA;
    } else if (pool.mintB?.address === WSOL_MINT) {
      liquiditySol = pool.mintAmountB;
    }

    if (liquiditySol === null || liquiditySol === undefined) {
      return { pass: false, reason: 'Could not identify SOL-side reserve in pool data — failing safe' };
    }

    return {
      pass: liquiditySol >= CONFIG.MIN_LIQUIDITY_SOL,
      reason: `Liquidity: ${liquiditySol.toFixed(2)} SOL (min ${CONFIG.MIN_LIQUIDITY_SOL})`,
      value: liquiditySol,
    };
  } catch (err) {
    return { pass: false, reason: `Error checking liquidity: ${err.message} — failing safe` };
  }
}

/**
 * Checks pool age against MAX_POOL_AGE_MS.
 */
function checkPoolAge(poolCreatedAtMs) {
  const ageMs = Date.now() - poolCreatedAtMs;
  return {
    pass: ageMs <= CONFIG.MAX_POOL_AGE_MS,
    reason: `Pool age: ${(ageMs / 1000).toFixed(1)}s (max ${CONFIG.MAX_POOL_AGE_MS / 1000}s)`,
    value: ageMs,
  };
}

// -----------------------------------------------------------------------
// PUMP.FUN BONDING CURVE SUPPORT
// -----------------------------------------------------------------------
// ⚠️ UNVERIFIED LAYOUT — same caveat as the Raydium account indices below.
// This byte layout for pump.fun's on-chain "BondingCurve" account is from
// public documentation/reference implementations, not confirmed against
// a live account in this sandbox (no network access here). Run
// verify_pumpfun_layout.js against a real bonding curve address before
// trusting this with real funds — a wrong offset would silently read
// garbage instead of erroring.
const BONDING_CURVE_LAYOUT = {
  discriminatorBytes: 8,
  virtualTokenReserves: 8,   // offset
  virtualSolReserves: 16,
  realTokenReserves: 24,
  realSolReserves: 32,
  tokenTotalSupply: 40,
  complete: 48,
  minExpectedLength: 49,
};

function readU64LE(buffer, offset) {
  return buffer.readBigUInt64LE(offset);
}

/**
 * Checks a pump.fun bonding curve's REAL (not virtual) SOL reserves —
 * i.e. actual SOL that's been paid in by buyers so far, as a proxy for
 * "some organic interest already," per your agreed 5 SOL threshold.
 *
 * Deliberately uses realSolReserves, not virtualSolReserves — virtual
 * reserves include pump.fun's built-in initial offset used for price
 * curve math and would overstate actual buyer-contributed liquidity.
 */
async function checkBondingCurveLiquidity(curveAddress) {
  try {
    const accountInfo = await connection.getAccountInfo(new PublicKey(curveAddress));
    const data = accountInfo?.data;

    if (!data || data.length < BONDING_CURVE_LAYOUT.minExpectedLength) {
      return { pass: false, reason: 'Bonding curve account data missing or too short — failing safe' };
    }

    const realSolLamports = readU64LE(data, BONDING_CURVE_LAYOUT.realSolReserves);
    const realSol = Number(realSolLamports) / 1e9;

    const isComplete = data[BONDING_CURVE_LAYOUT.complete] === 1;
    if (isComplete) {
      return { pass: false, reason: 'Curve already graduated to Raydium — not a pre-graduation candidate anymore' };
    }

    return {
      pass: realSol >= CONFIG.PUMPFUN_MIN_REAL_SOL,
      reason: `Bonding curve real SOL: ${realSol.toFixed(2)} (min ${CONFIG.PUMPFUN_MIN_REAL_SOL})`,
      value: realSol,
    };
  } catch (err) {
    return { pass: false, reason: `Error checking bonding curve liquidity: ${err.message} — failing safe` };
  }
}

/**
 * Checks top non-LP holder concentration for the project token itself.
 *
 * IMPORTANT FIX vs. the original stub: this must exclude the pool's own
 * vault account (the token account the AMM uses to hold its side of the
 * reserve) — NOT the LP mint address. The LP mint is a different token
 * entirely (represents ownership of the pool), so excluding it here was
 * a bug in the original design; it would never have matched any holder
 * of the actual project token and the check would've been meaningless.
 *
 * @param {string} mintAddress - the project token's mint
 * @param {string[]} excludeAddresses - token-account addresses to exclude
 *   from the "holder" count (the pool's own vault(s) for this mint —
 *   supplied by the listener once it extracts them from the creation tx)
 */
async function checkHolderConcentration(mintAddress, excludeAddresses = []) {
  try {
    const mintPubkey = new PublicKey(mintAddress);
    const excludeSet = new Set(excludeAddresses);

    const supplyInfo = await connection.getTokenSupply(mintPubkey);
    const totalSupply = supplyInfo?.value?.uiAmount;
    if (!totalSupply || totalSupply <= 0) {
      return { pass: false, reason: 'Could not read token total supply — failing safe' };
    }

    const largest = await connection.getTokenLargestAccounts(mintPubkey);
    const holders = largest?.value || [];
    if (holders.length === 0) {
      return { pass: false, reason: 'No holder accounts found — failing safe' };
    }

    const nonPoolHolders = holders.filter((h) => !excludeSet.has(h.address));

    if (nonPoolHolders.length === 0) {
      // Every top holder was the pool itself — nothing external holds a
      // meaningful stack yet. That's actually the safest state, not a
      // failure, so let it pass with 0% concentration.
      return {
        pass: true,
        reason: 'No non-pool holders yet (0% concentration)',
        value: 0,
      };
    }

    const topHolder = nonPoolHolders[0];
    const topHolderPct = ((topHolder.uiAmount || 0) / totalSupply) * 100;

    return {
      pass: topHolderPct <= CONFIG.MAX_HOLDER_PCT,
      reason: `Top non-pool holder: ${topHolderPct.toFixed(1)}% (max ${CONFIG.MAX_HOLDER_PCT}%)`,
      value: { topHolderPct, topHolderAddress: topHolder.address },
    };
  } catch (err) {
    return { pass: false, reason: `Error checking holder concentration: ${err.message} — failing safe` };
  }
}

/**
 * Checks the pool creator wallet's history for prior token launches, as a
 * risk signal (soft filter — informational, does not hard-block a
 * candidate on its own, since launching multiple tokens isn't inherently
 * a rug indicator, but a wallet with many recent launches is worth a
 * human glancing at before you buy).
 *
 * Looks at the creator's recent transaction signatures and counts how
 * many contain an SPL Token `initializeMint` instruction where this
 * wallet was the mint authority — a reasonable proxy for "how many
 * tokens has this wallet created."
 *
 * NOTE: this does one getSignaturesForAddress call + up to
 * CONFIG.CREATOR_HISTORY_LOOKBACK getParsedTransaction calls, so it's the
 * slowest/most RPC-heavy check here. Keep the lookback small in practice.
 */
async function checkCreatorHistory(creatorAddress) {
  try {
    const pubkey = new PublicKey(creatorAddress);
    const signatures = await connection.getSignaturesForAddress(pubkey, {
      limit: CONFIG.CREATOR_HISTORY_LOOKBACK,
    });

    if (!signatures || signatures.length === 0) {
      return {
        pass: true,
        reason: 'No prior transaction history found for creator wallet',
        value: { priorMintCount: 0 },
      };
    }

    let priorMintCount = 0;
    for (const sigInfo of signatures) {
      const tx = await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) continue;

      const instructions = tx.transaction?.message?.instructions || [];
      const createdMintHere = instructions.some((ix) => {
        const parsedType = ix.parsed?.type;
        const mintAuthority = ix.parsed?.info?.mintAuthority;
        return parsedType === 'initializeMint' && mintAuthority === creatorAddress;
      });
      if (createdMintHere) priorMintCount += 1;
    }

    // Informational — always "passes" (won't block a candidate on its
    // own) but the count is logged so you can eyeball serial deployers.
    return {
      pass: true,
      reason: `Creator has ${priorMintCount} prior token mint(s) in last ${signatures.length} txs (informational only)`,
      value: { priorMintCount },
    };
  } catch (err) {
    // Fails safe by NOT passing — since this check gates nothing on its
    // own in evaluateCandidate (it's not in hardChecks), an error here
    // just means "no signal available," which is reported honestly
    // rather than defaulting to a false "looks fine."
    return { pass: false, reason: `Error checking creator history: ${err.message} — no signal available` };
  }
}

// ---------------------------------------------------------------------
// MAIN FILTER PIPELINE
// ---------------------------------------------------------------------
async function evaluateCandidate(candidate) {
  const {
    source = 'raydium', // 'raydium' | 'pumpfun'
    mintAddress,
    lpMintAddress,
    poolAddress,
    curveAddress,
    creatorAddress,
    poolCreatedAtMs,
    poolTokenVaultAddresses = [], // the AMM/curve's own vault(s) holding this mint — excluded from holder concentration
  } = candidate;

  const checks = {};

  checks.mintAuthority = await checkMintAuthority(mintAddress);
  checks.freezeAuthority = await checkFreezeAuthority(mintAddress);
  checks.poolAge = checkPoolAge(poolCreatedAtMs);
  checks.holderConcentration = await checkHolderConcentration(mintAddress, poolTokenVaultAddresses);
  checks.creatorHistory = await checkCreatorHistory(creatorAddress);

  // holderConcentration is a hard check because you set an explicit
  // reject threshold for it (>20% non-pool holder = reject).
  // creatorHistory has no hard threshold you've set, so it stays soft.
  const hardChecks = ['mintAuthority', 'freezeAuthority', 'poolAge', 'holderConcentration'];

  if (source === 'raydium') {
    checks.lpLocked = await checkLpLockedOrBurned(lpMintAddress);
    checks.liquidity = await checkLiquidity(poolAddress);
    hardChecks.push('lpLocked', 'liquidity');
  } else if (source === 'pumpfun') {
    // No LP exists pre-graduation — this isn't a failure, it's genuinely
    // not applicable yet, so it reports pass rather than a misleading
    // rejection reason.
    checks.lpLocked = { pass: true, reason: 'N/A — pre-graduation pump.fun token has no LP yet' };
    checks.liquidity = await checkBondingCurveLiquidity(curveAddress);
    hardChecks.push('liquidity');
  } else {
    return {
      timestamp: nowIso(),
      mintAddress,
      passedAllHardFilters: false,
      failedChecks: ['unknownSource'],
      checks: { unknownSource: { pass: false, reason: `Unknown candidate source: ${source}` } },
      paperTrade: CONFIG.PAPER_TRADE,
    };
  }

  const failedHard = hardChecks.filter((k) => !checks[k].pass);

  const result = {
    timestamp: nowIso(),
    source,
    mintAddress,
    poolAddress: poolAddress || curveAddress,
    passedAllHardFilters: failedHard.length === 0,
    failedChecks: failedHard,
    checks,
    paperTrade: CONFIG.PAPER_TRADE,
  };

  logCandidate(result);

  if (result.passedAllHardFilters) {
    console.log(`✅ CANDIDATE PASSED [${source}]: ${mintAddress}`);
  } else {
    console.log(`❌ Rejected [${source}] ${mintAddress}: ${failedHard.join(', ')}`);
  }

  return result;
}

// ---------------------------------------------------------------------
// POOL DETECTION (LISTENER)
// ---------------------------------------------------------------------
// ⚠️⚠️⚠️ READ BEFORE RUNNING LIVE ⚠️⚠️⚠️
// This extracts mint/vault/creator addresses from a Raydium AMM V4
// `initialize2` instruction by ACCOUNT POSITION (index in the accounts
// array). This ordering is publicly documented in Raydium's own program
// source, but I have no live network access in this sandbox to fetch a
// real recent pool-creation transaction and confirm it against current
// mainnet reality. Program account orderings CAN change between
// versions. Run `node verify_account_layout.js <a real pool-creation
// tx signature>` (see that file) and manually compare the printed
// accounts against the INITIALIZE2_ACCOUNT_INDEX map below BEFORE
// trusting this with real funds. If the extraction looks wrong, this
// will misidentify mints/vaults, which would break every downstream
// check silently — that's the one failure mode fail-safe checks alone
// can't catch, because it happens before the checks even run.
// ---------------------------------------------------------------------

// Best-effort, UNVERIFIED account index map for Raydium AMM V4's
// `initialize2` instruction. Verify against a live tx before trusting.
const INITIALIZE2_ACCOUNT_INDEX = {
  amm: 4,           // pool state account -> poolAddress
  ammAuthority: 5,
  ammOpenOrders: 6,
  lpMint: 7,
  coinMint: 8,       // "base" mint
  pcMint: 9,         // "quote" mint
  coinVault: 10,
  pcVault: 11,
  userWallet: 17,    // fee payer / pool creator — verify this index especially
};

const INITIALIZE2_DISCRIMINATOR_LOG_HINT = 'initialize2';

/**
 * Given a parsed transaction believed to contain a Raydium initialize2
 * instruction, extract a candidate object for evaluateCandidate().
 * Returns null (skip) if anything doesn't match expectations — never
 * guesses partial data.
 */
function extractPoolCreationCandidate(tx, signature) {
  try {
    const accountKeys = tx.transaction?.message?.accountKeys;
    if (!accountKeys) return null;

    const instructions = tx.transaction?.message?.instructions || [];
    const raydiumIx = instructions.find(
      (ix) => ix.programId?.toString() === PROGRAM_IDS.RAYDIUM_AMM_V4.toString()
    );
    if (!raydiumIx || !raydiumIx.accounts) return null;

    const ixAccounts = raydiumIx.accounts; // array of pubkeys in instruction order

    const requiredIndices = Object.values(INITIALIZE2_ACCOUNT_INDEX);
    const maxIndex = Math.max(...requiredIndices);
    if (ixAccounts.length <= maxIndex) {
      // Account count doesn't match what we expect for initialize2 —
      // layout assumption is likely wrong, or this was a different
      // instruction. Skip rather than guess.
      return null;
    }

    const getAcct = (name) => ixAccounts[INITIALIZE2_ACCOUNT_INDEX[name]]?.toString();

    const poolAddress = getAcct('amm');
    const lpMintAddress = getAcct('lpMint');
    const coinMint = getAcct('coinMint');
    const pcMint = getAcct('pcMint');
    const coinVault = getAcct('coinVault');
    const pcVault = getAcct('pcVault');
    const creatorAddress = getAcct('userWallet');

    if (!poolAddress || !lpMintAddress || !coinMint || !pcMint || !creatorAddress) {
      return null;
    }

    // Whichever side isn't WSOL is "the project token" we're evaluating.
    let mintAddress, poolTokenVaultAddresses;
    if (coinMint === WSOL_MINT) {
      mintAddress = pcMint;
      poolTokenVaultAddresses = [pcVault].filter(Boolean);
    } else if (pcMint === WSOL_MINT) {
      mintAddress = coinMint;
      poolTokenVaultAddresses = [coinVault].filter(Boolean);
    } else {
      // Neither side is SOL — not a SOL-paired pool, skip (we only snipe
      // SOL pairs per your liquidity threshold being denominated in SOL).
      return null;
    }

    return {
      mintAddress,
      lpMintAddress,
      poolAddress,
      creatorAddress,
      poolTokenVaultAddresses,
      poolCreatedAtMs: Date.now(), // detection time, not exact block time
      signature,
    };
  } catch (err) {
    console.error(`Error extracting candidate from tx: ${err.message}`);
    return null;
  }
}

function startRaydiumListener() {
  connection.onLogs(
    PROGRAM_IDS.RAYDIUM_AMM_V4,
    async (logInfo) => {
      try {
        if (logInfo.err) return; // skip failed transactions

        const logsText = (logInfo.logs || []).join(' ');
        if (!logsText.toLowerCase().includes(INITIALIZE2_DISCRIMINATOR_LOG_HINT)) {
          return; // not a pool-creation instruction, ignore
        }

        const tx = await connection.getParsedTransaction(logInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!tx) return;

        const candidate = extractPoolCreationCandidate(tx, logInfo.signature);
        if (!candidate) {
          console.log(`[raydium] Skipped tx ${logInfo.signature} — could not extract a valid candidate (layout mismatch or non-SOL pair)`);
          return;
        }

        console.log(`[raydium] New pool detected: ${candidate.mintAddress} (tx ${logInfo.signature})`);
        await evaluateCandidate({ ...candidate, source: 'raydium' });
      } catch (err) {
        console.error('[raydium] Error processing log:', err.message);
      }
    },
    'confirmed'
  );
}

// -----------------------------------------------------------------------
// PUMP.FUN DETECTION
// -----------------------------------------------------------------------
// ⚠️ Same unverified-layout caveat as Raydium above. This index map is
// from public pump.fun IDL references, not confirmed live. Run
// verify_pumpfun_layout.js against a real "create" transaction before
// trusting this with real funds.
const PUMPFUN_CREATE_ACCOUNT_INDEX = {
  mint: 0,
  bondingCurve: 2,
  associatedBondingCurve: 3, // the curve's own token vault holding unsold supply
  user: 7,                   // creator / fee payer
};

const PUMPFUN_CREATE_LOG_HINT = 'instruction: create';

/**
 * Given a parsed transaction believed to contain a pump.fun `create`
 * instruction, extract a candidate object for evaluateCandidate().
 * Returns null (skip) if anything doesn't match expectations.
 */
function extractPumpFunCandidate(tx, signature) {
  try {
    const instructions = tx.transaction?.message?.instructions || [];
    const pumpIx = instructions.find(
      (ix) => ix.programId?.toString() === PROGRAM_IDS.PUMP_FUN.toString()
    );
    if (!pumpIx || !pumpIx.accounts) return null;

    const ixAccounts = pumpIx.accounts;
    const requiredIndices = Object.values(PUMPFUN_CREATE_ACCOUNT_INDEX);
    const maxIndex = Math.max(...requiredIndices);
    if (ixAccounts.length <= maxIndex) {
      return null; // account count doesn't match expected create ix shape
    }

    const getAcct = (name) => ixAccounts[PUMPFUN_CREATE_ACCOUNT_INDEX[name]]?.toString();

    const mintAddress = getAcct('mint');
    const curveAddress = getAcct('bondingCurve');
    const associatedCurveVault = getAcct('associatedBondingCurve');
    const creatorAddress = getAcct('user');

    if (!mintAddress || !curveAddress || !creatorAddress) return null;

    return {
      source: 'pumpfun',
      mintAddress,
      curveAddress,
      creatorAddress,
      poolTokenVaultAddresses: [associatedCurveVault].filter(Boolean),
      poolCreatedAtMs: Date.now(),
      signature,
    };
  } catch (err) {
    console.error(`Error extracting pump.fun candidate from tx: ${err.message}`);
    return null;
  }
}

function startPumpFunListener() {
  connection.onLogs(
    PROGRAM_IDS.PUMP_FUN,
    async (logInfo) => {
      try {
        if (logInfo.err) return;

        const logsText = (logInfo.logs || []).join(' ').toLowerCase();
        if (!logsText.includes(PUMPFUN_CREATE_LOG_HINT)) {
          return; // not a token-creation instruction, ignore (e.g. a buy/sell on an existing curve)
        }

        const tx = await connection.getParsedTransaction(logInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!tx) return;

        const candidate = extractPumpFunCandidate(tx, logInfo.signature);
        if (!candidate) {
          console.log(`[pumpfun] Skipped tx ${logInfo.signature} — could not extract a valid candidate (layout mismatch)`);
          return;
        }

        console.log(`[pumpfun] New token detected: ${candidate.mintAddress} (tx ${logInfo.signature})`);
        // Note: unlike Raydium, a brand-new curve will almost always fail
        // the 5 SOL real-reserve check immediately (curves start at 0).
        // This is expected — you're watching it, not necessarily buying
        // yet. Re-check candidates that failed only on liquidity as the
        // curve fills, rather than treating every early rejection as final.
        await evaluateCandidate(candidate);
      } catch (err) {
        console.error('[pumpfun] Error processing log:', err.message);
      }
    },
    'confirmed'
  );
}

function startListening() {
  console.log('Listening for new pool/token creations on Raydium + pump.fun...');
  console.log(`Mode: ${CONFIG.PAPER_TRADE ? 'PAPER TRADING (no real funds)' : 'LIVE'}`);
  console.log('⚠️  Account layouts for BOTH sources are UNVERIFIED. Run verify_account_layout.js and verify_pumpfun_layout.js before trusting output.');

  startRaydiumListener();
  startPumpFunListener();
}

// ---------------------------------------------------------------------
// ENTRY POINT
// ---------------------------------------------------------------------
if (require.main === module) {
  startListening();
}

module.exports = {
  evaluateCandidate,
  checkMintAuthority,
  checkFreezeAuthority,
  checkLpLockedOrBurned,
  checkLiquidity,
  checkBondingCurveLiquidity,
  checkPoolAge,
  checkHolderConcentration,
  checkCreatorHistory,
  extractPoolCreationCandidate,
  extractPumpFunCandidate,
  CONFIG,
  connection, // exposed so tests can mock its methods
  KNOWN_BURN_ADDRESSES,
  KNOWN_LOCKER_PROGRAMS,
};
