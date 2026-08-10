/**
 * test_liquidity.js
 * Mocks global.fetch to verify checkLiquidity's pass/fail logic without
 * needing live network access. Run: node test_liquidity.js
 */

const assert = require('assert');

function mockFetchOnce(responseBody, ok = true, status = 200) {
  global.fetch = async () => ({
    ok,
    status,
    json: async () => responseBody,
  });
}

async function run() {
  // Re-require fresh each time isn't needed since checkLiquidity reads
  // global.fetch at call time, not at import time.
  const { checkLiquidity, CONFIG } = require('./sniper_filter.js');

  console.log(`Configured MIN_LIQUIDITY_SOL: ${CONFIG.MIN_LIQUIDITY_SOL}`);

  // Case 1: pool has 15 SOL on the A side -> should PASS (>= 10)
  mockFetchOnce({
    data: [
      {
        mintA: { address: 'So11111111111111111111111111111111111111112' },
        mintB: { address: 'SomeOtherTokenMintXXXXXXXXXXXXXXXXXXXXXXXXX' },
        mintAmountA: 15,
        mintAmountB: 500000,
      },
    ],
  });
  let result = await checkLiquidity('fakePoolAddress1');
  console.log('Case 1 (15 SOL, side A):', result);
  assert.strictEqual(result.pass, true, 'Case 1 should PASS');

  // Case 2: pool has only 3 SOL on the B side -> should FAIL (< 10)
  mockFetchOnce({
    data: [
      {
        mintA: { address: 'SomeOtherTokenMintXXXXXXXXXXXXXXXXXXXXXXXXX' },
        mintB: { address: 'So11111111111111111111111111111111111111112' },
        mintAmountA: 500000,
        mintAmountB: 3,
      },
    ],
  });
  result = await checkLiquidity('fakePoolAddress2');
  console.log('Case 2 (3 SOL, side B):', result);
  assert.strictEqual(result.pass, false, 'Case 2 should FAIL (below threshold)');

  // Case 3: pool not indexed yet (empty data array) -> should fail safe
  mockFetchOnce({ data: [] });
  result = await checkLiquidity('fakePoolAddress3');
  console.log('Case 3 (not indexed):', result);
  assert.strictEqual(result.pass, false, 'Case 3 should fail safe');

  // Case 4: API returns an error status -> should fail safe
  mockFetchOnce({}, false, 500);
  result = await checkLiquidity('fakePoolAddress4');
  console.log('Case 4 (API 500 error):', result);
  assert.strictEqual(result.pass, false, 'Case 4 should fail safe');

  // Case 5: neither side is WSOL (shouldn't happen in practice, but test it) -> fail safe
  mockFetchOnce({
    data: [
      {
        mintA: { address: 'TokenAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' },
        mintB: { address: 'TokenBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' },
        mintAmountA: 1000,
        mintAmountB: 2000,
      },
    ],
  });
  result = await checkLiquidity('fakePoolAddress5');
  console.log('Case 5 (no WSOL side):', result);
  assert.strictEqual(result.pass, false, 'Case 5 should fail safe');

  console.log('\n✅ All checkLiquidity test cases passed.');
}

run().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
