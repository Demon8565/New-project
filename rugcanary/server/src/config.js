require('dotenv').config();

function buildHeliusRpcUrl() {
  if (process.env.HELIUS_RPC_URL) return process.env.HELIUS_RPC_URL;
  if (process.env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  }
  return null;
}

module.exports = {
  port: Number(process.env.PORT) || 3001,
  heliusRpcUrl: buildHeliusRpcUrl(),
  posthog: {
    apiKey: process.env.POSTHOG_API_KEY || null,
    host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
    clientKey: process.env.POSTHOG_CLIENT_KEY || process.env.POSTHOG_API_KEY || null,
  },
  databasePath: process.env.DATABASE_PATH || require('path').join(__dirname, '..', 'data', 'rugcanary.db'),
};
