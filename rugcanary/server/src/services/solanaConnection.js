const { Connection } = require('@solana/web3.js');
const config = require('../config');

let connection = null;

function getConnection() {
  if (!config.heliusRpcUrl) {
    throw new Error(
      'No Solana RPC configured. Set HELIUS_API_KEY or HELIUS_RPC_URL in the server environment.'
    );
  }
  if (!connection) {
    connection = new Connection(config.heliusRpcUrl, 'confirmed');
  }
  return connection;
}

module.exports = { getConnection };
