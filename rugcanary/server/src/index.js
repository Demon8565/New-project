const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

const scanRoute = require('./routes/scan');
const waitlistRoute = require('./routes/waitlist');
const publicConfigRoute = require('./routes/publicConfig');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/scan', scanRoute);
app.use('/api/waitlist', waitlistRoute);
app.use('/api/config', publicConfigRoute);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, heliusConfigured: Boolean(config.heliusRpcUrl) });
});

const clientDist = path.join(__dirname, '..', '..', 'client');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`RugCanary API listening on port ${config.port}`);
  if (!config.heliusRpcUrl) {
    console.warn('WARNING: no HELIUS_API_KEY/HELIUS_RPC_URL set — /api/scan will fail until configured.');
  }
  if (!config.posthog.apiKey) {
    console.warn('PostHog server-side analytics disabled (POSTHOG_API_KEY not set).');
  }
});
