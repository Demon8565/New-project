/**
 * Turns a list of check results into a plain-language summary.
 * Deliberately not a numeric score — "3 of 4 safety checks passed" plus
 * an overall label, so the report reads as a checklist, not a grade.
 */
function buildRiskSummary(checks) {
  const total = checks.length;
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass);

  let overall;
  if (failed.length === 0) {
    overall = 'low';
  } else if (failed.length === total) {
    overall = 'high';
  } else {
    overall = 'medium';
  }

  const overallLabel = {
    low: 'No major red flags found',
    medium: 'Some red flags found — review before buying',
    high: 'Multiple red flags found — high risk',
  }[overall];

  return {
    passed,
    total,
    overall,
    overallLabel,
    headline: `${passed} of ${total} safety checks passed`,
    failedChecks: failed.map((c) => c.id),
  };
}

module.exports = { buildRiskSummary };
