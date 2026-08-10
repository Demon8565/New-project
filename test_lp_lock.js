/**
 * test_lp_lock.js
 * Mocks connection.getTokenSupply / getTokenLargestAccounts /
 * getParsedAccountInfo to verify checkLpLockedOrBurned's logic without
 * live network access. Run: node test_lp_lock.js
 */

const assert = require('assert');
const mod = require('./sniper_filter.js');
const { checkLpLockedOrBurned, connection, CONFIG } = mod;

const BURN_ADDR = '1nc1nerator11111111111111111111111111111111';
const LOCKER_PROGRAM = 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m';
const RANDOM_WALLET = 'RandomWalletAddressXXXXXXXXXXXXXXXXXXXXXXXX';

function mockConnection({ totalSupply, holders, ownersByAccount }) {
  connection.getTokenSupply = async () => ({ value: { uiAmount: totalSupply } });
  connection.getTokenLargestAccounts = async () => ({ value: holders });
  connection.getParsedAccountInfo = async (pubkey) => {
    const addr = pubkey.toString();
    const owner = ownersByAccount[addr];
    return { value: { data: { parsed: { info: { owner } } } } };
  };
}

async function run() {
  console.log(`Configured LP_LOCK_MIN_PCT: ${CONFIG.LP_LOCK_MIN_PCT}%`);

  // Case 1: 100% burned -> PASS
  mockConnection({
    totalSupply: 1000,
    holders: [{ address: 'acct1', uiAmount: 1000 }],
    ownersByAccount: { acct1: BURN_ADDR },
  });
  let result = await checkLpLockedOrBurned('lpMint1');
  console.log('Case 1 (100% burned):', result);
  assert.strictEqual(result.pass, true, 'Case 1 should PASS');

  // Case 2: 95% locked via Streamflow, 5% free -> PASS (>= 90% threshold)
  mockConnection({
    totalSupply: 1000,
    holders: [
      { address: 'acct1', uiAmount: 950 },
      { address: 'acct2', uiAmount: 50 },
    ],
    ownersByAccount: { acct1: LOCKER_PROGRAM, acct2: RANDOM_WALLET },
  });
  result = await checkLpLockedOrBurned('lpMint2');
  console.log('Case 2 (95% locked, 5% free):', result);
  assert.strictEqual(result.pass, true, 'Case 2 should PASS');

  // Case 3: only 50% locked, rest in a normal wallet -> FAIL (rug risk)
  mockConnection({
    totalSupply: 1000,
    holders: [
      { address: 'acct1', uiAmount: 500 },
      { address: 'acct2', uiAmount: 500 },
    ],
    ownersByAccount: { acct1: LOCKER_PROGRAM, acct2: RANDOM_WALLET },
  });
  result = await checkLpLockedOrBurned('lpMint3');
  console.log('Case 3 (only 50% locked):', result);
  assert.strictEqual(result.pass, false, 'Case 3 should FAIL — this is the classic rug setup');

  // Case 4: 100% held by creator's own wallet, nothing locked/burned -> FAIL
  mockConnection({
    totalSupply: 1000,
    holders: [{ address: 'acct1', uiAmount: 1000 }],
    ownersByAccount: { acct1: RANDOM_WALLET },
  });
  result = await checkLpLockedOrBurned('lpMint4');
  console.log('Case 4 (100% free/unlocked):', result);
  assert.strictEqual(result.pass, false, 'Case 4 should FAIL');

  // Case 5: RPC error mid-check -> fail safe
  connection.getTokenSupply = async () => { throw new Error('RPC timeout'); };
  result = await checkLpLockedOrBurned('lpMint5');
  console.log('Case 5 (RPC error):', result);
  assert.strictEqual(result.pass, false, 'Case 5 should fail safe');

  // Case 6: no holder accounts returned -> fail safe
  connection.getTokenSupply = async () => ({ value: { uiAmount: 1000 } });
  connection.getTokenLargestAccounts = async () => ({ value: [] });
  result = await checkLpLockedOrBurned('lpMint6');
  console.log('Case 6 (no holders found):', result);
  assert.strictEqual(result.pass, false, 'Case 6 should fail safe');

  console.log('\n✅ All checkLpLockedOrBurned test cases passed.');
}

run().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
