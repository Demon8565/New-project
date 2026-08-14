const { PostHog } = require('posthog-node');
const config = require('../config');

const client = config.posthog.apiKey
  ? new PostHog(config.posthog.apiKey, { host: config.posthog.host })
  : null;

/**
 * No-ops when POSTHOG_API_KEY isn't set, so local dev never crashes on
 * missing analytics config.
 */
function capture(distinctId, event, properties = {}) {
  if (!client) return;
  client.capture({ distinctId, event, properties });
}

async function shutdown() {
  if (client) await client.shutdown();
}

module.exports = { capture, shutdown, enabled: Boolean(client) };
