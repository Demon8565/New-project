/**
 * verify_account_layout.js
 * -----------------------------------------------------------------------
 * RUN THIS BEFORE TRUSTING startListening()'s output.
 * -----------------------------------------------------------------------
 * The listener in sniper_filter.js extracts mint/vault/creator addresses
 * from a Raydium AMM V4 `initialize2` instruction by ACCOUNT POSITION.
 * That ordering was written from public documentation, not verified
 * against a live transaction (no network access in the sandbox this was
 * built in). This script fetches a real pool-creation transaction and
 * prints every account in order so you can manually confirm — or correct
 * — the INITIALIZE2_ACCOUNT_INDEX map in sniper_filter.js.
 *
 * HOW TO GET A TEST SIGNATURE:
 *   1. Go to https://solscan.io or https://solana.fm
 *   2. Search the Raydium AMM V4 program: 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8
 *   3. Find a recent transaction and confirm it's a pool creation (look
 *      for "initialize2" in the instruction list)
 *   4. Copy its signature
 *
 * USAGE:
 *   export HELIUS_RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
 *   node verify_account_layout.js <transaction_signature>
 *
 * WHAT TO CHECK:
 *   Compare the printed account list against sniper_filter.js's
 *   INITIALIZE2_ACCOUNT_INDEX map:
 *     amm: 4, ammAuthority: 5, ammOpenOrders: 6, lpMint: 7,
 *     coinMint: 8, pcMint: 9, coinVault: 10, pcVault: 11, userWallet: 17
 *   If the printed roles (mint vs vault vs wallet) don't match those
 *   index positions, update INITIALIZE2_ACCOUNT_INDEX in
 *   sniper_filter.js to match reality before running the bot live.
 * -----------------------------------------------------------------------
 */

const { Connection, PublicKey } = require('@solana/web3.js');

const RAYDIUM_AMM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

async function main() {
  const signature = process.argv[2];
  if (!signature) {
    console.error('Usage: node verify_account_layout.js <transaction_signature>');
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
    console.error('Transaction not found. Double check the signature and that your RPC endpoint has access to it.');
    process.exit(1);
  }

  const instructions = tx.transaction?.message?.instructions || [];
  const raydiumIx = instructions.find((ix) => ix.programId?.toString() === RAYDIUM_AMM_V4);

  if (!raydiumIx) {
    console.error('No instruction targeting the Raydium AMM V4 program found in this transaction.');
    console.error('Programs found in this tx:', instructions.map((ix) => ix.programId?.toString()));
    process.exit(1);
  }

  console.log(`Instruction type/data: ${JSON.stringify(raydiumIx.parsed || raydiumIx.data)}\n`);
  console.log('Accounts in this instruction, in order (compare against INITIALIZE2_ACCOUNT_INDEX):\n');

  const accounts = raydiumIx.accounts || [];
  accounts.forEach((acct, i) => {
    console.log(`  [${i}] ${acct.toString()}`);
  });

  console.log('\nCurrent assumed mapping in sniper_filter.js:');
  console.log('  amm: 4, ammAuthority: 5, ammOpenOrders: 6, lpMint: 7,');
  console.log('  coinMint: 8, pcMint: 9, coinVault: 10, pcVault: 11, userWallet: 17');
  console.log('\nManually check: does index 8/9 hold token MINT addresses, index 10/11');
  console.log('hold VAULT (token account) addresses, and index 17 the CREATOR wallet?');
  console.log('If not, update INITIALIZE2_ACCOUNT_INDEX in sniper_filter.js to match.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
