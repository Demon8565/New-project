/**
 * test_holder_concentration.js
 * Run: node test_holder_concentration.js
 */

const assert = require('assert');
const mod = require('./sniper_filter.js');
const { checkHolderConcentration, connection, CONFIG } = mod;

function mockConnection({ totalSupply, holders }) {
  connection.getTokenSupply = async () => ({ value: { uiAmount: totalSupply } });
  connection.getTokenLargestAccounts = async () => ({ value: holders });
}

async function run() {
  console.log(`Configured MAX_HOLDER_PCT: ${CONFIG.MAX_HOLDER_PCT}%`);

  // Case 1: pool vault holds most supply, top non-pool holder is small -> PASS
  mockConnection({
    totalSupply: 1000000,
    holders: [
      { address: 'poolVault', uiAmount: 900000 },
      { address: 'wallet1', uiAmount: 50000 }, // 5%
      { address: 'wallet2', uiAmount: 20000 },
    ],
  });
  let result = await checkHolderConcentration('mint1', ['poolVault']);
  console.log('Case 1 (top non-pool holder 5%):', result);
  assert.strictEqual(result.pass, true, 'Case 1 should PASS');

  // Case 2: a whale wallet holds 35% outside the pool -> FAIL
  mockConnection({
    totalSupply: 1000000,
    holders: [
      { address: 'poolVault', uiAmount: 500000 },
      { address: 'whale', uiAmount: 350000 }, // 35%
      { address: 'wallet2', uiAmount: 20000 },
    ],
  });
  result = await checkHolderConcentration('mint2', ['poolVault']);
  console.log('Case 2 (whale holds 35%):', result);
  assert.strictEqual(result.pass, false, 'Case 2 should FAIL');

  // Case 3: exactly at the 20% threshold -> PASS (<=)
  mockConnection({
    totalSupply: 1000000,
    holders: [
      { address: 'poolVault', uiAmount: 800000 },
      { address: 'wallet1', uiAmount: 200000 }, // exactly 20%
    ],
  });
  result = await checkHolderConcentration('mint3', ['poolVault']);
  console.log('Case 3 (exactly 20%):', result);
  assert.strictEqual(result.pass, true, 'Case 3 should PASS at exactly the threshold');

  // Case 4: only the pool holds tokens so far (brand new pool) -> PASS, 0%
  mockConnection({
    totalSupply: 1000000,
    holders: [{ address: 'poolVault', uiAmount: 1000000 }],
  });
  result = await checkHolderConcentration('mint4', ['poolVault']);
  console.log('Case 4 (only pool holds supply):', result);
  assert.strictEqual(result.pass, true, 'Case 4 should PASS — nothing external holds anything yet');

  // Case 5: RPC error -> fail safe
  connection.getTokenSupply = async () => { throw new Error('RPC down'); };
  result = await checkHolderConcentration('mint5', ['poolVault']);
  console.log('Case 5 (RPC error):', result);
  assert.strictEqual(result.pass, false, 'Case 5 should fail safe');

  console.log('\n✅ All checkHolderConcentration test cases passed.');
}

run().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
