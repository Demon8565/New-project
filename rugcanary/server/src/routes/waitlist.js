const express = require('express');
const { addEmail } = require('../db/waitlist');
const analytics = require('../services/analytics');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/', (req, res) => {
  const { email, distinctId } = req.body || {};

  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const result = addEmail(normalizedEmail);

  analytics.capture(distinctId || normalizedEmail, 'waitlist_signup', {
    alreadySubscribed: !result.created,
  });

  res.json({ ok: true, alreadySubscribed: !result.created });
});

module.exports = router;
