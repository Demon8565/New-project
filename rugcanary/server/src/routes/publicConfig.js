const express = require('express');
const config = require('../config');

const router = express.Router();

// Serves public (non-secret) runtime config to the browser bundle. The
// PostHog client key is a project API key, meant to be public — safe to
// expose here rather than baking it into a static bundle at build time.
router.get('/', (req, res) => {
  res.json({
    posthog: {
      key: config.posthog.clientKey,
      host: config.posthog.host,
      enabled: Boolean(config.posthog.clientKey),
    },
  });
});

module.exports = router;
