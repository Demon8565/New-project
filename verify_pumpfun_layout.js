/**
 * verify_pumpfun_layout.js
 * -----------------------------------------------------------------------
 * RUN THIS BEFORE TRUSTING pump.fun candidates from startListening().
 * -----------------------------------------------------------------------
 * Same purpose as verify_account_layout.js but for pump.fun's `create`
 * instruction and its bonding curve account layout — both written from
 * public documentation, not confirmed against a live account (no network
 * access in the sandbox this was built in).
 *
 * USAGE:
 *   export HELIUS_RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
 *   node verify_pumpfun_layout.js <a_real_pumpfun_create_tx_signature>
 *
 * Get a real signature: look up the pump.fun program on Solscan
 * (6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P) and find a recent
 * transaction that creates a new token (look for a "Create" instruction).
 *
 * This script does TWO checks:
 *   1. Prints the `create` instruction's accounts in order — compare
 *      against PUMPFUN_CREATE_ACCOUNT_INDEX in sniper_filter.js
 *      (mint: 0, bondingCurve: 2, associatedBondingCurve: 3, user: 7)
 *   2. Fetches that bonding curve account's raw bytes and prints the
 *      decoded reserve fields — sanity check that realSolReserves at
 *      byte offset 32 produces a plausible SOL number (should be a small
 *      number for a freshly created curve, growing as it's bought into)
 * -----------------------------------------------------------------------
 */

const { Connection, PublicKey } = require('@solana/web3.js');

const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

async function main() {
  const signature = process.argv[2];
  if (!signature) {
    console.error('Usage: node verify_pumpfun_layout.js <transaction_signature>');
    process.exit(1);
  }

  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl) {
    console.error('ERROR: HELIUS_RPC_URL env var is not set.');
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, 'confirmed');

  console.log(`Fetching transaction ${signature}...\n`);
  const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });

  if (!tx) {
    console.error('Transaction not found. Double check the signature.');
    process.exit(1);
  }

  const instructions = tx.transaction?.message?.instructions || [];
  const pumpIx = instructions.find((ix) => ix.programId?.toString() === PUMP_FUN_PROGRAM);

  if (!pumpIx) {
    console.error('No instruction targeting the pump.fun program found in this transaction.');
    console.error('Programs found in this tx:', instructions.map((ix) => ix.programId?.toString()));
    process.exit(1);
  }

  console.log('--- STEP 1: Account order in the create instruction ---\n');
  const accounts = pumpIx.accounts || [];
  accounts.forEach((acct, i) => {
    console.log(`  [${i}] ${acct.toString()}`);
  });

  console.log('\nCurrent assumed mapping in sniper_filter.js:');
  console.log('  mint: 0, bondingCurve: 2, associatedBondingCurve: 3, user: 7');
  console.log('\nManually check: is index 0 the new token mint, index 2 a PDA-looking');
  console.log('account (the bonding curve state), index 3 a token account (the curve\'s');
  console.log('vault), and index 7 the wallet that signed/paid for this transaction?');

  const bondingCurveAddress = accounts[2]?.toString();
  if (!bondingCurveAddress) {
    console.log('\n(Could not read index 2 to fetch bonding curve data — check account count above.)');
    return;
  }

  console.log(`\n--- STEP 2: Decoding bonding curve account at index 2 (${bondingCurveAddress}) ---\n`);
  const accountInfo = await connection.getAccountInfo(new PublicKey(bondingCurveAddress));
  if (!accountInfo?.data) {
    console.log('Could not fetch account data — this address may not be correct.');
    return;
  }

  const data = accountInfo.data;
  console.log(`Account data length: ${data.length} bytes (expected >= 49)`);

  if (data.length >= 49) {
    const virtualToken = data.readBigUInt64LE(8);
    const virtualSol = data.readBigUInt64LE(16);
    const realToken = data.readBigUInt64LE(24);
    const realSol = data.readBigUInt64LE(32);
    const totalSupply = data.readBigUInt64LE(40);
    const complete = data[48];

    console.log(`  virtualTokenReserves: ${virtualToken}`);
    console.log(`  virtualSolReserves:   ${virtualSol}  (${Number(virtualSol) / 1e9} SOL)`);
    console.log(`  realTokenReserves:    ${realToken}`);
    console.log(`  realSolReserves:      ${realSol}  (${Number(realSol) / 1e9} SOL)  <- this is what checkBondingCurveLiquidity reads`);
    console.log(`  tokenTotalSupply:     ${totalSupply}`);
    console.log(`  complete:             ${complete} (0 = still bonding, 1 = graduated to Raydium)`);
    console.log('\nSanity check: for a very freshly created token, realSolReserves should');
    console.log('be small (near 0) — if it prints a huge or nonsensical number, the byte');
    console.log('offsets in BONDING_CURVE_LAYOUT are wrong and need correcting.');
  } else {
    console.log('Data too short for the assumed layout — offsets are likely wrong for this account.');
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
