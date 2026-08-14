const express = require('express');
const { parseMintAddress, checkMintAndFreezeAuthority } = require('../services/solanaChecks');
const { buildRiskSummary } = require('../services/riskSummary');
const analytics = require('../services/analytics');

const router = express.Router();

router.post('/', async (req, res) => {
  const startedAt = Date.now();
  const { address, distinctId } = req.body || {};

  let mintPubkey;
  try {
    mintPubkey = parseMintAddress(address);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const authorityChecks = await checkMintAndFreezeAuthority(mintPubkey);

    // TODO(next): LP lock status/duration/provider, top 10-20 holder concentration.
    // Both will push additional entries onto this array once implemented.
    const checks = [authorityChecks.mintAuthority, authorityChecks.freezeAuthority];

    const summary = buildRiskSummary(checks);
    const durationMs = Date.now() - startedAt;

    analytics.capture(distinctId || 'anonymous', 'scan_completed', {
      mintAddress: mintPubkey.toString(),
      passed: summary.passed,
      total: summary.total,
      overall: summary.overall,
      durationMs,
    });

    res.json({
      address: mintPubkey.toString(),
      tokenProgram: authorityChecks.tokenProgram,
      decimals: authorityChecks.decimals,
      supply: authorityChecks.supply,
      checks,
      summary,
      durationMs,
    });
  } catch (err) {
    analytics.capture(distinctId || 'anonymous', 'scan_failed', {
      mintAddress: mintPubkey.toString(),
      error: err.message,
    });
    res.status(422).json({ error: err.message });
  }
});

module.exports = router;
