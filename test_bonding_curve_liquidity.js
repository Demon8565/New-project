/**
 * test_bonding_curve_liquidity.js
 * Run: node test_bonding_curve_liquidity.js
 */

const assert = require('assert');
const mod = require('./sniper_filter.js');
const { checkBondingCurveLiquidity, connection, CONFIG } = mod;

// Builds a mock bonding curve account buffer matching the layout:
// [8 bytes discriminator][virtualToken u64][virtualSol u64]
// [realToken u64][realSol u64][totalSupply u64][complete bool]
function buildCurveBuffer({ realSolLamports, complete = false }) {
  const buf = Buffer.alloc(49);
  buf.writeBigUInt64LE(0n, 8);               // virtualTokenReserves (unused in check)
  buf.writeBigUInt64LE(0n, 16);              // virtualSolReserves (unused in check)
  buf.writeBigUInt64LE(0n, 24);              // realTokenReserves (unused in check)
  buf.writeBigUInt64LE(BigInt(realSolLamports), 32); // realSolReserves — this is what we check
  buf.writeBigUInt64LE(0n, 40);              // tokenTotalSupply (unused in check)
  buf.writeUInt8(complete ? 1 : 0, 48);      // complete flag
  return buf;
}

function mockAccount(data) {
  connection.getAccountInfo = async () => ({ data });
}

async function run() {
  console.log(`Configured PUMPFUN_MIN_REAL_SOL: ${CONFIG.PUMPFUN_MIN_REAL_SOL}`);

  // Case 1: 8 SOL real reserves, curve active -> PASS (>= 5)
  mockAccount(buildCurveBuffer({ realSolLamports: 8_000_000_000 }));
  let result = await checkBondingCurveLiquidity('curve1');
  console.log('Case 1 (8 SOL, active):', result);
  assert.strictEqual(result.pass, true, 'Case 1 should PASS');

  // Case 2: 2 SOL real reserves (freshly created) -> FAIL (< 5)
  mockAccount(buildCurveBuffer({ realSolLamports: 2_000_000_000 }));
  result = await checkBondingCurveLiquidity('curve2');
  console.log('Case 2 (2 SOL, too fresh):', result);
  assert.strictEqual(result.pass, false, 'Case 2 should FAIL — below threshold');

  // Case 3: exactly 5 SOL -> PASS (>=)
  mockAccount(buildCurveBuffer({ realSolLamports: 5_000_000_000 }));
  result = await checkBondingCurveLiquidity('curve3');
  console.log('Case 3 (exactly 5 SOL):', result);
  assert.strictEqual(result.pass, true, 'Case 3 should PASS at exactly the threshold');

  // Case 4: curve already graduated (complete=true) -> FAIL, not a candidate anymore
  mockAccount(buildCurveBuffer({ realSolLamports: 90_000_000_000, complete: true }));
  result = await checkBondingCurveLiquidity('curve4');
  console.log('Case 4 (already graduated):', result);
  assert.strictEqual(result.pass, false, 'Case 4 should FAIL — should be picked up by the Raydium detector instead');

  // Case 5: account data missing/too short -> fail safe
  mockAccount(Buffer.alloc(10));
  result = await checkBondingCurveLiquidity('curve5');
  console.log('Case 5 (malformed/short data):', result);
  assert.strictEqual(result.pass, false, 'Case 5 should fail safe');

  // Case 6: RPC error -> fail safe
  connection.getAccountInfo = async () => { throw new Error('RPC timeout'); };
  result = await checkBondingCurveLiquidity('curve6');
  console.log('Case 6 (RPC error):', result);
  assert.strictEqual(result.pass, false, 'Case 6 should fail safe');

  console.log('\n✅ All checkBondingCurveLiquidity test cases passed.');
}

run().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
