(function () {
  const scanForm = document.getElementById('scan-form');
  const addressInput = document.getElementById('address-input');
  const scanButton = document.getElementById('scan-button');
  const scanError = document.getElementById('scan-error');
  const resultSection = document.getElementById('result-section');
  const resultCard = document.getElementById('result-card');
  const resultAddress = document.getElementById('result-address');
  const resultHeadline = document.getElementById('result-headline');
  const resultSublabel = document.getElementById('result-sublabel');
  const checksList = document.getElementById('checks-list');
  const resultTimestamp = document.getElementById('result-timestamp');

  const waitlistForm = document.getElementById('waitlist-form');
  const waitlistEmail = document.getElementById('waitlist-email');
  const waitlistButton = document.getElementById('waitlist-button');
  const waitlistMessage = document.getElementById('waitlist-message');

  let posthogReady = false;

  function getDistinctId() {
    if (posthogReady && window.posthog && window.posthog.get_distinct_id) {
      return window.posthog.get_distinct_id();
    }
    return undefined;
  }

  async function initAnalytics() {
    try {
      const res = await fetch('/api/config');
      const config = await res.json();
      if (!config.posthog?.enabled) return;

      const script = document.createElement('script');
      script.src = 'https://us-assets.i.posthog.com/static/array.js';
      script.onload = () => {
        window.posthog.init(config.posthog.key, {
          api_host: config.posthog.host,
          person_profiles: 'always',
        });
        posthogReady = true;
      };
      document.head.appendChild(script);
    } catch {
      // Analytics is best-effort — never block the app on it.
    }
  }

  function showError(message) {
    scanError.textContent = message;
    scanError.hidden = false;
  }

  function clearError() {
    scanError.hidden = true;
    scanError.textContent = '';
  }

  function renderResult(data) {
    resultCard.dataset.overall = data.summary.overall;
    resultAddress.textContent = data.address;
    resultHeadline.textContent = data.summary.headline;
    resultSublabel.textContent = data.summary.overallLabel;
    resultTimestamp.textContent = new Date().toLocaleString();

    checksList.innerHTML = '';
    for (const check of data.checks) {
      const li = document.createElement('li');
      li.className = 'check-item';
      li.dataset.pass = String(check.pass);

      const icon = document.createElement('span');
      icon.className = 'check-icon';
      icon.textContent = check.pass ? '✓' : '✕';
      icon.setAttribute('aria-hidden', 'true');

      const body = document.createElement('div');
      const label = document.createElement('div');
      label.className = 'check-label';
      label.textContent = check.label;
      const detail = document.createElement('div');
      detail.className = 'check-detail';
      detail.textContent = check.detail;
      body.appendChild(label);
      body.appendChild(detail);

      li.appendChild(icon);
      li.appendChild(body);
      checksList.appendChild(li);
    }

    resultSection.hidden = false;
  }

  scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const address = addressInput.value.trim();
    if (!address) return;

    scanButton.disabled = true;
    scanButton.textContent = 'Scanning...';
    resultSection.hidden = true;

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, distinctId: getDistinctId() }),
      });
      const data = await res.json();

      if (!res.ok) {
        showError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      renderResult(data);
    } catch {
      showError('Could not reach the server. Please try again.');
    } finally {
      scanButton.disabled = false;
      scanButton.textContent = 'Scan';
    }
  });

  waitlistForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    waitlistMessage.hidden = true;

    const email = waitlistEmail.value.trim();
    if (!email) return;

    waitlistButton.disabled = true;

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, distinctId: getDistinctId() }),
      });
      const data = await res.json();

      if (!res.ok) {
        waitlistMessage.style.color = 'var(--fail)';
        waitlistMessage.textContent = data.error || 'Something went wrong. Please try again.';
      } else {
        waitlistMessage.style.color = 'var(--pass)';
        waitlistMessage.textContent = data.alreadySubscribed
          ? "You're already on the list."
          : "You're on the list — we'll email you when it launches.";
        waitlistForm.reset();
      }
      waitlistMessage.hidden = false;
    } catch {
      waitlistMessage.style.color = 'var(--fail)';
      waitlistMessage.textContent = 'Could not reach the server. Please try again.';
      waitlistMessage.hidden = false;
    } finally {
      waitlistButton.disabled = false;
    }
  });

  initAnalytics();
})();
