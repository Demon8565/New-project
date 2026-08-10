/**
 * test_creator_history.js
 * Run: node test_creator_history.js
 */

const assert = require('assert');
const mod = require('./sniper_filter.js');
const { checkCreatorHistory, connection } = mod;

const CREATOR = 'CreatorWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

function mockConnection({ signatures, txByeSig }) {
  connection.getSignaturesForAddress = async () => signatures;
  connection.getParsedTransaction = async (sig) => txByeSig[sig] || null;
}

function mintInitTx(mintAuthority) {
  return {
    transaction: {
      message: {
        instructions: [
          { parsed: { type: 'initializeMint', info: { mintAuthority } } },
        ],
      },
    },
  };
}

function unrelatedTx() {
  return {
    transaction: {
      message: {
        instructions: [{ parsed: { type: 'transfer', info: {} } }],
      },
    },
  };
}

async function run() {
  // Case 1: no signature history at all -> pass, 0 count
  mockConnection({ signatures: [], txByeSig: {} });
  let result = await checkCreatorHistory(CREATOR);
  console.log('Case 1 (no history):', result);
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.value.priorMintCount, 0);

  // Case 2: 2 prior mints among 3 transactions -> pass, count = 2 (informational)
  mockConnection({
    signatures: [{ signature: 'sig1' }, { signature: 'sig2' }, { signature: 'sig3' }],
    txByeSig: {
      sig1: mintInitTx(CREATOR),
      sig2: unrelatedTx(),
      sig3: mintInitTx(CREATOR),
    },
  });
  result = await checkCreatorHistory(CREATOR);
  console.log('Case 2 (2 prior mints):', result);
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.value.priorMintCount, 2);

  // Case 3: mint created by a DIFFERENT authority shouldn't count
  mockConnection({
    signatures: [{ signature: 'sig1' }],
    txByeSig: { sig1: mintInitTx('SomeoneElseXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX') },
  });
  result = await checkCreatorHistory(CREATOR);
  console.log('Case 3 (mint by different authority):', result);
  assert.strictEqual(result.value.priorMintCount, 0, 'Should not count mints where this wallet is not the authority');

  // Case 4: RPC error -> fails safe (pass: false, no false "looks fine")
  connection.getSignaturesForAddress = async () => { throw new Error('RPC error'); };
  result = await checkCreatorHistory(CREATOR);
  console.log('Case 4 (RPC error):', result);
  assert.strictEqual(result.pass, false);

  console.log('\n✅ All checkCreatorHistory test cases passed.');
}

run().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
